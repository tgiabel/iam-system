# Langzeitplan Betrieb – Prod-Release, Dev-Instanz, Rechte, PWA

Stand 25.09.2026 · Status: Plan, nichts umgesetzt · wird Etappe für Etappe abgearbeitet. Etappen mit „auszuarbeiten“ brauchen vor der Umsetzung eine eigene Konzeptrunde.

## Ziel

| | Prod | Dev |
|---|---|---|
| Adresse | `https://sofa` | `https://dev.sofa` |
| Container | Image `sofa:<sha>`, fixer Release, kein Mount, kein Reload | mountet `/var/www/sofa`, `--reload` |
| Port (Host) | `127.0.0.1:8000` | `127.0.0.1:8001` |
| SD-API | produktiv | **ebenfalls produktiv** |
| PWA | ja, installiert, ein Hauptfenster; alle SOFA-Links öffnen dort, nur Widgets als eigene Fenster | nein |
| Kennung | – | DEV-Flag im Header |
| Rollenansicht | – | als andere Rolle ansehen (eigenes Recht) |

Deploy: Commit auf `main` → Image bauen → Deploy-Befehl tauscht den Prod-Container. Rollback auf einen früheren SHA mit einem Befehl.

Rechte: Die Session ist serverseitig geprüft und nicht fälschbar. Rechteänderungen wirken ohne neuen Login.

## Ausgangslage

- `sofa-app-1` mountet `./app` live und läuft mit `--reload` (`Dockerfile`, `docker-compose.yml`). Jede Änderung in `/var/www/sofa`, auch uncommittet, ist sofort produktiv. „Deploy“ heißt heute `git merge --ff-only` in diesem Checkout.
- `/var/www/sofa-releases/<sha>` sind Kopien, die kein Container nutzt.
- Apache: vhost `sofa` (Zertifikat aus der internen CA `/var/www/tls/ca`) → `127.0.0.1:8000`. Einen vhost `dev.sofa` gibt es nicht.
- `Dockerfile` kopiert mit `COPY . .` alles (kein `.dockerignore`), `pandas` ist nicht gepinnt.
- `static_v` (Cache-Busting) ist die Startzeit des Prozesses.
- SOFA schreibt zur Laufzeit keine Dateien (Exporte entstehen im Speicher). Prod kann also `read_only` laufen.
- Vorbild SD-API (`/var/www/html/api`): `make image` / `approve` / `deploy` / `rollback`, `compose.prod.yml` mit `image: sd-api:${RELEASE}`, Healthcheck, `releases.json`. SOFA hat keine DB und keine Migrationen, deshalb fallen Approve-Manifest, Rollback-Gate und Volume-Vorbereitung weg.

Rechte heute:

- Die Session ist das Cookie `sofa_user`: **unsigniertes JSON** mit Benutzer und `sofa_permissions` (`app/routes/pages.py`, `app/authz.py`). `require_permission` liest die Rechte aus diesem Cookie, ohne Rückfrage bei der SD-API.
- `GET /api/session/authz` lädt die Rechte neu und schreibt das Cookie neu. Angestoßen wird das nur vom Browser (`base.js`, Intervall und beim Zurückkehren auf den Tab). Bis dahin – und in jedem Aufruf ohne dieses JS – gelten die alten Rechte. Das ist der Grund, warum Änderungen oft erst nach neuem Login wirken.
- Der Refresh nimmt die `user_id` aus dem Cookie. Wer das Cookie selbst schreibt, bekommt beim nächsten Refresh die Rechte eines beliebigen Benutzers. Das ist heute schon ausnutzbar, unabhängig von Dev. Deshalb steht die Härtung in Etappe 3 vor der Dev-Instanz.
- Die SD-API kennt den handelnden Benutzer nur aus dem Header `X-User-Id` (`app/shared/actor.py` in der SD-API) und prüft keine Client-Identität. Geschützt ist sie nur über das Netz: Der öffentliche Einstieg `https://sd-api` lässt nur wenige Pfade durch, `/sofa` nicht. Damit ist SOFA die einzige Stelle, die Benutzer und Rechte prüft. Jede SOFA-Instanz (auch Dev) kann mit jeder Identität schreiben.
- SOFA lauscht auf `0.0.0.0:8000`, ist also am Apache und an TLS vorbei direkt erreichbar.
- Tool-Widgets: `tools.js` öffnet Tools per `window.open(..., "?view=widget", "noopener")` als Popup. `base.html` blendet bei `view=widget` den Rahmen aus. Wegen `noopener` kennt das Widget sein Hauptfenster nicht.

