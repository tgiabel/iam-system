"use strict";
const assert = require("node:assert/strict");
const guide = require("../app/static/js/resource_guide.js");

const missing = [{ key: "genesys_user_id", label: "Genesys-ID" }];
const catalog = [
    { key: "racf", label: "RACF-Kennung", group: "Konten" },
    { key: "first_name", label: "Vorname", group: "Mitarbeiter" },
    { key: "genesys_user_id", label: "Genesys-ID", group: "Konten" }
];

// Leer bleibt leer
assert.equal(guide.render(""), "");
assert.equal(guide.render(null), "");
assert.equal(guide.render("  \n\n "), "");

// HTML erscheint als Text, auch in Code, Links und fett
assert.equal(guide.render("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
assert.equal(guide.render("**<b>x</b>**"), "<p><strong>&lt;b&gt;x&lt;/b&gt;</strong></p>");
let html = guide.render('`<img src=x onerror="a">`');
assert.ok(!html.includes("<img"), html);
assert.ok(html.includes('data-copy="&lt;img src=x onerror=&quot;a&quot;&gt;"'), html);

// Nur http(s)-Links; javascript: bleibt Text
assert.equal(guide.render("[Klick](javascript:alert(1))"), "<p>[Klick](javascript:alert(1))</p>");
html = guide.render('[Portal](https://example.test/a?b=1&c="2")');
assert.ok(html.includes('href="https://example.test/a?b=1&amp;c=&quot;2&quot;"'), html);
assert.ok(html.includes(">Portal</a>"), html);
assert.ok(html.includes('rel="noopener noreferrer"'), html);

// Nackte https-Links, ohne Satzzeichen am Ende; http nur in eckigen Klammern
html = guide.render("Siehe https://example.test/x. Danach weiter");
assert.ok(html.includes('href="https://example.test/x"'), html);
assert.ok(html.includes("</a>. Danach"), html);
assert.ok(!guide.render("http://example.test").includes("<a"));
assert.ok(guide.render("[alt](http://example.test)").includes('href="http://example.test"'));
// Ein Link in Code bleibt Code
assert.ok(!guide.render("`https://example.test`").includes("<a"));

// Fett, Absätze, Zeilenumbruch
assert.equal(guide.render("Eins **fett** zwei\nneue Zeile\n\nAbsatz"), "<p>Eins <strong>fett</strong> zwei<br>neue Zeile</p><p>Absatz</p>");

// Listen; Startnummer bleibt; Wechsel zwischen Text und Liste im selben Block
assert.equal(guide.render("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
assert.equal(guide.render("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
assert.equal(guide.render("3. c\n4. d"), '<ol start="3"><li>c</li><li>d</li></ol>');
assert.equal(guide.render("Vorher\n- a\nNachher"), "<p>Vorher</p><ul><li>a</li></ul><p>Nachher</p>");
assert.equal(guide.render("- a\n1. b"), "<ul><li>a</li></ul><ol><li>b</li></ol>");
// "**fett**" am Zeilenanfang ist keine Liste
assert.equal(guide.render("**Achtung** jetzt"), "<p><strong>Achtung</strong> jetzt</p>");

// Kopier-Chip
html = guide.render("Kennung `ab12` eintragen");
assert.ok(html.includes('<button type="button" class="rg-chip" data-copy="ab12" title="Kopieren">ab12'), html);
// Fett wirkt im Chip nicht
assert.ok(guide.render("`**x**`").includes('data-copy="**x**"'));

// Fehlender Platzhalter: Warnung mit Label, im Chip nicht kopierbar
html = guide.render("Agent `{{genesys_user_id}}` in **Gruppe**", { missing });
assert.ok(html.includes('<span class="rg-chip is-static"><span class="rg-missing">Genesys-ID fehlt</span></span>'), html);
assert.ok(!html.includes("data-copy"), html);
html = guide.render("ID: {{genesys_user_id}}", { missing });
assert.equal(html, '<p>ID: <span class="rg-missing">Genesys-ID fehlt</span></p>');
// Teilweise fehlend: ganzer Chip nicht kopierbar
html = guide.render("`max.{{genesys_user_id}}`", { missing });
assert.ok(html.includes('class="rg-chip is-static">max.<span class="rg-missing">'), html);
// Nur gemeldete Schlüssel werden zu Warnungen; ein {{…}} aus einem Wert bleibt Text
assert.equal(guide.render("Wert {{anders}}", { missing }), "<p>Wert {{anders}}</p>");
assert.equal(guide.render("{{ geburtstag }}", { unknown: ["geburtstag"] }), '<p><span class="rg-missing">geburtstag unbekannt</span></p>');
assert.equal(guide.render("{{x}}", { unknown: [{ key: "x" }] }), '<p><span class="rg-missing">x unbekannt</span></p>');
// Platzhalter in Link-URL: kein Link, Warnung
html = guide.render("[Profil](https://example.test/u/{{genesys_user_id}})", { missing });
assert.ok(!html.includes("<a"), html);
assert.ok(html.includes("Profil <span class=\"rg-missing\">Genesys-ID fehlt</span>"), html);

// Vorschau: Labels aus dem Katalog, unbekannte als Warnung, Chips mit Platzhalter nicht kopierbar
html = guide.preview("Hallo {{first_name}}, `{{ racf }}` und {{geburtstag}}", catalog);
assert.ok(html.includes('<span class="rg-placeholder">Vorname</span>'), html);
assert.ok(html.includes('<span class="rg-chip is-static"><span class="rg-placeholder">RACF-Kennung</span></span>'), html);
assert.ok(html.includes('<span class="rg-missing">geburtstag unbekannt</span>'), html);

assert.equal(guide.preview("{{racf}}"), '<p><span class="rg-placeholder">racf</span></p>');

// Seiten: eine Zeile nur aus "---" trennt, Leerraum je Seite und leere Seiten entfallen
assert.deepEqual(guide.splitPages("Eins\n---\nZwei"), ["Eins", "Zwei"]);
assert.deepEqual(guide.splitPages("---\n\n  Eins  \n\n  ---  \n\n---\nZwei\n---\n"), ["Eins", "Zwei"]);
assert.deepEqual(guide.splitPages("a\r\n---\r\nb"), ["a", "b"]);
assert.deepEqual(guide.splitPages("Text --- weiter\n----\n- --"), ["Text --- weiter\n----\n- --"]);
assert.deepEqual(guide.splitPages(" \n---\n "), []);
assert.deepEqual(guide.splitPages(null), []);
// Listen und Absätze bleiben je Seite für sich
assert.deepEqual(guide.renderPages("1. a\n---\n2. b"), ["<ol><li>a</li></ol>", '<ol start="2"><li>b</li></ol>']);
assert.equal(guide.render("Eins\n---\nZwei"), "<p>Eins</p><p>Zwei</p>");
assert.deepEqual(guide.renderPages("`{{genesys_user_id}}`\n---\nok", { missing }).map(page => page.includes("Genesys-ID fehlt")), [true, false]);
assert.deepEqual(guide.previewPages("{{racf}}\n---\nx", catalog), ['<p><span class="rg-placeholder">RACF-Kennung</span></p>', "<p>x</p>"]);

// Pager: eine Seite ohne Steuerung, mehrere mit Pfeilen und Punkten, aktive Seite begrenzt
assert.equal(guide.pagerHtml(["<p>a</p>"]), '<div class="rg-guide"><p>a</p></div>');
assert.equal(guide.pagerHtml([]), '<div class="rg-guide"></div>');
html = guide.pagerHtml(["<p>a</p>", "<p>b</p>", "<p>c</p>"], 7);
assert.equal((html.match(/data-guide-dot=/g) || []).length, 3);
assert.ok(html.includes('data-guide-page="2" role="group" aria-label="Seite 3 von 3">'), html);
assert.ok(html.includes('data-guide-dot="2" aria-label="Seite 3" aria-current="true"'), html);
assert.ok(html.includes('data-guide-step="1" aria-label="Nächste Seite" disabled'), html);
assert.ok(!html.includes('data-guide-step="-1" aria-label="Vorherige Seite" disabled'), html);
assert.equal((html.match(/aria-hidden="true"><p>/g) || []).length, 2);

// Platzhalter-Hilfen
assert.deepEqual(guide.placeholderKeys("{{a}} {{ b }} {{a}} {{c-d}}"), ["a", "b"]);
assert.deepEqual(guide.unknownKeys("{{racf}} {{geburtstag}}", catalog), ["geburtstag"]);
assert.deepEqual(guide.groupCatalog(catalog).map(group => [group.name, group.entries.map(entry => entry.key)]),
    [["Konten", ["racf", "genesys_user_id"]], ["Mitarbeiter", ["first_name"]]]);

// Steuerzeichen der Token-Ersetzung im Text bleiben wirkungslos
assert.equal(guide.render("a\u00000\u0000b"), "<p>a0b</p>");

console.log("resource_guide checks ok");
