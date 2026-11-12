# SOFA: Entwicklung und Releases

Die Dev-Instanz zeigt den aktuellen Checkout unter `/var/www/sofa`, einschließlich
uncommitteter Änderungen. Uvicorn startet bei Änderungen in `app/` automatisch neu;
der Browser muss anschließend neu geladen werden. Sie läuft persistent als Compose-
Projekt `sofa-dev` auf `127.0.0.1:8001`. Von Clients im Netz ist sie unter
`https://sofa-dev` erreichbar: Apache-VHost `sofa-dev` (analog zu `sofa`) leitet auf
Port 8001, das Zertifikat stammt aus der internen CA (`/var/www/tls/ca`, SAN
`sofa-dev`, gültig bis 29.09.2029) und der Name steht in
`/var/www/html/soap/config/hosts` (wird auf die Clients ausgerollt).

Dev nutzt die bereits laufende `sd-api-dev` und deren getrennte Datenbank. Diese
API muss zuerst laufen (`make dev` in `/var/www/html/api`). SOFA-Dev hat ein
sichtbares `DEV`-Kennzeichen. Start und Aktualisierung: `make dev`.
Stoppen: `make dev-down`.

Prod läuft als Compose-Projekt `sofa` auf `127.0.0.1:8000` hinter Apache. Das
Image enthält einen festen Commit aus `main`; es hat weder Quellcode-Mount noch
Uvicorn-Reload. Ein Branchwechsel oder eine Dateiänderung im Checkout ändert
Prod damit nicht mehr. Der bestehende Apache-VHost kann unverändert auf Port 8000
zeigen.

Release-Ablauf nach Commit und Review (Versionen und Notes: `docs/release-notes.md`):

```sh
make release-notes         # Entwurf in app/release_notes.json, dann kürzen
git add app/release_notes.json
git commit -m "release: v$(python3 scripts/release_notes.py version)"
make image                 # prüft Notes und Release-Commit, baut sofa:<main-sha>
make deploy                # ersetzt sofa-app-1, wartet auf /health, setzt Tag vX.Y.Z
git push --follow-tags
```

Ausgeliefert wird nur ein Release-Commit `release: vX.Y.Z`, der allein
`app/release_notes.json` ändert; `image` und `deploy` verweigern andere Commits.
`/health` nennt zusätzlich die Version.

Ein älteres, bereits gebautes Image kann mit
`make rollback RELEASE=<voller-main-commit-sha>` wieder aktiviert werden. Das
Rollback-Ziel muss ein Vorfahr von `main` sein. `docker image ls sofa` zeigt die
verfügbaren Images. Prod-Secrets liegen in `/var/www/sofa-secrets/` und gelangen
nicht ins Image:

- `sd-api-service.env`: `SD_API_SERVICE_KEY`, der Dienstnachweis gegenüber der
  SD-API (≥ 32 Zufallsbytes, base64url). Die SD-API kennt nur seinen SHA-256 in
  `SOFA_SERVICE_KEY_SHA256`. Ohne Schlüssel startet SOFA in Prod nicht. Dev nutzt
  den eingecheckten Fixture-Schlüssel der SD-API und braucht keine Datei.

`agent-stats.env` (Report-Schlüssel der Releases vor den verifizierten Sitzungen)
ist seit dem 12.11.2026 entfernt. Ein Rollback auf solche Releases startet ohne
ihn, blendet aber die Reports mit Report-Token aus (Agent-Stats, Genesys-Live).

### Umstellung auf verifizierte Sitzungen

Am 12.11.2026 durchgeführt (SD-API API-1 08:46, SOFA d2c30e5 09:04, SD-API API-2
09:15 UTC). Vertrag: SD-API `docs/sofa-session-contract.md`, Abschnitt 11. Reihenfolge:

1. SD-API API-1 deployen (Migration `user_sessions`, `SOFA_SERVICE_KEY_SHA256`).
   Altes SOFA läuft unverändert weiter.
2. Schlüssel erzeugen, `SD_API_SERVICE_KEY=<schlüssel>` in
   `/var/www/sofa-secrets/sd-api-service.env` (Modus 600), Digest an SD-API.
3. Im selben Wartungsfenster: SOFA deployen, danach SD-API API-2. Alle melden sich
   einmal neu an; alte Cookies werden gelöscht, nie umgewandelt.

Rollback von SOFA hinter diesen Stand verlangt vorher SD-API API-1 oder älter.

Die frühere `docker-compose.yml` (Prod aus dem Live-Checkout) ist entfernt,
damit ein versehentliches `docker compose up` den alten Modus nicht wieder
startet. Der Dev-VHost hat wie `sofa` keinen eigenen Zugriffsschutz.
