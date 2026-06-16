document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initPopoutButtons();
});

function initTabs() {
    const tabs = document.querySelectorAll(".overview-tab");
    const panels = document.querySelectorAll(".overview-panel");

    function activateTab(target) {
        tabs.forEach(tab => {
            const isActive = tab.dataset.tab === target;
            tab.classList.toggle("active", isActive);
            tab.setAttribute("aria-selected", String(isActive));
        });

        panels.forEach(panel => {
            const isActive = panel.id === `tab-${target}`;
            panel.classList.toggle("active", isActive);
            panel.setAttribute("aria-hidden", String(!isActive));
        });
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            activateTab(tab.dataset.tab);
        });
    });

    const initiallyActive = document.querySelector(".overview-tab.active")?.dataset.tab || "tools";
    activateTab(initiallyActive);
}

function initPopoutButtons() {
    document.querySelectorAll(".overview-card-popout").forEach(btn => {
        if (btn.dataset.popoutInit) return;
        btn.dataset.popoutInit = "1";

        const card = btn.closest(".overview-card-link");
        if (!card) return;

        btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            const href = card.getAttribute("href");
            if (!href) return;

            const url = new URL(href, window.location.origin);
            url.searchParams.set("view", "widget");
            window.open(url.toString(), "_blank", "noopener,noreferrer,width=1280,height=860");
        });
    });
}
