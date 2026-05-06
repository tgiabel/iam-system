from datetime import date

import httpx  # type: ignore
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile  # type: ignore
from fastapi.responses import JSONResponse, StreamingResponse  # type: ignore

from app.api_client import api_client
from app.authz import (
    require_any_page_access,
    require_capability,
    require_login,
    require_page_access,
)
from app.helpers.datex import build_datex_export
from app.routes.shared import (
    _build_template_context,
    _coerce_bool,
    _coerce_int,
    _error_content_from_response,
    _filter_processes_for_scope,
    _filter_tasks_for_scope,
    _first_defined_value,
    _get_relevant_task_or_raise,
    _normalize_events_payload,
    _summarize_process,
    _summarize_task_action,
    _task_matches_initiator,
    _task_matches_target_user,
    templates,
)


router = APIRouter(prefix="/api")


@router.post("/tools/datex/convert")
async def convert_datex_file(
    request: Request,
    datfile: UploadFile = File(...),
    authz=Depends(require_login),
):
    try:
        if not datfile.filename:
            return templates.TemplateResponse(
                "tools/datex_tool.html",
                _build_template_context(
                    request,
                    user=authz.raw_user,
                    authz=authz,
                    flash_messages=[("failure", "Bitte waehlen Sie eine DAT-Datei aus.")],
                ),
                status_code=400,
            )

        filename, workbook = build_datex_export(await datfile.read())
    except ValueError as exc:
        return templates.TemplateResponse(
            "tools/datex_tool.html",
            _build_template_context(
                request,
                user=authz.raw_user,
                authz=authz,
                flash_messages=[("failure", str(exc))],
            ),
            status_code=400,
        )
    finally:
        await datfile.close()

    return StreamingResponse(
        workbook,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/users")
async def api_users(
    is_active: bool = True,
    current_user=Depends(require_page_access("users")),
):
    try:
        users = await api_client.list_users(is_active=is_active)
        if current_user.get_scope("users") == "none":
            return JSONResponse(content=[])
        return JSONResponse(content=users)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/users/{user_id}/details")
async def api_user_details(user_id: int, current_user=Depends(require_page_access("users"))):
    try:
        user_detail = await api_client.get_user_details(user_id)
        return JSONResponse(content=user_detail)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/users/{user_id}/activity")
async def api_user_activity(user_id: int, current_user=Depends(require_page_access("users"))):
    try:
        activity = await api_client.get_user_activity(user_id)
        return JSONResponse(content=activity)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code != 404:
            return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception:
        pass

    try:
        user_detail = await api_client.get_user_details(user_id)
        all_tasks = await api_client.list_tasks()
        completed_tasks = await api_client.list_tasks(status="COMPLETED", assigned_to_user_id=user_id)

        affected_buckets: dict[str, list[dict]] = {}
        initiated_buckets: dict[str, list[dict]] = {}

        for task in all_tasks:
            process_id = str(_first_defined_value(task, ["process_id", "id", "task_id"], "unknown"))

            if _task_matches_target_user(task, user_id, user_detail):
                affected_buckets.setdefault(process_id, []).append(task)

            if _task_matches_initiator(task, user_id, user_detail):
                initiated_buckets.setdefault(process_id, []).append(task)

        affected_processes = [
            _summarize_process(process_id, tasks)
            for process_id, tasks in affected_buckets.items()
        ]
        initiated_processes = [
            _summarize_process(process_id, tasks)
            for process_id, tasks in initiated_buckets.items()
        ]
        recent_task_actions = [
            _summarize_task_action(task)
            for task in sorted(
                completed_tasks,
                key=lambda item: str(_first_defined_value(item, ["completed_at", "updated_at", "created_at"], "")),
                reverse=True,
            )[:5]
        ]

        return JSONResponse(
            content={
                "affected_processes": affected_processes,
                "initiated_processes": initiated_processes,
                "recent_task_actions": recent_task_actions,
            }
        )
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/events")
async def api_events(current_user=Depends(require_page_access("console"))):
    try:
        events = await api_client.get_events()
        return JSONResponse(content=_normalize_events_payload(events))
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/task_backlogs")
async def api_task_backlogs(current_user=Depends(require_login)):
    try:
        backlogs = await api_client.get_task_backlogs()
        return JSONResponse(content=backlogs)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/users/{user_id}/sofa-access/setup")
async def api_setup_user_sofa_access(user_id: int, payload: dict, current_user=Depends(require_capability("sofa_access.setup"))):
    try:
        request_payload = {
            "password": payload.get("password"),
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.setup_user_sofa_access(user_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/users/{user_id}/sofa-access/reset-password")
async def api_reset_user_sofa_password(user_id: int, payload: dict, current_user=Depends(require_capability("sofa_access.reset"))):
    try:
        request_payload = {
            "password": payload.get("password"),
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.reset_user_sofa_password(user_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/users/{user_id}/sofa-access/revoke")
async def api_revoke_user_sofa_access(user_id: int, current_user=Depends(require_capability("sofa_access.revoke"))):
    try:
        request_payload = {"initiator_user_id": current_user.user_id}
        result = await api_client.revoke_user_sofa_access(user_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/roles/{role_id}/resources")
async def api_role_resources(role_id: int, current_user=Depends(require_page_access("roles"))):
    try:
        resources = await api_client.get_role_resources(role_id)
        return JSONResponse(content=resources)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/tasks/view")
async def api_list_tasks(
    status: str | None = None,
    type: str | None = None,
    handling_type: str | None = None,
    assigned_to_user_id: int | None = None,
    process_id: int | None = None,
    current_user=Depends(require_login),
):
    try:
        tasks = await api_client.list_tasks(
            status=status,
            type=type,
            handling_type=handling_type,
            assigned_to_user_id=assigned_to_user_id,
            process_id=process_id,
        )
        return JSONResponse(content=_filter_tasks_for_scope(tasks, current_user))
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.patch("/tasks/{task_id}/assign")
async def api_assign_task(task_id: int, user_id: int, current_user=Depends(require_login)):
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        if int(user_id) != int(current_user.user_id):
            raise HTTPException(
                status_code=403,
                detail={"code": "assignment_denied", "message": "Tasks koennen nur an den aktuellen User uebernommen werden."},
            )
        return await api_client.assign_task(task_id, current_user.user_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.json().get("detail", "Backend error"),
        )
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/tasks/{task_id}/assign")
async def api_unassign_task(task_id: int, current_user=Depends(require_login)):
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        task = await api_client.unassign_task(task_id, current_user.user_id)
        return JSONResponse(content=task)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/tasks/{task_id}/complete")
async def api_complete_task(task_id: int, payload: dict, current_user=Depends(require_login)):
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        user_id = current_user.user_id
        account_identifier = payload.get("account_identifier")
        comment = payload.get("comment")
        task = await api_client.complete_task(task_id, user_id, account_identifier, comment)
        return JSONResponse(content=task)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/tasks/dispatch_bot")
async def api_dispatch_bot(payload: dict, current_user=Depends(require_login)):
    try:
        task_id = payload.get("task_id")
        await _get_relevant_task_or_raise(task_id, current_user)
        result = await api_client.dispatch_bot(task_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/tasks/{task_id}/send_mail")
async def api_send_task_mail(task_id: int, payload: dict, current_user=Depends(require_login)):
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.send_task_mail(task_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/account/change-password")
async def api_change_own_password(payload: dict, current_user=Depends(require_login)):
    current_password = str(payload.get("current_password") or "").strip()
    new_password = str(payload.get("new_password") or "").strip()

    if not current_password or not new_password:
        return JSONResponse(
            content={"detail": "Aktuelles Passwort und neues Passwort sind erforderlich."},
            status_code=400,
        )

    if current_password == new_password:
        return JSONResponse(
            content={"detail": "Das neue Passwort muss sich vom aktuellen Passwort unterscheiden."},
            status_code=400,
        )

    user_id = current_user.user_id
    pnr = current_user.pnr

    if not pnr:
        return JSONResponse(
            content={"detail": "Die Personalnummer des aktuellen Users konnte nicht ermittelt werden."},
            status_code=400,
        )

    try:
        result = await api_client.change_own_sofa_password(
            user_id=user_id,
            current_password=current_password,
            new_password=new_password,
        )
        return JSONResponse(content=result or {"status": "success"})
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/onboarding/lookup")
async def api_lookup_onboarding_candidate(
    payload: dict,
    current_user=Depends(require_capability("onboarding.start")),
):
    pnr = str(payload.get("pnr") or "").strip()
    if not pnr:
        return JSONResponse(content={"detail": "Die Personalnummer ist erforderlich."}, status_code=400)

    try:
        result = await api_client.lookup_onboarding_candidate(
            {"pnr": pnr, "initiator_user_id": current_user.user_id}
        )
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/onboarding")
async def api_start_onboarding_process(
    payload: dict,
    current_user=Depends(require_capability("onboarding.start")),
):
    mode = str(payload.get("mode") or "").strip().lower()
    confirmed = bool(payload.get("confirmed"))

    if not confirmed:
        return JSONResponse(
            content={"detail": "Das Onboarding muss vor dem Start bestätigt werden."},
            status_code=400,
        )

    forwarded_payload = {
        "mode": mode,
        "confirmed": True,
        "initiator_user_id": current_user.user_id,
    }

    if mode == "helix":
        lookup_token = str(payload.get("lookup_token") or "").strip()
        telephone = str(payload.get("telephone") or "").strip()
        entry_date = str(payload.get("entry_date") or "").strip()
        weekly_hours = _coerce_int(payload.get("weekly_hours"))
        if not lookup_token:
            return JSONResponse(content={"detail": "Der Lookup-Token ist erforderlich."}, status_code=400)
        forwarded_payload["lookup_token"] = lookup_token
        if telephone:
            forwarded_payload["telephone"] = telephone
        if entry_date:
            forwarded_payload["entry_date"] = entry_date
        if weekly_hours is not None:
            forwarded_payload["weekly_hours"] = weekly_hours
    elif mode == "manual":
        pnr = str(payload.get("pnr") or "").strip()
        first_name = str(payload.get("first_name") or "").strip()
        last_name = str(payload.get("last_name") or "").strip()
        primary_role_id = _coerce_int(payload.get("primary_role_id"))
        telephone = str(payload.get("telephone") or "").strip()
        entry_date = str(payload.get("entry_date") or "").strip()
        weekly_hours = _coerce_int(payload.get("weekly_hours"))

        if (
            not pnr
            or not first_name
            or not last_name
            or primary_role_id is None
            or not telephone
            or not entry_date
            or weekly_hours is None
        ):
            return JSONResponse(
                content={"detail": "Für das manuelle Onboarding sind alle Pflichtfelder erforderlich."},
                status_code=400,
            )

        forwarded_payload.update(
            {
                "pnr": pnr,
                "first_name": first_name,
                "last_name": last_name,
                "primary_role_id": primary_role_id,
                "telephone": telephone,
                "entry_date": entry_date,
                "weekly_hours": weekly_hours,
            }
        )
    else:
        return JSONResponse(content={"detail": "Unbekannter Onboarding-Modus."}, status_code=400)

    try:
        result = await api_client.trigger_onboarding(forwarded_payload)
        return JSONResponse(
            content={
                "process_id": result.get("process_id"),
                "status": result.get("status", "started"),
            }
        )
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/onboarding-ext")
async def api_start_ext_onboarding_process(
    payload: dict,
    current_user=Depends(require_capability("onboarding.external.start")),
):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_ext_onboarding(payload)
        return JSONResponse(content={"process_id": result["process_id"], "status": "started"})
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/tasks/overview")
async def api_tasks_overview(current_user=Depends(require_login)):
    try:
        user_id = current_user.user_id
        tasks = await api_client.get_task_overview(user_id)
        for key in ("open_tasks", "blocked_tasks", "user_tasks", "completed_tasks"):
            if isinstance(tasks.get(key), list):
                tasks[key] = _filter_tasks_for_scope(tasks[key], current_user)
        return JSONResponse(content=tasks)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/processes/overview")
async def api_processes_overview(current_user=Depends(require_login)):
    try:
        user_id = current_user.user_id
        processes = await api_client.get_process_overview(user_id)

        for key in ("running_processes", "completed_processes"):
            if isinstance(processes.get(key), list):
                processes[key] = _filter_processes_for_scope(processes[key], current_user)

        return JSONResponse(content=processes)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/resources/mail_template")
async def api_get_mail_template(payload: dict, current_user=Depends(require_login)):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.get_mail_template(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/tasks/{task_id}/history")
async def api_task_logs(task_id, current_user=Depends(require_login)):
    try:
        await _get_relevant_task_or_raise(int(task_id), current_user)
        history = await api_client.get_task_logs(task_id)
        return JSONResponse(content=history)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/systems")
async def api_system_overview(current_user=Depends(require_page_access("systems"))):
    try:
        systems = await api_client.get_system_overview()
        return JSONResponse(content=systems)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/systems")
async def api_create_system(payload: dict, current_user=Depends(require_page_access("systems"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.create_system(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/systems/map")
async def api_system_map(current_user=Depends(require_any_page_access("systems", "users"))):
    try:
        systems = await api_client.get_system_map()
        system_map = {
            system["system_id"]: {"name": system["name"], "type": system.get("type")}
            for system in systems
        }
        return JSONResponse(content=system_map)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/systems/{system_id}")
async def api_get_system_detail(system_id: int, current_user=Depends(require_page_access("systems"))):
    try:
        system_detail = await api_client.get_system_detail(system_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/systems/{system_id}")
async def api_update_system(system_id: int, payload: dict, current_user=Depends(require_page_access("systems"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.update_system(system_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/systems/{system_id}/resources")
async def api_get_system_resources(system_id: int, current_user=Depends(require_page_access("systems"))):
    try:
        system_detail = await api_client.get_system_resources(system_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/resources")
async def api_list_resources(
    type_id: int | None = None,
    search: str | None = None,
    limit: int | None = None,
    current_user=Depends(require_page_access("systems")),
):
    try:
        params = {}
        if type_id is not None:
            params["type_id"] = type_id
        if search:
            params["search"] = search
        if limit is not None:
            params["limit"] = limit

        resources = await api_client.list_resources(params=params or None)
        return JSONResponse(content=resources)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/resources")
async def api_create_system_resource(payload: dict, current_user=Depends(require_page_access("systems"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.create_resource(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/resources/{resource_id}")
async def api_update_system_resource(resource_id: int, payload: dict, current_user=Depends(require_page_access("systems"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.update_resource(resource_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/roles")
async def api_role_overview(current_user=Depends(require_page_access("roles"))):
    try:
        systems = await api_client.get_role_overview()
        return JSONResponse(content=systems)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/roles")
async def api_create_role(payload: dict, current_user=Depends(require_page_access("roles"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.create_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/roles/map")
async def api_role_map(current_user=Depends(require_any_page_access("roles", "users"))):
    try:
        roles = await api_client.get_role_map()
        role_map = {
            role["role_id"]: {"name": role["name"], "type": role["role_type"]}
            for role in roles
        }
        return JSONResponse(content=role_map)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/roles/{role_id}")
async def api_get_role_detail(role_id: int, current_user=Depends(require_page_access("roles"))):
    try:
        system_detail = await api_client.get_role_detail(role_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/roles/{role_id}")
async def api_update_role(role_id: int, payload: dict, current_user=Depends(require_page_access("roles"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.update_role(role_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/roles/{role_id}/resources/reevaluate")
async def api_reevaluate_role_resources(role_id: int, payload: dict, current_user=Depends(require_page_access("roles"))):
    try:
        request_payload = {
            "initiator_user_id": current_user.user_id,
            "dry_run": _coerce_bool(payload.get("dry_run"), default=False),
        }
        result = await api_client.reevaluate_role_resources(role_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/skill_assignment")
async def api_start_skill_assignment_process(payload: dict, current_user=Depends(require_capability("skill.assign"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_skill_assignment(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/change")
async def api_start_primary_role_change_process(payload: dict, current_user=Depends(require_capability("primary_role.change"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_primary_role_change(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/tmp_role")
async def api_start_temporary_role_process(payload: dict, current_user=Depends(require_capability("temporary_role.assign"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_temporary_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/offboarding")
async def api_start_offboarding_process(payload: dict, current_user=Depends(require_capability("offboarding.start"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_offboarding(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/training_schedule")
async def api_start_training_schedule_process(payload: dict, current_user=Depends(require_capability("training.schedule"))):
    user_ids = payload.get("user_ids")
    role_ids = payload.get("role_ids")
    scheduled_for = str(payload.get("scheduled_for") or "").strip()

    if not isinstance(user_ids, list) or not user_ids:
        return JSONResponse(content={"detail": "Mindestens ein User muss ausgewählt werden."}, status_code=400)

    if not isinstance(role_ids, list) or not role_ids:
        return JSONResponse(content={"detail": "Mindestens eine Nebenrolle muss ausgewählt werden."}, status_code=400)

    normalized_user_ids = [_coerce_int(value) for value in user_ids]
    normalized_role_ids = [_coerce_int(value) for value in role_ids]

    if any(value is None for value in normalized_user_ids):
        return JSONResponse(content={"detail": "Die User-Auswahl ist ungültig."}, status_code=400)

    if any(value is None for value in normalized_role_ids):
        return JSONResponse(content={"detail": "Die Rollenauswahl ist ungültig."}, status_code=400)

    if not scheduled_for:
        return JSONResponse(content={"detail": "Das Schulungsdatum ist erforderlich."}, status_code=400)

    try:
        scheduled_date = date.fromisoformat(scheduled_for)
    except ValueError:
        return JSONResponse(content={"detail": "Das Schulungsdatum ist ungültig."}, status_code=400)

    if scheduled_date < date.today():
        return JSONResponse(content={"detail": "Das Schulungsdatum darf nicht in der Vergangenheit liegen."}, status_code=400)

    try:
        request_payload = {
            "user_ids": normalized_user_ids,
            "role_ids": normalized_role_ids,
            "scheduled_for": scheduled_for,
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.trigger_training_schedule(request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/skill_revocation")
async def api_start_skill_removal_process(payload: dict, current_user=Depends(require_capability("skill.revoke"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_skill_removal(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/iks")
async def api_start_iks_process_report(payload: dict, current_user=Depends(require_page_access("iks"))):
    try:
        request_payload = {
            "process_type": payload.get("process_type"),
            "start_date": payload.get("start_data"),
            "end_date": payload.get("end_date"),
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.trigger_iks_process_report(request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/roles/{role_id}/resources")
async def api_add_resources_to_role(role_id: int, resource_ids: dict, current_user=Depends(require_page_access("roles"))):
    try:
        payload = {
            "role_id": role_id,
            "resource_ids": resource_ids["resource_ids"],
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.add_resources_to_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.delete("/roles/{role_id}/resources")
async def api_remove_resources_from_role(role_id: int, resource_ids: dict, current_user=Depends(require_page_access("roles"))):
    try:
        payload = {
            "role_id": role_id,
            "resource_ids": resource_ids["resource_ids"],
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.remove_resources_from_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)
