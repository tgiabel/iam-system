import os
from urllib.parse import quote

from fastapi import FastAPI, Request  # type: ignore
from fastapi.responses import JSONResponse, RedirectResponse  # type: ignore
from fastapi.staticfiles import StaticFiles  # type: ignore
from starlette.middleware.base import BaseHTTPMiddleware  # type: ignore

from app.authz import SessionRequired
from app.session import APP_ENV, safe_next, service_key
from app.session_gate import SessionGateMiddleware

from app.routes.api import router as api_router
from app.routes.agent_stats_report import router as agent_stats_report_router
from app.routes.dashboard import router as dashboard_router
from app.routes.genesys_live import router as genesys_live_router
from app.routes.logon_log import router as logon_log_router
from app.routes.pages import router as page_router
from app.routes.presence_report import router as presence_report_router
from app.routes.service_level import router as service_level_router
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


_SESSION_MESSAGES = {
    "unavailable": ("service_unavailable", "Der Anmeldedienst ist nicht erreichbar. Bitte versuche es später erneut."),
    "expired": ("session_expired", "Deine Sitzung ist abgelaufen."),
    "revoked": ("session_revoked", "Deine Sitzung wurde beendet."),
    "logged_out": ("session_revoked", "Du bist abgemeldet."),
}


@app.exception_handler(SessionRequired)
async def session_required(request: Request, exc: SessionRequired):
    """HTML: Loginseite mit Ruecksprungziel. JSON (/api/): 401 mit Code, kein Redirect.
    Ist SD-API nicht erreichbar: 503, das Cookie bleibt."""
    problem = exc.problem
    if request.url.path.startswith("/api/"):
        code, message = _SESSION_MESSAGES.get(problem or "", ("session_missing", "Bitte melde dich an."))
        status = 503 if problem == "unavailable" else 401
        headers = {"Cache-Control": "no-store"}
        if status == 503:
            headers["Retry-After"] = "30"
        return JSONResponse({"detail": {"code": code, "message": message}}, status_code=status, headers=headers)
    target = safe_next(request.url.path + (f"?{request.url.query}" if request.url.query else ""))
    location = "/login"
    params = []
    if target != "/":
        params.append("next=" + quote(target, safe="/"))
    if problem in ("expired", "revoked", "logged_out"):
        params.append("reason=" + problem)
    if params:
        location += "?" + "&".join(params)
    return RedirectResponse(location, status_code=303)


@app.get("/health", include_in_schema=False)
def health():
    import os

    return {
        "status": "ok",
        "release": os.getenv("RELEASE_SHA", "development"),
        "env": os.getenv("APP_ENV", "production"),
    }


# Reihenfolge: zuletzt hinzugefuegt laeuft zuerst. ForwardedHeader setzt Host/Scheme, bevor die
# Sitzungspruefung Origin gegen Host vergleicht.
app.add_middleware(SessionGateMiddleware)
app.add_middleware(ForwardedHeaderMiddleware)
app.mount("/static", StaticFiles(directory=static_path), name="static")
app.include_router(page_router)
app.include_router(api_router)
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
