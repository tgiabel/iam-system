document.addEventListener("DOMContentLoaded", () => {
    initPopoutButtons();
});

function initPopoutButtons() {
    document.querySelectorAll(".overview-card-popout").forEach(btn => {
        if (btn.dataset.popoutInit) return;
        btn.dataset.popoutInit = "1";

        const card = btn.closest(".overview-card");
        if (!card) return;

        btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            const href = card.querySelector(".overview-card-main-link")?.getAttribute("href");
            if (!href) return;

            const url = new URL(href, window.location.origin);
            url.searchParams.set("view", "widget");
            window.open(url.toString(), "_blank", "noopener,noreferrer,width=1280,height=860");
        });
    });
}
