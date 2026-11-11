# Auftrag an den SD-API-Agenten: verifizierte Sitzungen für SOFA

Stand: 11.11.2026. **Abgeschlossen, nur noch Verlauf.** Entwurf vom 28.10., ergänzt um
Bestandsaufnahme der SD-API (`10e114a`) und getroffene Entscheidungen. Maßgeblich ist
seither der freigegebene Vertrag (SD-API `docs/sofa-session-contract.md`); die SOFA-Seite
beschreibt [login-flow-redesign.md](login-flow-redesign.md). Beschreibungen des
Ist-Zustands unten gelten für den Stand vor der Umstellung.

## Kontext und Ziel

Wir überarbeiten den SOFA-Login und die Übergänge zwischen unangemeldet und
angemeldet. Fachliche Seiten sollen eine gültige Sitzung voraussetzen; eine
dedizierte Loginseite ersetzt das leere unangemeldete Dashboard.

Heute setzt SOFA nach `POST /access/users/login` ein unsigniertes `sofa_user`-
Cookie mit Identität und `sofa_permissions`. SOFA deserialisiert es direkt und
baut daraus seinen AuthorizationContext. API-Aufrufe übermitteln teilweise
`X-User-Id`. Genesys-Reports verwenden zusätzlich ein signiertes Token mit eigener
Audience (`sofa-agent-stats-v1`). Prüfe den aktuellen API-Code selbst; diese
Beschreibung ist die aus dem SOFA-Code abgeleitete Ausgangslage.

Ziel ist eine verifizierte, widerrufbare Sitzung. Der Browser bekommt nur eine
zufällige, undurchsichtige Session-ID in einem HttpOnly-Cookie; Identität, Rechte
und weitere Token liegen serverseitig. Ein Browser-Cookie oder frei gesetztes
`X-User-Id` darf keine Identität begründen.

## Bestandsaufnahme SD-API (11.11.2026, `10e114a`)

Lesend geprüft; bitte bei Abweichungen selbst nachsehen.

- Nichts aus diesem Auftrag ist umgesetzt: keine Session-Tabelle, kein Token-Store
  für Benutzer, kein Rate Limit, kein CSRF. Kein Dienstnachweis SOFA → SD-API;
  `/access/*` und `/sofa/*` sind nur durch das Docker-Netz `sd-api-backend`
  geschützt (vgl. Docstring `app/modules/access/sofa_permissions.py`).
- `X-User-Id` ist die einzige Akteursquelle (`app/shared/actor.py` und Varianten,
  rund 50 Fundstellen). Rechteprüfung ist pro Service verteilt
  (`require_identity`/`require_any`/`require_function`); etliche Routen prüfen
  nichts, z. B. `GET /access/users/`. Alias `/dev/...` (`app/router.py`) beachten.
- **`POST /sofa/users/{id}/sofa-access/setup|reset-password|revoke` prüfen keine
  Berechtigung**; `initiator_user_id` kommt frei aus dem Body
  (`app/modules/sofa/api/sofa_access_router.py`). Zusammen mit dem fälschbaren
  SOFA-Cookie kann so jedes Passwort gesetzt werden.
- `authenticate_user` (`app/modules/access/services/user_service.py`): 404 für
  unbekannte PNR ohne bcrypt, 403 für inaktiv/ohne Zugang **vor** der
  Passwortprüfung, dann 401. Detailtexte statt Codes.
- `GET /access/users/me` und `GET /sofa/me` prüfen `is_active` nicht.
  Deaktivierung (`user_repo.deactivate`) setzt nur `is_active=0, password_hash=NULL`.
- Report-Token `sofa-agent-stats-v1` (`app/shared/agent_stats_token.py`): HMAC,
  8 h, ohne Sitzungsbindung oder Widerruf. SOFA erneuert es und `sofa_user` bei
  jedem Poll von `/api/session/authz` (alle 5 min) – offene Tabs bleiben dadurch
  unbegrenzt angemeldet. In Dev fehlt `SOFA_AGENT_STATS_SECRET_B64` (Reports 503).
- Vorbild im Bestand: Worker-Credentials in `app/modules/inventory/auth.py`
  (gehashtes Secret, `revoked_at`, `compare_digest`, Dummy-Digest gegen Timing).
