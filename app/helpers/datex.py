from datetime import datetime
from io import BytesIO

import pandas as pd


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


def parse_dat_record(record: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    position = 0
    for field_name, field_length in DAT_FIELDS:
        parsed[field_name] = record[position:position + field_length].strip()
        position += field_length
    return parsed


def decode_dat_payload(payload: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Die DAT-Datei konnte nicht gelesen werden.")


def build_datex_export(dat_payload: bytes) -> tuple[str, BytesIO]:
    data = decode_dat_payload(dat_payload)
    trimmed_data = data[DAT_RECORD_LENGTH:-DAT_RECORD_LENGTH]
    records = [
        trimmed_data[i:i + DAT_RECORD_LENGTH]
        for i in range(0, len(trimmed_data), DAT_RECORD_LENGTH)
    ]
    valid_records = [
        record for record in records
        if len(record) == DAT_RECORD_LENGTH and record.startswith("D")
    ]

    if not valid_records:
        raise ValueError("Keine gueltigen DAT-Datensaetze gefunden.")

    dataframe = pd.DataFrame(parse_dat_record(record) for record in valid_records)
    dataframe["Menge"] = pd.to_numeric(dataframe["Menge"], errors="coerce")

    workbook = BytesIO()
    with pd.ExcelWriter(workbook, engine="openpyxl") as writer:
        dataframe.to_excel(writer, index=False, sheet_name="DAT Export")

    workbook.seek(0)
    filename = f"DATExport_{datetime.now().strftime('%Y%m%d')}.xlsx"
    return filename, workbook
