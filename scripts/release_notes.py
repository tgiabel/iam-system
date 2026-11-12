#!/usr/bin/env python3
"""Versionen und Release Notes aus Git-Trailern (docs/release-notes.md).

Jeder Commit traegt am Ende seiner Nachricht:

    Scope: <scope>[, <scope>]   Pflicht, Werte aus "scopes" der Notes-Datei
    Note: <Stichpunkt>          Pflicht, fuer Endnutzer formuliert, "-" = intern
    Bump: minor|major           optional, ohne Angabe Patch
    Requires: <app> >= <x.y.z>  optional, mehrfach erlaubt

Die Version eines Commits ist der naechste Tag `vX.Y.Z` davor plus ein Bump je
Commit. Ein Commit, der eine Datei aus "minor_if_added" hinzufuegt, ist mindestens
Minor. Commits `release: vX.Y.Z` zaehlen nicht.

Nur Standardbibliothek und Python 3.7, damit dieselbe Datei in jedem Repo und auf
dem Host laeuft. Repo-spezifisch ist allein die Notes-Datei.
"""

import argparse
import datetime
import fnmatch
import json
import os
import re
import subprocess
import sys

NOTES_FILE = os.environ.get("RELEASE_NOTES_FILE", "app/release_notes.json")
SCHEMA = 1
BUMPS = ("patch", "minor", "major")
MAX_NOTE_LENGTH = 160
TRAILER_LINE = re.compile(r"^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$")
VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
REQUIRES = re.compile(r"^[a-z0-9-]+ >= \d+\.\d+\.\d+$")
RELEASE_SUBJECT = re.compile(r"^release: v(\d+\.\d+\.\d+)$")
EXEMPT_SUBJECT = re.compile(r"^(release: |Merge |fixup! |squash! |amend! )")
INTERNAL_NOTE = "-"
INTERNAL_SUMMARY = re.compile(r"^Interne Verbesserungen \(\d+ Änderung(en)?\)\.$")


class ReleaseNotesError(Exception):
    pass


# --- reine Logik (getestet in tests/test_release_notes.py) -------------------


def parse_version(text):
    match = VERSION.match(text or "")
    if not match:
        raise ReleaseNotesError("keine Version x.y.z: {!r}".format(text))
    return tuple(int(part) for part in match.groups())


def format_version(parts):
    return "{}.{}.{}".format(*parts)


def bump(parts, kind):
    major, minor, patch = parts
    if kind == "major":
        return (major + 1, 0, 0)
    if kind == "minor":
        return (major, minor + 1, 0)
    return (major, minor, patch + 1)


def parse_trailers(message):
    """Liest die Trailer-Absaetze am Ende einer Commit-Nachricht.

    Beruecksichtigt werden alle aufeinanderfolgenden Schlussabsaetze, die nur aus
    `Key: Wert`-Zeilen bestehen, damit ein abgesetzter weiterer Trailer (etwa
    `Signed-off-by`) nicht die eigentlichen Trailer verdeckt. Kommentarzeilen (`#`) und alles ab der
    Scheren-Zeile von `git commit -v` fallen weg.
    """
    lines = []
    for line in message.splitlines():
        if line.startswith("# ------------------------ >8"):
            break
        if not line.startswith("#"):
            lines.append(line.rstrip())
    paragraphs = []
    current = []
    for line in lines:
        if line.strip():
            current.append(line)
        elif current:
            paragraphs.append(current)
            current = []
    if current:
        paragraphs.append(current)

    trailers = {}
    # Der erste Absatz ist der Betreff und nie ein Trailer-Block.
    for paragraph in reversed(paragraphs[1:]):
        matches = [TRAILER_LINE.match(line) for line in paragraph]
        if not all(matches):
            break
        for match in reversed(matches):
            trailers.setdefault(match.group(1).lower(), []).insert(0, match.group(2).strip())
    return trailers


