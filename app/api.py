from . import db
from flask import Blueprint, abort, jsonify, request
from .models import Identity

api = Blueprint("api", __name__, url_prefix="/api")


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