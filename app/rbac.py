from functools import wraps
from flask import abort
from flask_login import current_user

from .models import Permission

def has_permission(user, perm_name):
    if not user or not getattr(user, "is_authenticated", False):
        return False
    # direkte Permissions
    for p in getattr(user, "permissions", []) or []:
        if p.name == perm_name:
            return True
    # Permissions über Roles
    for r in getattr(user, "roles", []) or []:
        for p in getattr(r, "permissions", []) or []:
            if p.name == perm_name:
                return True
    return False

def requires_permission(perm_name):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not has_permission(current_user, perm_name):
                abort(403)
            return fn(*args, **kwargs)
        return wrapper
    return decorator