def split_scopes(values):
    scopes = []
    for value in values:
        scopes.extend(part.strip() for part in value.split(",") if part.strip())
    return scopes


def message_problems(message, scopes):
    """Fehler einer Commit-Nachricht; leer bedeutet gueltig oder ausgenommen."""
    subject = message.lstrip().splitlines()[0] if message.strip() else ""
    if EXEMPT_SUBJECT.match(subject):
        return []
    trailers = parse_trailers(message)
    problems = []
    commit_scopes = split_scopes(trailers.get("scope", []))
    if not commit_scopes:
        problems.append("Trailer 'Scope:' fehlt")
    for scope in commit_scopes:
        if scope not in scopes:
            problems.append("unbekannter Scope {!r} (erlaubt: {})".format(scope, ", ".join(scopes)))
    notes = trailers.get("note", [])
    if not notes:
        problems.append("Trailer 'Note:' fehlt ('Note: -' fuer interne Aenderungen)")
    for note in notes:
        if not note:
            problems.append("leerer 'Note:'-Trailer")
        elif len(note) > MAX_NOTE_LENGTH:
            problems.append("Note laenger als {} Zeichen: {!r}".format(MAX_NOTE_LENGTH, note))
    bumps = trailers.get("bump", [])
    if len(bumps) > 1:
        problems.append("mehr als ein 'Bump:'-Trailer")
    for value in bumps:
        if value not in BUMPS:
            problems.append("Bump muss patch, minor oder major sein: {!r}".format(value))
    for value in trailers.get("requires", []):
        if not REQUIRES.match(value):
            problems.append("Requires im Format '<app> >= x.y.z': {!r}".format(value))
    return problems


def commit_bump(commit, minor_globs):
    """patch, minor oder major fuer einen Commit; None fuer Release-Commits."""
    if RELEASE_SUBJECT.match(commit["subject"]):
        return None
    explicit = (commit["trailers"].get("bump") or ["patch"])[0]
    level = BUMPS.index(explicit) if explicit in BUMPS else 0
    if any(fnmatch.fnmatch(path, pattern) for path in commit["added"] for pattern in minor_globs):
        level = max(level, BUMPS.index("minor"))
    return BUMPS[level]


def assign_versions(base, commits, minor_globs):
    """Versioniert Commits (aelteste zuerst) ab der Tag-Version `base`."""
    current = parse_version(base)
    result = []
    for commit in commits:
        kind = commit_bump(commit, minor_globs)
        if kind is not None:
            current = bump(current, kind)
        result.append(dict(commit, version=format_version(current), bump=kind))
    return result


def change_entry(commit):
    trailers = commit["trailers"]
    notes = [note for note in trailers.get("note", []) if note and note != INTERNAL_NOTE]
    return {
        "version": commit["version"],
        "commit": commit["sha"][:12],
        "date": commit["date"],
        "scopes": split_scopes(trailers.get("scope", [])),
        "notes": notes,
        "subject": commit["subject"],
    }


def internal_summary(count):
    return "Interne Verbesserungen ({} {}).".format(count, "Änderung" if count == 1 else "Änderungen")


def release_commit_problems(version, subject, changed_files, top_version, notes_file):
    """Fehler eines Release-Commits: Betreff, oberster Eintrag, nur die Notes-Datei."""
    problems = []
    if subject != "release: v{}".format(version):
        problems.append("kein Release-Commit 'release: v{}' (Betreff: {!r}); vorher draft ausfuehren".format(
            version, subject))
    if top_version != version:
        problems.append("oberster Eintrag ist {}, berechnet ist {}".format(top_version, version))
    extra = sorted(set(changed_files) - {notes_file})
    if extra:
        problems.append("Release-Commit darf nur {} aendern, nicht: {}".format(notes_file, ", ".join(extra)))
    return problems


