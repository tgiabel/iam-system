if (!window.taskOverlayInitialized) {
    document.addEventListener("DOMContentLoaded", () => {
        initTabs();
        initTaskOverlay();
        initTaskActionHandling();
        loadTasks();
    });
    window.taskOverlayInitialized = true;
}

const api = {
    async getMailTemplate(resource_id, user_id){
        try {
            const res = await fetch("/api/resources/mail_template", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({resource_id: resource_id, user_id: user_id})
            });
            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Unbekannter Fehler", "failure");
                return;
            }
            return data;

        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
        }
    },
    async sendMail(mailToSend) {
        try {
            const payload = {
                Absender: "test@servodata.de",
                EmpfängerTo: mailToSend.recipient,
                EmpfängerCC: mailToSend.cc || "",
                EmpfängerBCC: mailToSend.bcc || "",
                Betreff: mailToSend.subject,
                Mailtext: mailToSend.body,
                Html: 0                                  // 0 = Plain Text, 1 = HTML falls gewünscht
            };
            const res = await fetch("/api/mail/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!res.ok) {
                showFlash(data.detail || "Fehler beim Senden der E-Mail", "failure");
                return;
            }

            showFlash("E-Mail erfolgreich gesendet", "success");
            return data;

        } catch (err) {
            showFlash("Netzwerkfehler oder Server nicht erreichbar", "failure");
            console.error(err);
        }
    }
};

/* -----------------------------
   Tabs
----------------------------- */
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

/* -----------------------------
   Task Rendering
----------------------------- */
function renderTaskTile(task, blocked = false) {
    console.log("Rendering Task:", task, "Blocked:", blocked);
    const title = task.task_type === "ASSIGNMENT"
        ? "Zuweisung"
        : "Löschung";

    const badgeClass = {
        INTERNAL: "badge-internal",
        EXTERNAL: "badge-external",
        BOT: "badge-bot"
    }[task.handling_type] || "badge-default";

    // Optionales CSS für Blocked Tasks
    const blockedClass = blocked ? "task-blocked" : "";

    return `
        <a href="#" class="task-tile ${blockedClass}" data-task-id="${task.task_id}">
            <div class="task-header">
                <span class="task-title">${title}</span>
                <span class="task-badge ${badgeClass}">${task.handling_type}</span>
                ${blocked ? '<span class="task-badge badge-blocked">BLOCKED</span>' : ''}
            </div>
            <div class="task-body">
                <div class="task-line">
                    <strong>${task.resource_name}</strong>
                </div>
                <div class="task-line">
                    <strong>Für </strong> ${task.target_user_name}
                </div>
            </div>
        </a>
    `;
}

async function loadTasks() {
    try {
        const res = await fetch(`/api/tasks/overview`);
        const data = await res.json();

        // Sicherheitscheck
        const openTasks = Array.isArray(data.open_tasks) ? data.open_tasks : [];
        const blockedTasks = Array.isArray(data.blocked_tasks) ? data.blocked_tasks : [];
        const myTasks = Array.isArray(data.user_tasks) ? data.user_tasks : [];
        const completedTasks = Array.isArray(data.completed_tasks) ? data.completed_tasks : [];

        // Task Index für schnellen Zugriff
        window.taskIndex = {};
        [...openTasks, ...blockedTasks, ...myTasks, ...completedTasks].forEach(t => window.taskIndex[t.task_id] = t);

        // Open + Blocked Tasks zusammen rendern
        const openContainer = document.getElementById("open-tasks-slider");
        openContainer.innerHTML = [
            ...openTasks.map(t => renderTaskTile(t)),
            ...blockedTasks.map(t => renderTaskTile(t, true)) // blocked = true
        ].join("") || "<p>Keine offenen Aufgaben</p>";

        // Eigene Aufgaben
        const myContainer = document.getElementById("my-tasks-slider");
        myContainer.innerHTML = myTasks.map(t => renderTaskTile(t)).join("") || "<p>Keine eigenen Aufgaben</p>";

        // Completed Tasks (neuer Abschnitt)
        const completedContainer = document.getElementById("completed-tasks-slider");
        if (completedContainer) {
            completedContainer.innerHTML = completedTasks.map(t => renderTaskTile(t)).join("") || "<p>Keine abgeschlossenen Aufgaben</p>";
        }

    } catch (err) {
        console.error("Task-Ladefehler:", err);
        showFlash("Fehler beim Laden der Aufgaben. Siehe Konsole.", "failure");
    }
}