## Etappen

Jede Etappe ist für sich lauffähig und wird einzeln freigegeben.

### 1. Grundlagen im Code (ändert am Betrieb noch nichts)

- `APP_ENV` (`production` | `development`) und `RELEASE_SHA` als Umgebungsvariablen, gelesen an einer Stelle (z. B. `app/config/runtime.py`).
- `static_v` = `RELEASE_SHA` (Kurzform). In Dev bleibt die Startzeit.
- `GET /health` → `{"status": "ok", "release": "<sha>", "env": "<env>"}` ohne SD-API-Aufruf.
- `requirements.txt` vollständig pinnen (auch `pandas`).
- `.dockerignore` (`.git`, `misc`, `deprecated`, `tests`, `docs`, `.env`, `__pycache__`), auch wenn der Build später über `git archive` läuft.
- DEV-Flag in `base.html`: bei `APP_ENV=development` ein deutliches „DEV“-Badge im Header und ein anderes Favicon. Keine Erklärtexte (siehe Knappe-UI-Regel).

### 2. Release-Image und Deploy-Ablauf

Dateien im Repo:

- `Dockerfile`: CMD ohne `--reload`, `RELEASE_SHA` als Build-Arg → ENV, `--proxy-headers`, Nicht-Root-User.
- `compose.prod.yml`: `image: sofa:${RELEASE}`, kein Volume, `read_only`, `tmpfs /tmp`, `cap_drop: ALL`, `restart: unless-stopped`, Healthcheck auf `/health`, Port `127.0.0.1:8000:8000`, Netz `sd-api-backend`, `SD_API_BASE_URL=http://sd-api:8080`.
- `Makefile` (bewusst schlank):

| Ziel | Tut |
|---|---|
| `make test` | Suite wie bisher im Container (inkl. Host-`node`) |
| `make image` | `git archive $(RELEASE) \| docker build -` → `sofa:<sha>`; RELEASE default `git rev-parse main` |
| `make deploy` | prüft: `main` sauber, RELEASE = `main`, Image vorhanden, Tests grün → `compose.prod.yml up -d` → wartet auf `/health` mit richtigem SHA → Eintrag in `releases/history` |
| `make rollback RELEASE=<sha>` | Image vorhanden, in `history`, nicht älter als die Rollback-Grenze → `up -d` → Health-Check → Eintrag |
| `make releases` | zeigt aktuellen und letzte Releases |

Kein Approve-Schritt, kein Manifest-JSON: die History-Datei reicht. Rollback-Grenze: `releases/rollback-floor` enthält den ältesten erlaubten SHA. Nach der Härtung (Etappe 3) wird sie auf diesen Release gesetzt, damit ein Rollback die Lücke nicht wieder öffnet. Alte Images: `make prune` behält die letzten 5.

Test vor der Umschaltung: Image parallel auf `127.0.0.1:8002` starten und durchklicken.

Umschaltung an einem ruhigen Zeitpunkt:

1. Alles in `/var/www/sofa` committen (sonst fehlt es im Image).
2. `make image && make deploy` → Prod läuft aus dem Image. Ab hier deployt ein `git merge` nichts mehr.
3. Alten Service `app` aus `docker-compose.yml` entfernen, `/var/www/sofa-releases` löschen, Doku (Testlauf, Deploy) nachziehen.

**Eine Projektmappe.** Alles liegt unter `/var/www/sofa`, eigene Mappen daneben entfallen:

| Was | Wo |
|---|---|
| Code, Dev-Instanz (mountet `app/`) | `/var/www/sofa` |
| Release | Image `sofa:<sha>` – keine Code-Kopien mehr. Der Stand ist über Git-SHA und Image eindeutig. |
| Release-Verlauf, aktueller Release | `/var/www/sofa/releases/` (gitignored): `history` und `current` |
| Secrets für Prod und Dev | `/var/www/sofa/.env.production`, `.env.development` (gitignored, `600`) |
| Worktrees, falls doch einmal nötig | `/var/www/sofa/.worktrees/<name>` (gitignored, wird nicht gemountet) |