def draft_release(version, date, versioned, previous=None):
    """Entwurf eines Release-Eintrags; Release-Commits selbst erscheinen nicht."""
    changes = [change_entry(commit) for commit in versioned if commit["bump"] is not None]
    # Ein ersetzter Entwurf behaelt seine kuratierten Stichpunkte; Notes kommen nur aus
    # Commits hinzu, die er noch nicht enthielt, sonst kehrten gekuerzte Texte zurueck.
    covered = {change["commit"] for change in previous["changes"]} if previous else set()
    notes = [dict(note) for note in previous["notes"]] if previous else []
    known = {note["text"] for note in notes}
    new_internal = 0
    for change in changes:
        if change["commit"] in covered:
            continue
        if not change["notes"]:
            new_internal += 1
        for text in change["notes"]:
            if text not in known:
                known.add(text)
                notes.append({"scope": (change["scopes"] or ["internal"])[0], "text": text})
    summaries = [note for note in notes if INTERNAL_SUMMARY.match(note["text"])]
    if summaries:
        summaries[0]["text"] = internal_summary(sum(1 for change in changes if not change["notes"]))
    elif new_internal:
        notes.append({"scope": "internal", "text": internal_summary(new_internal)})
    scopes = sorted({scope for change in changes for scope in change["scopes"]} | {n["scope"] for n in notes})
    requires = sorted(
        {value for commit in versioned for value in commit["trailers"].get("requires", [])}
        | set(previous.get("requires", []) if previous else [])
    )
    return {
        "version": version,
        "date": date,
        "scopes": scopes,
        "requires": requires,
        "notes": notes,
        "changes": list(reversed(changes)),
    }


def document_problems(document):
    """Schemafehler der Notes-Datei."""
    problems = []
    if document.get("schema") != SCHEMA:
        problems.append("schema muss {} sein".format(SCHEMA))
    if not isinstance(document.get("app"), str) or not document.get("app"):
        problems.append("app fehlt")
    scopes = document.get("scopes")
    if not isinstance(scopes, dict) or not scopes:
        problems.append("scopes muss ein nicht leeres Objekt {id: Bezeichnung} sein")
        scopes = {}
    if not isinstance(document.get("minor_if_added"), list):
        problems.append("minor_if_added muss eine Liste sein")
    releases = document.get("releases")
    if not isinstance(releases, list):
        return problems + ["releases muss eine Liste sein"]
    previous = None
    for index, release in enumerate(releases):
        where = "releases[{}]".format(index)
        try:
            version = parse_version(release.get("version"))
        except ReleaseNotesError as error:
            problems.append("{}: {}".format(where, error))
            continue
        where = "Release {}".format(release["version"])
        if previous is not None and not version < previous:
            problems.append("{}: Versionen muessen absteigend und eindeutig sein".format(where))
        previous = version
        try:
            datetime.datetime.strptime(release.get("date") or "", "%Y-%m-%d")
        except ValueError:
            problems.append("{}: date im Format JJJJ-MM-TT".format(where))
        notes = release.get("notes")
        if not isinstance(notes, list) or not notes:
            problems.append("{}: notes darf nicht leer sein".format(where))
            notes = []
        for note in notes:
            text = note.get("text") if isinstance(note, dict) else None
            if not text:
                problems.append("{}: Stichpunkt ohne text".format(where))
            elif len(text) > MAX_NOTE_LENGTH:
                problems.append("{}: Stichpunkt laenger als {} Zeichen".format(where, MAX_NOTE_LENGTH))
            if isinstance(note, dict) and note.get("scope") not in scopes:
                problems.append("{}: unbekannter Scope {!r}".format(where, note.get("scope")))
        for scope in release.get("scopes", []):
            if scope not in scopes:
                problems.append("{}: unbekannter Scope {!r}".format(where, scope))
        for value in release.get("requires", []):
            if not REQUIRES.match(value):
                problems.append("{}: Requires im Format '<app> >= x.y.z': {!r}".format(where, value))
        if not isinstance(release.get("changes"), list):
            problems.append("{}: changes muss eine Liste sein".format(where))
    return problems


