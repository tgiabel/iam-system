class CardBuilder {
  constructor({ id = "", title = "", subtitle = "", status = "" } = {}) {
    this.id = id;
    this.title = title;
    this.subtitle = subtitle;
    this.status = status;
    this.metaInfo = null;
    this.infoItems = [];
    this.hasSpacer = false;
    this.actions = [];
  }

  setMetaInfo(text, link = "#") {
    this.metaInfo = { text, link };
    return this;
  }

  addInfoItem(label, value) {
    this.infoItems.push({ label, value, col: false });
    return this;
  }

  addInfoItemCol(label, value) {
    this.infoItems.push({ label, value, col: true });
    return this;
  }

  addSpacer() {
    this.hasSpacer = true;
    return this;
  }

  addAction(text, cssClass = "btn-primary") {
    this.actions.push({ text, cssClass });
    return this;
  }

  render() {
    // Outer Card
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = this.id;

    // Header
    const header = document.createElement("div");
    header.className = "card-header";

    const h3 = document.createElement("h3");
    h3.innerHTML = `
      <span class="card-title">${this.title}</span>
      <span class="card-subtitle">${this.subtitle}</span>
    `;

    const badge = document.createElement("span");
    badge.className = "badge status-open";
    badge.textContent = this.status;

    header.appendChild(h3);
    header.appendChild(badge);
    card.appendChild(header);

    // Meta Info
    if (this.metaInfo) {
      const link = document.createElement("a");
      link.href = this.metaInfo.link;
      link.className = "link";
      link.textContent = this.metaInfo.text;
      card.appendChild(link);
    }

    // Body
    const body = document.createElement("div");
    body.className = "card-body";

    this.infoItems.forEach(({ label, value, col }) => {
      const div = document.createElement("div");
      div.className = "info-item" + (col ? " col" : "");
      div.innerHTML = `
        <span class="label">${label}:</span>
        <span class="value">${value}</span>
      `;
      body.appendChild(div);
    });

    if (this.hasSpacer) {
      const spacer = document.createElement("div");
      spacer.className = "spacer";
      body.appendChild(spacer);
    }

    this.actions.forEach(({ text, cssClass }) => {
      const btn = document.createElement("button");
      btn.className = cssClass;
      btn.textContent = text;
      body.appendChild(btn);
    });

    card.appendChild(body);

    return card;
  }
}

class OverlayBuilder {
  constructor({ id = "", title = "", status = "", form = false } = {}) {
    this.id = id;
    this.title = title;
    this.status = status;
    this.isForm = form;
    this.items = [];
    this.actions = [];
  }

  addInfoItem(label, value, { link = null, col = false, button = null } = {}) {
    this.items.push({ type: "info", label, value, link, col, button });
    return this;
  }

  addFormItem(label, inputHTML, { col = false } = {}) {
    this.items.push({ type: "form", label, input: inputHTML, col });
    return this;
  }

  addAction(text, cssClass = "btn-primary") {
    this.actions.push({ text, cssClass });
    return this;
  }

  render() {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    if (this.id) overlay.id = this.id;

    const wrapper = document.createElement("div");
    wrapper.className = "overlay-content-wrapper";
    overlay.appendChild(wrapper);

    // Header
    const header = document.createElement("div");
    header.className = "overlay-header";
    header.innerHTML = `
      <h2>${this.title}</h2>
      <span class="badge status-active">${this.status}</span>
      <button class="close-button">x</button>
    `;
    wrapper.appendChild(header);

    // Content
    const content = document.createElement("div");
    content.className = this.isForm ? "overlay-form" : "overlay-content";
    wrapper.appendChild(content);

    // Items
    this.items.forEach(item => {
      if (item.type === "info") {
        const div = document.createElement("div");
        div.className = "info-item" + (item.col ? " col" : "");
        div.innerHTML = `<span class="label">${item.label}</span>`;
        if (item.link) {
          div.innerHTML += `<a class="link" href="${item.link}">${item.value}</a>`;
        } else if (item.button) {
          div.innerHTML += `<button type="button" class="${item.button.class}">${item.button.text}</button>`;
        } else {
          div.innerHTML += `<span class="value">${item.value}</span>`;
        }
        content.appendChild(div);
      }

      if (item.type === "form") {
        const div = document.createElement("div");
        div.className = "form-item" + (item.col ? " col" : "");
        div.innerHTML = `
          <span class="label">${item.label}</span>
          ${item.input}
        `;
        content.appendChild(div);
      }
    });

    // Actions
    if (this.actions.length > 0) {
      const actionsDiv = document.createElement("div");
      actionsDiv.className = "overlay-actions";
      this.actions.forEach(({ text, cssClass }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = cssClass;
        btn.textContent = text;
        actionsDiv.appendChild(btn);
      });
      content.appendChild(actionsDiv);
    }

    return overlay;
  }
}
