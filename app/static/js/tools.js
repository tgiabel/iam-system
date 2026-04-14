document.addEventListener("DOMContentLoaded", () => {
        initTabs();
    });

function initTabs() {
    const tabs = document.querySelectorAll(".tab-container .tab");
    const tabContents = document.querySelectorAll(".tab-content");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const target = tab.dataset.tab;
            tabs.forEach(t => t.classList.toggle("active", t === tab));
            tabContents.forEach(tc =>
                tc.classList.toggle("active", tc.id === `tab-${target}`)
            );
        });
    });
}