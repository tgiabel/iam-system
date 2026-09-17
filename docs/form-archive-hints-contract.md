# Archivhinweise in Formularen

Die Formularverwaltung nutzt die vereinheitlichte SD-API-Vorbefüllung für Word
und PDF. `fields[]` kann zwei zusätzliche Eigenschaften enthalten:

- `account_archived`: Boolean, standardmäßig `false`.
- `account_archived_at`: ISO-Datetime oder `null`, standardmäßig `null`.

Die BFF reicht diese Antwort unverändert weiter und setzt den Bearbeiter weiterhin
serverseitig. Die SD-API ermittelt Kennung und Archivmetadaten aus demselben
Kontosatz. Aktuelle Konten haben Vorrang; fehlt ein Konto, darf die frühere Kennung
auch für noch aktive Mitarbeiter verwendet werden.

Bei `account_archived: true` steht neben dem Feldlabel ein kleines Ausrufezeichen.
Hover und Tastaturfokus zeigen „Das Konto wurde am TT.MM.JJJJ deaktiviert.“. Für
diese fachliche Aussage gilt der abgeschlossene Kontoentzug in SOFA; das Datum
stammt aus dessen Archivierung und wird in `Europe/Berlin` angezeigt. Fehlt ein
verwertbares Datum, lautet der Text „Das Konto wurde deaktiviert.“.

Der Hinweis blockiert die Generierung nicht. Er verschwindet, sobald der Feldwert
von der ursprünglich vorbefüllten Kennung abweicht, und erscheint bei exakter
Wiederherstellung erneut. Andere Felder bleiben davon unberührt. Übermittelte
`values` enthalten ausschließlich die eigentlichen Formularwerte.

Beim Wechsel des Mitarbeiters oder der Vorlage werden Vorbefüllung, Hinweise und
die Referenz auf ein vorhandenes Dokument verworfen. Eine Revisionsnummer verhindert,
dass verspätete Antworten einer früheren Auswahl diese Daten wiederherstellen.
Antworten ohne neue Metadaten bleiben kompatibel und erzeugen keinen Hinweis.

Die Implementierung wird in einem separaten Checkout entwickelt. Erst nach
Deployment-Freigabe SD-API inklusive Archiv-Fallback ausrollen, dann SOFA. Es
werden keine Datenbankmigration und keine neuen Berechtigungen benötigt.

Prüfung: `python -m unittest tests.test_form_archive_hints tests.test_word_templates_tool`;
Node.js muss verfügbar sein. Die Workflowtests prüfen reale Feldnormalisierung,
DOM-Aufbau, Wertänderung, Wiederherstellung, Datumsformatierung, Auswahlwechsel und
verspätete Antworten mit synthetischen Daten. Zusätzlich wurde die Vorschau im
Browser auf Hover, Tastaturfokus, mehrere Hinweise und Generierung geprüft.
