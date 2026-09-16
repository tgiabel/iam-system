"""Fachliche Datumsgrenzen von SOFA, unabhaengig von der Container-Zeitzone."""

from datetime import datetime
from zoneinfo import ZoneInfo


LOCAL_TIMEZONE = ZoneInfo("Europe/Berlin")


def now_local() -> datetime:
    return datetime.now(LOCAL_TIMEZONE)


def today_local():
    return now_local().date()
