"""Daten der Dashboard-Card "Mein Tag": erledigte Aufgaben und angenommene Anrufe eines Tages."""
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.api_client import api_client
from app.authz import require_login

router = APIRouter(prefix='/dashboard')


async def _tasks_completed(user_id: int, day: date) -> int:
    overview = await api_client.get_task_overview(user_id, completed_since=day.isoformat())
    # completed_at ist lokal-naiv (Europe/Berlin), das Datum steht also vorne.
    return sum(1 for task in overview.get('completed_tasks') or []
               if task.get('assigned_to_user_id') == user_id and str(task.get('completed_at') or '')[:10] == day.isoformat())


async def _calls_answered(day: date) -> int:
    response = await api_client.agent_stats_request(params=[('period', 'day'), ('anchor', day.isoformat())])
    response.raise_for_status()
    phone = response.json().get('phone') or {}
    return int((phone.get('summary') or {}).get('answered') or 0) if phone.get('available') else 0


@router.get('/my-day')
async def my_day(day: date = Query(alias='date'), authz=Depends(require_login)):
    """Jeder Teil nur mit eigener Berechtigung; faellt einer aus, fehlt nur sein Wert."""
    result = {'date': day.isoformat()}
    if authz.has_permission('SOFA-PAGE-TODO'):
        try:
            result['tasks_completed'] = await _tasks_completed(authz.user_id, day)
        except Exception:
            pass
    try:
        result['calls_answered'] = await _calls_answered(day)
    except Exception:
        pass
    return JSONResponse(result, headers={'Cache-Control': 'no-store'})
