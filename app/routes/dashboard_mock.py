"""Mock-Daten fuer das Dashboard. Wird nur in der Entwicklungsinstanz eingebunden (app/main.py)."""
from datetime import date

from fastapi import APIRouter, Depends, Query  # type: ignore
from fastapi.responses import JSONResponse  # type: ignore

from app import dashboard_mock as mock
from app.authz import require_login

router = APIRouter(prefix="/dashboard-mock", include_in_schema=False)

NO_STORE = {"Cache-Control": "no-store"}


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
def service_level(scenario: str = Query("normal"), queue_id: str | None = Query(None),
                  group_id: str | None = Query(None), authz=Depends(require_login)):
    return JSONResponse(mock.mock_service_level(scenario, queue_id=queue_id, group_id=group_id), headers=NO_STORE)


@router.get("/my-day")
def my_day(scenario: str = Query("normal"), day: date | None = Query(None, alias="date"), authz=Depends(require_login)):
    return JSONResponse(mock.mock_my_day(scenario, day), headers=NO_STORE)
