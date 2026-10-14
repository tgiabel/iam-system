document.addEventListener("DOMContentLoaded", initWorkspace);

function initWorkspace() {
    const page = document.getElementById("toolsOverview");
    if (!page) return;

    const pins = window.WorkspacePins;
    const userId = page.dataset.userId;
    const slots = Array.from(page.querySelectorAll("[data-pin-slot]"));
    const columnCards = Array.from(page.querySelectorAll(".workspace-column .ws-item"));
    const visibleIds = columnCards.map(card => card.dataset.workspaceId);
    const cardById = new Map(columnCards.map(card => [card.dataset.workspaceId, card]));

    // Ohne Nutzer-ID gibt es keinen Speicherschluessel: Pins gelten dann nur bis zum Neuladen.
    const readStorage = () => {
        try { return window.localStorage; } catch (_) { return undefined; }
    };
    let pinned = userId ? pins.load(readStorage(), userId, visibleIds) : [];

    function renderPins() {
        slots.forEach((slot, index) => {
            const id = pinned[index];
            const source = id && cardById.get(id);
            slot.classList.toggle("is-empty", !source);
            if (!source) {
                slot.replaceChildren();
                return;
            }
            slot.replaceChildren(source.cloneNode(true));
        });
        page.querySelectorAll(".ws-item").forEach(card => {
            const isPinned = pinned.includes(card.dataset.workspaceId);
            const title = card.querySelector(".ws-item-link")?.textContent.trim() || "";
            const button = card.querySelector(".ws-item-pin");
            if (!button) return;
            button.setAttribute("aria-pressed", String(isPinned));
            button.setAttribute("aria-label", `${title} ${isPinned ? "lösen" : "anheften"}`);
            button.title = isPinned ? "Pin lösen" : "Anheften";
        });
    }

    function togglePin(id) {
        pinned = pins.toggle(pinned, id);
        if (userId) pins.save(readStorage(), userId, pinned);
        renderPins();
    }

    page.addEventListener("click", (event) => {
        const pinButton = event.target.closest(".ws-item-pin");
        if (pinButton) {
            event.preventDefault();
            const id = pinButton.closest(".ws-item")?.dataset.workspaceId;
            if (id) togglePin(id);
            return;
        }
        const popout = event.target.closest(".ws-item-popout");
        if (popout) {
            event.preventDefault();
            openWidget(popout.closest(".ws-item"));
        }
    });

    // Zweiter offener Tab: Pins uebernehmen.
    window.addEventListener("storage", (event) => {
        if (!userId || event.key !== pins.storageKey(userId)) return;
        pinned = pins.load(readStorage(), userId, visibleIds);
        renderPins();
    });

    renderPins();
}

function openWidget(card) {
    const href = card?.querySelector(".ws-item-link")?.getAttribute("href");
    if (!href) return;
    const url = new URL(href, window.location.origin);
    url.searchParams.set("view", "widget");
    window.open(url.toString(), "_blank", "noopener,noreferrer,width=1280,height=860");
}
