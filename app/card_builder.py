class CardBuilder:
    def __init__(self, card_id="", add_class="", title="", subtitle="", status="", badge="blue", is_clickable=False, overlay_id=None):
        self.card_id = card_id
        self.title = title
        self.subtitle = subtitle
        self.status = status
        self.badge = badge
        self.is_clickable = is_clickable
        self.overlay_id = overlay_id
        self.meta_info = None
        self.info_items = []
        self.has_spacer = False
        self.actions = []

    def set_meta_info(self, text, link="#"):
        self.meta_info = (text, link)
        return self

    def add_info_item(self, label, value):
        self.info_items.append((label, value, False))  # False = normal
        return self

    def add_info_item_col(self, label, value):
        self.info_items.append((label, value, True))   # True = col
        return self

    def add_spacer(self):
        self.has_spacer = True
        return self

    def add_action(self, text, css_class="btn-primary"):
        self.actions.append((text, css_class))
        return self

    def render(self):
        # onclick-Attribut vorbereiten
        onclick_attr = ""
        if self.is_clickable and self.overlay_id:
            onclick_attr = f' onclick="openCardOverlay(\'{self.overlay_id}\', \'{self.card_id}\')"'

        html = [f'<div class="card" data-id="{self.card_id}"{onclick_attr}>']
        html.append('  <div class="card-header">')
        html.append('    <h3>')
        html.append(f'      <span class="card-title">{self.title}</span>')
        html.append(f'      <span class="card-subtitle">{self.subtitle}</span>')
        html.append('    </h3>')
        html.append(f'    <span class="badge status-{self.badge}">{self.status}</span>')
        html.append('  </div>')

        if self.meta_info:
            text, link = self.meta_info
            html.append(f'  <a href="{link}" class="link">{text}</a>')

        html.append('  <div class="card-body">')

        for label, value, is_col in self.info_items:
            col_class = " col" if is_col else ""
            html.append(f'    <div class="info-item{col_class}">')
            html.append(f'      <span class="label">{label}:</span>')
            html.append(f'      <span class="value">{value}</span>')
            html.append('    </div>')

        if self.has_spacer:
            html.append('    <div class="spacer"></div>')

        for text, css_class in self.actions:
            html.append(f'    <button class="{css_class}">{text}</button>')

        html.append('  </div>')
        html.append('</div>')

        return "\n".join(html)

def profile_card(user_id="", name="", status="", role="", meta_text=None, meta_link="#", badge="blue"):
    card = (
        CardBuilder(
            card_id=f"user-{user_id}",
            title=name,
            subtitle=status,
            status=role,
            badge=badge,
            is_clickable=True,
            overlay_id="user-overlay"
        )
    )
    
    if meta_text:
        card.set_meta_info(meta_text, meta_link)
    
    return card.render()
