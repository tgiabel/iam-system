from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO, StringIO
from pathlib import Path
import re
from typing import Iterable
from zipfile import ZIP_DEFLATED, ZipFile


DAT_RECORD_LENGTH = 207
DAT_FIELDS = [
    ("Satzart", 1),
    ("BLZ", 8),
    ("Filiale", 4),
    ("KTONr", 16),
    ("Kartenart", 1),
    ("Kartenfolgenummer", 2),
    ("Leistungsnummer", 18),
    ("Menge", 10),
    ("Mengeneinheit", 3),
    ("Betrag", 8),
    ("Preiseinheit", 6),
    ("Sperrdatum", 8),
    ("Uhrzeit", 6),
    ("Nachname", 40),
    ("Vorname", 20),
    ("Reserve", 56),
]
FOOTER_COUNT_SLICE = slice(1, 11)
FOOTER_MENGE_SLICE = slice(11, 21)
MENGE_FIELD_SLICE = slice(50, 60)


def _field_slices() -> dict[str, slice]:
    position = 0
    slices: dict[str, slice] = {}
    for field_name, field_length in DAT_FIELDS:
        slices[field_name] = slice(position, position + field_length)
        position += field_length
    return slices


DAT_FIELD_SLICES = _field_slices()


@dataclass(frozen=True)
class ParsedDatFile:
    header: bytes
    records: tuple[bytes, ...]
    footer: bytes
    encoding: str
    footer_row_count: int
    footer_menge_total: int
    calculated_menge_total: int | None
    invalid_menge_indices: tuple[int, ...]
    warnings: tuple[str, ...]


def _display_encoding(payload: bytes) -> str:
    try:
        payload.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        return "latin-1"


def _decode_display(value: bytes, encoding: str) -> str:
    try:
        return value.decode(encoding).strip()
    except UnicodeDecodeError:
        return value.decode("latin-1").strip()


def _decode_raw(value: bytes, encoding: str) -> str:
    try:
        return value.decode(encoding)
    except UnicodeDecodeError:
        return value.decode("latin-1")


def parse_dat_record(record: bytes | str, encoding: str = "latin-1") -> dict[str, str]:
    if isinstance(record, str):
        raw_record = record.encode(encoding)
    else:
        raw_record = record

    if len(raw_record) != DAT_RECORD_LENGTH:
        raise ValueError(f"DAT-Datensaetze muessen genau {DAT_RECORD_LENGTH} Byte lang sein.")

    parsed: dict[str, str] = {}
    position = 0
    for field_name, field_length in DAT_FIELDS:
        field_value = raw_record[position:position + field_length]
        parsed[field_name] = _decode_display(field_value, encoding)
        position += field_length
    return parsed


def _parse_numeric_field(value: bytes, label: str) -> int:
    try:
        text = value.decode("ascii")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{label} enthaelt ungueltige Zeichen.") from exc

    if not text.isdigit():
        raise ValueError(f"{label} muss aus genau 10 Ziffern bestehen.")
    return int(text)


def _parse_menge_value(value: bytes) -> int | None:
    try:
        text = value.decode("ascii")
    except UnicodeDecodeError:
        return None
    return int(text) if text.isdigit() else None


def _validation_finding(field: str, code: str, message: str) -> dict[str, str]:
    return {"field": field, "code": code, "message": message}


def _has_exact_ascii_digits(value: bytes, length: int) -> bool:
    return len(value) == length and all(ord("0") <= byte <= ord("9") for byte in value)


def _validate_numeric_field(
    record: bytes,
    field_name: str,
    field_length: int,
    findings: list[dict[str, str]],
) -> None:
    value = record[DAT_FIELD_SLICES[field_name]]
    if not _has_exact_ascii_digits(value, field_length):
        findings.append(
            _validation_finding(
                field_name,
                "invalid_numeric",
                f"{field_name} muss aus genau {field_length} Ziffern bestehen.",
            )
        )


