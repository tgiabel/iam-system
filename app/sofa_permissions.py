from __future__ import annotations

from functools import lru_cache
import json
import os
from typing import Any


_CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config")


def _load_json_file(filename: str) -> dict[str, Any]:
    with open(os.path.join(_CONFIG_DIR, filename), "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else {}


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value

    normalized = _normalize_text(value).lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _normalize_resource_id(value: Any) -> int | str | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value

    normalized = _normalize_text(value)
    if not normalized:
        return None

    try:
        return int(normalized)
    except (TypeError, ValueError):
        return normalized


def _normalize_resource_scope(scope: Any) -> dict[str, Any]:
    if not isinstance(scope, dict):
        return {"all": False, "ids": []}

    seen_ids: set[int | str] = set()
    normalized_ids: list[int | str] = []

    raw_ids = scope.get("ids")
    if isinstance(raw_ids, list):
        for raw_id in raw_ids:
            normalized_id = _normalize_resource_id(raw_id)
            if normalized_id is None or normalized_id in seen_ids:
                continue
            seen_ids.add(normalized_id)
            normalized_ids.append(normalized_id)

    return {
        "all": _coerce_bool(scope.get("all"), default=False),
        "ids": normalized_ids,
    }


def normalize_grants(grants: Any) -> list[dict[str, Any]]:
    if not isinstance(grants, list):
        return []

    normalized_grants: list[dict[str, Any]] = []
    for grant in grants:
        if not isinstance(grant, dict):
            continue

        permission_key = _normalize_text(grant.get("permission"))
        if not permission_key:
            continue

        normalized_resources: dict[str, dict[str, Any]] = {}
        raw_resources = grant.get("resources")
        if isinstance(raw_resources, dict):
            for resource_key, resource_scope in raw_resources.items():
                normalized_key = _normalize_text(resource_key)
                if not normalized_key:
                    continue
                normalized_resources[normalized_key] = _normalize_resource_scope(resource_scope)

        normalized_grants.append(
            {
                "permission": permission_key,
                "resources": normalized_resources,
            }
        )

    return normalized_grants


@lru_cache(maxsize=1)
def get_sofa_permission_registry() -> dict[str, Any]:
    return _load_json_file("sofa_permissions.json")


@lru_cache(maxsize=1)
def get_sofa_profile_registry() -> dict[str, Any]:
    return _load_json_file("sofa_profiles.json")


@lru_cache(maxsize=1)
def get_permission_definitions_by_key() -> dict[str, dict[str, Any]]:
    registry = get_sofa_permission_registry()
    definitions: dict[str, dict[str, Any]] = {}

    for item in registry.get("permissions") or []:
        if not isinstance(item, dict):
            continue
        permission_key = _normalize_text(item.get("key"))
        if permission_key:
            definitions[permission_key] = item

    return definitions


@lru_cache(maxsize=1)
def get_resource_type_definitions_by_key() -> dict[str, dict[str, Any]]:
    registry = get_sofa_permission_registry()
    definitions: dict[str, dict[str, Any]] = {}

    for item in registry.get("resource_types") or []:
        if not isinstance(item, dict):
            continue
        resource_key = _normalize_text(item.get("key"))
        if resource_key:
            definitions[resource_key] = item

    return definitions


def get_permission_definition(permission_key: str) -> dict[str, Any] | None:
    return get_permission_definitions_by_key().get(permission_key)

