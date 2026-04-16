document.addEventListener("DOMContentLoaded", () => {
    initTabs();
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
