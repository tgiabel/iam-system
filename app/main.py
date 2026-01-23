from functools import wraps
from fastapi import FastAPI, Request, Cookie
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
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

# ------------------------------
# Decorator für geschützte Routen
# ------------------------------
def login_required(func):
    @wraps(func)
    async def wrapper(request: Request, *args, sofa_user: str | None = Cookie(default=None), **kwargs):
        user = get_current_user(sofa_user)
        if not user:
            return RedirectResponse(url="/login", status_code=303)
        # User als Keyword-Argument übergeben
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
def login(request: Request, username: str = None, password: str = None):
    # Platzhalter: hier später API aufrufen
    user_data = {
        "username": username or "demo",
        "first_name": "Max",
        "roles": ["Admin"]
    }

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
@login_required
def tasks(request: Request, sofa_user: str | None = Cookie(default=None)):
    user = get_current_user(sofa_user)
    return templates.TemplateResponse("tasks.html", {"request": request, "user": user})
 