def _validate_name_field(
    fields: dict[str, str],
    field_name: str,
    findings: list[dict[str, str]],
) -> None:
    value = fields[field_name]
    if not value:
        findings.append(_validation_finding(field_name, "empty", f"{field_name} darf nicht leer sein."))
        return

    allowed_characters = {" ", "-", "'", ".", "?"}
    invalid_characters = sorted({character for character in value if not character.isalpha() and character not in allowed_characters})
    if invalid_characters:
        rendered_characters = ", ".join(repr(character) for character in invalid_characters)
        findings.append(
            _validation_finding(
                field_name,
                "invalid_characters",
                f"{field_name} enthaelt nicht zulaessige Zeichen: {rendered_characters}.",
            )
        )


def validate_dat_record(record: bytes, encoding: str) -> list[dict[str, str]]:
    """Return non-blocking field findings for a structurally valid data record."""
    fields = parse_dat_record(record, encoding)
    findings: list[dict[str, str]] = []

    _validate_numeric_field(record, "BLZ", 8, findings)
    if _has_exact_ascii_digits(record[DAT_FIELD_SLICES["BLZ"]], 8) and int(record[DAT_FIELD_SLICES["BLZ"]]) == 0:
        findings.append(_validation_finding("BLZ", "zero", "BLZ muss groesser als 0 sein."))
    _validate_numeric_field(record, "KTONr", 16, findings)
    _validate_numeric_field(record, "Leistungsnummer", 18, findings)
    _validate_numeric_field(record, "Menge", 10, findings)
    _validate_numeric_field(record, "Betrag", 8, findings)

    date_value = record[DAT_FIELD_SLICES["Sperrdatum"]]
    time_value = record[DAT_FIELD_SLICES["Uhrzeit"]]
    has_valid_date_format = _has_exact_ascii_digits(date_value, 8)
    has_valid_time_format = _has_exact_ascii_digits(time_value, 6)
    if not has_valid_date_format:
        findings.append(
            _validation_finding("Sperrdatum", "invalid_date", "Sperrdatum muss das Format JJJJMMTT haben.")
        )
    if not has_valid_time_format:
        findings.append(
            _validation_finding("Uhrzeit", "invalid_time", "Uhrzeit muss das Format HHMMSS haben.")
        )
    if has_valid_date_format and has_valid_time_format:
        try:
            datetime.strptime((date_value + time_value).decode("ascii"), "%Y%m%d%H%M%S")
        except ValueError:
            findings.append(
                _validation_finding(
                    "Sperrdatum",
                    "invalid_timestamp",
                    "Sperrdatum und Uhrzeit ergeben keinen gueltigen Zeitpunkt.",
                )
            )

    _validate_name_field(fields, "Nachname", findings)
    _validate_name_field(fields, "Vorname", findings)
    return findings


def parse_dat_payload(payload: bytes) -> ParsedDatFile:
    if not payload:
        raise ValueError("Die DAT-Datei ist leer.")
    if len(payload) % DAT_RECORD_LENGTH:
        raise ValueError(
            f"Die Dateigroesse ist kein Vielfaches von {DAT_RECORD_LENGTH} Byte. "
            "Zeilenumbrueche oder ein unvollstaendiger Datensatz sind nicht erlaubt."
        )

    raw_records = tuple(
        payload[position:position + DAT_RECORD_LENGTH]
        for position in range(0, len(payload), DAT_RECORD_LENGTH)
    )
    if len(raw_records) < 3:
        raise ValueError("Die DAT-Datei muss Kopf-, Daten- und Fussdatensatz enthalten.")

    header, *data_records, footer = raw_records
    if not header.startswith(b"V"):
        raise ValueError("Der Kopfdatensatz muss mit 'V' beginnen.")
    if not footer.startswith(b"N"):
        raise ValueError("Der Fussdatensatz muss mit 'N' beginnen.")

    encoding = _display_encoding(payload)
    menge_total = 0
    invalid_menge_indices: list[int] = []
    for index, record in enumerate(data_records, start=1):
        if not record.startswith(b"D"):
            raise ValueError(f"Datensatz {index} muss mit 'D' beginnen.")
        menge_value = _parse_menge_value(record[MENGE_FIELD_SLICE])
        if menge_value is None:
            invalid_menge_indices.append(index - 1)
        else:
            menge_total += menge_value

    footer_row_count = _parse_numeric_field(footer[FOOTER_COUNT_SLICE], "Datensatzanzahl im Fussdatensatz")
    footer_menge_total = _parse_numeric_field(footer[FOOTER_MENGE_SLICE], "Mengensumme im Fussdatensatz")

    warnings: list[str] = []
    if footer_row_count != len(data_records):
        warnings.append(
            f"Der Fussdatensatz nennt {footer_row_count} Datensaetze, "
            f"gefunden wurden {len(data_records)}."
        )
    if invalid_menge_indices:
        warnings.append(
            "Die Mengensumme kann wegen ungueltiger Menge-Werte in Datenzeilen nicht vollstaendig geprueft werden."
        )
    elif footer_menge_total != menge_total:
        warnings.append(
            f"Der Fussdatensatz nennt die Mengensumme {footer_menge_total}, "
            f"berechnet wurden {menge_total}."
        )

    return ParsedDatFile(
        header=header,
        records=tuple(data_records),
        footer=footer,
        encoding=encoding,
        footer_row_count=footer_row_count,
        footer_menge_total=footer_menge_total,
        calculated_menge_total=None if invalid_menge_indices else menge_total,
        invalid_menge_indices=tuple(invalid_menge_indices),
        warnings=tuple(warnings),
    )


