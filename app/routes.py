from flask import Blueprint, current_app, render_template, redirect, url_for, request, flash
from flask_login import login_required, current_user, logout_user, login_user
from werkzeug.security import check_password_hash
from .models import Identity, RessourceType
from .overlay_builder import login_overlay
from .card_builder import profile_card

main = Blueprint("main", __name__)

# Dashboard (offen)
@main.route("/")
def index():
    return render_template("dashboard.html")

@main.route("/login", methods=["GET", "POST"])
def login_page():
    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")

        user = Identity.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            flash("Login erfolgreich!", "success")
            return redirect(url_for("main.index"))
        else:
            flash("Ungültiger Benutzername oder Passwort", "failure")
            return redirect(url_for("main.login_page"))

    overlay_html = login_overlay()
    return render_template("login.html", overlay=overlay_html)



# Logout
@main.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("main.index"))

# Geschützte Bereiche
@main.route("/tasks")
@login_required
def tasks():
    return render_template("tasks.html")

@main.route("/reports")
@login_required
def reports():
    return render_template("reports.html")

@main.route("/users")
@login_required
def users():
    # Configs
    role_colors = current_app.config["ROLE_COLOR_MAP"]

    # Aktive User aus der Identity-Tabelle laden
    identities = Identity.query.filter_by(active=True).all()

    list_html = ""
    for u in identities:
        list_html += profile_card(
            user_id=str(u.id),
            name=f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username,
            role=u.main_role.name if u.main_role else "",
            status=", ".join([r.name for r in u.roles]) if u.roles else "",
            meta_text=f"{u.email}",
            meta_link=f"mailto:{u.email}",
            badge=role_colors.get(str(u.main_role_id), "grey")
        )

    grid = {
        "title": "Aktive User",
        "items": list_html,
        "search_category": "Benutzer",
        "list_id": "user-grid-list",
        "search_id": "user-grid-search"
    }
    return render_template("users.html", grid=grid)

@main.route("/permissions")
@login_required
def permissions():
    return render_template("permissions.html")

@main.route("/responsibilities")
@login_required
def responsibilities():
    return render_template("responsibilities.html")

@main.route("/roles")
@login_required
def roles():
    return render_template("roles.html")

@main.route("/process")
@login_required
def process():
    return render_template("process.html")

@main.route("/systems")
@login_required
def systems():

    res_types = RessourceType.query.all()

    # HTML-Kacheln über das Makro rendern
    list_html = ""
    for res in res_types:
        list_html += render_template(
            "components/menu_item.html", 
            title=res.name, 
            url=f"systems/{res.url}", 
            icon=f"/static/img/{res.icon}"
        )
    list_html += render_template("components/menu_button.html", add_entity="ressource_type")

    grid = {
        "title": "Systeme",
        "items": list_html,  # fertiges HTML
        "search_category": "Systemkategorien",
        "list_id": "system-grid-list",
        "search_id": "system-grid-search"
    }

    return render_template("systems.html", grid=grid)

@main.route("/systems/hardware")
@login_required
def hardware():

    res_types = RessourceType.query.all()

    # HTML-Kacheln über das Makro rendern
    list_html = ""
    for res in res_types:
        list_html += render_template(
            "components/menu_item.html", 
            title=res.name, 
            url=f"systems/{res.url}", 
            icon=f"/static/img/{res.icon}"
        )
    list_html += render_template("components/floating_button.html", add_entity="hardware_type")

    grid = {
        "title": "Systeme",
        "items": list_html,  # fertiges HTML
        "search_category": "Systemkategorien",
        "list_id": "system-grid-list",
        "search_id": "system-grid-search"
    }

    return render_template("hardware.html", grid=grid)

@main.route("/systems/<string:ressource>")
@login_required
def software(ressource):
    return render_template("ressource.html")

@main.route("/account")
@login_required
def account():
    return render_template("account.html")




