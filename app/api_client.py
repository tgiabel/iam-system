import httpx  # type: ignore
from typing import Any


BASE_URL = "http://dev-api:8080"
ACCESS_BASE_URL = f"{BASE_URL}/access"
SOFA_BASE_URL = f"{BASE_URL}/sofa"
TICKETING_BASE_URL = f"{BASE_URL}/ticketing"
MESSAGING_BASE_URL = f"{BASE_URL}/messaging"


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
        headers: dict | None = None,
    ) -> httpx.Response:
        try:
            async with httpx.AsyncClient(base_url=base_url, timeout=self.timeout) as client:
                response = await client.request(
                    method,
                    path,
                    params=params,
                    json=payload,
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
        headers: dict | None = None,
    ) -> Any:
        response = await self._request(
            method,
            base_url,
            path,
            params=params,
            payload=payload,
            headers=headers,
        )
        if not response.content:
            return {}
        return response.json()

    async def _get(self, base_url: str, path: str, *, params: dict | None = None, headers: dict | None = None) -> Any:
        return await self._request_json("GET", base_url, path, params=params, headers=headers)

    async def _post(self, base_url: str, path: str, *, payload: dict | None = None, headers: dict | None = None) -> Any:
        return await self._request_json("POST", base_url, path, payload=payload, headers=headers)

    async def _patch(self, base_url: str, path: str, *, params: dict | None = None, payload: dict | None = None) -> Any:
        return await self._request_json("PATCH", base_url, path, params=params, payload=payload)

    async def _delete(self, base_url: str, path: str, *, params: dict | None = None, payload: dict | None = None) -> Any:
        return await self._request_json("DELETE", base_url, path, params=params, payload=payload)

    # Access
    async def login_user(self, pnr: str, password: str) -> dict:
        return await self._post(ACCESS_BASE_URL, "/users/login", payload={"pnr": pnr, "password": password})

    async def get_current_user(self, user_id: int) -> dict:
        return await self._get(ACCESS_BASE_URL, "/users/me", headers={"X-User-Id": str(user_id)})

    async def list_users(self, is_active: bool | None = None) -> list[dict]:
        params = {"is_active": is_active} if is_active is not None else None
        return await self._get(ACCESS_BASE_URL, "/users/", params=params)

    async def get_user_details(self, user_id: int) -> dict:
        return await self._get(ACCESS_BASE_URL, f"/users/{user_id}/details")

    async def get_user_activity(self, user_id: int) -> dict:
        return await self._get(ACCESS_BASE_URL, f"/users/{user_id}/activity")

    async def get_user_by_pnr(self, pnr: str):
        return await self._get(ACCESS_BASE_URL, f"/users/{pnr}")

    async def get_user_by_id(self, user_id: int):
        return await self._get(ACCESS_BASE_URL, f"/users/{user_id}")

    async def get_role_resources(self, role_id: int) -> list[dict]:
        return await self._get(ACCESS_BASE_URL, f"/roles/{role_id}/resources")

    async def get_system_overview(self) -> dict:
        return await self._get(ACCESS_BASE_URL, "/systems/")

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

    async def reevaluate_role_resources(self, role_id: int, payload: dict) -> dict:
        return await self._post(ACCESS_BASE_URL, f"/roles/{role_id}/resources/reevaluate", payload=payload)

    async def add_resources_to_role(self, payload: dict):
        return await self._post(ACCESS_BASE_URL, f"/roles/{payload['role_id']}/resources/add", payload=payload)

    async def remove_resources_from_role(self, payload: dict):
        return await self._post(ACCESS_BASE_URL, f"/roles/{payload['role_id']}/resources/remove", payload=payload)

    # SOFA
    async def get_events(self) -> list[dict]:
        return await self._get(SOFA_BASE_URL, "/events")

    async def get_task_backlogs(self) -> list[dict]:
        return await self._get(SOFA_BASE_URL, "/task_backlogs/")

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
        return await self._get(SOFA_BASE_URL, "/processes/overview", params={"user_id": user_id})

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

    async def get_task_logs(self, task_id):
        return await self._get(SOFA_BASE_URL, f"/tasks/{task_id}/logs")

    async def send_task_mail(self, task_id, payload: dict):
        return await self._post(SOFA_BASE_URL, f"/tasks/{task_id}/send_mail", payload=payload)

    async def dispatch_bot(self, task_id):
        return await self._post(SOFA_BASE_URL, f"/tasks/{task_id}/dispatch_bot", payload={"task_id": task_id})


api_client = APIClient()
