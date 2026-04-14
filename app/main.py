from functools import wraps
from fastapi import FastAPI, Request, Cookie, Depends, Form, File, UploadFile    # type: ignore
from fastapi.templating import Jinja2Templates                  # type: ignore
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, StreamingResponse    # type: ignore
from fastapi.staticfiles import StaticFiles                     # type: ignore
from fastapi.exceptions import HTTPException                    # type: ignore
import httpx # type: ignore
from app.api_client import api_client
from app.helpers.datex import build_datex_export
import os
import json

base_dir = os.path.dirname(os.path.abspath(__file__))
static_path = os.path.join(base_dir, "static")

# ------------------------------
# Templates
# ------------------------------
templates = Jinja2Templates(directory=os.path.join(base_dir, "templates"))

# ------------------------------
# FastAPI App
# ------------------------------
app = FastAPI(title="SOFA Frontend")
app.mount("/static", StaticFiles(directory=static_path), name="static")

# ------------------------------
# Hilfsfunktion zum Auslesen des Users aus Cookie
# ------------------------------
def get_current_user(sofa_user: str | None):
    if sofa_user:
        return json.loads(sofa_user)
    return None

async def get_current_user_dep(
    sofa_user: str | None = Cookie(default=None),
):
    user = get_current_user(sofa_user)
    if not user:
        raise HTTPException(status_code=303, headers={"Location": "/login"})
    return user

# ------------------------------
# Decorator für geschützte Routen
# ------------------------------
def login_required(func):
    @wraps(func)
    async def wrapper(request: Request, *args, sofa_user: str | None = Cookie(default=None), **kwargs):
        user = get_current_user(sofa_user)
        if not user:
            return RedirectResponse(url="/login", status_code=303)
        return await func(request, *args, user=user, **kwargs)
    return wrapper

# ------------------------------
# Offene Route: Dashboard
# ------------------------------
@app.get("/", response_class=HTMLResponse)
def index(request: Request, sofa_user: str | None = Cookie(default=None)):
    user = get_current_user(sofa_user)
    return templates.TemplateResponse("dashboard.html", {"request": request, "user": user})

# ------------------------------
# Login / Logout (Overlay möglich)
# ------------------------------
@app.get("/login", name="login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})

@app.post("/login")
async def login(request: Request, pnr: str = Form(...), password: str = Form(...)):
    try:
        user_data = await api_client.login_user(pnr, password)
    except Exception as e:
        flash_messages = [("failure", str(e))]
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "flash_messages": flash_messages,
                "pnr": pnr
            }
        )

    # Erfolgreiches Login → Cookie setzen
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(
        key="sofa_user",
        value=json.dumps(user_data),
        httponly=True,
        max_age=3600*8
    )
    return response

@app.get("/logout")
def logout():
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie("sofa_user")
    return response

# ------------------------------
# Beispiel geschützte Route
# ------------------------------
@app.get("/tasks", response_class=HTMLResponse)
def tasks(request: Request, user=Depends(get_current_user_dep)):
    return templates.TemplateResponse("tasks.html", {"request": request, "user": user})

@app.get("/tools", response_class=HTMLResponse)
def tools(request: Request, user=Depends(get_current_user_dep)):
    return templates.TemplateResponse("tools.html", {"request": request, "user": user})

# ------------------------------
# Userverwaltung-Seite
# ------------------------------
@app.get("/users", response_class=HTMLResponse)
async def users(request: Request, user=Depends(get_current_user_dep)):
    return templates.TemplateResponse(
        "userverwaltung.html",
        {
            "request": request,
            "user": user,
        },
    )

# ------------------------------
# Systemverwaltung-Seite
# ------------------------------
@app.get("/systems", response_class=HTMLResponse)
async def systems(request: Request, user=Depends(get_current_user_dep)):
    return templates.TemplateResponse(
        "systemverwaltung.html",
        {
            "request": request,
            "user": user,
        },
    )

# ------------------------------
# System-Detail-Seite
# ------------------------------
@app.get("/systems/{system_id}", response_class=HTMLResponse)
async def system_details(request: Request, system_id: str, user=Depends(get_current_user_dep)):
    return templates.TemplateResponse(
        "systemdetails.html",
        {
            "request": request,
            "user": user,
            "system_id": system_id
        },
    )

