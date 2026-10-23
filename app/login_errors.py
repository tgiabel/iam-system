from __future__ import annotations

import httpx  # type: ignore


GENERIC = "Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut."
BAD_CREDENTIALS = "Personalnummer oder Passwort ist falsch."
NOT_ALLOWED = "Für dieses Konto ist die Anmeldung an SOFA nicht freigegeben."
UNAVAILABLE = "Der Anmeldedienst ist nicht erreichbar. Bitte versuche es später erneut."
TIMEOUT = "Der Anmeldedienst antwortet nicht. Bitte versuche es später erneut."
SERVER_ERROR = "Der Anmeldedienst meldet einen Fehler. Bitte versuche es später erneut."


def login_error_message(exc: BaseException) -> str:
    """Klartext fuer die Login-Seite; technische Details gehoeren ins Serverlog.

    Unbekannte Personalnummer (404) und falsches Passwort (401) bekommen
    bewusst denselben Text, damit die Anmeldung keine Konten verraet.
    """
    # api_client wickelt Netzwerkfehler in Exception("Request Error: ...") ein.
    cause = exc if isinstance(exc, httpx.HTTPError) else exc.__cause__
    if isinstance(cause, httpx.HTTPStatusError):
        status = cause.response.status_code
        if status in (401, 404):
            return BAD_CREDENTIALS
        if status == 403:
            return NOT_ALLOWED
        if status == 422:
            return "Bitte Personalnummer und Passwort prüfen."
        if status >= 500:
            return SERVER_ERROR
    elif isinstance(cause, httpx.TimeoutException):
        return TIMEOUT
    elif isinstance(cause, httpx.RequestError):
        return UNAVAILABLE
    return GENERIC
