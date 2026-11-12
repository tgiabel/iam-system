import os
from urllib.parse import quote

from fastapi import FastAPI, Request  # type: ignore
from fastapi.responses import RedirectResponse  # type: ignore
from fastapi.staticfiles import StaticFiles  # type: ignore
from starlette.middleware.base import BaseHTTPMiddleware  # type: ignore

from app import login_errors
from app.authz import SessionRequired
from app.session import APP_ENV, safe_next, service_key
from app.session_gate import SessionGateMiddleware, session_error

from app.routes.api import router as api_router
from app.routes.agent_stats_report import router as agent_stats_report_router
from app.routes.dashboard import router as dashboard_router
from app.routes.genesys_live import router as genesys_live_router
from app.routes.logon_log import router as logon_log_router
from app.routes.pages import router as page_router
from app.routes.presence_report import router as presence_report_router
from app.routes.releases import router as releases_router
from app.routes.service_level import router as service_level_router
from app.routes.session_api import router as session_api_router
from app.routes.shared import static_path
from app.routes.token_deletions_report import router as token_deletions_report_router
from app.routes.time_corrections import router as time_corrections_router


class ForwardedHeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        forwarded_proto = request.headers.get("x-forwarded-proto")
        forwarded_host = request.headers.get("x-forwarded-host")

        if forwarded_proto:
            request.scope["scheme"] = forwarded_proto.split(",")[0].strip()

        if forwarded_host:
            host = forwarded_host.split(",")[0].strip()
            request.scope["server"] = (host, 443 if request.scope.get("scheme") == "https" else 80)
            request.scope["headers"] = [
                (key, value) if key != b"host" else (b"host", host.encode("latin-1"))
                for key, value in request.scope["headers"]
            ]

        return await call_next(request)


app = FastAPI(title="SOFA Frontend")


@app.on_event("startup")
def require_service_key():
    # Ohne Dienstnachweis entsteht bei SD-API keine Sitzung; lieber nicht starten als niemanden anmelden.
    if APP_ENV == "production" and not service_key():
        raise RuntimeError("SD_API_SERVICE_KEY fehlt")


_SESSION_CODES = {"expired": "session_expired", "revoked": "session_revoked", "logged_out": "session_revoked"}


@app.exception_handler(SessionRequired)
async def session_required(request: Request, exc: SessionRequired):
    """HTML: Loginseite mit Ruecksprungziel. JSON (/api/): 401 mit Code, kein Redirect.
    Ist SD-API nicht erreichbar: 503, das Cookie bleibt."""
    problem = exc.problem or ""
    if request.url.path.startswith("/api/"):
        if problem == "unavailable":
            return session_error("service_unavailable", login_errors.UNAVAILABLE, 503)
        if problem in _SESSION_CODES:
            return session_error(_SESSION_CODES[problem], login_errors.SESSION_ENDED[problem], 401)
        return session_error("session_missing", login_errors.SIGN_IN, 401)
    target = safe_next(request.url.path + (f"?{request.url.query}" if request.url.query else ""))
    location = "/login"
    params = []
    if target != "/":
        params.append("next=" + quote(target, safe="/"))
    if problem in _SESSION_CODES:
        params.append("reason=" + problem)
    if params:
        location += "?" + "&".join(params)
    return RedirectResponse(location, status_code=303)


@app.get("/health", include_in_schema=False)
def health():
    import os

    from app.release_notes import current_version

    return {
        "status": "ok",
        "version": current_version(),
        "release": os.getenv("RELEASE_SHA", "development"),
        "env": os.getenv("APP_ENV", "production"),
    }


# Reihenfolge: zuletzt hinzugefuegt laeuft zuerst. ForwardedHeader setzt Host/Scheme, bevor die
# Sitzungspruefung Origin gegen Host vergleicht.
app.add_middleware(SessionGateMiddleware)
app.add_middleware(ForwardedHeaderMiddleware)
app.mount("/static", StaticFiles(directory=static_path), name="static")
app.include_router(page_router)
app.include_router(releases_router)
app.include_router(api_router)
app.include_router(session_api_router)
app.include_router(logon_log_router, prefix="/api")
app.include_router(time_corrections_router, prefix="/api")
app.include_router(presence_report_router, prefix="/api")
app.include_router(agent_stats_report_router, prefix="/api")
app.include_router(genesys_live_router, prefix="/api")
app.include_router(service_level_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(token_deletions_report_router, prefix="/api")

# Mock-Daten fuer das Dashboard-Design gibt es nur in der Entwicklungsinstanz.
if os.getenv("APP_ENV") == "development":
    from app.routes.dashboard_mock import router as dashboard_mock_router

    app.include_router(dashboard_mock_router, prefix="/api")