/* -----------------------------
   Overlay
----------------------------- */
function getTaskContext(task) {
    const isMine =
        task.status === "IN_PROGRESS" &&
        task.assigned_to_user_id === window.currentUserId;

    const isOpen = task.status === "OPEN";

    return { isMine, isOpen };
}

function createActionButton(label, action, style = "secondary", id=null) {
    const btn = document.createElement("button");
    btn.className = `btn btn-${style}`;
    btn.textContent = label;
    btn.dataset.action = action;
    if (id !== null) {
        btn.id = id;
    }
    return btn;
}

function renderTaskActions(task) {
    const { isMine, isOpen } = getTaskContext(task);
    const formEl = document.getElementById("task-form");
    const actionsEl = document.getElementById("task-actions");

    // Alles leeren
    formEl.innerHTML = "";
    actionsEl.innerHTML = "";

    // Task ist noch offen → nur Übernehmen Button
    if (isOpen) {
        actionsEl.append(createActionButton("Übernehmen", "assign", "primary"));
        return;
    }

    // Task gehört mir
    if (isMine) {
        // Kommentarfeld immer dabei
        const commentField = document.createElement("textarea");
        commentField.id = "task-comment";
        commentField.placeholder = "Kommentar (optional)";
        commentField.className = "task-comment";
        formEl.appendChild(commentField);

        // Pflicht User-ID Feld nur für Account-Ressourcen (resource_type_id === 1)
        if (task.resource_type_id === 1 && task.task_type === "ASSIGNMENT") {
            const userIdField = document.createElement("input");
            userIdField.type = "text";
            userIdField.id = "task-account-identifier";
            userIdField.placeholder = "Account-Kennung/ Benutzername (Pflicht)";
            userIdField.title = "Für Account-Ressourcen muss hier die User-ID eingetragen werden";
            userIdField.className = "task-account-identifier";
            formEl.appendChild(userIdField);
        }

        // Buttons
        actionsEl.append(createActionButton("Freigeben", "release", "red"));

        if (task.handling_type === "EXTERNAL") {
            actionsEl.append(createActionButton("Extern beauftragen", "external", "secondary"));
        }

        if (task.handling_type === "BOT") {
            actionsEl.append(createActionButton("Bot beauftragen", "bot", "secondary"));
        }

        // Erledigen Button (immer)
        actionsEl.append(createActionButton("Erledigt", "complete", "primary", "task-complete-btn"));

    }
}



