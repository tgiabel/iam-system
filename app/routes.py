from flask import Blueprint, current_app, render_template, redirect, url_for, request, flash
from flask_login import login_required, current_user, logout_user, login_user
from werkzeug.security import check_password_hash
from .models import Identity, RessourceType


main = Blueprint("main", __name__)

# Dashboard (offen)
@main.route("/")
def index():
    return render_template("page_template/page_w_table.html")


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

    return render_template("login.html")



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

    return render_template("users.html", identities=identities)

@main.route("/location")
@login_required
def location():
    return render_template("standortverwaltung.html")

@main.route("/location/<int:id>")
@login_required
def room_details(id):
    return render_template("raum_detail.html")

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

    return render_template("systems.html")

@main.route("/systems/hardware")
@login_required
def hardware():

    res_types = RessourceType.query.all()

    return render_template("hardware.html")

@main.route("/systems/<string:ressource>")
@login_required
def software(ressource):
    return render_template("ressource.html")

@main.route("/account")
@login_required
def account():
    return render_template("account.html")