`/var/www/sofa-releases` fällt weg. `/var/www/sofa-zk` wird aufgelöst, sobald `feature/time-correction` gemergt ist.

### 3. Rechte-Mechanismus härten (auszuarbeiten)

Ziel: Das Cookie ist nicht fälschbar, und Rechte gelten serverseitig und aktuell.

Richtung:

- **Signierte Session.** Das Cookie enthält nur noch Session-ID bzw. `user_id` und Ausstellzeit, signiert mit einem Server-Secret (`itsdangerous` oder Starlette `SessionMiddleware`). Rechte stehen nicht mehr im Cookie. Das Secret kommt aus einer Env-Datei außerhalb des Images, Prod und Dev haben verschiedene Secrets.
- **Rechte serverseitig laden.** `require_permission` holt das Rechteprofil (`/sofa/me` o. ä.) pro Benutzer über einen kurzen In-Memory-Cache (z. B. 30–60 s). Eine Änderung in der Rollenverwaltung wirkt damit spätestens nach Ablauf des Caches, ohne neuen Login und ohne Browser-JS.
- **Sofort wirksam bei eigenen Änderungen.** Ändert SOFA selbst Rollen oder Rechte (Rollenmanagement, Userverwaltung), leert es den Cache der betroffenen Benutzer sofort. Offen: ob die SD-API eine Rechte-Version/ETag liefern kann, dann ist der Cache billig prüfbar statt zeitgesteuert.
- **Browser-Refresh vereinfachen.** `/api/session/authz` liefert nur noch den aktuellen Stand fürs UI (Menüs, Kacheln) und schreibt kein Cookie mehr. Der Umgang mit verlorenen Seitenrechten (`handleAuthzLossAfterRefresh`) bleibt.
- **Umstieg.** Beim Deploy der Härtung werden alle alten Cookies ungültig, alle melden sich einmal neu an.

Zu klären:

- Die SD-API vertraut `X-User-Id` (siehe Ausgangslage). Kurzfristig muss deshalb SOFAs Prüfung dicht sein. Langfristig abwägen: SOFA weist sich gegenüber der SD-API aus (Service-Key pro Instanz), oder SOFA reicht ein signiertes Benutzer-Token durch. Mit Service-Key pro Instanz kann die SD-API Dev auch anders behandeln (Etappe 5).
- Sofort mit der Härtung: Port-Bindung auf `127.0.0.1:8000`, damit niemand am Apache vorbei an SOFA kommt.
- Logout serverseitig wirksam (Session-Liste/Denylist) oder nur Cookie löschen plus kurze Laufzeit?
- Cache pro Prozess reicht (ein Uvicorn-Worker)? Bei mehreren Workern entweder kürzerer Cache oder Rechte-Version aus der SD-API.

### 4. Dev-Instanz `dev.sofa`

Voraussetzung: Etappe 2, damit `/var/www/sofa` frei ist, und Etappe 3, damit Dev eigene Sessions hat.

1. `compose.dev.yml`: Build-Target dev, Mount `./app`, `--reload`, `APP_ENV=development`, Port `127.0.0.1:8001`, produktive SD-API, eigenes Session-Secret.
2. DNS-Eintrag `dev.sofa`, Zertifikat aus der internen CA, Apache-vhost `dev.sofa` → `127.0.0.1:8001`.
3. Bis Etappe 5 steht: `dev.sofa` im vhost per `Require ip` auf den eigenen Rechner beschränken.

Cookies sind host-gebunden (kein `Domain`-Attribut), `sofa` und `dev.sofa` teilen sie nicht. Das bleibt so.

Feature-Branches: direkt in `/var/www/sofa` auschecken. Die Dev-Instanz zeigt immer, was dort ausgecheckt ist. Nach der Umschaltung ist das ungefährlich, weil Prod nicht mehr mitläuft.

### 5. DB-Schutz für Dev (eigene Session, auszuarbeiten)

Dev spricht mit der produktiven SD-API. Jeder Fehler in Dev schreibt in echte Daten. Ideen zum Abwägen:

- Dev grundsätzlich lesend: Der SOFA-API-Client blockt in Dev nicht-GET-Aufrufe, außer ausdrücklich freigegebene.
- Eigener SD-API-Client/Key für Dev mit eigenem Rechteprofil in der SD-API.
- Schreibaufrufe aus Dev in der SD-API markieren und protokollieren (Header `X-SOFA-Env: development`).
- Zugang zu Dev nur mit eigenem Recht (z. B. `SOFA-DEV-ACCESS`), dann kann `Require ip` entfallen.