# ------------------------------
# Rollenmanagement-Seite
# ------------------------------
@app.get("/roles", response_class=HTMLResponse)
async def roles(request: Request, user=Depends(get_current_user_dep)):
    return templates.TemplateResponse(
        "rollenmanagement.html",
        {
            "request": request,
            "user": user
        },
    )

@app.get("/roles/{role_id}", response_class=HTMLResponse)
async def role_details(request: Request, role_id: str, user=Depends(get_current_user_dep)):
    return templates.TemplateResponse(
        "rollendetails.html",
        {
            "request": request,
            "user": user,
            "role_id": role_id
        },
    )

@app.get("/iks", response_class=HTMLResponse)
async def iks(request: Request, user=Depends(get_current_user_dep)):
    return templates.TemplateResponse(
        "iks.html",
        {
            "request": request,
            "user": user
        }
    )

@app.get("/tools/iks", response_class=HTMLResponse)
async def iks_tool(request: Request, user=Depends(get_current_user_dep)):
    return templates.TemplateResponse(
        "tools/iks_tool.html",
        {
            "request": request,
            "user": user
        }
    )


@app.get("/tools/datex", response_class=HTMLResponse)
async def datex_tool(request: Request, user=Depends(get_current_user_dep)):
    return templates.TemplateResponse(
        "tools/datex_tool.html",
        {
            "request": request,
            "user": user,
        }
    )


@app.post("/api/tools/datex/convert")
async def convert_datex_file(
    request: Request,
    datfile: UploadFile = File(...),
    user=Depends(get_current_user_dep),
):
    try:
        if not datfile.filename:
            return templates.TemplateResponse(
                "tools/datex_tool.html",
                {
                    "request": request,
                    "user": user,
                    "flash_messages": [("failure", "Bitte waehlen Sie eine DAT-Datei aus.")],
                },
                status_code=400,
            )

        filename, workbook = build_datex_export(await datfile.read())
    except ValueError as exc:
        return templates.TemplateResponse(
            "tools/datex_tool.html",
            {
                "request": request,
                "user": user,
                "flash_messages": [("failure", str(exc))],
            },
            status_code=400,
        )
    finally:
        await datfile.close()

    return StreamingResponse(
        workbook,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

# ------------------------------
# API Routen
# ------------------------------
@app.get("/api/users")
async def api_users():
    try:
        users = await api_client.list_users()
        return JSONResponse(content=users)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/users/{user_id}/details")
async def api_user_details(user_id: int):
    try:
        user_detail = await api_client.get_user_details(user_id)
        return JSONResponse(content=user_detail)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.get("/api/roles/{role_id}/resources")
async def api_role_resources(role_id: int):
    try:
        resources = await api_client.get_role_resources(role_id)
        return JSONResponse(content=resources)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)
    
@app.get("/api/tasks/view")
async def api_list_tasks(
    status: str | None = None,
    type: str | None = None,
    handling_type: str | None = None,
    assigned_to_user_id: int | None = None,
    process_id: int | None = None,
):
    """
    Liefert Tasks gefiltert nach Status / Typ / Handling / Assigned User.
    Nur Payload durchreichen, keine Validierung im Frontend nötig.
    """
    try:
        tasks = await api_client.list_tasks(
            status=status,
            type=type,
            handling_type=handling_type,
            assigned_to_user_id=assigned_to_user_id,
            process_id=process_id,
        )
        return JSONResponse(content=tasks)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@app.patch("/api/tasks/{task_id}/assign")
async def api_assign_task(task_id: int, user_id: int):

    try:
        return await api_client.assign_task(task_id, user_id)

    except httpx.HTTPStatusError as e:

        # Status + Detail vom echten Backend übernehmen
        raise HTTPException(
            status_code=e.response.status_code,
            detail=e.response.json().get("detail", "Backend error")
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )

@app.delete("/api/tasks/{task_id}/assign")
async def api_unassign_task(task_id: int, current_user=Depends(get_current_user_dep)):
    try:
        task = await api_client.unassign_task(task_id, current_user['user_id'])
        return JSONResponse(content=task)

    except httpx.HTTPStatusError as e:
        # Fehler vom Backend sauber weiterreichen
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )

    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/tasks/{task_id}/complete")
