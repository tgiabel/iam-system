from . import db
from flask import Blueprint, abort, jsonify, request
from .models import Identity
from .overlay_builder import get_overlay_json

api = Blueprint("api", __name__, url_prefix="/api")

# Mapping: entity -> (Template-Name, Model-Klasse) TODO: Auslagern
ENTITY_MAP = {
    "user": ("user", "user-form", Identity),
    # "job": ("job_overlay", JobModel),  <-- weitere Entities
}

@api.route("/<string:entity>/<int:id>/details", methods=["GET"])
def get_entity_details(entity, id):
    if entity not in ENTITY_MAP:
        abort(404, description=f"Entity '{entity}' unknown")

    template_name, form_name, class_model = ENTITY_MAP[entity]
    instance = class_model.query.get(id)
    if not instance:
        abort(404, description=f"{entity} with id {id} not found")

    # Fülle Daten in Overlay-Template
    data = {}
    if entity.startswith("user"):
        data = {
            "Benutzername": instance.username,
            "Vorname": instance.first_name or "",
            "Nachname": instance.last_name or "",
            "E-Mail": instance.email or "",
            "Rolle": instance.main_role.name if instance.main_role else "",
            "status_text": "Aktiv" if instance.active else "Inaktiv",
            "status_color": "blue" if instance.active else "red",
            "btn-0": f"closeOverlay('{template_name}-overlay')",
            "btn-1": f"edit('{entity}', {id})"
        }

    overlay_json = get_overlay_json(template_name, data)
    return jsonify(overlay_json)

@api.route("/<string:entity>/form", methods=["GET"])
def get_entity_form(entity):
    """Gibt ein leeres Overlay-Formular-Template zurück (z.B. für 'Neu anlegen')."""
    if entity not in ENTITY_MAP:
        abort(404, description=f"Entity '{entity}' unknown")

    template_name, form_name, class_model = ENTITY_MAP[entity]

    # Overlay-Template aus config holen
    overlay_json = get_overlay_json(form_name, {})
    overlay_json["is_form"] = True
    return jsonify(overlay_json)

@api.route("/<string:entity>/form/<int:id>", methods=["GET"])
def get_entity_form_prefilled(entity, id):
    """Gibt ein vorausgefülltes Overlay-Formular für einen bestehenden Datensatz zurück."""
    if entity not in ENTITY_MAP:
        abort(404, description=f"Entity '{entity}' unknown")

    template_name, form_name, class_model = ENTITY_MAP[entity]
    instance = class_model.query.get(id)
    if not instance:
        abort(404, description=f"{entity} with id {id} not found")

    # hier die Daten vorbereiten für Prefill
    data = {}
    if entity.startswith("user"):
        data = {
            "Vorname": f"<input type='text' name='first_name' value='{instance.first_name or ''}' placeholder='Vorname'>",
            "Nachname": f"<input type='text' name='last_name' value='{instance.last_name or ''}' placeholder='Nachname'>",
            "E-Mail": f"<input type='email' name='email' value='{instance.email or ''}' placeholder='E-Mail'>",
            "Rolle": f"<input type='text' name='role' value='{instance.main_role.name if instance.main_role else ''}' placeholder='Rolle'>",
            # Beispiel für radio preselect
            "Typ": (
                "<div>"
                f"<label><input type='radio' name='typ' value='4' {'checked' if instance.typ == 4 else ''}>Extern</label>"
                f"<label><input type='radio' name='typ' value='1' {'checked' if instance.typ == 1 else ''}>Mitarbeiter</label>"
                "</div>"
            ),
        }

    overlay_json = get_overlay_json(form_name, data)
    overlay_json["is_form"] = True
    overlay_json["edit_id"] = id  # fürs Frontend, damit es weiß dass Update-Route benutzt werden muss
    return jsonify(overlay_json)

@api.route("/<string:entity>/add", methods=["POST"])
def add_entity(entity):
    """Legt eine neue Entität in der DB an (Formulardaten POST)."""
    if entity not in ENTITY_MAP:
        abort(404, description=f"Entity '{entity}' unknown")

    template_name, form_name, class_model = ENTITY_MAP[entity]
    data = request.json or {}

    if entity == "user":
        new_instance = class_model(
            username=data.get("username"),
            first_name=data.get("first_name"),
            last_name=data.get("last_name"),
            email=data.get("email"),
            active=True  # default auf aktiv
        )
        db.session.add(new_instance)
        db.session.commit()
        return jsonify({"message": "User created", "id": new_instance.id}), 201

    # Fallback für nicht implementierte Entities
    abort(400, description=f"Add for entity '{entity}' not implemented yet")