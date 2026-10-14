"""Katalog der Workspace-Einträge (Tools und Reports).

Einzige Quelle für die Karten auf /tools. Sichtbarkeit wird hier aufgelöst,
die Einträge selbst bleiben reine Daten, damit der Katalog später auch als JSON
im Dashboard ausgeliefert werden kann.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.authz import AuthorizationContext


@dataclass(frozen=True)
class WorkspaceItem:
    id: str
    kind: str  # "tool" | "report"
    href: str
    icon: str
    label: str  # kurze Einordnung, steht neben dem Titel
    title: str
    copy: str  # nur als Tooltip, nicht als Text auf der Karte
    permission: str | None = None
    admin_only: bool = False
    needs_agent_stats: bool = False


CATALOG: tuple[WorkspaceItem, ...] = (
    WorkspaceItem(
        id="request-templates", kind="tool", href="/tools/request-templates", icon="add.png",
        label="Dokumente", title="Berechtigungsformulare",
        copy="Vorlagen verwalten und ausgefüllte Dokumente (Word & PDF) erzeugen.",
        permission="SOFA-TOOL-FORM",
    ),
    WorkspaceItem(
        id="datex", kind="tool", href="/tools/datex", icon="process.png",
        label="Abrechnung", title="DAT-Export Check",
        copy="Debit- und Kredit-DAT-Dateien prüfen, fehlerhafte Zeilen entfernen und korrigiert exportieren.",
        permission="SOFA-TOOL-DATX",
    ),
    WorkspaceItem(
        id="genesys-queue-manager", kind="tool", href="/tools/genesys-queue-manager", icon="software.png",
        label="Steuerung", title="Queue Manager",
        copy="Warteschleifen in Genesys Cloud beobachten & verwalten",
        permission="SOFA-TOOL-GQ",
    ),
    WorkspaceItem(
        id="zeitkorrektur", kind="tool", href="/tools/zeitkorrektur", icon="software.png",
        label="Zeiterfassung", title="Zeitkorrektur",
        copy="Statuszeiten von Mitarbeitern für heute und gestern korrigieren, bevor sie an Opcyc gehen.",
        permission="SOFA-TOOL-ZK",
    ),
    WorkspaceItem(
        id="stoerungsprotokoll", kind="tool", href="/tools/stoerungsprotokoll", icon="process.png",
        label="Notfall", title="Störungsprotokoll",
        copy="Betriebliche Störungen erfassen, verfolgen und archivieren.",
        permission="SOFA-TOOL-SLOG",
    ),
    WorkspaceItem(
        id="media-blocking", kind="tool", href="/tools/media-blocking", icon="software.png",
        label="Demo", title="Sperrmaske",
        copy="Demo eines neuen Workflows zur Bearbeitung von Sperranfragen. Nur für Admins sichtbar.",
        admin_only=True,
    ),
    WorkspaceItem(
        id="genesys-live", kind="report", href="/tools/genesys-live", icon="process.png",
        label="Live", title="Genesys Cloud Live",
        copy="Besetzung und Anwesenheit der Queues in Echtzeit.",
        needs_agent_stats=True,
    ),
    WorkspaceItem(
        id="agent-stats", kind="report", href="/tools/agent-stats", icon="process.png",
        label="Persönlich", title="Meine Genesys-Zahlen",
        copy="Eigene Telefonie und Statuszeiten für Tag und Monat.",
        needs_agent_stats=True,
    ),
    WorkspaceItem(
        id="iks", kind="report", href="/tools/iks", icon="roles.png",
        label="IKS", title="IKS Kontrollberichte",
        copy="Prozesse, Rollen und dokumentierte Systemzugriffe kontrollieren und auditsicher exportieren.",
        permission="SOFA-TOOL-IKS",
    ),
    WorkspaceItem(
        id="ivr-call-details", kind="report", href="/tools/ivr-call-details", icon="process.png",
        label="IVR", title="IVR Call-Detailreport",
        copy="Calls beider Servicerufnummern mit ihrem vollständigen Routingverlauf analysieren.",
        permission="SOFA-RPRT-TIVR",
    ),
    WorkspaceItem(
        id="presence-report", kind="report", href="/tools/presence-report", icon="process.png",
        label="Presence", title="Presence-Report",
        copy="Statuszeiten und Statuswechsel der Mitarbeiter je Tag auswerten.",
        permission="SOFA-RPRT-PRSNC",
    ),
    WorkspaceItem(
        id="token-deletion-report", kind="report", href="/tools/token-deletion-report", icon="process.png",
        label="Token", title="Tokenlöschungs-Report",
        copy="Tokenlöschungen als schnelle Tages- und Monatssummen auswerten.",
        permission="SOFA-RPRT-PRSNC",
    ),
    WorkspaceItem(
        id="logon-log", kind="report", href="/tools/logon-log", icon="process.png",
        label="Anmeldungen", title="Anmeldeprotokoll",
        copy="Client-Anmeldungen auswerten und Parallelzugriffe prüfen.",
        permission="SOFA-RPRT-LL",
    ),
)


def is_visible(item: WorkspaceItem, authz: AuthorizationContext, agent_stats_configured: bool) -> bool:
    if item.admin_only and not authz.has_admin_access():
        return False
    if item.needs_agent_stats and not agent_stats_configured:
        return False
    if item.permission and not authz.has_permission(item.permission):
        return False
    return True


def visible_items(authz: AuthorizationContext, agent_stats_configured: bool) -> dict[str, list[WorkspaceItem]]:
    visible = [item for item in CATALOG if is_visible(item, authz, agent_stats_configured)]
    return {
        "tools": [item for item in visible if item.kind == "tool"],
        "reports": [item for item in visible if item.kind == "report"],
    }