async def api_complete_task(task_id: int, payload: dict, current_user=Depends(get_current_user_dep)):
    """
    Setzt einen Task auf COMPLETED.
    Prüft für resource_type_id = 1, dass account_identifier geliefert wird
    und legt ggf. einen UserAccount an.
    """
    try:
        # user_id für Log/Tracking
        user_id = current_user["user_id"] if isinstance(current_user, dict) else current_user.user_id

        # Extrahiere account_identifier falls vorhanden
        account_identifier = payload.get("account_identifier")
        comment = payload.get("comment")

        # Backend aufrufen
        task = await api_client.complete_task(task_id, user_id, account_identifier, comment)

        return JSONResponse(content=task)

    except httpx.HTTPStatusError as e:
        # Fehler vom Backend sauber weiterreichen
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/tasks/dispatch_bot")
async def api_dispatch_bot(payload: dict, current_user=Depends(get_current_user_dep)):
    try:
        task_id = payload.get("task_id")
        result = await api_client.dispatch_bot(task_id)

        return JSONResponse(content=result)

    except httpx.HTTPStatusError as e:
        # Fehler vom Backend sauber weiterreichen
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/processes/onboarding")
async def api_start_onboarding_process(
    payload: dict,
    current_user=Depends(get_current_user_dep)):
    """
    Trigger den Onboarding-Prozess für einen Mitarbeiter.
    """
    try:
        pnr = payload.get("pnr")
        user_id = current_user["user_id"] if isinstance(current_user, dict) else current_user.user_id

        payload = {
            "pnr": str(pnr),
            "initiator_user_id": user_id
        }
        result = await api_client.trigger_onboarding(payload)
        return JSONResponse(content={"process_id": result["process_id"], "status": "started"})
    
    except Exception as e:
        # Catch-All, kann noch spezifischer auf HTTPException oder ValueError mapen
        return JSONResponse(content={"error": str(e)}, status_code=500)
    
@app.post("/api/processes/onboarding-ext")
async def api_start_ext_onboarding_process(
    payload: dict,
    current_user=Depends(get_current_user_dep)):
    """
    Trigger den Onboarding-Prozess für einen Externen Dienstleister.
    """
    try:
        user_id = current_user["user_id"] if isinstance(current_user, dict) else current_user.user_id
        payload["initiator_user_id"] = user_id
        result = await api_client.trigger_ext_onboarding(payload)
        return JSONResponse(content={"process_id": result["process_id"], "status": "started"})
    
    except Exception as e:
        # Catch-All, kann noch spezifischer auf HTTPException oder ValueError mapen
        return JSONResponse(content={"error": str(e)}, status_code=500)

    
