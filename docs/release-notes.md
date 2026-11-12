# Versionen und Release Notes (SOFA)

SOFA nutzt dasselbe Framework wie SD-API. Gemeinsame Spezifikation (Trailer,
Versionsregeln, Notes-Schema 1): SD-API `docs/release-notes.md`
(`/var/www/html/api/docs/release-notes.md`). `scripts/release_notes.py` und
`.githooks/commit-msg` sind Kopien aus SD-API und werden **nicht** hier geändert:
Änderungen zuerst in SD-API, dann beide Dateien unverändert herüberkopieren.

Repo-spezifisch ist allein `app/release_notes.json` (Standardpfad, kein
`RELEASE_NOTES_FILE` nötig). Sie liegt unter `app/` und gelangt so ins Prod-Image.

## Commits

Jeder Commit endet mit `Scope:` und `Note:` (optional `Bump:`, `Requires:`), keine
weiteren Trailer wie `Co-Authored-By`. Hook einmal je Klon aktivieren:

```sh
git config core.hooksPath .githooks
```

Scopes (`scopes` in der Notes-Datei): `dashboard`, `workspace`, `tasks`,
`processes`, `users`, `roles`, `systems`, `computers`, `iks`, `reports`, `tools`,
`login`, `ops`, `internal`. Es sind die SOFA-Bereiche der SD-API ohne `sofa/`.

- `Note:` kurzer deutscher Stichpunkt, wie ein Nutzer die Änderung spürt; `Note: -` intern.
- `Requires: sd-api >= x.y.z`, wenn der Commit eine bestimmte SD-API-Version braucht.
  API-Änderungen stehen nur in den API-Notes, SOFA-Änderungen nur hier.
- `minor_if_added` ist `[]`: SOFA hat keine Migrationen. Minor nur mit `Bump: minor`
  (z. B. am Ende eines Feature-Laufs).
- Major nur mit `Bump: major`, wenn Nutzer sich grundlegend neu orientieren müssen.
  Der laufende UI/UX-Umbau wird bei seinem Abschluss `2.0.0`, nicht vorher.

`make changes` zeigt den Stand seit dem letzten Tag mit der Version jedes Commits.

## Release

Direkt in `/var/www/sofa` auf `main` (Deploy erlaubt nur den aktuellen `main`-Commit):

```sh
make release-notes                 # Entwurf oben in app/release_notes.json
# Stichpunkte kürzen und zusammenfassen, Interna zu einem Punkt bündeln
git add app/release_notes.json
git commit -m "release: v$(python3 scripts/release_notes.py version)"
make image                         # check + check-release, dann Build
make deploy                        # check-release, Start, danach Tag vX.Y.Z
git push --follow-tags             # Tags bleiben sonst lokal
```

- `make image` prüft mit `check $(RELEASE)` Schema und Trailer aus genau diesem Commit
  und mit `check-release`, dass er ein passender Release-Commit ist (Betreff, oberster
  Eintrag, nur die Notes-Datei geändert).
- `make deploy` prüft erneut `check-release` (das Gegenstück zu `approve` in SD-API)
  und setzt nach erfolgreichem `--wait` den Tag. Ein Tag heißt: lief in Produktion.
- `make rollback` prüft nichts davon und setzt keinen Tag; Rollback-Ziele können
  ältere Stände ohne Notes-Datei sein.
- Kommt ein Release nicht in Produktion, ersetzt der nächste `make release-notes` den
  ungetaggten Eintrag und behält dessen Stichpunkte.

## Anzeige

`/releases` (Profilmenü „Release Notes“, für alle Angemeldeten, kein eigenes Recht)
zeigt die Einträge von SOFA und SD-API zusammen, neueste zuerst, filterbar nach App.
Je Eintrag erscheinen die kuratierten `notes`; `changes` sind zugeklappt.

- SD-API-Notes kommen über `GET /meta/releases` mit Dienstschlüssel und Sitzung des
  Nutzers und werden 5 Minuten zwischengespeichert. Antwortet die API nicht (oder
  fehlt die Route), steht dort „SD-API nicht erreichbar“, die SOFA-Notes bleiben.
- Fordert der laufende SOFA-Eintrag per `requires` eine neuere SD-API, als läuft,
  trägt er einen Hinweis „Erwartet sd-api >= …“. Ist die API-Version unbekannt, keiner.
- `GET /api/meta/releases` liefert die eigenen Notes im selben Format wie SD-API
  (`schema`, `app`, `scopes`, `releases`, `version`, `release_sha`), `GET /health`
  zusätzlich `version`.
- Dev: `app/` ist in `sofa-dev` eingehängt; die Notes-Datei wird bei Änderung neu
  gelesen, ohne Neustart. API-Notes zeigt Dev nur, wenn `sd-api-dev` die Route hat.

## Rückblick

Die Einträge bis `1.5.0` sind am 12.11.2026 aus der Historie gebildet; ihre `changes`
tragen nur den Commit-Betreff, ihre `requires` die SD-API-Version, die zum Deploy lief.

| Version | Tag auf | Datum | Inhalt |
|---|---|---|---|
| 1.5.0 | `7fb7866` | 12.11.2026 | Geprüfte Sitzungen, neue Anmeldung |
| 1.4.0 | `7127be0` | 11.11.2026 | Rollen- und Systemdetailseiten |
| 1.3.0 | `1aa84ce` | 26.10.2026 | Aufgaben-Board, neues Dashboard |
| 1.2.0 | `b88a74a` | 14.10.2026 | Workspace, erstes Prod-Image; alles seit Mai |
| 1.1.3 | `7bad173` (vorhanden) | 08.05.2026 | Erster Stand bis einschließlich v1.1.3 |

Innerhalb eines Abschnitts zählt jeder Commit als Patch, der Anker-Commit trägt den
Minor-Sprung. Im Ersten Stand trägt jeder Commit die Version des ersten Mai-Tags,
der ihn enthält (die Tags `v1.0.0`–`v1.1.3` wurden damals von Hand gesetzt).
`trailers_required_after` ist `6dfc175`, der letzte Commit ohne Trailer.