### 6. Rollenansicht in Dev (auszuarbeiten)

In Dev kann man sich als eine andere Rolle ausgeben und sieht SOFA so, wie diese Rolle es sieht.

- **Nur Dev, nur mit Recht.** Die Funktion existiert nur bei `APP_ENV=development` (in Prod nicht registriert, nicht nur versteckt) und nur mit einem eigenen Recht, z. B. `SOFA-DEV-ROLEVIEW`, das in der SD-API angelegt und vergeben wird.
- **Umsetzung auf Basis von Etappe 3.** Die Session hält neben dem echten Benutzer eine „Ansicht als“-Rolle. `require_permission` und die Template-Rechte rechnen mit dem Rechteprofil dieser Rolle statt mit dem eigenen. Die Prüfung, ob man die Rollenansicht nutzen darf, läuft immer gegen die echten Rechte.
- **Deutlich erkennbar.** Im Header neben dem DEV-Flag steht „Ansicht: <Rolle>“ mit einem Knopf zum Beenden. Die Auswahl sitzt im Header oder im Account-Menü.
- **Nur lesend.** Während der Rollenansicht sind Schreibaufrufe gesperrt. Sonst würde man mit fremden Rechten in Produktivdaten schreiben.
- **Was „sehen“ heißt.** Menüs, Seiten und Kacheln folgen direkt aus den SOFA-Rechten. Filtert die SD-API Daten selbst nach dem Benutzer (z. B. zugängliche Backlogs), muss SOFA diese Filter aus dem Rollenprofil nachbilden oder die SD-API muss „Daten wie Rolle X“ liefern. Das ist zu klären.

Zu klären:

- Rolle oder konkreter Benutzer? Eine Rolle ist sauberer. Ein Benutzer zeigt Kombinationen aus mehreren Rollen, ist aber datenschutzrelevanter.
- Liefert die SD-API das SOFA-Rechteprofil einer Rolle (ohne Benutzer)? Sonst braucht es einen Endpunkt.
- Mehrere Rollen kombinieren (Primär- plus Zusatzrollen)?

### 7. PWA, Hauptfenster und Widgets (nur Prod)

Erst nach Etappe 2, weil Service-Worker-Caching feste Releases braucht.

**Installierbar machen**

- `manifest.webmanifest` unter `/`: `id "/"`, `start_url "/"`, `scope "/"`, `display "standalone"`, Name/Kurzname, Farben aus dem Theme, Icons 192/512 + maskable (aus dem vorhandenen Logo erzeugen).
- Service Worker `/sw.js` aus einer Route (Scope `/`), minimal: `/static/*` cache-first mit Cache-Namen = Release-SHA, alles andere Netz. **Nie** `/api`, `/login`, `/logout` oder HTML cachen. Offline nur eine schlichte Seite „Keine Verbindung“. Beim neuen Release alte Caches löschen und Seite neu laden.
- In Dev werden Manifest und Service Worker nicht ausgeliefert.
- Voraussetzung: Die Clients vertrauen der internen CA ohne Warnung. Sonst registriert der Browser keinen Service Worker und bietet keine Installation an. Prüfen.

**„Erzwingen“**

Eine Website kann die Installation nicht selbst erzwingen. Zwei Hebel:

- Hart, empfohlen: Gruppenrichtlinie für Edge/Chrome `WebAppInstallForceList` mit `https://sofa/` und `default_launch_container: window`. Die App ist dann auf allen Domänen-Clients installiert.
- Weich, zusätzlich: Läuft SOFA im normalen Browser-Tab (`display-mode: browser`), ein Hinweis „In App öffnen“. Offen: Hinweis oder Sperre? Eine Sperre schließt Nicht-Chromium-Browser und Notfälle aus – Empfehlung: Hinweis, keine Sperre.

**Grundregel: SOFA-Links öffnen im Hauptfenster**

Egal woher ein Link auf `https://sofa/...` kommt – aus SOFA selbst, einem Widget, einer Benachrichtigung in SOFA, einer System-Benachrichtigung, einer Mail oder Teams: Er öffnet im Hauptfenster. Es entsteht kein weiteres Fenster und kein Tab. Einzige Ausnahme ist ein Tool, das ausdrücklich über „Als Widget öffnen“ gestartet wird.