# --- Git ---------------------------------------------------------------------


def git(*args, check=True):
    completed = subprocess.run(
        ["git"] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True
    )
    if check and completed.returncode != 0:
        raise ReleaseNotesError("git {} fehlgeschlagen: {}".format(" ".join(args), completed.stderr.strip()))
    return completed.stdout


def last_tag(rev):
    tag = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", rev, check=False).strip()
    if not tag:
        raise ReleaseNotesError("kein Versions-Tag vor {}".format(rev))
    return tag


def commits_between(start, end):
    """Commits in start..end, aelteste zuerst, mit hinzugefuegten Dateien."""
    output = git(
        "log", "--reverse", "--topo-order", "--date=short", "--name-status", "--no-renames",
        "--format=%x1e%H%x1f%ad%x1f%s%x1f%B%x1f", "{}..{}".format(start, end),
    )
    commits = []
    for record in output.split("\x1e")[1:]:
        sha, date, subject, body, files = record.split("\x1f")
        commits.append({
            "sha": sha,
            "date": date,
            "subject": subject,
            "trailers": parse_trailers(body),
            "added": [line[2:] for line in files.splitlines() if line.startswith("A\t")],
            "message": body,
        })
    return commits


def versioned_since_tag(document, rev):
    tag = last_tag(rev)
    commits = commits_between(tag, rev)
    return tag, assign_versions(tag[1:], commits, document["minor_if_added"])


def version_at(document, rev):
    tag, versioned = versioned_since_tag(document, rev)
    return versioned[-1]["version"] if versioned else tag[1:]


def load_document(path=NOTES_FILE, rev=None):
    if rev is None:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    return json.loads(git("show", "{}:{}".format(rev, path)))


def write_document(document, path=NOTES_FILE):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def is_ancestor(commit, other):
    return subprocess.call(["git", "merge-base", "--is-ancestor", commit, other]) == 0


def tag_exists(name):
    return bool(git("tag", "--list", name).strip())


# --- Befehle -----------------------------------------------------------------


def cmd_version(args):
    print(version_at(load_document(), args.rev))


def cmd_changes(args):
    document = load_document()
    tag, versioned = versioned_since_tag(document, args.rev)
    head = versioned[-1]["version"] if versioned else tag[1:]
    print("{} {} – {} Commit(s) seit {}".format(document["app"], head, len(versioned), tag))
    for commit in versioned:
        if commit["bump"] is None:
            print("  {:<9} {}  {}".format("-", commit["sha"][:7], commit["subject"]))
            continue
        scopes = ",".join(split_scopes(commit["trailers"].get("scope", []))) or "?"
        notes = commit["trailers"].get("note") or ["(keine Note)"]
        print("  {:<9} {}  [{}] {}".format(commit["version"], commit["sha"][:7], scopes, " / ".join(notes)))


def cmd_draft(args):
    document = load_document()
    tag, versioned = versioned_since_tag(document, "HEAD")
    if not any(commit["bump"] for commit in versioned):
        raise ReleaseNotesError("keine Aenderungen seit {}".format(tag))
    version = versioned[-1]["version"]
    releases = document["releases"]
    previous = None
    if releases and not tag_exists("v" + releases[0]["version"]):
        # Nie deployter Entwurf: ersetzen, seine kuratierten Stichpunkte behalten.
        previous = releases.pop(0)
    entry = draft_release(version, args.date or datetime.date.today().isoformat(), versioned, previous)
    releases.insert(0, entry)
    write_document(document)
    print("Entwurf {} mit {} Aenderung(en) in {}.".format(version, len(entry["changes"]), NOTES_FILE))
    print("Stichpunkte kuerzen und zusammenfassen, dann committen als: release: v{}".format(version))


