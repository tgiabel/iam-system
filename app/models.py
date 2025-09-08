from . import db
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

# ----------------------------
# Haupttabellen
# ----------------------------

class Identity(UserMixin, db.Model):
    __tablename__ = "identity"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    first_name = db.Column(db.String(100), nullable=True)
    last_name = db.Column(db.String(100), nullable=True)
    email = db.Column(db.String(100), unique=True, nullable=True)
    password_hash = db.Column(db.String(200), nullable=False)
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    main_role_id = db.Column(db.Integer, db.ForeignKey("role.id"), nullable=True)
    main_role = db.relationship("Role", foreign_keys=[main_role_id])

    roles = db.relationship("Role", secondary="identity_role", back_populates="identities")
    permissions = db.relationship("Permission", secondary="identity_permission", back_populates="identities")

    def set_password(self, password: str):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)


class Role(db.Model):
    __tablename__ = "role"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    description = db.Column(db.String(200))
    type_id = db.Column(db.Integer, db.ForeignKey("role_type.id"))
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    identities = db.relationship("Identity", secondary="identity_role", back_populates="roles")
    permissions = db.relationship("Permission", secondary="role_permission", back_populates="roles")


class System(db.Model):
    __tablename__ = "system"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    description = db.Column(db.String(200))
    type_id = db.Column(db.Integer, db.ForeignKey("system_type.id"))
    active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Process(db.Model):
    __tablename__ = "process"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    description = db.Column(db.String(200))
    system_id = db.Column(db.Integer, db.ForeignKey("system.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    system = db.relationship("System", backref=db.backref("processes", lazy=True))


class Permission(db.Model):
    __tablename__ = "permission"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    type_id = db.Column(db.Integer, db.ForeignKey("permission_type.id"))
    description = db.Column(db.String(200))
    system_id = db.Column(db.Integer, db.ForeignKey("system.id"))
    ressource_id = db.Column(db.Integer, db.ForeignKey("ressource.id"))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    identities = db.relationship("Identity", secondary="identity_permission", back_populates="permissions")
    roles = db.relationship("Role", secondary="role_permission", back_populates="permissions")

class Ressource(db.Model):
    __tablename__ = "ressource"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    type_id = db.Column(db.Integer, db.ForeignKey("ressource_type.id"))
    description = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# ----------------------------
# Nebentabellen / Typen
# ----------------------------

class PermissionType(db.Model):
    __tablename__ = "permission_type"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    description = db.Column(db.String(200))


class RoleType(db.Model):
    __tablename__ = "role_type"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    description = db.Column(db.String(200))

class RessourceType(db.Model):
    __tablename__ = "ressource_type"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    url = db.Column(db.String(50))
    icon = db.Column(db.String(50))
    description = db.Column(db.String(200))

class SystemType(db.Model):
    __tablename__ = "system_type"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    description = db.Column(db.String(200))

# ----------------------------
# Association Tables
# ----------------------------

identity_role = db.Table(
    "identity_role",
    db.Column("identity_id", db.Integer, db.ForeignKey("identity.id"), primary_key=True),
    db.Column("role_id", db.Integer, db.ForeignKey("role.id"), primary_key=True),
    assigned_on = db.Column(db.DateTime, default=datetime.utcnow)
)

role_permission = db.Table(
    "role_permission",
    db.Column("role_id", db.Integer, db.ForeignKey("role.id"), primary_key=True),
    db.Column("permission_id", db.Integer, db.ForeignKey("permission.id"), primary_key=True),
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)
)

identity_permission = db.Table(
    "identity_permission",
    db.Column("identity_id", db.Integer, db.ForeignKey("identity.id"), primary_key=True),
    db.Column("permission_id", db.Integer, db.ForeignKey("permission.id"), primary_key=True),
    assingned_on = db.Column(db.DateTime, default=datetime.utcnow)
)


# ----------------------------
# Logs
# ----------------------------

class IdentityPermissionLog(db.Model):
    __tablename__ = "identity_permission_log"

    id = db.Column(db.Integer, primary_key=True)
    identity_id = db.Column(db.Integer, db.ForeignKey("identity.id"))
    permission_id = db.Column(db.Integer, db.ForeignKey("permission.id"))
    action = db.Column(db.String(50))  # z.B. "granted", "revoked"
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    performed_by = db.Column(db.Integer, db.ForeignKey("identity.id"))  # wer hat die Aktion durchgeführt
