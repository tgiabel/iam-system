import os
import json
import click
from flask import Flask
from flask.cli import with_appcontext
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_migrate import Migrate
from pathlib import Path

db = SQLAlchemy()
login_manager = LoginManager()
login_manager.login_view = "main.login_page"
migrate = Migrate()

def create_app():
    app = Flask(__name__)

    # Config laden
    with open(Path(__file__).parent / "config" / "colors.json") as f:
        color_config = json.load(f)

    app.config['ROLE_COLOR_MAP'] = color_config.get("roles", {})
    app.config['SECRET_KEY'] = 'supersecretkey'
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://dev:dev@db/sd_monitor"
    )
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    db.init_app(app)
    login_manager.init_app(app)
    migrate.init_app(app, db)

    # Registriere Blueprints
    from .routes import main
    app.register_blueprint(main)

    # Registriere API-Blueprint mit Prefix /api
    from .api import api
    app.register_blueprint(api)

    with app.app_context():
        db.create_all()

    # CLI Commands
    app.cli.add_command(create_root_user)
    app.cli.add_command(delete_root_user)
    app.cli.add_command(drop_db)
    app.cli.add_command(seed_roles)
    app.cli.add_command(seed_systems)
    app.cli.add_command(seed_ressources)

    return app


from .models import Identity

@login_manager.user_loader
def load_user(user_id):
    return Identity.query.get(int(user_id))

# ─────────────────────────────────────────────────────────────
# ─────────────────────CLI COMMANDS────────────────────────────
# ─────────────────────────────────────────────────────────────
@click.command("create-root-user")
@with_appcontext
def create_root_user():
    """Erstellt einen root-User in der Datenbank."""
    from .models import Identity, Role  # sicherstellen, dass Import da ist

    root = Identity.query.filter_by(username="root").first()
    if not root:
        # Optional: Main Role zuweisen, z.B. die Admin-Rolle
        admin_role = Role.query.filter_by(name="SD-IT").first()

        root = Identity(
            username="root",
            first_name="Super",
            last_name="User",
            email="root@example.com",
            active=True,
            main_role=admin_role  # kann None sein, falls Admin-Rolle noch nicht existiert
        )
        root.set_password("sdmonitor")  # Passwort setzen

        db.session.add(root)
        db.session.commit()

        click.echo("✅ Root User erstellt")
    else:
        click.echo("ℹ️ Root User existiert bereits")


# ─────────────────────────────────────────────────────────────
@click.command("delete-root-user")
@with_appcontext
def delete_root_user():
    """Löscht den root-User aus der Datenbank."""
    root = Identity.query.filter_by(username="root").first()
    if root:
        db.session.delete(root)
        db.session.commit()
        click.echo("✅ Root User gelöscht")
    else:
        click.echo("ℹ️ Root User existiert nicht")

# ─────────────────────────────────────────────────────────────
@click.command("drop-db")
@with_appcontext
def drop_db():
    """Löscht alle Tabellen in der Datenbank (vorsichtig!)."""
    confirm = click.confirm(
        "⚠️ Willst du wirklich die gesamte Datenbank löschen?", default=False
    )
    if confirm:
        db.drop_all()
        click.echo("✅ Alle Tabellen gelöscht")
    else:
        click.echo("❌ Abgebrochen")

# ─────────────────────────────────────────────────────────────
@click.command("seed-roles")
@with_appcontext
def seed_roles():
    """Befüllt die Role- und RoleType-Tabellen aus config/roles.json."""

    from .models import Role, RoleType

    config_path = os.path.join(os.path.dirname(__file__), "config", "roles.json")
    with open(config_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    role_types = data.get("role_types", [])
    roles = data.get("roles", [])

    created_types = 0
    for type_data in role_types:
        existing = RoleType.query.filter_by(id=type_data["id"]).first()
        if not existing:
            role_type = RoleType(**type_data)
            db.session.add(role_type)
            created_types += 1
            db.session.commit()

    created_roles = 0
    for role_data in roles:
        existing = Role.query.filter_by(name=role_data["name"]).first()
        if not existing:
            role = Role(**role_data)
            db.session.add(role)
            created_roles += 1

    if created_types + created_roles > 0:
        db.session.commit()
        click.echo(f"✅ {created_types} RoleTypes und {created_roles} Roles erstellt")
    else:
        click.echo("ℹ️ Alle RoleTypes und Roles existieren bereits")

# ─────────────────────────────────────────────────────────────
@click.command("seed-systems")
@with_appcontext
def seed_systems():
    """Befüllt die System- und SystemType-Tabellen aus config/systems.json."""

    from .models import System, SystemType

    config_path = os.path.join(os.path.dirname(__file__), "config", "systems.json")
    with open(config_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    system_types = data.get("system_types", [])
    systems = data.get("systems", [])

    created_types = 0
    for type_data in system_types:
        existing = SystemType.query.filter_by(id=type_data["id"]).first()
        if not existing:
            system_type = SystemType(**type_data)
            db.session.add(system_type)
            created_types += 1
            db.session.commit()

    created_systems = 0
    for system_data in systems:
        existing = System.query.filter_by(name=system_data["name"]).first()
        if not existing:
            system = System(**system_data)
            db.session.add(system)
            created_systems += 1

    if created_types + created_systems > 0:
        db.session.commit()
        click.echo(f"✅ {created_types} SystemTypes und {created_systems} Systems erstellt")
    else:
        click.echo("ℹ️ Alle SystemTypes und Systems existieren bereits")

# ─────────────────────────────────────────────────────────────
@click.command("seed-ressources")
@with_appcontext
def seed_ressources():
    """Befüllt die Ressource-Tabellen aus config/ressources.json."""

    from .models import RessourceType

    config_path = os.path.join(os.path.dirname(__file__), "config", "ressources.json")
    with open(config_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    ressource_types = data.get("ressource_types", [])
    systems = data.get("ressources", [])

    created_types = 0
    for type_data in ressource_types:
        existing = RessourceType.query.filter_by(id=type_data["id"]).first()
        if not existing:
            system_type = RessourceType(**type_data)
            db.session.add(system_type)
            created_types += 1
            db.session.commit()

    # created_systems = 0
    # for system_data in systems:
    #     existing = System.query.filter_by(name=system_data["name"]).first()
    #     if not existing:
    #         system = System(**system_data)
    #         db.session.add(system)
    #         created_systems += 1

    if created_types > 0: # if created_types + created_systems > 0:
        db.session.commit()
        click.echo(f"✅ {created_types} RessourceTypes erstellt") # click.echo(f"✅ {created_types} SystemTypes und {created_systems} Systems erstellt")
    else:
        click.echo("ℹ️ Alle RessourceTypes und Ressources existieren bereits")