function initTaskActionHandling() {
    const actionsEl = document.getElementById("task-actions");
    if (!actionsEl) return;

    // Alte Listener entfernen
    actionsEl.replaceWith(actionsEl.cloneNode(true));
    const newActionsEl = document.getElementById("task-actions");

    newActionsEl.addEventListener("click", async e => {
        const btn = e.target.closest("button");
        if (!btn) return;

        const action = btn.dataset.action;
        const task = window.currentTask;

        if (!task) return;

        if (action === "assign") {

            try {

                const res = await fetch(`/api/tasks/${task.task_id}/assign?user_id=${window.currentUserId}`, {
                    method: "PATCH"
                });

                if (!res.ok) {

                    if (res.status === 409) {
                        showFlash("Task wurde bereits übernommen", "failure");

                        loadTasks(); // refresh!
                        return;
                    }

                    throw new Error("Assign fehlgeschlagen");
                }

                showFlash("Task erfolgreich übernommen");

                const updatedTask = await res.json();

                console.log("Task übernommen:", updatedTask);

                document.getElementById("task-overlay")
                    .classList.remove("active");

                loadTasks(); // UI refreshen!

            } catch (err) {
                console.error(err);
                alert("Fehler beim Übernehmen des Tasks.");
            }
        }


        if (action === "release") {
            console.log("Task freigeben", task);

            fetch(`/api/tasks/${task.task_id}/assign`, {
                method: "DELETE"
            })
            .then(async res => {
                if (!res.ok) {
                    const err = await res.json();
                    showFlash(err.detail || "Fehler beim Freigeben", "failure");
                    throw new Error(err.detail || "API Error");
                }

                const updatedTask = await res.json();
                showFlash("Task erfolgreich freigegeben");

                // Overlay schließen
                document.getElementById("task-overlay").classList.remove("active");

                // Task-Liste aktualisieren
                loadTasks();
            })
            .catch(err => {
                console.error("Release Task Error:", err);
            });
        }


        if (action === "complete") {

            if (!validateTaskCompletion(task)) {
                return;
            }

            const completeBtn = document.getElementById("task-complete-btn");
            completeBtn.disabled = true;
            completeBtn.textContent = "Wird gespeichert...";

            const handler = window.completeHandlers[task.handling_type];
            handler?.(task);

            if (completeBtn) {
                completeBtn.disabled = false;
                completeBtn.textContent = "Erledigt";
            }
        }

        if (action === "external") {
            openMailDialog(task);
        }

        if (action === "bot") {
            dispatchBot(task);
        }

    });
}

function initTaskOverlay() {
    // 1. Toggle-Event nur EINMAL beim Initialisieren binden (nicht im Click-Listener!)
    const historyToggle = document.getElementById("history-toggle");
    historyToggle?.addEventListener("click", () => {
        const container = document.getElementById("history-container");
        const isOpen = container.classList.toggle("open");
        historyToggle.querySelector("span").textContent = isOpen ? "Verlauf ausblenden" : "Verlauf anzeigen";
    });

    document.addEventListener("click", async e => {
        const tile = e.target.closest(".task-tile");
        if (!tile) return;

        e.preventDefault();
        const taskId = tile.dataset.taskId;
        const task = window.taskIndex?.[taskId];
        if (!task) return;

        window.currentTask = task;

        // --- UI SOFORT ÖFFNEN ---
        document.getElementById("task-modal-title").textContent = 
            task.task_type === "ASSIGNMENT" ? "Zuweisung" : "Löschung";
        document.getElementById("task-modal-user").textContent = task.target_user_name;
        document.getElementById("task-modal-resource").textContent = task.resource_name;
        document.getElementById("task-modal-status").textContent = task.status;

        // Verlauf-Bereich zurücksetzen
        const historyContainer = document.getElementById("history-container");
        const historyBody = document.getElementById("task-history-body");
        historyContainer.classList.remove("open");
        document.querySelector("#history-toggle span").textContent = "Verlauf anzeigen";
        historyBody.innerHTML = '<tr><td colspan="3">Lade Verlauf...</td></tr>';

        renderTaskActions(task);
        document.getElementById("task-overlay").classList.add("active");

        // --- DATEN ASYNCHRON NACHLADEN ---
        try {
            const res = await fetch(`/api/tasks/${taskId}/history`);
            if (!res.ok) throw new Error("History failed");
            const historyData = await res.json();

            // Befüllen
            historyBody.innerHTML = ""; 
            if (historyData && historyData.length > 0) {
                historyData.forEach(entry => {
                    const row = `
                        <tr>
                            <td>
                                ${new Date(entry.timestamp).toLocaleString('de-DE', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}
                            </td>
                            <td>${entry.action}</td>
                            <td>${entry.user_id || "-"}</td>
                            <td>${entry.comment || "-"}</td>
                        </tr>`;
                    historyBody.insertAdjacentHTML("beforeend", row);
                });
            } else {
                historyBody.innerHTML = "<tr><td colspan='3'>Kein Verlauf verfügbar</td></tr>";
            }
        } catch (err) {
            console.error("History Error:", err);
            historyBody.innerHTML = "<tr><td colspan='3' style='color:red;'>Fehler beim Laden des Verlaufs</td></tr>";
        }
    });

    // Close-Buttons (bleiben gleich)
    document.getElementById("task-close-btn")?.addEventListener("click", () => 
        document.getElementById("task-overlay").classList.remove("active")
    );
}