- Migrationen: `scripts/migrations.py`, `migrations/YYYYMMDD_name.sql`,
  Dev `make dev-migrate`.

## Bereits entschieden

1. Inaktivitätsfrist: **vier Stunden / 14.400 Sekunden**, serverseitig geprüft.
2. Polling, Hintergrundabrufe, Token-Erneuerung und reine Sitzungsprüfungen
   verlängern die Inaktivitätsfrist nicht.
3. Normale Arbeit soll ohne häufige Wiederanmeldung möglich sein. Definiere einen
   sparsamen, gedrosselten Weg, echte Bedienaktivität zu melden, einschließlich
   Formulareingabe ohne API-Aufruf. Client-Aktivität darf eine bereits abgelaufene
   Sitzung nicht wiederbeleben. Ein heartbeat ohne Bedienaktivität genügt nicht.
4. Absolutes Limit: **12 Stunden / 43.200 Sekunden** ab Login, unabhängig von
   Aktivität. Danach neue Anmeldung.
5. Browser/API unterscheiden fehlende Sitzung (401), fehlendes Recht (403) und
   Dienstausfall (503). Ein Infrastrukturfehler darf nicht pauschal als Logout gelten.
6. **Session Store liegt in SD-API** (Benutzer, Hashes, Rechte, Migrationen sind
   dort). SOFA ist Backend-for-Frontend: setzt das Browser-Cookie mit der opaken
   Session-ID, reicht sie an SD-API weiter und hält selbst keinen Store. SD-API
   leitet den Akteur aus der Sitzung ab. Zusätzlich ein Dienstnachweis
   SOFA → SD-API, der allein keine Benutzer-ID begründet.
7. **Login prüft zuerst das Passwort.** Unbekannte PNR, falsches Passwort, inaktives
   Konto und fehlender Zugang ergeben ohne korrektes Passwort dieselbe Antwort
   (gleicher Code, vergleichbare Laufzeit, z. B. Dummy-Hash). Nur bei korrektem
   Passwort darf ein eigener Code „Konto nicht für SOFA freigegeben“ folgen.

## Vorgehen

1. **Sofortschritt, unabhängig von der Sitzung:** `sofa-access`-Endpunkte mit
   Rechteprüfung versehen (Akteur vorerst aus `X-User-Id` über die bestehenden
   Helfer, nicht aus dem Body; `initiator_user_id` nur noch gegen den Akteur
   prüfen) und Login gemäß Entscheidung 7 umbauen. Das schließt die Lücke nur
   teilweise, solange `X-User-Id` vertraut wird; trotzdem vorziehen. Auf Dev
   umsetzen, dann zur Freigabe vorlegen.
2. **Architektur und Vertrag** (Abschnitt unten) als Dokument im API-Repo vorlegen
   und auf Freigabe warten.
3. Nach Freigabe API-Seite auf Dev umsetzen. SOFA integriert parallel gegen Dev.
4. Gemeinsamer, koordinierter Prod-Cutover (nicht in diesem Lauf).

## Gewünschter Vertrag

Bitte liefere die konkrete Architektur und den Integrationsvertrag:

- Login, Sitzung prüfen/aktueller Benutzer, relevante Aktivität, Logout und
  Widerruf. Benenne Methoden, Pfade, Request-/Response-Beispiele sowie Fehlercodes.
  Nutze bestehende geeignete Endpunkte statt parallel unnötige neue einzuführen.
- Verifizierte Benutzeridentität für alle SOFA-API-Aufrufe; definierte Verwendung
  oder Ablösung von `X-User-Id`. Ein Service-Nachweis allein authentifiziert noch
  keine vom Browser frei wählbare Benutzer-ID.
- Rechtequelle, Aktualisierungsstrategie und maximale Verzögerung bei Rechteentzug.
  Kontosperre, Passwortänderung und Logout müssen serverseitig wirksam werden.
  API-Autorisierung bleibt verbindlich; SOFA-Sichtbarkeit ist kein Ersatz dafür.
- Zeitangaben wie `idle_expires_at`, `absolute_expires_at` (falls festgelegt) und
  Serverzeit für Hinweise im UI. Definiere Verhalten bei parallelen Requests,
  mehreren Tabs, Reload, Widget-Fenstern und Erneuerung kurz vor dem Ablauf.
