import json
from pathlib import Path

OVERLAY_TEMPLATES = json.load(open(Path(__file__).parent / "config" / "overlays.json"))

class OverlayBuilder:
    def __init__(self, title="", status="", status_text="", overlay_id="", form=False, form_action=""):
        self.title = title
        self.status = status
        self.status_text = status_text
        self.overlay_id = overlay_id
        self.is_form = form
        self.form_action = form_action
        self.items = []
        self.actions = []

    def add_info_item(self, label, value, link=None, col=False, button=None):
        self.items.append({
            "type": "info",
            "label": label,
            "value": value,
            "link": link,
            "col": col,
            "button": button
        })
        return self

    def add_form_item(self, label, input_html, col=False):
        self.items.append({
            "type": "form",
            "label": label,
            "input": input_html,
            "col": col
        })
        return self

    def add_action(self, text, css_class="btn-primary", submit=False, action =""):
        self.actions.append((text, css_class, submit, action))
        return self

    def render(self):
        html = [f'<div class="overlay" id="{self.overlay_id}">']
        html.append('  <div class="overlay-content-wrapper">')

        # Header
        html.append('    <div class="overlay-header">')
        html.append(f'      <h2>{self.title}</h2>')
        if self.status and self.status_text:
            html.append(f'      <span class="badge status-{self.status}">{self.status_text}</span>')
        html.append(f'      <button class="close-button" onclick="closeOverlay(\'{self.overlay_id}\')">x</button>')
        html.append('    </div>')

        # Content
        content_class = "overlay-form" if self.is_form else "overlay-content"

        if self.is_form:
            html.append(f'    <form class="{content_class}" method="POST" action="{self.form_action}">')
        else:
            html.append(f'    <div class="{content_class}">')

        for item in self.items:
            if item["type"] == "info":
                col_class = " col" if item["col"] else ""
                html.append(f'      <div class="info-item{col_class}">')
                html.append(f'        <span class="label">{item["label"]}</span>')
                if item["link"]:
                    html.append(f'        <a class="link" href="{item["link"]}">{item["value"]}</a>')
                elif item["button"]:
                    html.append(f'        <button type="button" class="{item["button"]["class"]}">{item["button"]["text"]}</button>')
                else:
                    html.append(f'        <span class="value">{item["value"]}</span>')
                html.append('      </div>')

            elif item["type"] == "form":
                col_class = " col" if item["col"] else ""
                html.append(f'      <div class="form-item{col_class}">')
                html.append(f'        <span class="label">{item["label"]}</span>')
                html.append(f'        {item["input"]}')
                html.append('      </div>')

        # Actions
        if self.actions:
            html.append('      <div class="overlay-actions">')
            for text, css_class, submit, action in self.actions:
                if submit:
                    html.append(f'        <button type="submit" class="{css_class}">{text}</button>')
                else:    
                    html.append(f'        <button type="button" class="{css_class}" onclick="{action}">{text}</button>')
            html.append('      </div>')

        # Closing form/div
        if self.is_form:
            html.append('    </form>')
        else:
            html.append('    </div>')

        html.append('  </div>')
        html.append('</div>')

        return "\n".join(html)

def login_overlay():
    return (
        OverlayBuilder(
            title="Login",
            status="red",
            status_text="Anmeldung notwendig",
            overlay_id="login-overlay",
            form=True,
            form_action="/login"
        )
        .add_form_item(
            "Benutzername",
            '<input type="text" id="username" name="username" required>',
            True
        )
        .add_form_item(
            "Passwort",
            '<input type="password" id="password" name="password" required>',
            True
        )
        .add_action("Abbrechen", "btn-secondary", False, "closeOverlay('login-overlay')")
        .add_action("Login", "btn-primary", True)
        .render()
    )

def profile_overlay(user):
    """Overlay zum Anzeigen der Benutzerdetails (nur lesen)."""
    return (
        OverlayBuilder(
            title="Benutzerdetails",
            status="blue" if user.active else "red",
            status_text="Aktiv" if user.active else "Inaktiv",
            overlay_id=f"profile-overlay",
            form=False
        )
        .add_info_item("Benutzername", user.username, col=True)
        .add_info_item("Vorname", user.first_name or "-", col=True)
        .add_info_item("Nachname", user.last_name or "-", col=True)
        .add_info_item("E-Mail", user.email or "-", col=True)
        .add_info_item("Rolle", user.main_role.name if user.main_role else "-", col=True)
        .add_info_item("Status", "Aktiv" if user.active else "Inaktiv", col=True)
        .add_action("Schließen", "btn-secondary", False, f"closeCardOverlay('profile-overlay-{user.id}')")
        .render()
    )


def profile_form_overlay(user):
    """Overlay zum Bearbeiten der Benutzerdetails (Formular)."""
    return (
        OverlayBuilder(
            title="Benutzerdetails bearbeiten",
            status="blue",
            status_text="Formular",
            overlay_id=f"profile-overlay-form",
            form=True,
            form_action=f"/user/{user.id}/update"
        )
        .add_form_item("Benutzername", f'<input type="text" name="username" value="{user.username}" required>', col=True)
        .add_form_item("Vorname", f'<input type="text" name="first_name" value="{user.first_name or ""}">', col=True)
        .add_form_item("Nachname", f'<input type="text" name="last_name" value="{user.last_name or ""}">', col=True)
        .add_form_item("E-Mail", f'<input type="email" name="email" value="{user.email or ""}">', col=True)
        .add_form_item("Rolle", f'<input type="text" name="role" value="{user.main_role.name if user.main_role else ""}">', col=True)
        .add_form_item("Status", f'<select name="active"><option value="1" {"selected" if user.active else ""}>Aktiv</option><option value="0" {"selected" if not user.active else ""}>Inaktiv</option></select>', col=True)
        .add_action("Abbrechen", "btn-secondary", False, f"closeCardOverlay('profile-overlay-{user.id}-edit')")
        .add_action("Speichern", "btn-primary", True)
        .render()
    )


def get_overlay_json(template_name, data):
    """
    Lädt ein Overlay-Template und füllt die Werte aus `data` ein.
    """
    import copy
    template = copy.deepcopy(OVERLAY_TEMPLATES.get(template_name))
    if not template:
        return {}

    # Header
    for el in template.get("header", []):
        if el["type"] == "status":
            el["status"] = data.get("status_color", el.get("status"))
            el["value"] = data.get("status_text", el.get("value"))

    # Content
    for el in template.get("content", []):
        if el["type"] == "info-item":
            # Direkt nach Label matchen
            el["value"] = data.get(el["label"], el["value"])
        elif el["type"] == "form-item":
            el["input"] = data.get(el["label"], el.get("input"))

    # Actions
    btn_counter = 0
    for el in template.get("actions", []):
        if "onclick" in el:
            el["onclick"] = data.get(f"btn-{btn_counter}", el["onclick"])
            btn_counter += 1

    return template

