import json
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.main import app


def user_cookie(*pages):
    permissions = {"accessible_pages": [{"identifier": item} for item in pages], "accessible_backlogs": []}
    return json.dumps({"user_id": 42, "pnr": "42", "first_name": "Erika", "last_name": "Test",
                       "primary_role": {"name": "Agent"}, "secondary_roles": [], "sofa_permissions": permissions})


def api_error(status_code, detail):
    request = httpx.Request("POST", "http://api/access/systems/9/resource-types")
    response = httpx.Response(status_code, json={"detail": detail}, request=request)
    return httpx.HTTPStatusError("error", request=request, response=response)


class ResourceTypeProxyTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.cookies.set("sofa_user", user_cookie("SOFA-PAGE-SYS"))
        self.calls = []

    def test_list_needs_system_page(self):
        async def listing(system_id):
            self.calls.append(("list", system_id))
            return [{"type_id": 6, "system_id": 9, "name": "Queue", "slug": "QUEUE", "resource_count": 24}]

        with patch("app.routes.api.api_client.get_system_resource_types", listing):
            self.assertEqual(self.client.get("/api/systems/9/resource-types").json()[0]["slug"], "QUEUE")
            self.client.cookies.set("sofa_user", user_cookie("SOFA-PAGE-ROLE"))
            self.assertEqual(self.client.get("/api/systems/9/resource-types").status_code, 403)
        self.assertEqual(self.calls, [("list", 9)])

    def test_create_forwards_only_name_and_slug(self):
        async def create(system_id, payload):
            self.calls.append(("create", system_id, payload))
            return {"type_id": 7, "system_id": system_id, **payload}

        with patch("app.routes.api.api_client.create_system_resource_type", create):
            response = self.client.post("/api/systems/9/resource-types", json={"name": "Queue", "slug": "QUEUE", "system_id": 1})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.calls, [("create", 9, {"name": "Queue", "slug": "QUEUE"})])

    def test_conflicts_pass_through(self):
        async def create(system_id, payload):
            raise api_error(409, "Kuerzel QUEUE ist schon vergeben")

        async def delete(system_id, type_id):
            raise api_error(409, "Typ ist noch in Verwendung")

        with patch("app.routes.api.api_client.create_system_resource_type", create), \
                patch("app.routes.api.api_client.delete_system_resource_type", delete):
            created = self.client.post("/api/systems/9/resource-types", json={"name": "Queue", "slug": "QUEUE"})
            deleted = self.client.delete("/api/systems/9/resource-types/6")
        self.assertEqual((created.status_code, created.json()["detail"]), (409, "Kuerzel QUEUE ist schon vergeben"))
        self.assertEqual((deleted.status_code, deleted.json()["detail"]), (409, "Typ ist noch in Verwendung"))

    def test_delete_answers_without_body(self):
        async def delete(system_id, type_id):
            self.calls.append(("delete", system_id, type_id))
            return {}

        with patch("app.routes.api.api_client.delete_system_resource_type", delete):
            response = self.client.delete("/api/systems/9/resource-types/6")
        self.assertEqual((response.status_code, response.content), (204, b""))
        self.assertEqual(self.calls, [("delete", 9, 6)])


class BacklogProxyTests(unittest.TestCase):
    def test_backlogs_for_system_page_keep_access_filter(self):
        async def backlogs():
            return [{"technical_identifier": "SOFA-BKLG-IT", "name": "IT"}, {"technical_identifier": "SOFA-BKLG-HR", "name": "HR"}]

        client = TestClient(app)
        cookie = json.loads(user_cookie("SOFA-PAGE-SYS"))
        cookie["sofa_permissions"]["accessible_backlogs"] = [{"identifier": "SOFA-BKLG-IT"}]
        client.cookies.set("sofa_user", json.dumps(cookie))
        with patch("app.routes.api.api_client.get_backlogs", backlogs):
            response = client.get("/api/backlogs")
            client.cookies.set("sofa_user", user_cookie("SOFA-PAGE-USER"))
            denied = client.get("/api/backlogs")
        self.assertEqual([b["technical_identifier"] for b in response.json()], ["SOFA-BKLG-IT"])
        self.assertEqual(denied.status_code, 403)


class ResourceRolesProxyTests(unittest.TestCase):
    def test_roles_for_system_or_role_page(self):
        async def roles(resource_id):
            if resource_id == 404:
                raise api_error(404, "Ressource nicht gefunden")
            return [{"role_id": 7, "name": "Agent", "inherited": False}]

        client = TestClient(app)
        with patch("app.routes.api.api_client.get_resource_roles", roles):
            for page in ("SOFA-PAGE-SYS", "SOFA-PAGE-ROLE"):
                client.cookies.set("sofa_user", user_cookie(page))
                self.assertEqual(client.get("/api/resources/9003/roles").json()[0]["role_id"], 7)
            self.assertEqual(client.get("/api/resources/404/roles").status_code, 404)
            client.cookies.set("sofa_user", user_cookie("SOFA-PAGE-USER"))
            self.assertEqual(client.get("/api/resources/9003/roles").status_code, 403)


if __name__ == "__main__":
    unittest.main()