def build_datex_preview(payload: bytes) -> dict[str, object]:
    parsed_file = parse_dat_payload(payload)
    records: list[dict[str, object]] = []

    for index, raw_record in enumerate(parsed_file.records):
        fields = parse_dat_record(raw_record, parsed_file.encoding)
        menge_value = _parse_menge_value(raw_record[MENGE_FIELD_SLICE])
        findings = validate_dat_record(raw_record, parsed_file.encoding)
        records.append(
            {
                "index": index,
                "file_row": index + 2,
                "fields": fields,
                "menge_value": menge_value,
                "findings": findings,
                "raw": _decode_raw(raw_record, parsed_file.encoding),
            }
        )

    return {
        "record_length": DAT_RECORD_LENGTH,
        "row_count": len(parsed_file.records),
        "menge_total": parsed_file.calculated_menge_total,
        "flagged_row_count": sum(bool(record["findings"]) for record in records),
        "finding_count": sum(len(record["findings"]) for record in records),
        "invalid_menge_indices": list(parsed_file.invalid_menge_indices),
        "footer_row_count": parsed_file.footer_row_count,
        "footer_menge_total": parsed_file.footer_menge_total,
        "warnings": list(parsed_file.warnings),
        "records": records,
    }


def _normalize_removed_indices(indices: Iterable[int], record_count: int) -> tuple[int, ...]:
    normalized: list[int] = []
    seen: set[int] = set()
    for index in indices:
        if isinstance(index, bool) or not isinstance(index, int):
            raise ValueError("Entfernte Datensatznummern muessen Ganzzahlen sein.")
        if index < 0 or index >= record_count:
            raise ValueError(f"Datensatznummer {index} liegt ausserhalb der Datei.")
        if index in seen:
            raise ValueError(f"Datensatznummer {index} wurde mehrfach uebermittelt.")
        seen.add(index)
        normalized.append(index)
    return tuple(sorted(normalized))


def _build_footer(original_footer: bytes, row_count: int, menge_total: int) -> bytes:
    if row_count > 9_999_999_999 or menge_total > 9_999_999_999:
        raise ValueError("Datensatzanzahl oder Mengensumme passt nicht in das 10-stellige Fussformat.")
    footer = b"N" + f"{row_count:010d}{menge_total:010d}".encode("ascii") + original_footer[21:]
    if len(footer) != DAT_RECORD_LENGTH:
        raise ValueError("Der Fussdatensatz konnte nicht im 207-Byte-Format erzeugt werden.")
    return footer


