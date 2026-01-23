from ..app import db
from flask import Blueprint, abort, jsonify, request
from .models import Identity
from .rbac import requires_permission

api = Blueprint("api", __name__, url_prefix="/api")

'''@requires_permission("users:view")'''
@api.route("/users/<int:user_id>/details", methods=["GET"])
def get_user_details(user_id):
    """Gibt alle Details eines Users für das Sidebar-Overlay zurück"""
    user = Identity.query.get_or_404(user_id)
    
    return jsonify({
        "id": user.id,
        "username": user.username,
        "anrede": user.anrede,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "email": user.email,
        "email_private": user.email_private,
        "telephone": user.telephone,
        "telephone_private": user.telephone_private,
        "mobile": user.mobile,
        "address": user.address,
        "personalnummer": user.personalnummer,
        "wochenstunden": user.wochenstunden,
        "eintrittsdatum": user.eintrittsdatum.isoformat() if user.eintrittsdatum else None,
        "austrittsdatum": user.austrittsdatum.isoformat() if user.austrittsdatum else None,
        "geburtsdatum": user.brithdate.isoformat() if user.brithdate else None,
        "active": user.active,
        "main_role": user.main_role.name if user.main_role else None,
        "nebenrollen": [r.name for r in user.roles if r != user.main_role],
        "accounts": [
            {
                "system": perm.system.name if perm.system else None,
                "name": perm.ressource.name if perm.ressource else None
            }
            for perm in user.permissions
            if perm.ressource and perm.ressource.type_id == 1  # Account
        ],
        "permissions": [
            {
                "name": perm.name,
                "system": perm.system.name if perm.system else None,
                "ressource": perm.ressource.name if perm.ressource else None
            } 
            for perm in user.permissions
        ]
        # optional: hardware, logs, etc.
    })

@api.route("/<string:entity>/<int:id>/details", methods=["GET"])
def get_entity_details(entity, id):
    """Gibt ein ausgefülltes Overlay im Read-Modus zurück"""
    pass

@api.route("/<string:entity>/form", methods=["GET"])
def get_entity_form(entity):
    """Gibt ein leeres Overlay-Formular-Template zurück (z.B. für 'Neu anlegen')."""
    pass

@api.route("/<string:entity>/form/<int:id>", methods=["GET"])
def get_entity_form_prefilled(entity, id):
    """Gibt ein vorausgefülltes Overlay-Formular für einen bestehenden Datensatz zurück."""
    pass

@api.route("/<string:entity>/add", methods=["POST"])
def add_entity(entity):
    """Legt eine neue Entität in der DB an (Formulardaten POST)."""
    pass