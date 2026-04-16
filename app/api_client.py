# app/api_client.py
import httpx # type: ignore
from typing import Any

BASE_URL = "http://dev-api:8080/dev"  # Backend-Base-URL

class APIClient:
    def __init__(self, base_url: str = BASE_URL, timeout: int = 10):
        self.base_url = base_url
        self.timeout = timeout

    # --------------------------
    # Hilfsmethode für GET
    # --------------------------
    async def get(self, path: str, params: dict | None = None) -> Any:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            try:
                resp = await client.get(path, params=params, timeout=self.timeout)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as e:
                # Backend hat Fehlercode zurückgegeben
                detail = e.response.json().get("detail", "Unbekannter Fehler")
                raise Exception(f"HTTP {e.response.status_code}: {detail}")
            except httpx.RequestError as e:
                raise Exception(f"Request Error: {str(e)}")

    # --------------------------
    # Hilfsmethode für POST
    # --------------------------
    async def post(self, path: str, data: dict | None = None) -> Any:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            try:
                resp = await client.post(path, json=data, timeout=self.timeout)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as e:
                detail = e.response.json().get("detail", "Unbekannter Fehler")
                raise Exception(f"HTTP {e.response.status_code}: {detail}")
            except httpx.RequestError as e:
                raise Exception(f"Request Error: {str(e)}")

    # --------------------------
    # Konkrete API-Aufrufe
    # --------------------------
    async def login_user(self, pnr: str, password: str) -> dict:
        return await self.post("/users/login", data={"pnr": pnr, "password": password})

    async def list_users(self, is_active: bool | None = None) -> list[dict]:
        params = {"is_active": is_active} if is_active is not None else None
        return await self.get("/users/", params=params)

    async def get_user_details(self, user_id: int) -> dict:
        return await self.get(f"/users/{user_id}/details")

    async def setup_user_sofa_access(self, user_id: int, payload: dict) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/users/{user_id}/sofa-access/setup", json=payload)
            resp.raise_for_status()
            return resp.json()

    async def reset_user_sofa_password(self, user_id: int, payload: dict) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/users/{user_id}/sofa-access/reset-password", json=payload)
            resp.raise_for_status()
            return resp.json()

    async def revoke_user_sofa_access(self, user_id: int, payload: dict) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/users/{user_id}/sofa-access/revoke", json=payload)
            resp.raise_for_status()
            return resp.json()
    
    async def get_user_by_pnr(self, pnr: str):
        async with httpx.AsyncClient(base_url=BASE_URL) as client:
            resp = await client.get(f"/users/{pnr}")
            resp.raise_for_status()
        return resp.json()

    async def get_user_by_id(self, user_id: int):
        async with httpx.AsyncClient(base_url=BASE_URL) as client:
            resp = await client.get(f"/users/{user_id}")
            resp.raise_for_status()
        return resp.json()

    async def get_role_resources(self, role_id: int) -> list[dict]:
        async with httpx.AsyncClient(base_url=BASE_URL) as client:
            resp = await client.get(f"/roles/{role_id}/resources")
            resp.raise_for_status()
        return resp.json()   

    async def list_tasks(
        self,
        status: str | None = None,
        type: str | None = None,
        handling_type: str | None = None,
        assigned_to_user_id: int | None = None,
        process_id: int | None = None,
    ) -> list[dict]:
        """
        Liefert Tasks (Payload wird unverändert weitergereicht)
        """
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

        async with httpx.AsyncClient(base_url=BASE_URL) as client:
            resp = await client.get("/tasks/view", params=params)
            resp.raise_for_status()
            return resp.json()
        
    async def assign_task(self, task_id: int, user_id: int) -> dict:
        async with httpx.AsyncClient(base_url=BASE_URL) as client:
            resp = await client.patch(
                f"/tasks/{task_id}/assign",
                params={"user_id": user_id}
            )
            resp.raise_for_status()

        return resp.json()
    
    async def unassign_task(self, task_id: int, user_id: int) -> dict:
        """
        Ruft die Backend Route auf, um einen Task wieder auf OPEN zu setzen
        """
        async with httpx.AsyncClient(base_url=BASE_URL) as client:
            resp = await client.delete(
                f"/tasks/{task_id}/assign",
                params={"user_id": user_id}
            )

            if resp.is_error:
                # HTTPException wird im BFF gefangen
                raise httpx.HTTPStatusError(
                    message="Backend error",
                    request=resp.request,
                    response=resp
                )

            return resp.json()
        
    async def complete_task(self, task_id: int, user_id: int, account_identifier: str | None = None, comment: str | None = None) -> dict:
        """
        Wrapper für /tasks/{task_id}/complete
        account_identifier nur nötig, wenn resource_type_id = 1
        """
        payload = {}
        if account_identifier:
            payload["account_identifier"] = account_identifier
        if comment:
            payload["comment"] = comment

        async with httpx.AsyncClient(base_url=BASE_URL) as client:
            resp = await client.post(
                f"/tasks/{task_id}/complete",
                headers={"Content-Type": "application/json"},
                json=payload
            )
            resp.raise_for_status()
            return resp.json()
        
    async def trigger_onboarding(self, payload: dict) -> dict:
        """
        Triggert den Onboarding-Prozess via Backend.
        payload muss enthalten: { "pnr": str, "initiator_user_id": int }
        """
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
            resp = await client.post("/processes/onboarding", json=payload)
            resp.raise_for_status()  # HTTPError wenn Status != 2xx
            return resp.json()
        
    async def trigger_ext_onboarding(self, payload: dict) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout) as client:
            resp = await client.post("/processes/onboarding-ext", json=payload)
            resp.raise_for_status()  # HTTPError wenn Status != 2xx
            return resp.json()


    async def get_task_overview(self, user_id: int) -> dict:
        """
        Liefert eine Übersicht über Tasks für einen User (offen, erledigt, etc.)
        """
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.get(f"/tasks/overview", params={"user_id": user_id})
            resp.raise_for_status()
            return resp.json()
        
    async def get_system_overview(self) -> dict:
        """
        Liefert die Liste aller Systeme inkl. Resource-Namen
        """
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.get("/systems/")
            resp.raise_for_status()
            return resp.json()

    async def create_system(self, payload: dict) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post("/systems/", json=payload)
            resp.raise_for_status()
            return resp.json()
        
    async def get_system_detail(self, system_id: int) -> dict:
        """
        Liefert SystemContext JSON vom Backend
        """
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.get(f"/systems/{system_id}")  # interne Backend-Route
            resp.raise_for_status()
            return resp.json()

    async def update_system(self, system_id: int, payload: dict) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/systems/{system_id}", json=payload)
            resp.raise_for_status()
            return resp.json()
        
    async def get_system_resources(self, system_id: int) -> dict:
        
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.get(f"/systems/{system_id}/resources")  
            resp.raise_for_status()
            return resp.json()
        
    async def update_resource(self, resource_id, payload) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/resources/{resource_id}", json=payload)  
            resp.raise_for_status()
            return resp.json()  
          
    async def create_resource(self, payload) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/resources/", json=payload)  
            resp.raise_for_status()
            return resp.json()  
    
    async def get_role_overview(self) -> dict:
        """
        Liefert die Liste aller Systeme inkl. Resource-Namen
        """
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.get("/roles/")
            resp.raise_for_status()
            return resp.json()

    async def create_role(self, payload: dict) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post("/roles/", json=payload)
            resp.raise_for_status()
            return resp.json()
        
    async def get_role_map(self) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.get(f"/roles/map")
            resp.raise_for_status()
            return resp.json()
        
    async def get_system_map(self) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.get(f"/systems/map")
            resp.raise_for_status()
            return resp.json()
        
    async def get_mail_template(self, payload) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/resources/mail_template", json=payload)  
            resp.raise_for_status()
            return resp.json()
        
    async def get_role_detail(self, role_id: int) -> dict:
        """
        Liefert SystemContext JSON vom Backend
        """
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.get(f"/roles/{role_id}")  
            resp.raise_for_status()
            return resp.json()

    async def update_role(self, role_id: int, payload: dict) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/roles/{role_id}", json=payload)
            resp.raise_for_status()
            return resp.json()
        
    async def trigger_skill_assignment(self, payload):
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/processes/skill_assignment", json=payload)  
            resp.raise_for_status()
            return resp.json()
        
    async def trigger_skill_removal(self, payload):
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/processes/skill_removal", json=payload)  
            resp.raise_for_status()
            return resp.json()

    async def trigger_temporary_role(self, payload):
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/processes/tmp_role", json=payload)  
            resp.raise_for_status()
            return resp.json()
        
    async def trigger_offboarding(self, payload):
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/processes/offboarding", json=payload)  
            resp.raise_for_status()
            return resp.json()

    async def trigger_iks_process_report(self, payload):
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/processes/iks", json=payload)
            resp.raise_for_status()
            return resp.json()
        
    async def add_resources_to_role(self, payload: dict):
        print(payload)
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/roles/{payload['role_id']}/resources/add", json=payload)  
            resp.raise_for_status()
            return resp.json()
        
    async def remove_resources_from_role(self, payload: dict):
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/roles/{payload['role_id']}/resources/remove", json=payload)
            resp.raise_for_status()
            return resp.json()
        
    async def get_task_logs(self, task_id):
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.get(f"/tasks/{task_id}/logs")  
            resp.raise_for_status()
            return resp.json()
        
    async def dispatch_bot(self, task_id):
        async with httpx.AsyncClient(base_url=self.base_url) as client:
            resp = await client.post(f"/tasks/{task_id}/dispatch_bot", json=task_id)  
            resp.raise_for_status()
            return resp.json()
        
# Singleton-Client
api_client = APIClient()