def cmd_check(args):
    # Ohne rev: Arbeitsverzeichnis gegen HEAD, mit rev: die Datei aus genau diesem Commit.
    rev = git("rev-parse", "--verify", args.rev + "^{commit}").strip() if args.rev else "HEAD"
    document = load_document(rev=rev if args.rev else None)
    problems = document_problems(document)
    scopes = list(document.get("scopes") or {})
    cutoff = document.get("trailers_required_after")
    tag, versioned = versioned_since_tag(document, rev)
    for commit in versioned:
        if cutoff and is_ancestor(commit["sha"], cutoff):
            continue  # vor Einfuehrung der Trailer
        for problem in message_problems(commit["message"], scopes):
            problems.append("{} {}: {}".format(commit["sha"][:7], commit["subject"][:50], problem))
    if problems:
        raise ReleaseNotesError("\n".join(problems))
    head = versioned[-1]["version"] if versioned else tag[1:]
    print("release notes ok: {} Releases, {} = {}".format(len(document["releases"]), rev[:12], head))


def cmd_check_release(args):
    rev = git("rev-parse", "--verify", args.rev + "^{commit}").strip()
    document = load_document(rev=rev)
    problems = document_problems(document)
    if problems:
        raise ReleaseNotesError("\n".join(problems))
    version = version_at(document, rev)
    subject = git("log", "-1", "--format=%s", rev).strip()
    changed = git("diff-tree", "--no-commit-id", "--name-only", "-r", rev).split()
    top = document["releases"][0]["version"] if document["releases"] else None
    problems = release_commit_problems(version, subject, changed, top, NOTES_FILE)
    if problems:
        raise ReleaseNotesError("{}: {}".format(rev[:12], "\n".join(problems)))
    print("release notes {} passen zu {}".format(version, rev[:12]))


def cmd_tag(args):
    rev = git("rev-parse", "--verify", args.rev + "^{commit}").strip()
    document = load_document(rev=rev)
    name = "v" + version_at(document, rev)
    if tag_exists(name):
        target = git("rev-list", "-n", "1", name).strip()
        if target != rev:
            raise ReleaseNotesError("Tag {} zeigt bereits auf {}".format(name, target[:12]))
        print("Tag {} besteht bereits".format(name))
        return
    git("tag", "-a", name, rev, "-m", "{} {}".format(document["app"], name))
    print("Tag {} auf {} gesetzt".format(name, rev[:12]))


def cmd_check_msg(args):
    with open(args.file, encoding="utf-8") as handle:
        message = handle.read()
    problems = message_problems(message, list(load_document().get("scopes") or {}))
    if problems:
        raise ReleaseNotesError(
            "Commit-Nachricht unvollstaendig (docs/release-notes.md):\n  - " + "\n  - ".join(problems)
        )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command")
    sub.required = True
    command = sub.add_parser("version", help="berechnete Version eines Commits")
    command.add_argument("rev", nargs="?", default="HEAD")
    command.set_defaults(func=cmd_version)
    command = sub.add_parser("changes", help="Entwicklungsstand seit dem letzten Tag")
    command.add_argument("rev", nargs="?", default="HEAD")
    command.set_defaults(func=cmd_changes)
    command = sub.add_parser("draft", help="Release-Eintrag fuer HEAD entwerfen")
    command.add_argument("--date")
    command.set_defaults(func=cmd_draft)
    command = sub.add_parser("check", help="Schema und Trailer seit dem letzten Tag pruefen")
    command.add_argument("rev", nargs="?")
    command.set_defaults(func=cmd_check)
    command = sub.add_parser("check-release", help="Commit ist ein passender Release-Commit")
    command.add_argument("rev")
    command.set_defaults(func=cmd_check_release)
    command = sub.add_parser("tag", help="Versions-Tag nach erfolgreichem Deploy setzen")
    command.add_argument("rev")
    command.set_defaults(func=cmd_tag)
    command = sub.add_parser("check-msg", help="commit-msg-Hook")
    command.add_argument("file")
    command.set_defaults(func=cmd_check_msg)
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except ReleaseNotesError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
