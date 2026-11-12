"""Release Notes: Seite fuer alle Angemeldeten und die eigenen Notes als JSON."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Request  # type: ignore
from fastapi.responses import HTMLResponse  # type: ignore

from app import release_notes
from app.authz import require_login
from app.routes.shared import _build_template_context, templates

router = APIRouter()


@router.get("/releases", response_class=HTMLResponse)
async def releases_page(request: Request, app: str | None = None, authz=Depends(require_login)):
    page = release_notes.build_page(release_notes.load_own(), await release_notes.load_api(), app)
    return templates.TemplateResponse(
        "releases.html", _build_template_context(request, user=authz.raw_user, authz=authz, **page)
    )


@router.get("/api/meta/releases")
def own_releases(authz=Depends(require_login)):
    notes = release_notes.load_own()
    return {**notes, "version": release_notes.current_version(), "release_sha": os.getenv("RELEASE_SHA", "development")}
