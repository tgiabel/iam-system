from __future__ import annotations

from datetime import date, timedelta
from io import BytesIO
import json
from urllib.parse import quote

import httpx  # type: ignore
from fastapi import APIRouter, Cookie, Depends, File, Form, HTTPException, Request, UploadFile  # type: ignore
from fastapi.responses import JSONResponse, StreamingResponse  # type: ignore

from app.api_client import api_client
from app.authz import (
    build_authorization_context_from_user,
    get_authz_payload_for_template,
    get_current_user,
    require_any_permission,
    require_login,
    require_permission,
)
from app.helpers.datex import build_corrected_package, build_datex_preview
from app.routes.shared import (
    _build_template_context,
    _coerce_bool,
    _coerce_int,
    _build_session_user_from_login,
    _error_content_from_response,
    _normalize_session_user,
    _filter_processes_for_scope,
    _filter_tasks_for_scope,
    _get_relevant_task_or_raise,
    _normalize_events_payload,
    templates,
)


router = APIRouter(prefix="/api")


IKS_EXPORT_FORMATS = frozenset({"html", "csv", "json"})
IKS_REPORT_PERMISSIONS = {
    "process": "SOFA-IKS-PRCS",
    "role": "SOFA-IKS-ROLE",
    "system": "SOFA-IKS-SYS",
}


def _normalize_iks_export_links(report: dict) -> dict:
    """Keep internal backend URLs out of browser-visible report payloads."""
    normalized = dict(report)
    report_id = report.get("report_id")
    exports = report.get("exports")
    if not report_id or not isinstance(exports, dict):
        return normalized

    encoded_report_id = quote(str(report_id), safe="")
    normalized_exports = dict(exports)
    for export_format in IKS_EXPORT_FORMATS:
        if exports.get(export_format):
            normalized_exports[export_format] = (
                f"/api/iks/reports/{encoded_report_id}/exports/{export_format}"
            )
    normalized["exports"] = normalized_exports
    return normalized


