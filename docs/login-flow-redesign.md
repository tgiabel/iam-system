# Login und Sitzungsübergänge

Stand: 11.11.2026. Phasen A bis C und das anschließende Review sind auf
`feat/login-redesign` umgesetzt und gegen sd-api-dev geprüft (Vertrag: SD-API
`docs/sofa-session-contract.md`). Nicht auf `main`: Der Stand verlangt SD-API API-1 und
den Dienstschlüssel in Prod (siehe [deployment.md](deployment.md)).

## Umsetzung

**Phase A (umgesetzt):** opakes Sitzungs-Cookie `__Host-sofa_session` (Dev
`__Host-sofa_dev_session`); je Request `GET /access/users/me` in
`app/session_gate.py`, AuthorizationContext nur daraus; Dienstschlüssel, Sitzung
und Sitzungs-CSRF an jedem SD-API-Aufruf (`api_client`); zentrale CSRF- und
Origin-Prüfung, `fetch`-Wrapper (heute in `session.js`); neue Loginseite nach der Vorschau mit
Login-CSRF und geprüftem Rücksprungziel; Logout per POST mit Widerruf; HTML ohne
Sitzung → `/login?next=…&reason=…`, `/api/` → JSON 401, SD-API-Ausfall → 503 ohne
Logout; Report-Token und `sofa_user` entfernt, alte Cookies werden gelöscht; Poll
rein lesend; `no-store` auf allen Antworten außer `/static`.

**Phase B (umgesetzt):** `app/static/js/session.js` mit `session.css`, eingebunden in
`base.html` vor allen anderen Skripten. Den Poll auf `/api/session/authz` macht nur
`session.js` (`SofaSession.check`); `base.js` wendet das Ergebnis über das Ereignis
`sofa:session-checked` auf Navigation, Badge und Rechte an.

- Aktivität: echte Bedienung (`isTrusted`) in sichtbaren Fenstern meldet höchstens alle
  60 s je Tab `POST /api/session/activity` (`keepalive`). Poll und Hintergrundabrufe
  verlängern nie.
- Hinweise: Fristen kommen mit der Seite (`window.sofaSession`, ohne Tokens) und mit
  jeder Poll-/Aktivitätsantwort; Uhrenversatz aus `server_time`. 5 min vor
  Inaktivitätsablauf „Weiterarbeiten“ (vorher und dann minütlich Nachfrage, weil
  andere Tabs verlängern können); 5 min vor Absolutablauf „Bitte speichere deine
  Arbeit“ mit „OK“.
- Ablauf: Jeder 401 `session_*` einer `/api/`-Antwort (Poll, Widget-Abruf, Speichern)
  sperrt die Seite (`inert`) und zeigt ein Banner, keine Weiterleitung. „Erneut
  anmelden“ fragt erst nach (anderer Tab schon angemeldet?) und öffnet sonst einen
  Dialog, der `POST /api/session/login` aufruft (JSON, `Origin` Pflicht). Gleiches
  Konto: Seite bleibt, Eingaben bleiben, neues CSRF-Token wird übernommen. Anderes
  Konto: Seite wird neu geladen. Nichts wird automatisch wiederholt.
- Mehrere Tabs: Poll und Aktivität liefern das gültige CSRF-Token mit; ein
  `403 csrf_failed` holt es sofort nach. Widget-Fenster verhalten sich gleich (Banner
  oben, keine Schleife).
- Gate löscht ein abgelaufenes Cookie nicht mehr, wenn die Route gerade ein neues
  gesetzt hat (betraf auch `POST /login` mit altem Cookie).

**Phase C (umgesetzt):** Unerwartete Fehler in `app/routes/api.py` antworten über
`internal_error()` (`app/routes/shared.py`) mit neutralem Text und Fehler-ID; die
Details stehen mit derselben ID im Log. Nicht erreichbares Backend bekommt einen
eigenen Text. Fehlerkörper der SD-API ohne JSON werden nicht mehr roh weitergereicht.
`str(exc)` bleibt nur für selbst geschriebene Validierungsmeldungen (`ValueError` →
400); `tests/test_error_responses.py` prüft das.

## Abgestimmte Richtung

- Reduzierte, ansehnliche Loginseite mit dezentem SOFA-Branding, ohne Overlay,
  Schließen, Abbrechen oder unangemeldete Dashboard-Navigation.
- Card nur mit Personalnummer, Passwort und Anmeldebutton. Feldnamen als
  Platzhalter, verknüpfte Labels und Überschrift nur für Screenreader. SOFA-Logo
  und Schriftzug bleiben außerhalb der Card.
- Vier Stunden Inaktivität (14.400 Sekunden). Hintergrundabrufe, Polling und reine
  Sitzungsprüfungen verlängern diese Frist nicht. Die API setzt den Ablauf durch.