@app.get("/api/tasks/overview")
async def api_tasks_overview(current_user=Depends(get_current_user_dep)):
    try:
        user_id = (
            current_user["user_id"] 
            if isinstance(current_user, dict) 
            else current_user.user_id
        )

        tasks = await api_client.get_task_overview(user_id)
        return JSONResponse(content=tasks)

    except httpx.HTTPStatusError as e:
        # Backend-Fehler sauber weitergeben
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/resources/mail_template")
async def api_get_mail_template(payload: dict, current_user=Depends(get_current_user_dep)):
    try:
        payload["initiator_user_id"] = current_user["user_id"]
        result = await api_client.get_mail_template(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        print(e)
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.get("/api/tasks/{task_id}/history")
async def api_task_logs(task_id, current_user=Depends(get_current_user_dep)):
    try:
        history = await api_client.get_task_logs(task_id)
        return JSONResponse(content=history)
    
    except httpx.HTTPStatusError as e:
        # Backend-Fehler sauber weitergeben
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    

    
@app.get("/api/systems")
async def api_system_overview(current_user=Depends(get_current_user_dep)):
    """
    Liefert die Systemliste für das Dashboard als JSON
    """
    try:
        systems = await api_client.get_system_overview()
        return JSONResponse(content=systems)

    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.get("/api/systems/map")
async def api_system_map(current_user=Depends(get_current_user_dep)):
    try:
        systems = await api_client.get_system_map()

        system_map = {
            system["system_id"]: system["name"]
            for system in systems
        }

        return JSONResponse(content=system_map)

    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
     

@app.get("/api/systems/{system_id}")
async def api_get_system_detail(system_id: int, current_user=Depends(get_current_user_dep)):
    """
    Liefert Details + Ressourcen eines Systems für Frontend
    """
    try:
        system_detail = await api_client.get_system_detail(system_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.get("/api/systems/{system_id}/resources")
async def api_get_system_resources(system_id: int, current_user=Depends(get_current_user_dep)):
    try:
        system_detail = await api_client.get_system_resources(system_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/resources")
async def api_create_system_resource(payload: dict, current_user=Depends(get_current_user_dep)):
    try:
        payload["initiator_user_id"] = current_user["user_id"]
        result = await api_client.create_resource(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        print(e)
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/resources/{resource_id}")
async def api_update_system_resource(resource_id: int, payload: dict, current_user=Depends(get_current_user_dep)):
    try:
        print(payload["meta"])
        payload["initiator_user_id"] = current_user["user_id"]
        result = await api_client.update_resource(resource_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        print(e)
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

    
@app.get("/api/roles")
async def api_role_overview(current_user=Depends(get_current_user_dep)):
    try:
        systems = await api_client.get_role_overview()
        return JSONResponse(content=systems)

    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.get("/api/roles/map")
async def api_role_map(current_user=Depends(get_current_user_dep)):
    try:
        roles = await api_client.get_role_map()

        role_map = {
            role["role_id"]: {
                "name": role["name"],
                "type": role["role_type"]
            }
            for role in roles
        }

        return JSONResponse(content=role_map)

    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.get("/api/roles/{role_id}")
async def api_get_role_detail(role_id: int, current_user=Depends(get_current_user_dep)):
    try:
        system_detail = await api_client.get_role_detail(role_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/processes/skill_assignment")
async def api_start_skill_assignment_process(payload: dict, current_user=Depends(get_current_user_dep)):
    try:
        payload["initiator_user_id"] = current_user["user_id"]
        result = await api_client.trigger_skill_assignment(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/processes/tmp_role")
async def api_start_temporary_role_process(payload: dict, current_user=Depends(get_current_user_dep)):
    try:
        payload["initiator_user_id"] = current_user["user_id"]
        result = await api_client.trigger_temporary_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/processes/offboarding")
async def api_start_offboarding_process(payload: dict, current_user=Depends(get_current_user_dep)):
    try:
        payload["initiator_user_id"] = current_user["user_id"]
        result = await api_client.trigger_offboarding(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/processes/skill_revocation")
async def api_start_skill_removal_process(payload: dict, current_user=Depends(get_current_user_dep)):
    try:
        payload["initiator_user_id"] = current_user["user_id"]
        result = await api_client.trigger_skill_removal(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )

@app.post("/api/processes/iks")
async def api_start_iks_process_report(payload: dict, current_user=Depends(get_current_user_dep)):
    try:
        request_payload = {
            "process_type": payload.get("process_type"),
            "start_date": payload.get("start_data"),
            "end_date": payload.get("end_date"),
            "initiator_user_id": current_user["user_id"]
        }
        result = await api_client.trigger_iks_process_report(request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
    
@app.post("/api/roles/{role_id}/resources")
async def api_add_resources_to_role(role_id: int, resource_ids: dict, current_user=Depends(get_current_user_dep)):
    try:
        payload: dict = {}
        payload["role_id"] = role_id
        payload["resource_ids"] = resource_ids["resource_ids"]
        payload["initiator_user_id"] = current_user["user_id"]

        result = await api_client.add_resources_to_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )


@app.delete("/api/roles/{role_id}/resources")
async def api_remove_resources_from_role(role_id: int, resource_ids: dict, current_user=Depends(get_current_user_dep)):
    try:
        payload: dict = {}
        payload["role_id"] = role_id
        payload["resource_ids"] = resource_ids["resource_ids"]
        payload["initiator_user_id"] = current_user["user_id"]

        result = await api_client.remove_resources_from_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as e:
        return JSONResponse(
            content=e.response.json(),
            status_code=e.response.status_code
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            content={"error": str(e)},
            status_code=500
        )