function validateTaskCompletion(task) {

    if (task.resource_type_id === 1 && task.task_type === "ASSIGNMENT") {

        const val = document
            .getElementById("task-account-identifier")
            ?.value
            ?.trim();

        if (!val) {
            showFlash("Bitte Benutzer-Kennung eintragen.", "failure");
            const input = document.getElementById("task-account-identifier");
            input.classList.add("input-error");
            input.focus();
            return false;
        }
    }

    return true;
}

async function completeInternal(task) {

    const payload = {};

    const comment =
        document.getElementById("task-comment")?.value?.trim();

    if (comment) {
        payload.comment = comment;
    }

    if (task.resource_type_id === 1 && task.task_type === "ASSIGNMENT") {

        payload.account_identifier =
            document.getElementById("task-account-identifier").value.trim();
    }

    try {

        const res = await fetch(
            `/api/tasks/${task.task_id}/complete`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            }
        );

        if (!res.ok) {
            throw new Error(await res.text());
        }

        showFlash("Task erfolgreich erledigt.");

        document
            .getElementById("task-overlay")
            .classList.remove("active");

        await loadTasks();

    } catch (err) {

        console.error("Complete failed:", err);
        showFlash("Task konnte nicht erledigt werden.", "failure");
    }
}

window.completeHandlers ||= {

    INTERNAL: completeInternal,
    EXTERNAL: completeInternal, // gleiches Verhalten
    BOT: completeInternal      // erstmal auch
};

async function openMailDialog(task) {
    if (!task) return;

    // 1. Maildaten per API holen
    // erwartet { recipient, subject, body }
    let mailData;
    try {
        mailData = await api.getMailTemplate(task.resource_id, task.target_user_id);
    } catch (err) {
        console.error("Fehler beim Abrufen der Mailvorlage:", err);
        showFlash("Mailvorlage konnte nicht geladen werden!", "failure");
        return;
    }

    // 2. UI-Elemente referenzieren
    const recipientInput = document.getElementById("mail-recipient");
    const subjectInput = document.getElementById("mail-subject");
    const bodyInput = document.getElementById("mail-body");
    const mailOverlay = document.getElementById("mail-dialog-overlay");
    const sendBtn = document.getElementById("send-mail-btn");

    if (!recipientInput || !subjectInput || !bodyInput || !mailOverlay || !sendBtn) {
        console.error("Mail-Dialog Elemente fehlen im DOM!");
        return;
    }

    // 3. Felder befüllen
    recipientInput.value = mailData.recipient || "";
    subjectInput.value = mailData.subject || "";
    bodyInput.value = mailData.body || "";

    // 4. Dialog anzeigen
    mailOverlay.classList.add("active");

    // 5. Click-Event für Senden vorbereiten
    // Vorher alte Listener entfernen, damit kein Doppelversand passiert
    sendBtn.replaceWith(sendBtn.cloneNode(true)); // simple remove old listeners
    const newSendBtn = document.getElementById("send-mail-btn");

    newSendBtn.addEventListener("click", async () => {
        const mailToSend = {
            recipient: recipientInput.value.trim(),
            subject: subjectInput.value.trim(),
            body: bodyInput.value.trim(),
            task_id: task.task_id
        };

        if (!mailToSend.recipient || !mailToSend.subject || !mailToSend.body) {
            showFlash("Bitte Empfänger, Betreff und Nachricht ausfüllen!", "failure");
            return;
        }

        try {
            await api.sendMail(mailToSend);
            showFlash("E-Mail erfolgreich gesendet!", "success");
            mailOverlay.classList.remove("active");
        } catch (err) {
            console.error("Fehler beim Senden der Mail:", err);
            showFlash("Fehler beim Senden der E-Mail. Bitte erneut versuchen.", "failure");
        }
    });
}

async function dispatchBot(task) {
    
}