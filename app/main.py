from fastapi import FastAPI  # type: ignore
from fastapi.staticfiles import StaticFiles  # type: ignore
from starlette.middleware.base import BaseHTTPMiddleware  # type: ignore

from app.routes.api import router as api_router
from app.routes.agent_stats_report import router as agent_stats_report_router
from app.routes.logon_log import router as logon_log_router
from app.routes.pages import router as page_router
from app.routes.presence_report import router as presence_report_router
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
app.add_middleware(ForwardedHeaderMiddleware)
app.mount("/static", StaticFiles(directory=static_path), name="static")
app.include_router(page_router)
app.include_router(api_router)
app.include_router(logon_log_router, prefix="/api")
app.include_router(time_corrections_router, prefix="/api")
app.include_router(presence_report_router, prefix="/api")
app.include_router(agent_stats_report_router, prefix="/api")
app.include_router(token_deletions_report_router, prefix="/api")
