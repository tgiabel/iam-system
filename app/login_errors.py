"""Texte und Fehlerzuordnung fuer Anmeldung und Sitzung (Loginseite, Wiederanmeldung, JSON-401/503).

Technische Details gehoeren ins Serverlog, nie in diese Texte.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx  # type: ignore


GENERIC = "Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut."
BAD_CREDENTIALS = "Personalnummer oder Passwort ist falsch."
NOT_ALLOWED = "Für dieses Konto ist die Anmeldung an SOFA nicht freigegeben."
CHECK_INPUT = "Bitte Personalnummer und Passwort prüfen."
UNAVAILABLE = "Der Anmeldedienst ist nicht erreichbar. Bitte versuche es später erneut."
TIMEOUT = "Der Anmeldedienst antwortet nicht. Bitte versuche es später erneut."
SERVER_ERROR = "Der Anmeldedienst meldet einen Fehler. Bitte versuche es später erneut."
RATE_LIMITED = "Zu viele Anmeldeversuche. Bitte warte einen Moment und versuche es erneut."
MISSING_FIELDS = "Bitte Personalnummer und Passwort eingeben."
FORM_EXPIRED = "Die Anmeldeseite war zu lange geöffnet. Bitte versuche es erneut."

# Sitzung beendet, je Ergebnis der Sitzungspruefung (app.session_gate). Kurzform fuer JSON-Antworten;
# die Loginseite haengt die Aufforderung an.
SESSION_ENDED = {
    "expired": "Deine Sitzung ist abgelaufen.",
    "revoked": "Deine Sitzung wurde beendet.",
    "logged_out": "Du bist abgemeldet.",
}
SIGN_IN = "Bitte melde dich an."
SIGN_IN_AGAIN = "Bitte melde dich erneut an."

# Hinweise auf der Loginseite (Query `reason` bzw. Ergebnis der Sitzungspruefung).
NOTICES = {
    "expired": f"{SESSION_ENDED['expired']} {SIGN_IN_AGAIN}",
    "revoked": f"{SESSION_ENDED['revoked']} {SIGN_IN_AGAIN}",
    "logged_out": SESSION_ENDED["logged_out"],
    "unavailable": UNAVAILABLE,
}


@dataclass(frozen=True)
class LoginFailure:
    code: str      # wie die SD-API (sofa-session-contract.md, Abschnitt 6)
    status: int    # Status der Antwort an den Browser
    message: str


def classify_login_error(exc: BaseException) -> LoginFailure:
    """Fehlgeschlagener Login bei SD-API -> Code, Status und Klartext.

    Unbekannte Personalnummer und falsches Passwort meldet die SD-API gleich (401);
    403 kommt nur nach korrektem Passwort. Alles Technische wird 503, nie ein
    Hinweis auf falsche Zugangsdaten.
    """
    # api_client wickelt Netzwerkfehler in Exception("Request Error: ...") ein.
    cause = exc if isinstance(exc, httpx.HTTPError) else exc.__cause__
    if isinstance(cause, httpx.HTTPStatusError):
        status = cause.response.status_code
        if status == 401:
            return LoginFailure("invalid_credentials", 401, BAD_CREDENTIALS)
        if status == 403:
            return LoginFailure("account_not_enabled", 403, NOT_ALLOWED)
        if status == 422:
            return LoginFailure("invalid_request", 400, CHECK_INPUT)
        if status == 429:
            return LoginFailure("login_rate_limited", 429, RATE_LIMITED)
        if status >= 500:
            return LoginFailure("service_unavailable", 503, SERVER_ERROR)
    elif isinstance(cause, httpx.TimeoutException):
        return LoginFailure("service_unavailable", 503, TIMEOUT)
    elif isinstance(cause, httpx.RequestError):
        return LoginFailure("service_unavailable", 503, UNAVAILABLE)
    return LoginFailure("service_unavailable", 503, GENERIC)