def build_corrected_dat(payload: bytes, removed_indices: Iterable[int]) -> tuple[bytes, ParsedDatFile, tuple[int, ...]]:
    parsed_file = parse_dat_payload(payload)
    removed = _normalize_removed_indices(removed_indices, len(parsed_file.records))
    if not removed:
        raise ValueError("Es wurde kein Datensatz zum Entfernen ausgewaehlt.")

    removed_set = set(removed)
    invalid_menge_indices = set(parsed_file.invalid_menge_indices)
    unremoved_invalid_menge_indices = invalid_menge_indices - removed_set
    if unremoved_invalid_menge_indices:
        raise ValueError(
            "Zeilen mit ungueltiger Menge muessen vor dem Export vollstaendig vorgemerkt werden."
        )
    kept_records = [record for index, record in enumerate(parsed_file.records) if index not in removed_set]
    corrected_menge = sum(_parse_numeric_field(record[MENGE_FIELD_SLICE], "Menge") for record in kept_records)
    footer = _build_footer(parsed_file.footer, len(kept_records), corrected_menge)
    corrected_payload = parsed_file.header + b"".join(kept_records) + footer
    return corrected_payload, parsed_file, removed


def _safe_export_stem(source_filename: str) -> str:
    source_name = Path(source_filename or "DATExport.dat").name
    stem = Path(source_name).stem
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    return safe_stem or "DATExport"


def _csv_safe(value: object) -> object:
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def _build_audit_csv(
    source_filename: str,
    parsed_file: ParsedDatFile,
    removed: tuple[int, ...],
) -> bytes:
    removed_records = [parsed_file.records[index] for index in removed]
    removed_menge_values = [_parse_menge_value(record[MENGE_FIELD_SLICE]) for record in removed_records]
    removed_menge = None if any(value is None for value in removed_menge_values) else sum(removed_menge_values)
    corrected_count = len(parsed_file.records) - len(removed)
    kept_records = [record for index, record in enumerate(parsed_file.records) if index not in set(removed)]
    corrected_menge = sum(_parse_numeric_field(record[MENGE_FIELD_SLICE], "Menge") for record in kept_records)

    summary_fields = [
        "Quelldatei",
        "Datensaetze_original",
        "Datensaetze_entfernt",
        "Datensaetze_korrigiert",
        "Menge_original",
        "Menge_entfernt",
        "Menge_korrigiert",
        "Pruefhinweise",
    ]
    fieldnames = ["Dateizeile", *summary_fields, *(name for name, _ in DAT_FIELDS), "Rohdatensatz"]
    output = StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fieldnames, delimiter=";", lineterminator="\r\n")
    writer.writeheader()

    for index, raw_record in zip(removed, removed_records):
        fields = parse_dat_record(raw_record, parsed_file.encoding)
        findings = validate_dat_record(raw_record, parsed_file.encoding)
        row: dict[str, object] = {
            "Dateizeile": index + 2,
            "Quelldatei": Path(source_filename).name,
            "Datensaetze_original": len(parsed_file.records),
            "Datensaetze_entfernt": len(removed),
            "Datensaetze_korrigiert": corrected_count,
            "Menge_original": parsed_file.calculated_menge_total
            if parsed_file.calculated_menge_total is not None
            else "nicht berechenbar",
            "Menge_entfernt": removed_menge if removed_menge is not None else "nicht berechenbar",
            "Menge_korrigiert": corrected_menge,
            "Pruefhinweise": " | ".join(
                f"{finding['field']}: {finding['message']}" for finding in findings
            ),
            **fields,
            "Rohdatensatz": _decode_raw(raw_record, parsed_file.encoding),
        }
        writer.writerow({key: _csv_safe(value) for key, value in row.items()})

    return ("\ufeff" + output.getvalue()).encode("utf-8")


def build_corrected_package(
    payload: bytes,
    removed_indices: Iterable[int],
    source_filename: str,
) -> tuple[str, BytesIO]:
    corrected_payload, parsed_file, removed = build_corrected_dat(payload, removed_indices)
    safe_stem = _safe_export_stem(source_filename)
    dat_filename = f"{safe_stem}_korrigiert.dat"
    audit_filename = f"{safe_stem}_entfernte_zeilen.csv"
    package_filename = f"{safe_stem}_korrigiert.zip"

    package = BytesIO()
    with ZipFile(package, mode="w", compression=ZIP_DEFLATED) as archive:
        archive.writestr(dat_filename, corrected_payload)
        archive.writestr(
            audit_filename,
            _build_audit_csv(source_filename, parsed_file, removed),
        )
    package.seek(0)
    return package_filename, package
