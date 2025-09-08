class OverlayBuilder {
    constructor(overlayId, jsonData) {
        this.overlayId = overlayId;
        this.data = jsonData;
        this.overlayEl = document.getElementById(overlayId);
    }

    render() {
        if (!this.overlayEl) return;

        // Header
        const headerEl = this.overlayEl.querySelector(".overlay-header");
        if (headerEl) {
            headerEl.innerHTML = "";
            this.data.header.forEach(el => {
                switch (el.type) {
                    case "title":
                        headerEl.insertAdjacentHTML("beforeend", `<h2>${el.value}</h2>`);
                        break;
                    case "status":
                        headerEl.insertAdjacentHTML("beforeend", `<span class="badge status-${el.status}">${el.value}</span>`);
                        break;
                    case "info":
                        headerEl.insertAdjacentHTML("beforeend", `<span class="info-item">${el.label}: ${el.value}</span>`);
                        break;
                    case "spacer":
                        headerEl.insertAdjacentHTML("beforeend", `<div class="spacer"></div>`);
                        break;
                }
            });

            // Close-Button immer am Ende
            headerEl.insertAdjacentHTML(
                "beforeend",
                `<button type="button" class="close-button" onclick="closeOverlay('${this.overlayId}')">✕</button>`
            );
        }

        // Content-Container
        const contentEl = this.overlayEl.querySelector(".overlay-content");
        if (!contentEl) return;
        contentEl.innerHTML = "";

        // ggf. <form> erzeugen
        let parentEl = contentEl;
        if (this.data.is_form) {
            parentEl = document.createElement("form");
            parentEl.classList.add("overlay-form");
            contentEl.appendChild(parentEl);
        }

        // Content-Elemente einfügen
        this.data.content.forEach(el => {
            if (el.type === "info-item") {
                parentEl.insertAdjacentHTML("beforeend", `
                    <div class="info-item">
                        <span class="label">${el.label}</span>
                        <span class="value">${el.value}</span>
                    </div>
                `);
            } else if (el.type === "form-item") {
                parentEl.insertAdjacentHTML("beforeend", `
                    <div class="form-item">
                        <span class="label">${el.label}</span>
                        ${el.input}
                    </div>
                `);
            }
        });

        parentEl.insertAdjacentHTML("beforeend", "<div class='spacer'></div>");

        // Actions
        if (this.data.actions && this.data.actions.length > 0) {
            const actionsHtml = this.data.actions.map(el => {
                if (el.submit) {
                    return `<button type="submit" class="${el.css_class}">${el.text}</button>`;
                } else {
                    return `<button type="button" class="${el.css_class}" onclick="${el.onclick}">${el.text}</button>`;
                }
            }).join("");

            parentEl.insertAdjacentHTML("beforeend", `
                <div class="overlay-actions">${actionsHtml}</div>
            `);
        }
    }
}
