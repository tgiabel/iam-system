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

function closeOverlay(overlayId) {
  const overlay = document.getElementById(overlayId);

  if (overlay) {
    // Inhalte leeren
    const headerEl = overlay.querySelector(".overlay-header");
    const contentEl = overlay.querySelector(".overlay-content");
    const formEl = overlay.querySelector(".overlay-actions");
    if (headerEl) headerEl.innerHTML = "";
    if (contentEl) {
      contentEl.innerHTML = `
        <div class="skeleton-block">
          <div class="skeleton title"></div>
          <div class="skeleton line"></div>
          <div class="skeleton line"></div>
          <div class="skeleton line short"></div>
        </div>
      `;
    }
    if (formEl) formEl.innerHTML = "";

    // Overlay ausblenden
    overlay.classList.add("hidden"); 

    // Sonderfall: Login Overlay
    if (overlayId === "login-overlay") {
      window.location.href = "/";
    }
  }
}


function openOverlay(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (overlay) {
    overlay.style.display = "block"; 
  }
}

async function openCardOverlay(overlayId, cardId) {
    // Overlay sichtbar machen
    const overlayEl = document.getElementById(overlayId);
    if (!overlayEl) {
        console.error(`Overlay mit ID ${overlayId} nicht gefunden`);
        return;
    }
    overlayEl.classList.remove("hidden");

    // entity und id aus cardId extrahieren (Format: entity-id)
    const [entity, id] = cardId.split("-");

    try {
        // API-Call
        const response = await fetch(`/api/${entity}/${id}/details`);
        if (!response.ok) {
            throw new Error(`Fehler beim Laden: ${response.status}`);
        }

        const jsonData = await response.json();

        // Builder instanziieren (OverlayBuilder auf JS-Seite)
        const builder = new OverlayBuilder(overlayId, jsonData);
        builder.render();
    } catch (err) {
        console.error("Fehler beim Laden des Overlays:", err);
    }
}

async function add(entity) {
    // Overlay-Id herleiten (z. B. nach Namenskonvention)
    const overlayId = `${entity}-form-overlay`;
    const overlayEl = document.getElementById(overlayId);
    if (!overlayEl) {
        console.error(`Overlay mit ID ${overlayId} nicht gefunden`);
        return;
    }

    // sichtbar machen
    overlayEl.classList.remove("hidden");

    try {
        // API-Call zum Template
        const response = await fetch(`/api/${entity}/form`);
        if (!response.ok) {
            throw new Error(`Fehler beim Laden des Templates: ${response.status}`);
        }

        const jsonData = await response.json();

        // wichtig: markieren, dass es sich um ein Formular handelt
        jsonData.is_form = true;

        // Builder instanziieren
        const builder = new OverlayBuilder(overlayId, jsonData);
        builder.render();
    } catch (err) {
        console.error("Fehler beim Laden des Overlay-Templates:", err);
    }
}

async function add_new(entity) {
  
}

async function edit(entity, id) {
    // Overlay-Id herleiten (nach deiner Konvention)
    const overlayId = `${entity}-form-overlay`;
    const overlayEl = document.getElementById(overlayId);
    if (!overlayEl) {
        console.error(`Overlay mit ID ${overlayId} nicht gefunden`);
        return;
    }

    // sichtbar machen
    overlayEl.classList.remove("hidden");

    try {
        // API-Call zum vorausgefüllten Formular
        const response = await fetch(`/api/${entity}/form/${id}`);
        if (!response.ok) {
            throw new Error(`Fehler beim Laden des Formulars: ${response.status}`);
        }

        const jsonData = await response.json();

        // Builder instanziieren
        const builder = new OverlayBuilder(overlayId, jsonData);
        builder.render();
    } catch (err) {
        console.error("Fehler beim Laden des Overlay-Templates:", err);
    }
}
