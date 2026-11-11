from __future__ import annotations

import httpx  # type: ignore


GENERIC = "Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut."
BAD_CREDENTIALS = "Personalnummer oder Passwort ist falsch."
NOT_ALLOWED = "Für dieses Konto ist die Anmeldung an SOFA nicht freigegeben."
UNAVAILABLE = "Der Anmeldedienst ist nicht erreichbar. Bitte versuche es später erneut."
TIMEOUT = "Der Anmeldedienst antwortet nicht. Bitte versuche es später erneut."
SERVER_ERROR = "Der Anmeldedienst meldet einen Fehler. Bitte versuche es später erneut."
RATE_LIMITED = "Zu viele Anmeldeversuche. Bitte warte einen Moment und versuche es erneut."


# Hinweise auf der Loginseite (Query `reason` bzw. Ergebnis der Sitzungspruefung).
NOTICES = {
    "expired": "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
    "revoked": "Deine Sitzung wurde beendet. Bitte melde dich erneut an.",
    "logged_out": "Du bist abgemeldet.",
    "unavailable": UNAVAILABLE,
    "form_expired": "Die Anmeldeseite war zu lange geöffnet. Bitte versuche es erneut.",
    "missing_fields": "Bitte Personalnummer und Passwort eingeben.",
}


def login_error_message(exc: BaseException) -> str:
    """Klartext fuer die Login-Seite; technische Details gehoeren ins Serverlog.

    Unbekannte Personalnummer und falsches Passwort bekommen bewusst denselben
    Text, damit die Anmeldung keine Konten verraet. Die SD-API meldet beides
    inzwischen als 401 und 403 nur nach korrektem Passwort; 404 bleibt, solange
    eine aeltere SD-API laeuft.
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
        if status == 429:
            return RATE_LIMITED
        if status >= 500:
            return SERVER_ERROR
    elif isinstance(cause, httpx.TimeoutException):
        return TIMEOUT
    elif isinstance(cause, httpx.RequestError):
        return UNAVAILABLE
    return GENERIC
