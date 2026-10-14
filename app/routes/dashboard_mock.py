"""Mock-Daten fuer das Dashboard. Wird nur in der Entwicklungsinstanz eingebunden (app/main.py)."""
from fastapi import APIRouter, Depends, Query  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore

from app import dashboard_mock as mock
from app.authz import require_login

router = APIRouter(prefix="/dashboard-mock", include_in_schema=False)

NO_STORE = {"Cache-Control": "no-store"}


@router.get("/tasks-overview")
def tasks_overview(scenario: str = Query("normal"), authz=Depends(require_login)):
    return JSONResponse(mock.mock_tasks_overview(scenario), headers=NO_STORE)


@router.get("/events")
def events(
    scenario: str = Query("normal"),
    from_date: str | None = Query(None),
    to_date: str | None = Query(None),
    authz=Depends(require_login),
):
    data = mock.filter_events(mock.mock_events(scenario), from_date, to_date)
    return JSONResponse(data, headers=NO_STORE)


@router.get("/genesys-live")
def genesys_live(scenario: str = Query("normal"), authz=Depends(require_login)):
    return JSONResponse(mock.mock_genesys_live(scenario), headers=NO_STORE)


@router.get("/service-level")
def service_level(scenario: str = Query("normal"), authz=Depends(require_login)):
    return JSONResponse(mock.mock_service_level(scenario), headers=NO_STORE)
