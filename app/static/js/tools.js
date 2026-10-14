document.addEventListener("DOMContentLoaded", initWorkspace);

function initWorkspace() {
    const page = document.getElementById("toolsOverview");
    if (!page) return;

    const pins = window.WorkspacePins;
    const userId = page.dataset.userId;
    const slots = Array.from(page.querySelectorAll("[data-pin-slot]"));
    const columnCards = Array.from(page.querySelectorAll(".workspace-column .overview-card"));
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
            const clone = source.cloneNode(true);
            clone.classList.add("is-compact");
            clone.classList.remove("is-pinned");
            slot.replaceChildren(clone);
        });
        page.querySelectorAll(".overview-card").forEach(card => {
            const isPinned = pinned.includes(card.dataset.workspaceId);
            const title = card.querySelector(".overview-card-main-link")?.textContent.trim() || "";
            const button = card.querySelector(".overview-card-pin");
            if (!button) return;
            button.setAttribute("aria-pressed", String(isPinned));
            button.setAttribute("aria-label", `${title} ${isPinned ? "lösen" : "anheften"}`);
            button.title = isPinned ? "Pin lösen" : "Anheften";
            if (!card.closest("[data-pin-slot]")) card.classList.toggle("is-pinned", isPinned);
        });
    }

    function togglePin(id) {
        pinned = pins.toggle(pinned, id);
        if (userId) pins.save(readStorage(), userId, pinned);
        renderPins();
    }

    page.addEventListener("click", (event) => {
        const pinButton = event.target.closest(".overview-card-pin");
        if (pinButton) {
            event.preventDefault();
            const id = pinButton.closest(".overview-card")?.dataset.workspaceId;
            if (id) togglePin(id);
            return;
        }
        const popout = event.target.closest(".overview-card-popout");
        if (popout) {
            event.preventDefault();
            openWidget(popout.closest(".overview-card"));
        }
    });

    // Zweiter offener Tab: Pins uebernehmen.
    window.addEventListener("storage", (event) => {
        if (!userId || event.key !== pins.storageKey(userId)) return;
        pinned = pins.load(readStorage(), userId, visibleIds);
        renderPins();
    });

    // Der Scrollbalken der Spalten verengt die Karten; die Pin-Zeile bekommt dieselbe Breite.
    const scroller = page.querySelector(".workspace-column-scroll");
    function measureGutter() {
        const gutter = scroller ? scroller.offsetWidth - scroller.clientWidth : 0;
        page.style.setProperty("--ws-gutter", `${gutter}px`);
    }
    window.addEventListener("resize", measureGutter);
    measureGutter();

    renderPins();
}

function openWidget(card) {
    const href = card?.querySelector(".overview-card-main-link")?.getAttribute("href");
    if (!href) return;
    const url = new URL(href, window.location.origin);
    url.searchParams.set("view", "widget");
    window.open(url.toString(), "_blank", "noopener,noreferrer,width=1280,height=860");
}
