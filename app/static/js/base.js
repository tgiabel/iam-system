function toggleDropdown() {
    const menu = document.getElementById("dropdown-menu");
    menu.classList.toggle("hidden");
}

window.addEventListener("DOMContentLoaded", () => {
    const profileIcon = document.getElementById("profile-icon");

    profileIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleDropdown();
    });

    window.addEventListener("click", () => {
        const dropdown = document.getElementById("dropdown-menu");
        if (!dropdown.classList.contains("hidden")) {
            dropdown.classList.add("hidden");
        }
    });

    const alerts = document.querySelectorAll(".flash-messages .alert");
    if (alerts.length) {
      setTimeout(() => {
        alerts.forEach(alert => {
          alert.classList.add("hide");
        });
      }, 2000); // 5000ms = 5 Sekunden
    }
});