Wie jeder Weg dorthin kommt:

| Herkunft | Weg ins Hauptfenster |
|---|---|
| Link in SOFA | normale Navigation; `target="_blank"` und `window.open` für interne Ziele entfallen. Ein zentraler Klick-Handler in `base.js` fängt Mittelklick, Strg+Klick und `target` ab. |
| Link im Widget | `BroadcastChannel("sofa-nav")` an das Hauptfenster; das navigiert und holt sich nach vorn. |
| In-App-Benachrichtigung (Toast mit Link) | wie ein Link in SOFA; im Widget über den Kanal. |
| System-Benachrichtigung | `notificationclick` im Service Worker: offenes Hauptfenster suchen (`clients.matchAll`), fokussieren, Ziel per `postMessage`; gibt es keins, `clients.openWindow`. |
| Mail, Teams, Desktop-Verknüpfung | `launch_handler` (s. u.) plus aktive Link-Übernahme im Browser. |

Überall gilt: Das Hauptfenster navigiert selbst, damit die Nachfrage bei ungespeicherten Änderungen greift (z. B. Zeitkorrektur). Externe Hosts gehen weiter im Browser auf. Eine `/widget/...`-URL, die von außen kommt, öffnet ebenfalls im Hauptfenster (als normale Tool-Seite). Widget-Fenster entstehen nur über den Widget-Knopf.

**Ein Hauptfenster**

- Manifest `launch_handler: {"client_mode": "focus-existing"}`. Startmenü, Taskleiste und von außen geöffnete Links holen das offene Fenster nach vorn. Die Ziel-URL nimmt SOFA per `window.launchQueue.setConsumer` entgegen und navigiert selbst. Bei `navigate-existing` würde der Browser ohne Nachfrage wegnavigieren.
- Damit externe Links überhaupt in der App landen, muss die Link-Übernahme („unterstützte Links in App öffnen“) aktiv sein, per Richtlinie oder Nutzereinstellung. Das Verhalten von Edge und Chrome dabei prüfen. Ohne Link-Übernahme öffnet ein Mail-Link einen Browser-Tab; der zeigt dann den Hinweis „In App öffnen“ (bzw. gibt das Ziel ans Hauptfenster weiter und schließt sich, falls machbar).
- Zweites Hauptfenster oder zweiter Tab: Web Locks (`navigator.locks`, Lock `sofa-main`). Wer den Lock nicht bekommt, gibt seine URL ans Hauptfenster weiter und zeigt „SOFA ist bereits geöffnet“ mit „Hier weiterarbeiten“. Das übernimmt den Lock, das andere Fenster wird per `BroadcastChannel` inaktiv geschaltet.

**Widgets**

- Eigener Pfad statt `?view=widget`, z. B. `/widget/<tool>`. `base.html` erkennt den Widget-Rahmen am Pfad, die Seitenrechte bleiben die des Tools.
- Öffnen nur über den Widget-Knopf, als eigenes Fenster mit fester Größe (im PWA-Kontext als App-Fenster). Nicht Teil des Locks `sofa-main`.
- Ein Fenster pro Tool: Ein zweiter Klick holt das bestehende Widget (fester Fenstername statt `_blank`).
- `noopener` kann bleiben, weil der Kanal kein `window.opener` braucht.
- Alternative bei Bedarf: eigener Host (z. B. `widget.sofa`). Das bringt eigene Cookies und ein eigenes Zertifikat. Erst der Pfad, der Host nur, wenn der Pfad nicht reicht.

**Benachrichtigungen (auszuarbeiten)**

- In-App-Toasts mit Link: ohne Infrastruktur, sofort machbar.
- System-Benachrichtigungen, während SOFA offen ist: `registration.showNotification` über den Service Worker, Erlaubnis einmal pro Client (per Richtlinie vorab erteilbar). Woher SOFA erfährt, dass es etwas zu melden gibt: Polling oder Server-Sent Events.
- Push bei geschlossener App: Braucht den Push-Dienst des Browsers (Chrome: Google FCM, Edge: Microsoft WNS), also Internet und einen externen Dienst, über den die Nachricht läuft. Erst entscheiden, ob das gewollt ist.

