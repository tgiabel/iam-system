import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
import subprocess
from unittest.mock import patch
import httpx
from starlette.datastructures import QueryParams
from app.authz import AuthorizationContext
from app.api_client import APIClient, REPORTING_BASE_URL
from app.routes import logon_log as ll, pages


def authz(*permissions):
    return AuthorizationContext(user_id=42,pnr='00042',primary_role_name='Pruefer',permissions=frozenset(permissions),
                                accessible_backlogs=frozenset(),has_all_backlog_access=False,raw_user={'user_id':42})


class ProxyTests(unittest.TestCase):
    def test_report_and_function_permission_matrix(self):
        for function in (None,ll.NAMES,ll.CHECK):
            with self.assertRaises(Exception):ll.authorize(authz(),function)
            if function:
                with self.assertRaises(Exception):ll.authorize(authz(ll.REPORT),function)
            ll.authorize(authz(ll.REPORT,*([] if function is None else [function])),function)
        ll.authorize(authz('SOFA-RPRT-ALL','SOFA-FN-ALL'),ll.CHECK)

    def test_check_permission_does_not_grant_name_function(self):
        with self.assertRaises(Exception):ll.authorize(authz(ll.REPORT,ll.CHECK),ll.NAMES)

    def test_client_forwards_only_server_actor(self):
        client=APIClient();calls=[]
        async def request(*args,**kwargs):calls.append((args,kwargs));return 'ok'
        client._request=request
        result=asyncio.run(client.logon_log_request('GET','/day',42,params={'day':'2026-09-18'}))
        self.assertEqual(result,'ok')
        self.assertEqual(calls[0][0],('GET',REPORTING_BASE_URL,'/logon-log/day'))
        self.assertEqual(calls[0][1]['headers'],{'X-User-Id':'42'})

    def test_proxy_preserves_backend_error_and_no_store(self):
        request=SimpleNamespace(query_params=QueryParams({'day':'2026-09-18'}))
        async def backend(*args,**kwargs):
            response=httpx.Response(409,json={'detail':{'code':'review_changed','message':'Neu laden'}},request=httpx.Request('GET','http://test/day'))
            raise httpx.HTTPStatusError('Conflict',request=response.request,response=response)
        with patch.object(ll.api_client,'logon_log_request',backend):
            response=asyncio.run(ll.forward(request,authz(ll.REPORT),'GET','/day'))
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(json.loads(response.body)['detail']['code'],'review_changed')

    def test_proxy_preserves_csv_bytes(self):
        request=SimpleNamespace(query_params=QueryParams({'scope':'day'}))
        async def backend(*args,**kwargs):return httpx.Response(200,content=b'Id;Username\r\n1;YC00001\r\n',headers={'content-type':'text/csv','content-disposition':'attachment; filename="logon-log.csv"'})
        with patch.object(ll.api_client,'logon_log_request',backend):response=asyncio.run(ll.export(request,authz(ll.REPORT)))
        self.assertEqual(response.body,b'Id;Username\r\n1;YC00001\r\n')
        self.assertIn('attachment',response.headers['content-disposition'])

    def test_export_scope_all_requires_names(self):
        request=SimpleNamespace(query_params=QueryParams({'scope':'all'}))
        with self.assertRaises(Exception):asyncio.run(ll.export(request,authz(ll.REPORT)))

    def test_range_queries_get_long_timeout_and_keep_repeated_params(self):
        calls=[]
        async def backend(*args,**kwargs):calls.append(kwargs);return httpx.Response(200,json={})
        with patch.object(ll.api_client,'logon_log_request',backend):
            asyncio.run(ll.day(SimpleNamespace(query_params=QueryParams('day=2026-09-18')),authz(ll.REPORT)))
            asyncio.run(ll.export(SimpleNamespace(query_params=QueryParams('scope=day&status=open&status=changed')),authz(ll.REPORT)))
            asyncio.run(ll.analysis(SimpleNamespace(query_params=QueryParams('user_id=1')),authz(ll.REPORT,ll.NAMES)))
            asyncio.run(ll.export(SimpleNamespace(query_params=QueryParams('scope=all')),authz(ll.REPORT,ll.NAMES)))
        self.assertEqual([c['timeout'] for c in calls],[None,None,ll.LOGON_LOG_RANGE_TIMEOUT_SECONDS,ll.LOGON_LOG_RANGE_TIMEOUT_SECONDS])
        self.assertEqual(calls[1]['params'],[('scope','day'),('status','open'),('status','changed')])

    def test_page_and_tools_include_report_right(self):
        import inspect
        dependency=inspect.signature(pages.logon_log_tool).parameters['authz'].default.dependency
        self.assertIsNotNone(asyncio.run(dependency(authz(ll.REPORT))))
        with self.assertRaises(Exception):asyncio.run(dependency(authz()))
        root=Path(__file__).parents[1]
        self.assertIn('href="/tools/logon-log"',(root/'app/templates/tools.html').read_text())
        tools_route=next(line for line in (root/'app/routes/pages.py').read_text().splitlines() if line.startswith('def tools('))
        self.assertIn('"SOFA-RPRT-LL"',tools_route)

    def test_sensitive_controls_are_gated_by_template(self):
        from jinja2 import Environment,FileSystemLoader
        root=Path(__file__).parents[1]
        env=Environment(loader=FileSystemLoader(root/'app/templates'))
        template=env.from_string((root/'app/templates/reports/logon_log.html').read_text().replace('{% extends "base.html" %}',''))
        reader=template.render(authz=authz(ll.REPORT))
        checker=template.render(authz=authz(ll.REPORT,ll.CHECK))
        self.assertNotIn('id="llAnalyze"',reader)
        self.assertNotIn('id="llNames"',checker)
        self.assertIn('data-can-check="true"',checker)


class RealRouteTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.authz import build_authorization_context
        self.app=app
        self.context=authz(ll.REPORT)
        app.dependency_overrides[build_authorization_context]=lambda:self.context
        self.addCleanup(app.dependency_overrides.clear)
        self.client=TestClient(app)

    def test_page_renders_report_and_hides_sensitive_controls(self):
        response=self.client.get('/tools/logon-log')
        self.assertEqual(response.status_code,200)
        self.assertIn('id="llReport"',response.text)
        self.assertNotIn('id="llNames"',response.text)
        self.assertNotIn('id="llAnalyze"',response.text)
        self.assertIn('Anmeldeprotokoll',self.client.get('/tools').text)

    def test_proxy_is_mounted_and_ignores_browser_actor_header(self):
        calls=[]
        async def backend(*args,**kwargs):calls.append((args,kwargs));return httpx.Response(200,json={'events':[]})
        with patch.object(ll.api_client,'logon_log_request',backend):
            response=self.client.get('/api/reporting/logon-log/day',headers={'X-User-Id':'999'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(calls[0][0][2],42)

    def test_proxy_rejects_names_without_function_permission(self):
        response=self.client.post('/api/reporting/logon-log/names',json={'usernames':['YC00001']})
        self.assertEqual(response.status_code,403)



class FrontendLogicTests(unittest.TestCase):
    def test_grouping_filters_and_date_logic_in_node(self):
        script=Path(__file__).with_name('logon_log_checks.js')
        result=subprocess.run(['node',str(script)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)



if __name__=='__main__':unittest.main()
