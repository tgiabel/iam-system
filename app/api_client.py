from __future__ import annotations

import httpx  # type: ignore
from typing import Any
from urllib.parse import quote


BASE_URL = "http://dev-api:8080"
ACCESS_BASE_URL = f"{BASE_URL}/access"
SOFA_BASE_URL = f"{BASE_URL}/sofa"
TICKETING_BASE_URL = f"{BASE_URL}/ticketing"
MESSAGING_BASE_URL = f"{BASE_URL}/messaging"
DATAPROCESSING_BASE_URL = f"{BASE_URL}/dataprocessing"
Q_MANAGER_BASE_URL = f"{BASE_URL}/q-manager"
REPORTING_BASE_URL = f"{BASE_URL}/reporting"
STOERUNG_BASE_URL = BASE_URL


class APIClient:
    def __init__(self, timeout: int = 10):
        self.timeout = timeout

    async def _request(
        self,
        method: str,
        base_url: str,
        path: str,
        *,
        params: dict | None = None,
        payload: dict | None = None,
        data: dict | None = None,
        files: dict | None = None,
        headers: dict | None = None,
    ) -> httpx.Response:
        try:
            async with httpx.AsyncClient(base_url=base_url, timeout=self.timeout) as client:
                response = await client.request(
                    method,
                    path,
                    params=params,
                    json=payload,
                    data=data,
                    files=files,
                    headers=headers,
                )
                response.raise_for_status()
                return response
        except httpx.RequestError as exc:
            raise Exception(f"Request Error: {str(exc)}") from exc

    async def _request_json(
        self,
        method: str,
        base_url: str,
        path: str,
        *,
        params: dict | None = None,
        payload: dict | None = None,
        data: dict | None = None,
        files: dict | None = None,
        headers: dict | None = None,
    ) -> Any:
        response = await self._request(
            method,
            base_url,
            path,
            params=params,
            payload=payload,
            data=data,
            files=files,
            headers=headers,
        )
        if not response.content:
            return {}
        return response.json()

    async def _get(self, base_url: str, path: str, *, params: dict | None = None, headers: dict | None = None) -> Any:
        return await self._request_json("GET", base_url, path, params=params, headers=headers)

    async def _post(self, base_url: str, path: str, *, params: dict | None = None, payload: dict | None = None, headers: dict | None = None) -> Any:
        return await self._request_json("POST", base_url, path, params=params, payload=payload, headers=headers)

    async def _post_form(
        self,
        base_url: str,
        path: str,
        *,
        data: dict | None = None,
        files: dict | None = None,
        headers: dict | None = None,
    ) -> Any:
        return await self._request_json("POST", base_url, path, data=data, files=files, headers=headers)

    async def _put(self, base_url: str, path: str, *, params: dict | None = None, payload: dict | None = None, headers: dict | None = None) -> Any:
        return await self._request_json("PUT", base_url, path, params=params, payload=payload, headers=headers)

    async def _patch(self, base_url: str, path: str, *, params: dict | None = None, payload: dict | None = None, headers: dict | None = None) -> Any:
        return await self._request_json("PATCH", base_url, path, params=params, payload=payload, headers=headers)

    async def _delete(self, base_url: str, path: str, *, params: dict | None = None, payload: dict | None = None) -> Any:
        return await self._request_json("DELETE", base_url, path, params=params, payload=payload)

    # Access
    async def login_user(self, pnr: str, password: str) -> dict:
        return await self._post(ACCESS_BASE_URL, "/users/login", payload={"pnr": pnr, "password": password})

    async def get_current_user(self, user_id: int) -> dict:
        return await self._get(ACCESS_BASE_URL, "/users/me", headers={"X-User-Id": str(user_id)})

    async def get_sofa_me(self, user_id: int) -> dict:
        return await self._get(SOFA_BASE_URL, "/me", headers={"X-User-Id": str(user_id)})

    async def list_users(self, is_active: bool | None = None) -> list[dict]:
        params = {"is_active": is_active} if is_active is not None else None
        return await self._get(ACCESS_BASE_URL, "/users/", params=params)

    async def get_user_details(self, user_id: int) -> dict:
        return await self._get(ACCESS_BASE_URL, f"/users/{user_id}/details")

    async def get_user_account_history(self, user_id: int) -> list[dict]:
        return await self._get(ACCESS_BASE_URL, f"/users/{user_id}/account-history")

    async def get_user_role_history(self, user_id: int, *, limit: int = 50, offset: int = 0) -> dict:
        return await self._get(
            ACCESS_BASE_URL,
            f"/users/{user_id}/role-history",
            params={"limit": limit, "offset": offset},
        )

    async def get_user_resource_history(self, user_id: int, *, limit: int = 50, offset: int = 0) -> dict:
        return await self._get(
            ACCESS_BASE_URL,
            f"/users/{user_id}/resource-history",
            params={"limit": limit, "offset": offset},
        )

    async def get_user_by_pnr(self, pnr: str):
        return await self._get(ACCESS_BASE_URL, f"/users/{pnr}")

    async def get_user_by_id(self, user_id: int):
        return await self._get(ACCESS_BASE_URL, f"/users/{user_id}")

    async def get_role_resources(self, role_id: int) -> list[dict]:
        return await self._get(ACCESS_BASE_URL, f"/roles/{role_id}/resources")

    async def get_system_overview(self) -> dict:
        return await self._get(ACCESS_BASE_URL, "/systems/")

    async def get_system_map(self) -> dict:
        return await self._get(ACCESS_BASE_URL, "/systems/map")

    async def create_system(self, payload: dict) -> dict:
        return await self._post(ACCESS_BASE_URL, "/systems/", payload=payload)

    async def get_system_detail(self, system_id: int) -> dict:
        return await self._get(ACCESS_BASE_URL, f"/systems/{system_id}")

    async def update_system(self, system_id: int, payload: dict) -> dict:
        return await self._post(ACCESS_BASE_URL, f"/systems/{system_id}", payload=payload)

    async def get_system_resources(self, system_id: int) -> dict:
        return await self._get(ACCESS_BASE_URL, f"/systems/{system_id}/resources")

    async def list_resources(self, params: dict | None = None) -> list[dict]:
        return await self._get(ACCESS_BASE_URL, "/resources/", params=params)

    async def update_resource(self, resource_id, payload) -> dict:
        return await self._post(ACCESS_BASE_URL, f"/resources/{resource_id}", payload=payload)

    async def create_resource(self, payload) -> dict:
        return await self._post(ACCESS_BASE_URL, "/resources/", payload=payload)

    async def get_role_overview(self) -> dict:
        return await self._get(ACCESS_BASE_URL, "/roles/")

    async def create_role(self, payload: dict) -> dict:
        return await self._post(ACCESS_BASE_URL, "/roles/", payload=payload)

    async def get_role_map(self) -> dict:
        return await self._get(ACCESS_BASE_URL, "/roles/map")

    async def get_mail_template(self, payload) -> dict:
        return await self._post(ACCESS_BASE_URL, "/resources/mail_template", payload=payload)

    async def get_role_detail(self, role_id: int) -> dict:
        return await self._get(ACCESS_BASE_URL, f"/roles/{role_id}")

    async def update_role(self, role_id: int, payload: dict) -> dict:
        return await self._post(ACCESS_BASE_URL, f"/roles/{role_id}", payload=payload)

    async def get_sofa_authorization_catalog(self) -> dict:
        return await self._get(ACCESS_BASE_URL, "/sofa-authorization/catalog")

    async def get_role_sofa_grants(self, role_id: int) -> list[dict]:
        return await self._get(ACCESS_BASE_URL, f"/roles/{role_id}/sofa-grants")

    async def replace_role_sofa_grants(self, role_id: int, payload: dict) -> dict:
        return await self._post(ACCESS_BASE_URL, f"/roles/{role_id}/sofa-grants", payload=payload)

    async def reevaluate_role_resources(self, role_id: int, payload: dict) -> dict:
        return await self._post(ACCESS_BASE_URL, f"/roles/{role_id}/resources/reevaluate", payload=payload)

    async def add_resources_to_role(self, payload: dict):
        return await self._post(ACCESS_BASE_URL, f"/roles/{payload['role_id']}/resources/add", payload=payload)

    async def remove_resources_from_role(self, payload: dict):
        return await self._post(ACCESS_BASE_URL, f"/roles/{payload['role_id']}/resources/remove", payload=payload)

    # SOFA
    async def get_events(self) -> list[dict]:
        return await self._get(SOFA_BASE_URL, "/events")

    async def get_backlogs(self) -> list[dict]:
        return await self._get(SOFA_BASE_URL, "/backlogs/")

    async def setup_user_sofa_access(self, user_id: int, payload: dict) -> dict:
        return await self._post(SOFA_BASE_URL, f"/users/{user_id}/sofa-access/setup", payload=payload)

    async def reset_user_sofa_password(self, user_id: int, payload: dict) -> dict:
        return await self._post(SOFA_BASE_URL, f"/users/{user_id}/sofa-access/reset-password", payload=payload)

    async def change_own_sofa_password(self, user_id: int, current_password: str, new_password: str) -> dict:
        return await self._post(
            SOFA_BASE_URL,
            f"/users/{user_id}/sofa-access/change-password",
            payload={
                "current_password": current_password,
                "new_password": new_password,
                "initiator_user_id": user_id,
            },
        )

    async def revoke_user_sofa_access(self, user_id: int, payload: dict) -> dict:
        return await self._post(SOFA_BASE_URL, f"/users/{user_id}/sofa-access/revoke", payload=payload)

    async def cancel_process(self, process_id: int, payload: dict) -> dict:
        return await self._post(SOFA_BASE_URL, f"/processes/{process_id}/cancel", payload=payload)

    async def list_tasks(
        self,
        status: str | None = None,
        type: str | None = None,
        handling_type: str | None = None,
        assigned_to_user_id: int | None = None,
        process_id: int | None = None,
    ) -> list[dict]:
        params = {}
        if status:
            params["status"] = status
        if type:
            params["type"] = type
        if handling_type:
            params["handling_type"] = handling_type
        if assigned_to_user_id is not None:
            params["assigned_to_user_id"] = assigned_to_user_id
        if process_id is not None:
            params["process_id"] = process_id

        return await self._get(SOFA_BASE_URL, "/tasks/view", params=params or None)

    async def assign_task(self, task_id: int, user_id: int) -> dict:
        return await self._patch(SOFA_BASE_URL, f"/tasks/{task_id}/assign", params={"user_id": user_id})

    async def unassign_task(self, task_id: int, user_id: int) -> dict:
        return await self._delete(SOFA_BASE_URL, f"/tasks/{task_id}/assign", params={"user_id": user_id})

    async def bulk_assign_tasks(self, task_ids: list[int], user_id: int) -> dict:
        return await self._post(
            SOFA_BASE_URL,
            "/tasks/bulk-assign",
            payload={"task_ids": task_ids, "user_id": user_id},
            headers={"X-User-Id": str(user_id)},
        )

    async def bulk_release_tasks(self, task_ids: list[int], user_id: int) -> dict:
        return await self._post(
            SOFA_BASE_URL,
            "/tasks/bulk-release",
            payload={"task_ids": task_ids, "user_id": user_id},
            headers={"X-User-Id": str(user_id)},
        )

    async def complete_task(
        self,
        task_id: int,
        user_id: int,
        account_identifier: str | None = None,
        comment: str | None = None,
    ) -> dict:
        payload = {}
        if account_identifier:
            payload["account_identifier"] = account_identifier
        if comment:
            payload["comment"] = comment

        return await self._post(
            SOFA_BASE_URL,
            f"/tasks/{task_id}/complete",
            payload=payload,
            headers={"Content-Type": "application/json"},
        )

    async def lookup_onboarding_candidate(self, payload: dict) -> dict:
        return await self._post(SOFA_BASE_URL, "/processes/onboarding/lookup", payload=payload)

    async def trigger_onboarding(self, payload: dict) -> dict:
        return await self._post(SOFA_BASE_URL, "/processes/onboarding", payload=payload)

    async def trigger_ext_onboarding(self, payload: dict) -> dict:
        return await self._post(SOFA_BASE_URL, "/processes/onboarding-ext", payload=payload)

    async def get_task_overview(self, user_id: int) -> dict:
        return await self._get(SOFA_BASE_URL, "/tasks/overview", params={"user_id": user_id})

    async def get_process_overview(self, user_id: int) -> dict:
        return await self._get(SOFA_BASE_URL, f"/processes/overview/{user_id}")

    async def trigger_skill_assignment(self, payload) -> dict:
        return await self._post(SOFA_BASE_URL, "/processes/skill_assignment", payload=payload)

    async def trigger_primary_role_change(self, payload) -> dict:
        return await self._post(SOFA_BASE_URL, "/processes/change", payload=payload)

    async def trigger_skill_removal(self, payload) -> dict:
        return await self._post(SOFA_BASE_URL, "/processes/skill_removal", payload=payload)

    async def trigger_temporary_role(self, payload) -> dict:
        return await self._post(SOFA_BASE_URL, "/processes/tmp_role", payload=payload)

    async def trigger_offboarding(self, payload) -> dict:
        return await self._post(SOFA_BASE_URL, "/processes/offboarding", payload=payload)

    async def trigger_training_schedule(self, payload) -> dict:
        return await self._post(SOFA_BASE_URL, "/processes/training_schedule", payload=payload)

    async def trigger_iks_process_report(self, payload) -> dict:
        return await self._post(SOFA_BASE_URL, "/processes/iks", payload=payload)

    # IKS reports
    @staticmethod
    def _iks_headers(user_id: int) -> dict[str, str]:
        return {"X-User-Id": str(user_id)}

    async def get_iks_catalog(self, user_id: int) -> dict:
        return await self._get(
            SOFA_BASE_URL,
            "/iks/catalog",
            headers=self._iks_headers(user_id),
        )

    async def create_iks_report(self, user_id: int, payload: dict) -> dict:
        return await self._post(
            SOFA_BASE_URL,
            "/iks/reports",
            payload=payload,
            headers=self._iks_headers(user_id),
        )

    async def download_iks_report_export(self, user_id: int, report_id: str, export_format: str) -> httpx.Response:
        encoded_report_id = quote(str(report_id), safe="")
        return await self._request(
            "GET",
            SOFA_BASE_URL,
            f"/iks/reports/{encoded_report_id}/exports/{export_format}",
            headers=self._iks_headers(user_id),
        )

    async def get_task_logs(self, task_id):
        return await self._get(SOFA_BASE_URL, f"/tasks/{task_id}/logs")

    async def send_task_mail(self, task_id, payload: dict):
        return await self._post(SOFA_BASE_URL, f"/tasks/{task_id}/send_mail", payload=payload)

    async def dispatch_bot(self, task_id):
        return await self._post(SOFA_BASE_URL, f"/tasks/{task_id}/dispatch_bot", payload={"task_id": task_id})

    # Dataprocessing
    async def list_word_templates(self) -> list[dict]:
        return await self._get(DATAPROCESSING_BASE_URL, "/word-templates/")

    async def get_word_template(self, template_id: str) -> dict:
        return await self._get(DATAPROCESSING_BASE_URL, f"/word-templates/{template_id}")

    async def list_word_documents(self, *, template_id: str | None = None, user_id: str | None = None) -> list[dict]:
        params = {
            key: value
            for key, value in {
                "template_id": template_id,
                "user_id": user_id,
            }.items()
            if value not in (None, "")
        }
        return await self._get(DATAPROCESSING_BASE_URL, "/word-documents/", params=params or None)

    async def create_word_template(
        self,
        *,
        name: str,
        description: str,
        schema_json: str,
        template_filename: str,
        template_content: bytes,
        template_content_type: str | None = None,
    ) -> dict:
        files = {
            "template_file": (
                template_filename,
                template_content,
                template_content_type or "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
            )
        }
        data = {
            "name": name,
            "description": description,
            "schema_json": schema_json,
        }
        return await self._post_form(DATAPROCESSING_BASE_URL, "/word-templates/", data=data, files=files)

    async def update_word_template(self, template_id: str, payload: dict) -> dict:
        return await self._put(DATAPROCESSING_BASE_URL, f"/word-templates/{template_id}", payload=payload)

    async def render_word_template(self, template_id: str, payload: dict) -> dict:
        return await self._post(DATAPROCESSING_BASE_URL, f"/word-templates/{template_id}/render", payload=payload)

    async def prefill_word_template(self, template_id: str, payload: dict) -> dict:
        return await self._post(DATAPROCESSING_BASE_URL, f"/word-templates/{template_id}/prefill", payload=payload)

    async def render_download_word_template(self, template_id: str, payload: dict) -> httpx.Response:
        return await self._request("POST", DATAPROCESSING_BASE_URL, f"/word-templates/{template_id}/render-download", payload=payload)

    async def download_word_document(self, document_id: str) -> httpx.Response:
        return await self._request("GET", DATAPROCESSING_BASE_URL, f"/word-documents/{document_id}/download")

    async def delete_word_document(self, document_id: str) -> dict:
        return await self._delete(DATAPROCESSING_BASE_URL, f"/word-documents/{document_id}")

    # Dataprocessing - unified doc templates (word + pdf)
    async def list_doc_templates(self, doc_type: str | None = None) -> list[dict]:
        params = {"doc_type": doc_type} if doc_type else None
        return await self._get(DATAPROCESSING_BASE_URL, "/doc-templates/", params=params)

    async def get_doc_template(self, template_id: str, doc_type: str) -> dict:
        return await self._get(DATAPROCESSING_BASE_URL, f"/doc-templates/{template_id}", params={"doc_type": doc_type})

    async def list_doc_documents(
        self,
        *,
        doc_type: str | None = None,
        template_id: str | None = None,
        user_id: str | None = None,
    ) -> list[dict]:
        params = {
            key: value
            for key, value in {
                "doc_type": doc_type,
                "template_id": template_id,
                "user_id": user_id,
            }.items()
            if value not in (None, "")
        }
        return await self._get(DATAPROCESSING_BASE_URL, "/doc-documents/", params=params or None)

    async def create_doc_template(
        self,
        *,
        name: str,
        description: str,
        schema_json: str,
        doc_type: str,
        template_filename: str,
        template_content: bytes,
        template_content_type: str | None = None,
    ) -> dict:
        files = {
            "template_file": (
                template_filename,
                template_content,
                template_content_type or "application/octet-stream",
            )
        }
        data = {
            "name": name,
            "description": description,
            "schema_json": schema_json,
            "doc_type": doc_type,
        }
        return await self._post_form(DATAPROCESSING_BASE_URL, "/doc-templates/", data=data, files=files)

    async def update_doc_template(self, template_id: str, doc_type: str, payload: dict) -> dict:
        return await self._put(DATAPROCESSING_BASE_URL, f"/doc-templates/{template_id}", params={"doc_type": doc_type}, payload=payload)

    async def render_doc_template(self, template_id: str, doc_type: str, payload: dict) -> dict:
        return await self._post(DATAPROCESSING_BASE_URL, f"/doc-templates/{template_id}/render", params={"doc_type": doc_type}, payload=payload)

    async def prefill_doc_template(self, template_id: str, doc_type: str, payload: dict) -> dict:
        return await self._post(DATAPROCESSING_BASE_URL, f"/doc-templates/{template_id}/prefill", params={"doc_type": doc_type}, payload=payload)

    async def render_download_doc_template(self, template_id: str, doc_type: str, payload: dict) -> httpx.Response:
        return await self._request(
            "POST",
            DATAPROCESSING_BASE_URL,
            f"/doc-templates/{template_id}/render-download",
            params={"doc_type": doc_type},
            payload=payload,
        )

    async def download_doc_document(self, document_id: str, doc_type: str) -> httpx.Response:
        return await self._request(
            "GET",
            DATAPROCESSING_BASE_URL,
            f"/doc-documents/{document_id}/download",
            params={"doc_type": doc_type},
        )

    async def delete_doc_document(self, document_id: str, doc_type: str) -> dict:
        return await self._delete(DATAPROCESSING_BASE_URL, f"/doc-documents/{document_id}", params={"doc_type": doc_type})

    # Q-Manager
    async def list_qmanager_queues(self) -> dict:
        return await self._get(Q_MANAGER_BASE_URL, "/queues/all")

    async def list_qmanager_queues_overview(self) -> dict:
        return await self._get(Q_MANAGER_BASE_URL, "/queues/overview")

    async def list_qmanager_queue_members(self, queue_id: str) -> dict:
        return await self._get(Q_MANAGER_BASE_URL, f"/queues/{queue_id}/members")

    async def patch_qmanager_queue_members(self, queue_id: str, payload: dict) -> dict:
        return await self._patch(Q_MANAGER_BASE_URL, f"/queues/{queue_id}/members", payload=payload)

    async def list_qmanager_user_queues(self, user_id: str) -> dict:
        return await self._get(Q_MANAGER_BASE_URL, f"/users/{user_id}/queues")

    async def update_qmanager_user_queues(self, user_id: str, payload: dict) -> dict:
        return await self._patch(Q_MANAGER_BASE_URL, f"/users/{user_id}/queues", payload=payload)

    # Reporting
    async def get_ivr_report(self, day: str | None = None) -> dict:
        params = {"day": day} if day else None
        return await self._get(REPORTING_BASE_URL, "/ivr/report", params=params)

    async def get_ivr_call_details(self, day: str) -> dict:
        return await self._get(
            REPORTING_BASE_URL,
            "/ivr/call-details",
            params={"day": day},
        )

    # Störungsprotokoll
    def _stoerung_headers(self, authz: Any) -> dict:
        return {
            "X-User-Id": str(authz.user_id or ""),
            "X-User-Pnr": str(authz.pnr or ""),
            "X-User-Role": str(authz.primary_role_name or ""),
        }

    async def list_incidents(self, authz: Any, status_filter: str | None = None) -> list[dict]:
        params = {"status_filter": status_filter} if status_filter else None
        return await self._get(STOERUNG_BASE_URL, "/incidents", params=params, headers=self._stoerung_headers(authz))

    async def list_active_incidents(self, authz: Any) -> list[dict]:
        return await self._get(STOERUNG_BASE_URL, "/incidents/active", headers=self._stoerung_headers(authz))

    async def get_incident(self, authz: Any, incident_id: str) -> dict:
        return await self._get(STOERUNG_BASE_URL, f"/incidents/{incident_id}", headers=self._stoerung_headers(authz))

    async def create_incident(self, authz: Any, payload: dict) -> dict:
        return await self._post(STOERUNG_BASE_URL, "/incidents", payload=payload, headers=self._stoerung_headers(authz))

    async def update_incident_status(self, authz: Any, incident_id: str, status: str) -> dict:
        return await self._patch(STOERUNG_BASE_URL, f"/incidents/{incident_id}/status", payload={"status": status}, headers=self._stoerung_headers(authz))

    async def append_incident_entry(self, authz: Any, incident_id: str, content: str) -> dict:
        return await self._post(STOERUNG_BASE_URL, f"/incidents/{incident_id}/entries", payload={"content": content}, headers=self._stoerung_headers(authz))

    async def close_incident(self, authz: Any, incident_id: str, payload: dict) -> dict:
        return await self._post(STOERUNG_BASE_URL, f"/incidents/{incident_id}/close", payload=payload, headers=self._stoerung_headers(authz))

    async def update_incident_contributors(self, authz: Any, incident_id: str, payload: dict) -> dict:
        return await self._patch(STOERUNG_BASE_URL, f"/incidents/{incident_id}/contributors", payload=payload, headers=self._stoerung_headers(authz))


api_client = APIClient()
