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

Release-Ablauf nach Commit und Review:

```sh
make image                 # baut sofa:<main-sha> aus git archive main
make deploy                # ersetzt die bisherige sofa-app-1 und wartet auf /health
```

Ein älteres, bereits gebautes Image kann mit
`make rollback RELEASE=<voller-main-commit-sha>` wieder aktiviert werden. Das
Rollback-Ziel muss ein Vorfahr von `main` sein. `docker image ls sofa` zeigt die
verfügbaren Images. Prod-Secrets bleiben in
`/var/www/sofa-secrets/agent-stats.env` und gelangen nicht ins Image.

Die erste Umstellung erfolgt, sobald die Konfiguration auf `main` steht und das
Image gebaut und geprüft ist. Die frühere `docker-compose.yml` ist entfernt,
damit ein versehentliches `docker compose up` den alten Modus nicht wieder
startet. Der Dev-VHost hat wie `sofa` keinen eigenen Zugriffsschutz.