def _request_uses_https(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        primary_proto = forwarded_proto.split(",")[0].strip().lower()
        return primary_proto == "https"
    return request.url.scheme.lower() == "https"


@router.post("/tools/datex/preview")
async def preview_datex_file(
    datfile: UploadFile = File(...),
    _authz=Depends(require_permission("SOFA-TOOL-DATX")),
):
    try:
        if not datfile.filename:
            return JSONResponse(
                content={"error": "Bitte waehlen Sie eine DAT-Datei aus."},
                status_code=400,
            )

        preview = build_datex_preview(await datfile.read())
        preview["filename"] = datfile.filename
        return JSONResponse(content=preview)
    except ValueError as exc:
        return JSONResponse(
            content={"error": str(exc)},
            status_code=400,
        )
    finally:
        await datfile.close()


@router.post("/tools/datex/download")
async def download_corrected_datex_file(
    datfile: UploadFile = File(...),
    removed_indices_json: str = Form(...),
    _authz=Depends(require_permission("SOFA-TOOL-DATX")),
):
    try:
        if not datfile.filename:
            raise ValueError("Bitte waehlen Sie eine DAT-Datei aus.")

        try:
            removed_indices = json.loads(removed_indices_json)
        except json.JSONDecodeError as exc:
            raise ValueError("Die Liste der entfernten Datensaetze ist ungueltig.") from exc
        if not isinstance(removed_indices, list):
            raise ValueError("Die Liste der entfernten Datensaetze ist ungueltig.")

        filename, package = build_corrected_package(
            await datfile.read(),
            removed_indices,
            datfile.filename,
        )
    except ValueError as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=400)
    finally:
        await datfile.close()

    return StreamingResponse(
        package,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/dataprocessing/word-templates")
async def api_list_word_templates(current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        result = await api_client.list_word_templates()
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/dataprocessing/word-template-users")
async def api_list_word_template_users(current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        users = await api_client.list_users(is_active=True)

        normalized_users: list[dict] = []
        for user in users or []:
            if not isinstance(user, dict):
                continue
            normalized_users.append(
                {
                    "user_id": user.get("user_id"),
                    "pnr": user.get("pnr"),
                    "racf": user.get("racf"),
                    "first_name": user.get("first_name"),
                    "last_name": user.get("last_name"),
                    "email": user.get("email"),
                    "is_active": user.get("is_active", True),
                }
            )

        normalized_users.sort(
            key=lambda item: (
                str(item.get("last_name") or "").strip().lower(),
                str(item.get("first_name") or "").strip().lower(),
                str(item.get("email") or "").strip().lower(),
            )
        )
        return JSONResponse(content=normalized_users)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/dataprocessing/word-templates/{template_id}")
async def api_get_word_template(template_id: str, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        result = await api_client.get_word_template(template_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/dataprocessing/word-documents")
async def api_list_word_documents(
    template_id: str | None = None,
    user_id: str | None = None,
    current_user=Depends(require_permission("SOFA-TOOL-FORM")),
):
    try:
        result = await api_client.list_word_documents(template_id=template_id, user_id=user_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/dataprocessing/word-templates")
async def api_create_word_template(
    name: str = Form(...),
    description: str = Form(""),
    schema_json: str = Form(...),
    template_file: UploadFile = File(...),
    current_user=Depends(require_permission("SOFA-TOOL-FORM")),
):
    try:
        template_content = await template_file.read()
        result = await api_client.create_word_template(
            name=name,
            description=description,
            schema_json=schema_json,
            template_filename=template_file.filename or "template.dotx",
            template_content=template_content,
            template_content_type=template_file.content_type,
        )
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)
    finally:
        await template_file.close()


@router.put("/dataprocessing/word-templates/{template_id}")
async def api_update_word_template(template_id: str, payload: dict, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        result = await api_client.update_word_template(template_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/dataprocessing/word-templates/{template_id}/render")
async def api_render_word_template(template_id: str, payload: dict, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        result = await api_client.render_word_template(template_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/dataprocessing/word-templates/{template_id}/prefill")
async def api_prefill_word_template(template_id: str, payload: dict, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        request_payload = {
            "user_id": payload.get("user_id"),
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.prefill_word_template(template_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/dataprocessing/word-templates/{template_id}/render-download")
async def api_render_download_word_template(template_id: str, payload: dict, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        request_payload = {
            "user_id": payload.get("user_id"),
            "values": payload.get("values") or {},
            "initiator_user_id": current_user.user_id,
        }
        response = await api_client.render_download_word_template(template_id, request_payload)
        media_type = response.headers.get(
            "content-type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        content_disposition = response.headers.get(
            "content-disposition",
            f'attachment; filename="document-{template_id}.docx"',
        )
        return StreamingResponse(
            BytesIO(response.content),
            media_type=media_type,
            headers={"Content-Disposition": content_disposition},
        )
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/dataprocessing/word-documents/{document_id}/download")
async def api_download_word_document(document_id: str, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        response = await api_client.download_word_document(document_id)
        media_type = response.headers.get(
            "content-type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        content_disposition = response.headers.get(
            "content-disposition",
            f'attachment; filename="document-{document_id}.docx"',
        )
        return StreamingResponse(
            BytesIO(response.content),
            media_type=media_type,
            headers={"Content-Disposition": content_disposition},
        )
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.delete("/dataprocessing/word-documents/{document_id}")
async def api_delete_word_document(document_id: str, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        result = await api_client.delete_word_document(document_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


_DOC_TYPE_EXTENSIONS = {".dotx": "word", ".pdf": "pdf"}

_DOC_TYPE_MEDIA_TYPES = {
    "word": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}

_DOC_TYPE_FILE_EXTENSIONS = {"word": "docx", "pdf": "pdf"}


def _infer_doc_type_from_filename(filename: str | None) -> str | None:
    lowered = str(filename or "").strip().lower()
    for extension, doc_type in _DOC_TYPE_EXTENSIONS.items():
        if lowered.endswith(extension):
            return doc_type
    return None


@router.get("/dataprocessing/doc-templates")
async def api_list_doc_templates(doc_type: str | None = None, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        result = await api_client.list_doc_templates(doc_type)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/dataprocessing/doc-templates/{template_id}")
async def api_get_doc_template(template_id: str, doc_type: str, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        result = await api_client.get_doc_template(template_id, doc_type)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/dataprocessing/doc-documents")
async def api_list_doc_documents(
    doc_type: str | None = None,
    template_id: str | None = None,
    user_id: str | None = None,
    current_user=Depends(require_permission("SOFA-TOOL-FORM")),
):
    try:
        result = await api_client.list_doc_documents(doc_type=doc_type, template_id=template_id, user_id=user_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/dataprocessing/doc-templates")
async def api_create_doc_template(
    name: str = Form(...),
    description: str = Form(""),
    schema_json: str = Form(...),
    template_file: UploadFile = File(...),
    current_user=Depends(require_permission("SOFA-TOOL-FORM")),
):
    try:
        doc_type = _infer_doc_type_from_filename(template_file.filename)
        if not doc_type:
            return JSONResponse(
                content={"error": "Die Vorlagendatei muss die Endung .dotx oder .pdf haben."},
                status_code=400,
            )

        template_content = await template_file.read()
        result = await api_client.create_doc_template(
            name=name,
            description=description,
            schema_json=schema_json,
            doc_type=doc_type,
            template_filename=template_file.filename or f"template.{doc_type}",
            template_content=template_content,
            template_content_type=template_file.content_type,
        )
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)
    finally:
        await template_file.close()


@router.put("/dataprocessing/doc-templates/{template_id}")
async def api_update_doc_template(template_id: str, doc_type: str, payload: dict, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        result = await api_client.update_doc_template(template_id, doc_type, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/dataprocessing/doc-templates/{template_id}/render")
async def api_render_doc_template(template_id: str, doc_type: str, payload: dict, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        result = await api_client.render_doc_template(template_id, doc_type, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/dataprocessing/doc-templates/{template_id}/prefill")
async def api_prefill_doc_template(template_id: str, doc_type: str, payload: dict, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        request_payload = {
            "user_id": payload.get("user_id"),
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.prefill_doc_template(template_id, doc_type, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/dataprocessing/doc-templates/{template_id}/render-download")
async def api_render_download_doc_template(template_id: str, doc_type: str, payload: dict, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        request_payload = {
            "user_id": payload.get("user_id"),
            "values": payload.get("values") or {},
            "initiator_user_id": current_user.user_id,
        }
        response = await api_client.render_download_doc_template(template_id, doc_type, request_payload)
        fallback_extension = _DOC_TYPE_FILE_EXTENSIONS.get(doc_type, "bin")
        media_type = response.headers.get(
            "content-type",
            _DOC_TYPE_MEDIA_TYPES.get(doc_type, "application/octet-stream"),
        )
        content_disposition = response.headers.get(
            "content-disposition",
            f'attachment; filename="document-{template_id}.{fallback_extension}"',
        )
        return StreamingResponse(
            BytesIO(response.content),
            media_type=media_type,
            headers={"Content-Disposition": content_disposition},
        )
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/dataprocessing/doc-documents/{document_id}/download")
async def api_download_doc_document(document_id: str, doc_type: str, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        response = await api_client.download_doc_document(document_id, doc_type)
        fallback_extension = _DOC_TYPE_FILE_EXTENSIONS.get(doc_type, "bin")
        media_type = response.headers.get(
            "content-type",
            _DOC_TYPE_MEDIA_TYPES.get(doc_type, "application/octet-stream"),
        )
        content_disposition = response.headers.get(
            "content-disposition",
            f'attachment; filename="document-{document_id}.{fallback_extension}"',
        )
        return StreamingResponse(
            BytesIO(response.content),
            media_type=media_type,
            headers={"Content-Disposition": content_disposition},
        )
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.delete("/dataprocessing/doc-documents/{document_id}")
async def api_delete_doc_document(document_id: str, doc_type: str, current_user=Depends(require_permission("SOFA-TOOL-FORM"))):
    try:
        result = await api_client.delete_doc_document(document_id, doc_type)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/q-manager/queues/all")
async def api_list_qmanager_queues(current_user=Depends(require_permission("SOFA-TOOL-GQ"))):
    try:
        result = await api_client.list_qmanager_queues()
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/q-manager/queues/overview")
async def api_list_qmanager_queues_overview(current_user=Depends(require_permission("SOFA-TOOL-GQ"))):
    try:
        result = await api_client.list_qmanager_queues_overview()
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/q-manager/queues/{queue_id}/members")
async def api_list_qmanager_queue_members(queue_id: str, current_user=Depends(require_permission("SOFA-TOOL-GQ"))):
    try:
        result = await api_client.list_qmanager_queue_members(queue_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.patch("/q-manager/queues/{queue_id}/members")
async def api_patch_qmanager_queue_members(
    queue_id: str,
    payload: dict,
    current_user=Depends(require_permission("SOFA-TOOL-GQ")),
):
    try:
        result = await api_client.patch_qmanager_queue_members(queue_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/q-manager/users/{user_id}/queues")
async def api_list_qmanager_user_queues(user_id: str, current_user=Depends(require_permission("SOFA-TOOL-GQ"))):
    try:
        result = await api_client.list_qmanager_user_queues(user_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.patch("/q-manager/users/{user_id}/queues")
async def api_update_qmanager_user_queues(
    user_id: str,
    payload: dict,
    current_user=Depends(require_permission("SOFA-TOOL-GQ")),
):
    try:
        result = await api_client.update_qmanager_user_queues(user_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


# Reporting

@router.get("/reporting/ivr/report")
async def api_get_ivr_report(
    day: str | None = None,
    current_user=Depends(require_permission("SOFA-RPRT-TIVR")),
):
    try:
        result = await api_client.get_ivr_report(day=day)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


def _resolve_ivr_report_day(day: str | None) -> str:
    yesterday = date.today() - timedelta(days=1)
    if not day:
        return yesterday.isoformat()
    try:
        report_day = date.fromisoformat(day)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Tag muss das Format YYYY-MM-DD haben.") from exc
    if report_day >= date.today():
        raise HTTPException(
            status_code=400,
            detail="IVR-Reportdaten stehen regulär nur bis einschließlich Vortag zur Verfügung.",
        )
    return report_day.isoformat()


@router.get("/reporting/ivr/call-details")
async def api_get_ivr_call_details(
    day: str | None = None,
    current_user=Depends(require_permission("SOFA-RPRT-TIVR")),
):
    report_day = _resolve_ivr_report_day(day)
    try:
        result = await api_client.get_ivr_call_details(day=report_day)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/session/authz")
async def api_session_authz_refresh(request: Request, sofa_user: str | None = Cookie(default=None)):
    try:
        session_user = get_current_user(sofa_user)
    except Exception:
        session_user = None

    if not isinstance(session_user, dict):
        return JSONResponse(content={"detail": "Keine aktive Session vorhanden."}, status_code=401)

    normalized_session_user = _normalize_session_user(session_user)
    session_user_id = _coerce_int(normalized_session_user.get("user_id"))
    if session_user_id is None:
        return JSONResponse(content={"detail": "Session konnte nicht eindeutig aufgeloest werden."}, status_code=401)

    stale_authz = get_authz_payload_for_template(
        build_authorization_context_from_user(normalized_session_user, normalized_session_user.get("sofa_permissions"))
    )

    try:
        refreshed_user = await api_client.get_current_user(session_user_id)
        normalized_user = await _build_session_user_from_login(refreshed_user)
        refreshed_authz = get_authz_payload_for_template(
            build_authorization_context_from_user(normalized_user, normalized_user.get("sofa_permissions"))
        )

        response = JSONResponse(
            content={
                "user": normalized_user,
                "authz": refreshed_authz,
                "refreshed": True,
            }
        )
        response.set_cookie(
            key="sofa_user",
            value=json.dumps(normalized_user),
            httponly=True,
            max_age=3600 * 8,
            samesite="lax",
            secure=_request_uses_https(request),
        )
        return response
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content={
                "detail": _error_content_from_response(exc.response).get("detail", "Berechtigungen konnten nicht aktualisiert werden."),
                "user": normalized_session_user,
                "authz": stale_authz,
                "refreshed": False,
            },
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(
            content={
                "detail": str(exc),
                "user": normalized_session_user,
                "authz": stale_authz,
                "refreshed": False,
            },
            status_code=503,
        )


@router.get("/users")
async def api_users(
    is_active: bool = True,
    current_user=Depends(require_permission("SOFA-PAGE-USER")),
):
    try:
        users = await api_client.list_users(is_active=is_active)
        return JSONResponse(content=users)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/users/{user_id}/details")
async def api_user_details(user_id: int, current_user=Depends(require_permission("SOFA-PAGE-USER"))):
    try:
        user_detail = await api_client.get_user_details(user_id)
        return JSONResponse(content=user_detail)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/users/{user_id}/account-history")
async def api_user_account_history(user_id: int, current_user=Depends(require_permission("SOFA-PAGE-USER"))):
    try:
        history = await api_client.get_user_account_history(user_id)
        return JSONResponse(content=history)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/users/{user_id}/role-history")
async def api_user_role_history(
    user_id: int,
    limit: int = 50,
    offset: int = 0,
    current_user=Depends(require_permission("SOFA-PAGE-USER")),
):
    try:
        history = await api_client.get_user_role_history(user_id, limit=limit, offset=offset)
        return JSONResponse(content=history)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/users/{user_id}/resource-history")
async def api_user_resource_history(
    user_id: int,
    limit: int = 50,
    offset: int = 0,
    current_user=Depends(require_permission("SOFA-PAGE-USER")),
):
    try:
        history = await api_client.get_user_resource_history(user_id, limit=limit, offset=offset)
        return JSONResponse(content=history)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/events")
async def api_events(current_user=Depends(require_permission("SOFA-PAGE-CNSL"))):
    try:
        events = await api_client.get_events()
        return JSONResponse(content=_normalize_events_payload(events))
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/backlogs")
async def api_task_backlogs(current_user=Depends(require_any_permission("SOFA-PAGE-TODO", "SOFA-PAGE-ROLE"))):
    try:
        backlogs = await api_client.get_backlogs()
        if not current_user.has_all_backlog_access:
            allowed = current_user.accessible_backlogs
            backlogs = [b for b in backlogs if b.get("identifier") in allowed]
        return JSONResponse(content=backlogs)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/users/{user_id}/sofa-access/setup")
async def api_setup_user_sofa_access(user_id: int, payload: dict, current_user=Depends(require_permission("SOFA-FN-ACC"))):
    try:
        request_payload = {
            "password": payload.get("password"),
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.setup_user_sofa_access(user_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/users/{user_id}/sofa-access/reset-password")
async def api_reset_user_sofa_password(user_id: int, payload: dict, current_user=Depends(require_permission("SOFA-FN-ACC"))):
    try:
        request_payload = {
            "password": payload.get("password"),
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.reset_user_sofa_password(user_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/users/{user_id}/sofa-access/revoke")
async def api_revoke_user_sofa_access(user_id: int, current_user=Depends(require_permission("SOFA-FN-ACC"))):
    try:
        request_payload = {"initiator_user_id": current_user.user_id}
        result = await api_client.revoke_user_sofa_access(user_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/roles/{role_id}/resources")
async def api_role_resources(role_id: int, current_user=Depends(require_any_permission("SOFA-PAGE-ROLE", "SOFA-PAGE-USER"))):
    try:
        resources = await api_client.get_role_resources(role_id)
        return JSONResponse(content=resources)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/tasks/view")
async def api_list_tasks(
    status: str | None = None,
    type: str | None = None,
    handling_type: str | None = None,
    assigned_to_user_id: int | None = None,
    process_id: int | None = None,
    current_user=Depends(require_permission("SOFA-PAGE-TODO")),
):
    try:
        tasks = await api_client.list_tasks(
            status=status,
            type=type,
            handling_type=handling_type,
            assigned_to_user_id=assigned_to_user_id,
            process_id=process_id,
        )
        return JSONResponse(content=_filter_tasks_for_scope(tasks, current_user))
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.patch("/tasks/{task_id}/assign")
async def api_assign_task(task_id: int, user_id: int, current_user=Depends(require_permission("SOFA-PAGE-TODO"))):
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        if int(user_id) != int(current_user.user_id):
            raise HTTPException(
                status_code=403,
                detail={"code": "assignment_denied", "message": "Tasks koennen nur an den aktuellen User uebernommen werden."},
            )
        return await api_client.assign_task(task_id, current_user.user_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.json().get("detail", "Backend error"),
        )
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/tasks/{task_id}/assign")
async def api_unassign_task(task_id: int, current_user=Depends(require_permission("SOFA-PAGE-TODO"))):
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        task = await api_client.unassign_task(task_id, current_user.user_id)
        return JSONResponse(content=task)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/tasks/bulk-assign")
async def api_bulk_assign_tasks(payload: dict, current_user=Depends(require_permission("SOFA-PAGE-TODO"))):
    try:
        task_ids = payload.get("task_ids") or []
        result = await api_client.bulk_assign_tasks(task_ids, current_user.user_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/tasks/bulk-release")
async def api_bulk_release_tasks(payload: dict, current_user=Depends(require_permission("SOFA-PAGE-TODO"))):
    try:
        task_ids = payload.get("task_ids") or []
        result = await api_client.bulk_release_tasks(task_ids, current_user.user_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/tasks/{task_id}/complete")
async def api_complete_task(task_id: int, payload: dict, current_user=Depends(require_permission("SOFA-PAGE-TODO"))):
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        user_id = current_user.user_id
        account_identifier = payload.get("account_identifier")
        comment = payload.get("comment")
        task = await api_client.complete_task(task_id, user_id, account_identifier, comment)
        return JSONResponse(content=task)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/tasks/dispatch_bot")
async def api_dispatch_bot(payload: dict, current_user=Depends(require_permission("SOFA-PAGE-TODO"))):
    try:
        task_id = payload.get("task_id")
        await _get_relevant_task_or_raise(task_id, current_user)
        result = await api_client.dispatch_bot(task_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/tasks/{task_id}/send_mail")
async def api_send_task_mail(task_id: int, payload: dict, current_user=Depends(require_permission("SOFA-PAGE-TODO"))):
    try:
        await _get_relevant_task_or_raise(task_id, current_user)
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.send_task_mail(task_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/account/change-password")
async def api_change_own_password(payload: dict, current_user=Depends(require_login)):
    current_password = str(payload.get("current_password") or "").strip()
    new_password = str(payload.get("new_password") or "").strip()

    if not current_password or not new_password:
        return JSONResponse(
            content={"detail": "Aktuelles Passwort und neues Passwort sind erforderlich."},
            status_code=400,
        )

    if current_password == new_password:
        return JSONResponse(
            content={"detail": "Das neue Passwort muss sich vom aktuellen Passwort unterscheiden."},
            status_code=400,
        )

    user_id = current_user.user_id
    pnr = current_user.pnr

    if not pnr:
        return JSONResponse(
            content={"detail": "Die Personalnummer des aktuellen Users konnte nicht ermittelt werden."},
            status_code=400,
        )

    try:
        result = await api_client.change_own_sofa_password(
            user_id=user_id,
            current_password=current_password,
            new_password=new_password,
        )
        return JSONResponse(content=result or {"status": "success"})
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/onboarding/lookup")
async def api_lookup_onboarding_candidate(
    payload: dict,
    current_user=Depends(require_permission("SOFA-FN-ONB")),
):
    pnr = str(payload.get("pnr") or "").strip()
    if not pnr:
        return JSONResponse(content={"detail": "Die Personalnummer ist erforderlich."}, status_code=400)

    try:
        result = await api_client.lookup_onboarding_candidate(
            {"pnr": pnr, "initiator_user_id": current_user.user_id}
        )
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/onboarding")
async def api_start_onboarding_process(
    payload: dict,
    current_user=Depends(require_permission("SOFA-FN-ONB")),
):
    mode = str(payload.get("mode") or "").strip().lower()
    confirmed = bool(payload.get("confirmed"))

    if not confirmed:
        return JSONResponse(
            content={"detail": "Das Onboarding muss vor dem Start bestätigt werden."},
            status_code=400,
        )

    forwarded_payload = {
        "mode": mode,
        "confirmed": True,
        "initiator_user_id": current_user.user_id,
    }

    if mode == "helix":
        lookup_token = str(payload.get("lookup_token") or "").strip()
        telephone = str(payload.get("telephone") or "").strip()
        entry_date = str(payload.get("entry_date") or "").strip()
        weekly_hours = _coerce_int(payload.get("weekly_hours"))
        if not lookup_token:
            return JSONResponse(content={"detail": "Der Lookup-Token ist erforderlich."}, status_code=400)
        forwarded_payload["lookup_token"] = lookup_token
        if telephone:
            forwarded_payload["telephone"] = telephone
        if entry_date:
            forwarded_payload["entry_date"] = entry_date
        if weekly_hours is not None:
            forwarded_payload["weekly_hours"] = weekly_hours
    elif mode == "manual":
        pnr = str(payload.get("pnr") or "").strip()
        first_name = str(payload.get("first_name") or "").strip()
        last_name = str(payload.get("last_name") or "").strip()
        primary_role_id = _coerce_int(payload.get("primary_role_id"))
        telephone = str(payload.get("telephone") or "").strip()
        entry_date = str(payload.get("entry_date") or "").strip()
        weekly_hours = _coerce_int(payload.get("weekly_hours"))

        if (
            not pnr
            or not first_name
            or not last_name
            or primary_role_id is None
            or not telephone
            or not entry_date
            or weekly_hours is None
        ):
            return JSONResponse(
                content={"detail": "Für das manuelle Onboarding sind alle Pflichtfelder erforderlich."},
                status_code=400,
            )

        forwarded_payload.update(
            {
                "pnr": pnr,
                "first_name": first_name,
                "last_name": last_name,
                "primary_role_id": primary_role_id,
                "telephone": telephone,
                "entry_date": entry_date,
                "weekly_hours": weekly_hours,
            }
        )
    else:
        return JSONResponse(content={"detail": "Unbekannter Onboarding-Modus."}, status_code=400)

    try:
        result = await api_client.trigger_onboarding(forwarded_payload)
        return JSONResponse(
            content={
                "process_id": result.get("process_id"),
                "status": result.get("status", "started"),
            }
        )
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/onboarding-ext")
async def api_start_ext_onboarding_process(
    payload: dict,
    current_user=Depends(require_permission("SOFA-FN-ONB")),
):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_ext_onboarding(payload)
        return JSONResponse(content={"process_id": result["process_id"], "status": "started"})
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/tasks/overview")
async def api_tasks_overview(current_user=Depends(require_permission("SOFA-PAGE-TODO"))):
    try:
        user_id = current_user.user_id
        tasks = await api_client.get_task_overview(user_id)
        for key in ("open_tasks", "blocked_tasks", "user_tasks"):
            if isinstance(tasks.get(key), list):
                tasks[key] = _filter_tasks_for_scope(tasks[key], current_user)
        tasks.pop("completed_tasks", None)
        return JSONResponse(content=tasks)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/processes/overview")
async def api_processes_overview(current_user=Depends(require_permission("SOFA-PAGE-TODO"))):
    try:
        user_id = current_user.user_id
        processes = await api_client.get_process_overview(user_id)

        for key in ("running_processes", "completed_processes"):
            if isinstance(processes.get(key), list):
                processes[key] = _filter_processes_for_scope(processes[key], current_user)

        return JSONResponse(content=processes)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except HTTPException as exc:
        raise exc
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/resources/mail_template")
async def api_get_mail_template(payload: dict, current_user=Depends(require_login)):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.get_mail_template(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/tasks/{task_id}/history")
async def api_task_logs(task_id, current_user=Depends(require_permission("SOFA-PAGE-TODO"))):
    try:
        await _get_relevant_task_or_raise(int(task_id), current_user)
        history = await api_client.get_task_logs(task_id)
        return JSONResponse(content=history)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/systems")
async def api_system_overview(current_user=Depends(require_permission("SOFA-PAGE-SYS"))):
    try:
        systems = await api_client.get_system_overview()
        return JSONResponse(content=systems)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/systems")
async def api_create_system(payload: dict, current_user=Depends(require_permission("SOFA-PAGE-SYS"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.create_system(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/systems/map")
async def api_system_map(current_user=Depends(require_any_permission("SOFA-PAGE-SYS", "SOFA-PAGE-USER"))):
    try:
        systems = await api_client.get_system_map()
        system_map = {
            system["system_id"]: {"name": system["name"], "type": system.get("type")}
            for system in systems
        }
        return JSONResponse(content=system_map)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/systems/{system_id}")
async def api_get_system_detail(system_id: int, current_user=Depends(require_permission("SOFA-PAGE-SYS"))):
    try:
        system_detail = await api_client.get_system_detail(system_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/systems/{system_id}")
async def api_update_system(system_id: int, payload: dict, current_user=Depends(require_permission("SOFA-PAGE-SYS"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.update_system(system_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/systems/{system_id}/resources")
async def api_get_system_resources(system_id: int, current_user=Depends(require_permission("SOFA-PAGE-SYS"))):
    try:
        system_detail = await api_client.get_system_resources(system_id)
        return JSONResponse(content=system_detail)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/resources/map")
async def api_resource_map(current_user=Depends(require_any_permission("SOFA-PAGE-SYS", "SOFA-PAGE-USER", "SOFA-PAGE-ROLE"))):
    try:
        resources = await api_client.list_resources()
        resource_map = {
            r["resource_id"]: {
                "display_name": r.get("display_name"),
                "technical_identifier": r.get("technical_identifier"),
                "system_name": r.get("system_name"),
                "system_id": r.get("system_id"),
                "type_id": r.get("type_id"),
                "type_name": r.get("type_name"),
            }
            for r in resources
            if "resource_id" in r
        }
        return JSONResponse(content=resource_map)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/resources")
async def api_list_resources(
    type_id: int | None = None,
    search: str | None = None,
    limit: int | None = None,
    current_user=Depends(require_permission("SOFA-PAGE-SYS")),
):
    try:
        params = {}
        if type_id is not None:
            params["type_id"] = type_id
        if search:
            params["search"] = search
        if limit is not None:
            params["limit"] = limit

        resources = await api_client.list_resources(params=params or None)
        return JSONResponse(content=resources)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/resources")
async def api_create_system_resource(payload: dict, current_user=Depends(require_permission("SOFA-PAGE-SYS"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.create_resource(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/resources/{resource_id}")
async def api_update_system_resource(resource_id: int, payload: dict, current_user=Depends(require_permission("SOFA-PAGE-SYS"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.update_resource(resource_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/roles")
async def api_role_overview(current_user=Depends(require_permission("SOFA-PAGE-ROLE"))):
    try:
        systems = await api_client.get_role_overview()
        return JSONResponse(content=systems)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/roles")
async def api_create_role(payload: dict, current_user=Depends(require_permission("SOFA-PAGE-ROLE"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.create_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/roles/map")
async def api_role_map(current_user=Depends(require_any_permission("SOFA-PAGE-ROLE", "SOFA-PAGE-USER"))):
    try:
        roles = await api_client.get_role_map()
        role_map = {
            role["role_id"]: {"name": role["name"], "type": role["role_type"]}
            for role in roles
        }
        return JSONResponse(content=role_map)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/roles/{role_id}")
async def api_get_role_detail(role_id: int, current_user=Depends(require_permission("SOFA-PAGE-ROLE"))):
    try:
        role_detail = await api_client.get_role_detail(role_id)
        return JSONResponse(content=role_detail)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/roles/{role_id}")
async def api_update_role(role_id: int, payload: dict, current_user=Depends(require_permission("SOFA-PAGE-ROLE"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.update_role(role_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/roles/{role_id}/resources/reevaluate")
async def api_reevaluate_role_resources(role_id: int, payload: dict, current_user=Depends(require_permission("SOFA-PAGE-ROLE"))):
    try:
        request_payload = {
            "initiator_user_id": current_user.user_id,
            "dry_run": _coerce_bool(payload.get("dry_run"), default=False),
        }
        result = await api_client.reevaluate_role_resources(role_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/skill_assignment")
async def api_start_skill_assignment_process(payload: dict, current_user=Depends(require_permission("SOFA-FN-RL"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_skill_assignment(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/change")
async def api_start_primary_role_change_process(payload: dict, current_user=Depends(require_permission("SOFA-FN-ROLE"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_primary_role_change(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/tmp_role")
async def api_start_temporary_role_process(payload: dict, current_user=Depends(require_permission("SOFA-FN-TMPR"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_temporary_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/offboarding")
async def api_start_offboarding_process(payload: dict, current_user=Depends(require_permission("SOFA-FN-OFFB"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_offboarding(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/training_schedule")
async def api_start_training_schedule_process(payload: dict, current_user=Depends(require_permission("SOFA-FN-TRNG"))):
    user_ids = payload.get("user_ids")
    role_ids = payload.get("role_ids")
    scheduled_for = str(payload.get("scheduled_for") or "").strip()

    if not isinstance(user_ids, list) or not user_ids:
        return JSONResponse(content={"detail": "Mindestens ein User muss ausgewählt werden."}, status_code=400)

    if not isinstance(role_ids, list) or not role_ids:
        return JSONResponse(content={"detail": "Mindestens eine Nebenrolle muss ausgewählt werden."}, status_code=400)

    normalized_user_ids = [_coerce_int(value) for value in user_ids]
    normalized_role_ids = [_coerce_int(value) for value in role_ids]

    if any(value is None for value in normalized_user_ids):
        return JSONResponse(content={"detail": "Die User-Auswahl ist ungültig."}, status_code=400)

    if any(value is None for value in normalized_role_ids):
        return JSONResponse(content={"detail": "Die Rollenauswahl ist ungültig."}, status_code=400)

    if not scheduled_for:
        return JSONResponse(content={"detail": "Das Schulungsdatum ist erforderlich."}, status_code=400)

    try:
        scheduled_date = date.fromisoformat(scheduled_for)
    except ValueError:
        return JSONResponse(content={"detail": "Das Schulungsdatum ist ungültig."}, status_code=400)

    if scheduled_date < date.today():
        return JSONResponse(content={"detail": "Das Schulungsdatum darf nicht in der Vergangenheit liegen."}, status_code=400)

    try:
        request_payload = {
            "user_ids": normalized_user_ids,
            "role_ids": normalized_role_ids,
            "scheduled_for": scheduled_for,
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.trigger_training_schedule(request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/skill_revocation")
async def api_start_skill_removal_process(payload: dict, current_user=Depends(require_permission("SOFA-FN-RMRL"))):
    try:
        payload["initiator_user_id"] = current_user.user_id
        result = await api_client.trigger_skill_removal(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/{process_id}/cancel")
async def api_cancel_process(process_id: int, payload: dict, current_user=Depends(require_permission("SOFA-FN-PCNCL"))):
    try:
        request_payload = {"initiator_user_id": current_user.user_id}
        reason = (payload or {}).get("reason")
        if reason:
            request_payload["reason"] = reason
        result = await api_client.cancel_process(process_id, request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/iks/catalog")
async def api_get_iks_catalog(authz=Depends(require_permission("SOFA-TOOL-IKS"))):
    try:
        result = await api_client.get_iks_catalog(authz.user_id)
        if isinstance(result, dict):
            result = dict(result)
            for report_type, catalog_key in (
                ("process", "process_types"),
                ("role", "roles"),
                ("system", "systems"),
            ):
                if not authz.has_permission(IKS_REPORT_PERMISSIONS[report_type]):
                    result[catalog_key] = []
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/iks/reports")
async def api_create_iks_report(payload: dict, authz=Depends(require_permission("SOFA-TOOL-IKS"))):
    # Only forward fields from the public report contract. In particular, the
    # browser cannot provide generated_by or override the authenticated user.
    request_payload = {}
    if "report_type" in payload:
        request_payload["report_type"] = payload["report_type"]
    if "target" in payload:
        target = payload["target"]
        request_payload["target"] = (
            {"id": target["id"]}
            if isinstance(target, dict) and "id" in target
            else target
        )
    if "period" in payload:
        period = payload["period"]
        request_payload["period"] = (
            {key: period[key] for key in ("from", "to") if key in period}
            if isinstance(period, dict)
            else period
        )
    if "timezone" in payload:
        request_payload["timezone"] = payload["timezone"]

    report_type = request_payload.get("report_type")
    required_permission = IKS_REPORT_PERMISSIONS.get(report_type)
    if required_permission and not authz.has_permission(required_permission):
        return JSONResponse(
            content={
                "detail": {
                    "code": "iks_report_access_denied",
                    "message": "Keine Berechtigung für diese IKS-Kontrollart.",
                }
            },
            status_code=403,
        )

    try:
        result = await api_client.create_iks_report(authz.user_id, request_payload)
        if not isinstance(result, dict):
            return JSONResponse(
                content={"error": "Das IKS-Backend hat keinen gültigen Bericht geliefert."},
                status_code=502,
            )
        return JSONResponse(content=_normalize_iks_export_links(result))
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/iks/reports/{report_id}/exports/{export_format}")
async def api_download_iks_report_export(
    report_id: str,
    export_format: str,
    authz=Depends(require_permission("SOFA-TOOL-IKS")),
):
    normalized_format = export_format.lower()
    if normalized_format not in IKS_EXPORT_FORMATS:
        return JSONResponse(content={"error": "Unbekanntes Exportformat."}, status_code=404)

    try:
        upstream = await api_client.download_iks_report_export(
            authz.user_id,
            report_id,
            normalized_format,
        )
        forwarded_headers = {
            header: upstream.headers[header]
            for header in ("content-type", "content-disposition", "cache-control", "etag", "last-modified")
            if header in upstream.headers
        }
        forwarded_headers.setdefault("content-type", "application/octet-stream")
        return StreamingResponse(
            BytesIO(upstream.content),
            headers=forwarded_headers,
        )
    except httpx.HTTPStatusError as exc:
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/processes/iks")
async def api_start_iks_process_report(payload: dict, current_user=Depends(require_permission("SOFA-TOOL-IKS"))):
    try:
        request_payload = {
            "process_type": payload.get("process_type"),
            "start_date": payload.get("start_data"),
            "end_date": payload.get("end_date"),
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.trigger_iks_process_report(request_payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/roles/{role_id}/resources")
async def api_add_resources_to_role(role_id: int, resource_ids: dict, current_user=Depends(require_permission("SOFA-PAGE-ROLE"))):
    try:
        payload = {
            "role_id": role_id,
            "resource_ids": resource_ids["resource_ids"],
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.add_resources_to_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.delete("/roles/{role_id}/resources")
async def api_remove_resources_from_role(role_id: int, resource_ids: dict, current_user=Depends(require_permission("SOFA-PAGE-ROLE"))):
    try:
        payload = {
            "role_id": role_id,
            "resource_ids": resource_ids["resource_ids"],
            "initiator_user_id": current_user.user_id,
        }
        result = await api_client.remove_resources_from_role(payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=exc.response.json(), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


# Störungsprotokoll

@router.get("/stoerung/incidents")
async def api_list_incidents(status_filter: str | None = None, authz=Depends(require_permission("SOFA-TOOL-SLOG"))):
    try:
        result = await api_client.list_incidents(authz, status_filter=status_filter)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/stoerung/incidents/active")
async def api_list_active_incidents(authz=Depends(require_login)):
    try:
        result = await api_client.list_active_incidents(authz)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/stoerung/incidents/{incident_id}")
async def api_get_incident(incident_id: str, authz=Depends(require_permission("SOFA-TOOL-SLOG"))):
    try:
        result = await api_client.get_incident(authz, incident_id)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/stoerung/incidents")
async def api_create_incident(payload: dict, authz=Depends(require_permission("SOFA-TOOL-SLOG"))):
    try:
        description = payload.get("description") or None
        payload.setdefault("contributor_roles", [])
        if authz.primary_role_name and authz.primary_role_name not in payload["contributor_roles"]:
            payload["contributor_roles"].append(authz.primary_role_name)
        payload.setdefault("contributor_user_ids", [])
        result = await api_client.create_incident(authz, payload)
        if description and result.get("id"):
            try:
                await api_client.append_incident_entry(
                    authz, str(result["id"]), f"Störung erfasst: {description}"
                )
            except Exception:
                pass
        return JSONResponse(content=result, status_code=201)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.patch("/stoerung/incidents/{incident_id}/status")
async def api_update_incident_status(incident_id: str, payload: dict, authz=Depends(require_permission("SOFA-TOOL-SLOG"))):
    try:
        result = await api_client.update_incident_status(authz, incident_id, payload["status"])
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/stoerung/incidents/{incident_id}/entries")
async def api_append_incident_entry(incident_id: str, payload: dict, authz=Depends(require_permission("SOFA-TOOL-SLOG"))):
    try:
        result = await api_client.append_incident_entry(authz, incident_id, payload["content"])
        return JSONResponse(content=result, status_code=201)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.post("/stoerung/incidents/{incident_id}/close")
async def api_close_incident(incident_id: str, payload: dict, authz=Depends(require_permission("SOFA-TOOL-SLOG"))):
    try:
        result = await api_client.close_incident(authz, incident_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.patch("/stoerung/incidents/{incident_id}/contributors")
async def api_update_incident_contributors(incident_id: str, payload: dict, authz=Depends(require_permission("SOFA-TOOL-SLOG"))):
    try:
        result = await api_client.update_incident_contributors(authz, incident_id, payload)
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/stoerung/roles")
async def api_stoerung_roles(authz=Depends(require_permission("SOFA-TOOL-SLOG"))):
    try:
        result = await api_client.get_role_map()
        return JSONResponse(content=result)
    except httpx.HTTPStatusError as exc:
        return JSONResponse(content=_error_content_from_response(exc.response), status_code=exc.response.status_code)
    except Exception as exc:
        return JSONResponse(content={"error": str(exc)}, status_code=500)
# Rechnerverwaltung

def _computer_proxy_error(exc: Exception) -> JSONResponse:
    if isinstance(exc, httpx.HTTPStatusError):
        return JSONResponse(
            content=_error_content_from_response(exc.response),
            status_code=exc.response.status_code,
        )
    return JSONResponse(content={"error": str(exc)}, status_code=500)


@router.get("/computers/overview")
async def api_computer_overview(
    current_user=Depends(require_permission("SOFA-PAGE-COMPUTER")),
):
    try:
        return JSONResponse(content=await api_client.get_computer_overview())
    except Exception as exc:
        return _computer_proxy_error(exc)


@router.post("/computers/software-actions")
async def api_create_computer_software_action(
    payload: dict,
    current_user=Depends(require_permission("SOFA-FN-COMPUTER-SOFTWARE")),
):
    computer_ids = payload.get("computer_ids")
    if not isinstance(computer_ids, list):
        return JSONResponse(content={"detail": "computer_ids muss eine Liste sein."}, status_code=400)

    normalized_ids = list(dict.fromkeys(
        str(computer_id).strip()
        for computer_id in computer_ids
        if computer_id is not None
        and not isinstance(computer_id, (dict, list, bool))
        and str(computer_id).strip()
    ))
    if not normalized_ids:
        return JSONResponse(content={"detail": "Mindestens ein Rechner muss ausgewählt sein."}, status_code=400)
    if len(normalized_ids) > 500:
        return JSONResponse(content={"detail": "Pro Auftrag sind maximal 500 Rechner erlaubt."}, status_code=400)

    action = str(payload.get("action") or "").strip().lower()
    if action not in {"install", "uninstall"}:
        return JSONResponse(content={"detail": "action muss install oder uninstall sein."}, status_code=400)

    software_id = str(payload.get("software_id") or "").strip()
    if not software_id:
        return JSONResponse(content={"detail": "software_id darf nicht leer sein."}, status_code=400)

    upstream_payload = {
        "computer_ids": normalized_ids,
        "action": action,
        "software_id": software_id,
        "initiator_user_id": current_user.user_id,
    }
    version = str(payload.get("version") or "").strip()
    if version:
        upstream_payload["version"] = version

    try:
        return JSONResponse(content=await api_client.create_computer_software_action(upstream_payload))
    except Exception as exc:
        return _computer_proxy_error(exc)


@router.get("/computers/{computer_id}")
async def api_get_computer_detail(
    computer_id: str,
    current_user=Depends(require_permission("SOFA-PAGE-COMPUTER")),
):
    try:
        return JSONResponse(content=await api_client.get_computer_detail(computer_id))
    except Exception as exc:
        return _computer_proxy_error(exc)


@router.patch("/computers/{computer_id}/comment")
async def api_update_computer_comment(
    computer_id: str,
    payload: dict,
    current_user=Depends(require_permission("SOFA-FN-COMPUTER-COMMENT")),
):
    comment = payload.get("comment")
    if not isinstance(comment, str):
        return JSONResponse(content={"detail": "comment muss ein Text sein."}, status_code=400)
    if len(comment) > 4000:
        return JSONResponse(content={"detail": "Der Kommentar darf maximal 4000 Zeichen enthalten."}, status_code=400)

    try:
        result = await api_client.update_computer_comment(
            computer_id,
            {"comment": comment.strip(), "initiator_user_id": current_user.user_id},
        )
        return JSONResponse(content=result)
    except Exception as exc:
        return _computer_proxy_error(exc)


@router.post("/computers/{computer_id}/power-actions")
async def api_create_computer_power_action(
    computer_id: str,
    payload: dict,
    current_user=Depends(require_permission("SOFA-FN-COMPUTER-POWER")),
):
    action = str(payload.get("action") or "").strip().lower()
    if action not in {"reboot", "shutdown"}:
        return JSONResponse(content={"detail": "action muss reboot oder shutdown sein."}, status_code=400)

    upstream_payload = {
        "action": action,
        "confirm_active_session": _coerce_bool(payload.get("confirm_active_session"), False),
        "initiator_user_id": current_user.user_id,
    }
    try:
        return JSONResponse(content=await api_client.create_computer_power_action(computer_id, upstream_payload))
    except Exception as exc:
        return _computer_proxy_error(exc)


@router.get("/computers/{computer_id}/jobs")
async def api_get_computer_jobs(
    computer_id: str,
    limit: int = 50,
    current_user=Depends(require_permission("SOFA-PAGE-COMPUTER")),
):
    normalized_limit = max(1, min(limit, 100))
    try:
        return JSONResponse(content=await api_client.get_computer_jobs(computer_id, limit=normalized_limit))
    except Exception as exc:
        return _computer_proxy_error(exc)


@router.get("/computer-job-batches/{batch_id}")
async def api_get_computer_job_batch(
    batch_id: str,
    current_user=Depends(require_any_permission(
        "SOFA-FN-COMPUTER-SOFTWARE",
        "SOFA-FN-COMPUTER-POWER",
        "SOFA-PAGE-COMPUTER",
    )),
):
    try:
        return JSONResponse(content=await api_client.get_computer_job_batch(batch_id))
    except Exception as exc:
        return _computer_proxy_error(exc)
