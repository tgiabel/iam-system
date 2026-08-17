from __future__ import annotations

import csv
from io import BytesIO, TextIOWrapper
from pathlib import Path
import unittest
from zipfile import ZipFile

from app.helpers.datex import (
    DAT_FIELDS,
    DAT_RECORD_LENGTH,
    build_corrected_dat,
    build_corrected_package,
    build_datex_preview,
    parse_dat_payload,
)


def make_record(**overrides: str) -> bytes:
    values = {
        "Satzart": "D",
        "BLZ": "12345678",
        "Filiale": "0001",
        "KTONr": "0000000000000001",
        "Kartenart": "K",
        "Kartenfolgenummer": "00",
        "Leistungsnummer": "000000000000000001",
        "Menge": "0000000001",
        "Mengeneinheit": "LE ",
        "Betrag": "00000064",
        "Preiseinheit": "000001",
        "Sperrdatum": "20260801",
        "Uhrzeit": "120000",
        "Nachname": "MUSTER",
        "Vorname": "MAX",
        "Reserve": "",
    }
    values.update(overrides)
    record = "".join(values[name].ljust(length)[:length] for name, length in DAT_FIELDS).encode("latin-1")
    assert len(record) == DAT_RECORD_LENGTH
    return record


def make_payload(records: list[bytes], footer_count: int | None = None, footer_menge: int | None = None) -> bytes:
    header = b"VTEST".ljust(DAT_RECORD_LENGTH, b" ")
    count = len(records) if footer_count is None else footer_count
    menge = sum(int(record[50:60]) for record in records) if footer_menge is None else footer_menge
    footer = (b"N" + f"{count:010d}{menge:010d}".encode("ascii")).ljust(DAT_RECORD_LENGTH, b" ")
    return header + b"".join(records) + footer


class DatexParserTests(unittest.TestCase):
    def test_preview_parses_rows_and_totals(self):
        payload = make_payload([
            make_record(BLZ="11111111", Menge="0000000004"),
            make_record(BLZ="22222222", Menge="0000000007"),
        ])

        preview = build_datex_preview(payload)

        self.assertEqual(preview["row_count"], 2)
        self.assertEqual(preview["menge_total"], 11)
        self.assertEqual(preview["warnings"], [])
        self.assertEqual(preview["flagged_row_count"], 0)
        self.assertEqual(preview["finding_count"], 0)
        self.assertEqual(preview["records"][0]["fields"]["BLZ"], "11111111")
        self.assertEqual(len(preview["records"][0]["raw"]), DAT_RECORD_LENGTH)

    def test_footer_mismatches_are_warnings(self):
        payload = make_payload([make_record(Menge="0000000003")], footer_count=2, footer_menge=99)

        parsed = parse_dat_payload(payload)

        self.assertEqual(len(parsed.warnings), 2)
        self.assertIn("2 Datensaetze", parsed.warnings[0])
        self.assertIn("99", parsed.warnings[1])

    def test_latin_1_names_are_decoded_without_changing_record_width(self):
        payload = make_payload([make_record(Nachname="MÜLLER")])

        preview = build_datex_preview(payload)

        self.assertEqual(preview["records"][0]["fields"]["Nachname"], "MÜLLER")
        self.assertEqual(len(preview["records"][0]["raw"].encode("latin-1")), DAT_RECORD_LENGTH)

    def test_rejects_incomplete_and_non_data_records(self):
        with self.assertRaisesRegex(ValueError, "Vielfaches"):
            parse_dat_payload(make_payload([make_record()]) + b"x")

        invalid_record = b"X" + make_record()[1:]
        with self.assertRaisesRegex(ValueError, "mit 'D'"):
            parse_dat_payload(make_payload([invalid_record]))

    def test_reports_non_numeric_menge_without_rejecting_preview(self):
        payload = make_payload([make_record(Menge="nichtzahl")], footer_menge=0)

        parsed = parse_dat_payload(payload)
        preview = build_datex_preview(payload)

        self.assertIsNone(parsed.calculated_menge_total)
        self.assertEqual(parsed.invalid_menge_indices, (0,))
        self.assertIsNone(preview["menge_total"])
        self.assertEqual(preview["invalid_menge_indices"], [0])
        self.assertIn("Menge", {finding["field"] for finding in preview["records"][0]["findings"]})
        self.assertTrue(any("Mengensumme" in warning for warning in preview["warnings"]))

    def test_preview_reports_numeric_timestamp_and_name_findings(self):
        payload = make_payload([
            make_record(
                BLZ="00000000",
                KTONr="123456789012345X",
                Leistungsnummer="0000000000000000A1",
                Menge="nichtzahl",
                Betrag="00000X64",
                Sperrdatum="20260230",
                Uhrzeit="250000",
                Nachname="NICO,A",
                Vorname="",
            ),
        ], footer_menge=0)

        findings = build_datex_preview(payload)["records"][0]["findings"]
        finding_codes = {(finding["field"], finding["code"]) for finding in findings}

        self.assertIn(("BLZ", "zero"), finding_codes)
        self.assertIn(("KTONr", "invalid_numeric"), finding_codes)
        self.assertIn(("Leistungsnummer", "invalid_numeric"), finding_codes)
        self.assertIn(("Menge", "invalid_numeric"), finding_codes)
        self.assertIn(("Betrag", "invalid_numeric"), finding_codes)
        self.assertIn(("Sperrdatum", "invalid_timestamp"), finding_codes)
        self.assertIn(("Nachname", "invalid_characters"), finding_codes)
        self.assertIn(("Vorname", "empty"), finding_codes)

    def test_name_question_mark_and_permitted_name_characters_are_valid(self):
        payload = make_payload([make_record(Nachname="O'NEIL-SR.?", Vorname="DR. ANNA")])

        findings = build_datex_preview(payload)["records"][0]["findings"]

        self.assertFalse({finding["field"] for finding in findings} & {"Nachname", "Vorname"})

    def test_blank_and_short_numeric_values_are_findings(self):
        payload = make_payload([make_record(BLZ="1234567", KTONr="", Leistungsnummer="", Betrag="")])

        fields_with_findings = {
            finding["field"] for finding in build_datex_preview(payload)["records"][0]["findings"]
        }

        self.assertTrue({"BLZ", "KTONr", "Leistungsnummer", "Betrag"}.issubset(fields_with_findings))

    def test_non_numeric_date_and_time_formats_are_findings(self):
        payload = make_payload([make_record(Sperrdatum="20260A01", Uhrzeit="1200X0")])

        finding_codes = {
            (finding["field"], finding["code"])
            for finding in build_datex_preview(payload)["records"][0]["findings"]
        }

        self.assertIn(("Sperrdatum", "invalid_date"), finding_codes)
        self.assertIn(("Uhrzeit", "invalid_time"), finding_codes)


