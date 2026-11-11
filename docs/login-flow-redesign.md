# Login und Sitzungsübergänge

Stand: 11.11.2026. Phasen A und B der echten Umstellung auf `feat/login-redesign`
umgesetzt und gegen sd-api-dev geprüft (Vertrag: SD-API `docs/sofa-session-contract.md`).
Nicht auf `main`: Der Stand verlangt SD-API API-1 und den Dienstschlüssel in Prod.

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
`base.html` vor allen anderen Skripten.

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

**Phase C (offen):** keine Exception-Texte mehr nach außen (`{"error": str(exc)}`
in `app/routes/api.py`).

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

## Dev-Vorschau

`https://sofa-dev/dev/auth-preview`

Zustände werden unten im gesonderten DEV-Bereich gewählt. Ein Beispiel für einen
geschützten Direkteinstieg:

`https://sofa-dev/dev/auth-preview?state=login&next=%2Ftasks%3Fbacklog%3Ddemo`

Verfügbare Zustände: `login`, `credentials`, `not_enabled`, `unavailable`, `limited`,
`expired`, `logout`, `authenticated`, `denied`, `draft`. Die Fehlertexte kommen aus
`app/login_errors.py` (`PREVIEW_MESSAGES`) und lauten wie im echten Login.

- Zum simulierten Anmelden eine beliebige Beispiel-Personalnummer und ein
  Beispielpasswort eingeben. Keine echten Zugangsdaten verwenden.
- In den Fehlerzuständen schlägt auch Absenden entsprechend fehl. Zum Prüfen der
  Erholung den Zustand wieder auf „Anmeldung“ stellen; die Personalnummer bleibt.
- Nach erfolgreicher Simulation zeigt eine eigene Beispielansicht das interne
  Rücksprungziel. Es findet keine Weiterleitung zu einer echten geschützten Seite
  statt. Unzulässige Ziele fallen auf `/` zurück.
- In der Beispielansicht eine Notiz eingeben, „4 Stunden ohne Aktivität simulieren“
  wählen und erneut anmelden. Der Entwurf bleibt im DOM dieses Tabs erhalten,
  ohne Speicherung oder automatisches Wiederholen einer Schreibaktion.
- „Abmelden“ leert den Entwurf. Neuladen verwirft ihn ebenfalls. Die Simulation
  bildet bewusst keine dauerhafte Sitzung oder tabübergreifende Identität nach.
- Theme-Wechsel gilt nur für die Vorschau und überschreibt nicht das gespeicherte
  Theme der Anwendung. Hell, dunkel und Servodata sind verfügbar.

Eigene Route, eigenes Template und eigene CSS-/JS-Dateien. Die Route wird nur bei
`APP_ENV=development` registriert. Kein Zugriff auf API oder echte Sitzungen,
keine Cookie-Schreibzugriffe. Formularfelder haben in dieser Simulation keine
`name`-Attribute; Zugangsdaten werden auch bei einem versehentlichen nativen Submit
nicht in eine URL serialisiert. Der Submit wird erst durch JS aktiviert.

Die echte Loginseite, Auth-Abhängigkeiten, Rollen-/Systemdetails sowie globale
Styles und `base.js` bleiben unverändert. Die einzige Integration ist die
Registrierung des separaten Routers im bestehenden Dev-Block in `app/main.py`.

## Zielverhalten für die echte Integration

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
`autocomplete="username"` und `autocomplete="current-password"`; in der
unverbindlichen Vorschau bewusst deaktiviert. Fehlermeldungen erhalten Fokus,
statt dass man sie außerhalb des Formulars suchen muss.

## Übergabe an SD-API

Der ausführliche Agentenauftrag steht in
[backend-request-auth-sessions.md](backend-request-auth-sessions.md).
Am 11.11.2026 um eine Bestandsaufnahme der SD-API und die Entscheidungen ergänzt;
die Umsetzung läuft in einer eigenen API-Session.

Die serverseitige Umsetzung ist ein separater Lauf. Vier Stunden Inaktivität,
echte Weiterleitungen und echte Sitzungsprüfung sind im Mock nicht implementiert.

## Prüfung der Vorschau

Am 28.10.2026 gegen die laufende Dev-Instanz geprüft:

- Route in Dev erreichbar, im Produktionsmodus 404; POST wird abgewiesen.
- Keine Cookie-Änderungen oder API-Requests; auch ein kaputtes echtes
  `sofa_user`-Cookie beeinflusst die Vorschau nicht. Echte Loginseite unverändert.
- Tastaturreihenfolge, Enter, Passwortanzeige, Ladezustand, Fehlerfokus und
  Erhalt der Personalnummer; Rücksprungziel einschließlich Query.
- Abgelaufene Sitzung blockiert die Beispielansicht; Wiederanmeldung erhält den
  Entwurf ohne automatisches Speichern. Abmeldung verwirft ihn.
- Sechs unzulässige Rücksprungziele werden in der Simulation verworfen.
- Sechs Zustände in drei Themes und fünf Viewports (1440×900, 1366×768,
  390×844, 320×568, 740×360): kein horizontaler Seitenüberlauf, keine JS-Fehler.
- Desktop, Mobil und Dunkelansicht zusätzlich anhand von Screenshots geprüft.

Am 11.11.2026 nach Abgleich mit der SD-API erneut geprüft: Zustand „Konto nicht
freigegeben“ (403 nur nach korrektem Passwort), Texte aus `login_errors.py` inkl. 429,
Servodata-Hintergrund hinter deckender Card, gesperrter Bereich bei Ablauf ohne
`opacity`. Zehn Zustände × drei Themes × vier Viewports (1440×900, 390×844, 320×568,
740×360): kein Überlauf, keine JS-Fehler; Fehlerfokus und Erhalt der PNR geprüft.