- Maschinenlesbare Codes für ungültige Zugangsdaten, abgelaufene/widerrufene
  Sitzung, fehlende Berechtigung, Rate Limit mit `Retry-After` und Dienstausfall.
  Unbekannte PNR und falsches Passwort dürfen keine unterschiedlichen
  öffentlich sichtbaren Antworten liefern.
- CSRF-Schutz einschließlich Login und zustandsändernder Aktionen; Logout über
  eine geschützte schreibende Methode. Cookie-Attribute HttpOnly, Secure bei HTTPS,
  SameSite, Scope/Path und ggf. `__Host-`-Präfix festlegen. Dev/Prod bleiben getrennt.
- Neue Session-ID beim Login; Widerruf beim Logout statt nur Cookie-Löschung.
  Definiere Persistenz/Store, Schutz gespeicherter Token, Restart-Verhalten und
  Aufräumen abgelaufener Sitzungen. Keine Passwörter oder Session-Geheimnisse loggen.
- Login-Begrenzung ohne leicht missbrauchbare dauerhafte Kontosperren; Cache-Control
  für Auth-Antworten und geschützte Inhalte festlegen.
- Bestehende Report-Tokens berücksichtigen: kein loses zweites Login-Leben nach
  Logout/Ablauf, keine pauschale Erweiterung ihrer Audience. Lege fest, wie sie an
  die Sitzung gebunden, erneuert oder abgelöst werden.

## Migration und Zuständigkeiten

Trenne SD-API-Aufgaben von notwendigen SOFA-Anpassungen. SOFA setzt heute das
Browser-Cookie und liest es selbst. Eine reine API-Änderung beseitigt diese
Vertrauensstelle nicht.

Erstelle einen abgestimmten Cutover mit kontrollierter Neuanmeldung. Bestehende
unsignierte Cookies sind kein Beweis einer vorherigen Anmeldung und dürfen nicht
automatisch in verifizierte Sitzungen umgewandelt werden. Keine dauerhafte
Rückfalllogik auf das alte Cookie. Berücksichtige parallel weiterlaufende Clients
und vermeide unkoordinierte Änderungen außerhalb des SOFA-Vertrags.

Rücksprungziele und die HTML-/JSON-Unterscheidung behandelt SOFA. Die API soll
JSON-Fehler liefern und keine Browser-Weiterleitungen erzwingen. SOFA validiert
interne Rücksprungziele serverseitig und wiederholt nach Login keine Schreibaktion
automatisch.

Keine Dateien in `/var/www/sofa` bearbeiten: Die SOFA-Seite (Loginseite,
Cookie, Weiterleitungen) läuft in einer eigenen Session gegen den vereinbarten
Vertrag. Notwendige SOFA-Anpassungen im Vertrag benennen. Keine
Produktionsumstellung in diesem Lauf. Dev läuft live auf dem API-Checkout.

## Wesentliche Nachweise

- Manipuliertes altes Cookie und frei gesetzte Benutzer-ID gewähren keinen Zugriff.
- `sofa-access`-Endpunkte lehnen Aufrufe ohne `SOFA-FN-ACC` des Akteurs ab.
- Login liefert für unbekannte PNR, falsches Passwort, inaktives Konto und
  fehlenden Zugang ohne korrektes Passwort identische Antworten.
- Ab 43.200 Sekunden nach Login abgelaufen, auch bei laufender Aktivität.
- Bei 14.399 Sekunden ohne Bedienaktivität gültig, ab 14.400 Sekunden abgelaufen;
  Polling hält die Sitzung nicht offen, Bedienaktivität verlängert sie definiert.
- Abgelaufene/widerrufene Sitzung lässt sich weder per Aktivitätsmeldung noch mit
  einem weiterhin vorhandenen Report-Token wiederbeleben.
- Logout, Kontosperre, Passwortänderung und Rechteentzug greifen gemäß Vertrag;
  parallele Tabs/Requests führen nicht zu unbeabsichtigter Wiederanmeldung.
- CSRF, Fixation, Rate Limit und fehlgeschlagene Infrastrukturzugriffe sind
  angemessen behandelt; 401/403/429/503 bleiben fachlich unterscheidbar.

Grundlagen: [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
