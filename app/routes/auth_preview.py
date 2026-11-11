"""Isolated auth UX preview. Registered only in development; no session or API access."""
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.login_errors import PREVIEW_MESSAGES
from app.routes.shared import templates

router = APIRouter(prefix="/dev/auth-preview", include_in_schema=False)


@router.get("", response_class=HTMLResponse)
def auth_preview(request: Request):
    return templates.TemplateResponse(
        "auth_preview.html",
        {"request": request, "messages": PREVIEW_MESSAGES},
        headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"},
    )