**Service Worker entfernbar halten**

Ein fehlerhafter Service Worker bleibt bei den Clients hängen. Deshalb von Anfang an: `/sw.js` mit `Cache-Control: no-cache`, und ein vorbereiteter „Aus“-Modus (Umgebungsvariable), der einen Service Worker ausliefert, der seine Caches löscht und sich selbst abmeldet.

## Vor dem Start

**Reihenfolge**

- Etappe 3 (Härtung) hängt nicht an 1 und 2 und kann im heutigen Aufbau zuerst kommen. Das ist die dringendste Etappe, weil die Lücke in Prod besteht. Die Port-Bindung auf `127.0.0.1` geht sofort.
- Die PWA (Etappe 7) erst, wenn Releases fest sind. Sonst cached der Service Worker Stände, die es nie als Release gab.

**Arbeitsweise nach der Umschaltung**

- `git merge` auf `main` ist dann kein Deploy mehr. Live geht nur, was per `make deploy` als Image läuft. Dev zeigt sofort alles, auch Uncommittetes.
- `make deploy` ist ein Prod-Deploy. Den führt der Nutzer selbst aus, der Agent schlägt nur den Befehl vor (wie heute beim Fast-Forward).
- Laufende, uncommittete Arbeit in `/var/www/sofa` muss vor der Umschaltung committet sein oder bewusst draußen bleiben.
- Der Testlauf nutzt heute das Image `sofa-app` aus der alten Compose. Er wandert nach `make test` mit einem eigenen Test-Target.

**Außerhalb des Servers** (vorher klären, wer es macht)

- DNS-Eintrag `dev.sofa`.
- Endgültiger Hostname für die PWA. Die App ist an den Origin gebunden: `https://sofa` und ein voller Domainname wären zwei verschiedene Apps. Einen Namen festlegen, die anderen per Apache umleiten. `id` und `scope` im Manifest danach nie mehr ändern.
- Vertrauen der internen CA auf allen Clients (für Service Worker Pflicht).
- Gruppenrichtlinien: Installation (`WebAppInstallForceList`), Link-Übernahme, ggf. Benachrichtigungs-Erlaubnis. Browser und Versionen der Clients (Edge/Chrome, alles Chromium?).

**Server**

- Platte: `/` ist zu 89 % belegt (21 GB frei), die SD-API-Images stapeln sich schon. SOFA-Images (~400 MB mit pandas, Basis-Layer geteilt) brauchen `make prune`, SD-API-Images aufräumen.
- RAM: 7,7 GB, rund 1 GB frei. Ein zweiter SOFA-Container (~50–150 MB) passt, viel Luft ist nicht.
- Umschaltung: wenige Sekunden Ausfall beim Container-Tausch, ruhigen Zeitpunkt wählen.

**Sessions und Rechte**

- Die Härtung meldet einmal alle ab. Vorher ankündigen.
- Rollback-Grenze setzen (siehe Etappe 2), sonst öffnet ein Rollback die Lücke wieder.
- Session-Secrets: wo sie liegen (`.env.production`, `600`), dass sie mitgesichert werden und was beim Wechsel passiert (alle abgemeldet).
- Rechte-Cache erzeugt pro aktivem Benutzer etwa einen SD-API-Aufruf pro Minute. Vernachlässigbar, aber der SD-API-Endpunkt muss dafür schnell sein.

## Offene Entscheidungen

1. Installation per GPO – wer pflegt die Richtlinie, sind alle Nutzer Domänen-Clients mit Edge/Chrome? Link-Übernahme und Benachrichtigungs-Erlaubnis per Richtlinie mit ausrollen?
2. Browser-Tab: Hinweis oder Sperre.
3. Endgültiger Hostname der PWA.
4. SD-API-Vertrauen: bleibt es bei `X-User-Id` plus Netzschutz, oder Service-Key pro SOFA-Instanz bzw. signiertes Token? Entscheidet Tiefe von Etappe 3 und 5.
5. Rollenansicht: Rolle oder Benutzer, und woher kommt das Rechteprofil einer Rolle?
6. System-Benachrichtigungen nur bei offener App, oder Push über externe Dienste?
7. Ergebnis der DB-Schutz-Session (Etappe 5) – bestimmt, ab wann `dev.sofa` mehr als einem Rechner offensteht.