- Absolutes Sitzungslimit zwölf Stunden ab Login (entschieden 11.11.2026); vier
  Stunden sind die Inaktivitätsfrist, nicht die maximale Anmeldedauer.
- Session Store in SD-API, SOFA als Backend-for-Frontend. Login prüft zuerst das
  Passwort; „nicht freigegeben“ nur nach korrektem Passwort (entschieden 11.11.2026).

## Zielverhalten

| Ausgangslage | Ergebnis |
|---|---|
| Ohne Sitzung `/` öffnen | Loginseite |
| Ohne Sitzung geschützte Seite öffnen | Login mit internem Rücksprungziel |
| Anmeldung erfolgreich | Validiertes Ziel inklusive Query, sonst Dashboard |
| Bereits angemeldet `/login` öffnen | Validiertes Ziel, sonst Dashboard |
| Anmeldung falsch | Gemeinsamer Hinweis für unbekannte PNR/falsches Passwort, PNR bleibt |
| Dienst nicht erreichbar | Technischer Fehler mit Wiederholungsmöglichkeit; keine falsche Meldung über Zugangsdaten |
| Sitzung abgelaufen | Erneute Anmeldung mit verständlichem Hinweis |
| Hintergrundrequest ohne Sitzung | JSON 401, kein Redirect auf HTML |
| Berechtigung fehlt | 403 und verständlicher Rückweg; keine Login-Schleife |
| Abmelden | Serverseitiger Widerruf, Cookie löschen, Login mit Bestätigung |

Bei Ablauf während eines Formulars darf eine Weiterleitung nicht ungefragt den
Entwurf zerstören. Ein Entwurf kann vorübergehend im Arbeitsspeicher bleiben;
personenbezogene Inhalte werden dafür nicht pauschal in Browser-Speicher gelegt.
Wiederherstellung nur nach Bestätigung derselben verifizierten Identität;
Kontowechsel oder Abmeldung verwirft den Entwurf. Andere offene Tabs und Widgets
müssen den Sitzungswechsel ebenfalls nachvollziehen. Fehlgeschlagene POST/PATCH/
DELETE-Requests werden niemals automatisch wiederholt.

Formular: verknüpfte Labels, natürlicher DOM-/Tab-Ablauf PNR → Passwort →
Passwortanzeige → Anmelden, sichtbarer Fokus, Enter-Submit, angekündigte Fehler,
kein zweiter Submit während des Versuchs. Für die echte Anmeldung zusätzlich
`autocomplete="username"` und `autocomplete="current-password"`. Fehlermeldungen erhalten Fokus,
statt dass man sie außerhalb des Formulars suchen muss.

## Aufbau im Code

| Teil | Ort |
|---|---|
| Cookie, Token-Format, Rücksprungziel, Dienstschlüssel | `app/session.py` (`request_session()` für Routen, ContextVar nur für `api_client`) |
| Sitzungsprüfung je Request, CSRF/Origin, `no-store`, alte Cookies | `app/session_gate.py` (`SELF_CSRF_PATHS`, `session_error()` als einziges JSON-Fehlerformat) |
| Anmeldung (`open_session`), Poll, Aktivität, Wiederanmeldung im Tab | `app/routes/session_api.py` (`/api/session/*`) |
| Loginseite, `POST /login`, `POST /logout` | `app/routes/pages.py` |
| Texte, Zuordnung von Login-Fehlern (`classify_login_error`) | `app/login_errors.py` |
| 401/503 bzw. Weiterleitung ohne Sitzung | `app/main.py` (Handler für `SessionRequired`) |
| Gestaltung | `auth.css` (gemeinsam: Card, Felder, Button, Hinweise), `login.css` (Seitenrahmen), `session.css` (Banner, Sperre, Dialograhmen) |

Das Ablaufbanner liegt mit z-index 9999 über allen Seiten-Overlays und unter Flash
(10000). Der Primärbutton nutzt `--btn-primary-*` und `--text-inverse` wie alle
Primärbuttons der App; die Systemschrift ist das Token `--font-system`.

## Verlauf

- 28.10.2026: Designvorschau `/dev/auth-preview` als Vorlage für Loginseite, Banner und
  Wiederanmeldung; in drei Themes und fünf Viewports geprüft. Auftrag an die SD-API in
  [backend-request-auth-sessions.md](backend-request-auth-sessions.md).
- 11.11.2026: Vertrag der SD-API freigegeben, Phasen A bis C umgesetzt, Vorschau entfernt.
- 11.11.2026: Review auf Einheitlichkeit. Gemeinsame `auth.css` mit Theme-Tokens, ein
  Anmeldeweg für Formular und Tab, Sitzungsrouten in eigenem Modul, Texte an einer
  Stelle, toter Code der Cookie- und Report-Token-Zeit entfernt (`has_any_tool`,
  `dashboard_live`, Login-Links in `base.html`), Ablaufbanner über App-Overlays.