class DatexExportTests(unittest.TestCase):
    def setUp(self):
        self.records = [
            make_record(BLZ="11111111", Menge="0000000004"),
            make_record(BLZ="22222222", Menge="0000000007"),
            make_record(BLZ="11111111", Menge="0000000009"),
        ]
        self.payload = make_payload(self.records)

    def test_corrected_dat_preserves_header_order_and_record_width(self):
        corrected, _parsed, removed = build_corrected_dat(self.payload, [2, 0])

        self.assertEqual(removed, (0, 2))
        self.assertEqual(corrected[:DAT_RECORD_LENGTH], self.payload[:DAT_RECORD_LENGTH])
        self.assertEqual(corrected[DAT_RECORD_LENGTH:2 * DAT_RECORD_LENGTH], self.records[1])
        self.assertEqual(len(corrected) % DAT_RECORD_LENGTH, 0)
        self.assertEqual(corrected[-DAT_RECORD_LENGTH:-DAT_RECORD_LENGTH + 21], b"N00000000010000000007")

    def test_rejects_missing_duplicate_and_out_of_range_indices(self):
        with self.assertRaisesRegex(ValueError, "kein Datensatz"):
            build_corrected_dat(self.payload, [])
        with self.assertRaisesRegex(ValueError, "mehrfach"):
            build_corrected_dat(self.payload, [0, 0])
        with self.assertRaisesRegex(ValueError, "ausserhalb"):
            build_corrected_dat(self.payload, [3])

    def test_requires_removal_of_all_invalid_menge_rows_before_export(self):
        records = [
            make_record(Menge="nichtzahl"),
            make_record(Menge="0000000007"),
        ]
        payload = make_payload(records, footer_menge=7)

        with self.assertRaisesRegex(ValueError, "ungueltiger Menge"):
            build_corrected_dat(payload, [1])

        corrected, parsed, removed = build_corrected_dat(payload, [0])
        self.assertEqual(removed, (0,))
        self.assertEqual(parsed.invalid_menge_indices, (0,))
        self.assertEqual(corrected[DAT_RECORD_LENGTH:2 * DAT_RECORD_LENGTH], records[1])
        self.assertEqual(corrected[-DAT_RECORD_LENGTH:-DAT_RECORD_LENGTH + 21], b"N00000000010000000007")

    def test_non_footer_validation_findings_do_not_block_export_or_change_kept_raw_record(self):
        records = [
            make_record(BLZ="00000000", KTONr="0000000000000001"),
            make_record(BLZ="12345678", KTONr="0000000000000002"),
        ]
        payload = make_payload(records)

        corrected, _parsed, _removed = build_corrected_dat(payload, [1])

        self.assertEqual(corrected[DAT_RECORD_LENGTH:2 * DAT_RECORD_LENGTH], records[0])
        self.assertEqual(corrected[-DAT_RECORD_LENGTH:-DAT_RECORD_LENGTH + 21], b"N00000000010000000001")

    def test_package_contains_corrected_dat_and_audit_csv(self):
        package_name, package = build_corrected_package(self.payload, [0, 2], "Monat Kredit.dat")

        self.assertEqual(package_name, "Monat_Kredit_korrigiert.zip")
        with ZipFile(package) as archive:
            self.assertEqual(
                set(archive.namelist()),
                {"Monat_Kredit_korrigiert.dat", "Monat_Kredit_entfernte_zeilen.csv"},
            )
            corrected = archive.read("Monat_Kredit_korrigiert.dat")
            self.assertEqual(corrected[-DAT_RECORD_LENGTH:-DAT_RECORD_LENGTH + 21], b"N00000000010000000007")

            csv_bytes = archive.read("Monat_Kredit_entfernte_zeilen.csv")
            with TextIOWrapper(BytesIO(csv_bytes), encoding="utf-8-sig", newline="") as csv_file:
                rows = list(csv.DictReader(csv_file, delimiter=";"))
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]["BLZ"], "11111111")
            self.assertEqual(rows[0]["Datensaetze_entfernt"], "2")
            self.assertEqual(rows[0]["Menge_korrigiert"], "7")
            self.assertEqual(rows[0]["Pruefhinweise"], "")

    def test_audit_csv_contains_server_side_validation_findings(self):
        records = [
            make_record(BLZ="00000000", Menge="nichtzahl"),
            make_record(Menge="0000000007"),
        ]
        payload = make_payload(records, footer_menge=7)

        _package_name, package = build_corrected_package(payload, [0], "fehlerhaft.dat")

        with ZipFile(package) as archive:
            csv_bytes = archive.read("fehlerhaft_entfernte_zeilen.csv")
            with TextIOWrapper(BytesIO(csv_bytes), encoding="utf-8-sig", newline="") as csv_file:
                rows = list(csv.DictReader(csv_file, delimiter=";"))
        self.assertIn("BLZ: BLZ muss groesser als 0 sein.", rows[0]["Pruefhinweise"])
        self.assertIn("Menge: Menge muss aus genau 10 Ziffern bestehen.", rows[0]["Pruefhinweise"])
        self.assertEqual(rows[0]["Menge_original"], "nicht berechenbar")
        self.assertEqual(rows[0]["Menge_entfernt"], "nicht berechenbar")

    def test_supplied_kredit_fixture_matches_footer(self):
        fixture = Path(__file__).parents[1] / "misc/datex/SPEDGVerlag_Kredit_2026_07-01_2026_08-01.dat"
        payload = fixture.read_bytes()
        parsed = parse_dat_payload(payload)

        self.assertEqual(len(parsed.records), 5686)
        self.assertEqual(parsed.calculated_menge_total, 1_009_557)
        self.assertEqual(parsed.warnings, ())

        preview = build_datex_preview(payload)
        ktonr_findings = sum(
            1
            for record in preview["records"]
            for finding in record["findings"]
            if finding["field"] == "KTONr"
        )
        self.assertEqual(ktonr_findings, 26)

        corrected, _parsed, _removed = build_corrected_dat(payload, [0, 1])
        self.assertEqual(corrected[-DAT_RECORD_LENGTH:-DAT_RECORD_LENGTH + 21], b"N00000056840001009108")


if __name__ == "__main__":
    unittest.main()
