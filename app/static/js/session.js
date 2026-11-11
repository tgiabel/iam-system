/* Sitzung im Browser (Vertrag SD-API docs/sofa-session-contract.md, Abschnitt 9).
 *
 * - CSRF: schreibende same-origin-Requests tragen das Token der Sitzung im Kopf X-CSRF-Token.
 * - Aktivitaet: echte Bedienung in sichtbaren Fenstern verlaengert die Sitzung, hoechstens alle 60 s.
 *   Polling und Hintergrundabrufe verlaengern nie.
 * - Hinweise 5 Minuten vor Inaktivitaets- und Absolutablauf (Uhrenversatz aus server_time).
 * - Ablauf ohne Weiterleitung: Banner, Seite gesperrt, Wiederanmeldung im selben Tab. Ungespeicherte
 *   Eingaben bleiben erhalten; meldet sich ein anderes Konto an, wird die Seite neu geladen.
 */
(() => {
    "use strict";
    const nativeFetch = window.fetch.bind(window);
    const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
    const ACTIVITY_EVENTS = ["pointerdown", "keydown", "input", "change", "wheel", "touchstart"];
    const ACTIVITY_INTERVAL_MS = 60 * 1000;
    const WARN_BEFORE_MS = 5 * 60 * 1000;
    const CHECK_EVERY_MS = 15 * 1000;
    const ACTIVITY_KEY = "sofaActivitySentAt";
    const SESSION_CODES = new Set(["session_expired", "session_revoked", "session_missing", "session_invalid"]);
    const TEXT = {
        expired: "Deine Sitzung ist abgelaufen.",
        revoked: "Deine Sitzung wurde beendet.",
        missing: "Du bist nicht mehr angemeldet.",
        resumed: "Wieder angemeldet. Nicht gespeicherte Eingaben sind erhalten.",
        missingFields: "Bitte Personalnummer und Passwort eingeben.",
        unreachable: "Der Anmeldedienst ist nicht erreichbar. Bitte versuche es später erneut.",
        failed: "Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.",
    };

    let boot = null;            // {user_id, pnr, info} aus der Seite
    let info = null;            // Fristen aus der letzten Antwort
    let clockOffset = 0;        // Serverzeit minus Browserzeit in ms
    let ended = null;           // Grundtext, solange keine gueltige Sitzung besteht
    let idleCheckedAt = 0;      // letzte Nachfrage vor bzw. waehrend des Inaktivitaetshinweises
    let dismissedAbsolute = null;
    let checking = null;
    let lastActivity = 0;
    let focusBefore = null;
    let ui = null;

    function sameOriginUrl(input) {
        try {
            const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
            return url.origin === window.location.origin ? url : null;
        } catch (_) {
            return null;  // ungueltige URL: fetch meldet den Fehler selbst
        }
    }

    const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content || "";

    function setCsrfToken(token) {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) meta.content = token;
        document.querySelectorAll('form input[name="csrf_token"]').forEach(field => { field.value = token; });
    }

    window.fetch = async (input, init = {}) => {
        const request = input instanceof Request ? input : null;
        const method = String(init.method || request?.method || "GET").toUpperCase();
        const url = sameOriginUrl(input);
        const token = csrfToken();
        let response;
        if (!SAFE.has(method) && url && token) {
            const headers = new Headers(init.headers || request?.headers || undefined);
            headers.set("X-CSRF-Token", token);
            response = await nativeFetch(input, { ...init, headers });
        } else {
            response = await nativeFetch(input, init);
        }
        if (boot && url && url.pathname.startsWith("/api/") && (response.status === 401 || response.status === 403)) {
            inspectFailure(response.clone());
        }
        return response;
    };

    async function inspectFailure(response) {
        let detail;
        try {
            detail = (await response.json())?.detail;
        } catch (_) {
            return;
        }
        if (!detail || typeof detail !== "object") return;
        if (response.status === 401 && SESSION_CODES.has(detail.code)) end(detail.code);
        // Veraltetes Token, weil ein anderer Tab neu angemeldet hat: frisches holen. Nichts wird wiederholt.
        else if (response.status === 403 && detail.code === "csrf_failed") check();
    }

    const serverNow = () => Date.now() + clockOffset;

    function deadlines() {
        const idle = Date.parse(info?.idle_expires_at);
        const absolute = Date.parse(info?.absolute_expires_at);
        return Number.isFinite(idle) && Number.isFinite(absolute) ? { idle, absolute } : null;
    }

    function update(data) {
        if (!boot || !data || typeof data !== "object") return;
        const userId = data.user?.user_id;
        if (userId != null && userId !== boot.user_id) {
            // In diesem Browser hat sich ein anderes Konto angemeldet: nichts von dieser Seite weiterverwenden.
            window.location.reload();
            return;
        }
        if (typeof data.csrf_token === "string" && data.csrf_token) setCsrfToken(data.csrf_token);
        if (data.session && typeof data.session === "object" && data.session.idle_expires_at) {
            info = data.session;
            const server = Date.parse(info.server_time);
            if (Number.isFinite(server)) clockOffset = server - Date.now();
            if (ended) resume();
        }
        tick();
    }

    // Rein lesend; ein 401 beendet ueber den fetch-Wrapper.
    function check() {
        if (!checking) {
            checking = fetch("/api/session/authz", { headers: { Accept: "application/json" } })
                .then(async response => { if (response.ok) update(await response.json()); })
                .catch(() => {})
                .finally(() => { checking = null; });
        }
        return checking;
    }

    function reportActivity() {
        lastActivity = Date.now();
        try { window.sessionStorage.setItem(ACTIVITY_KEY, String(lastActivity)); } catch (_) { /* nur Drossel */ }
        // keepalive: die Meldung kommt auch an, wenn der Klick eine Navigation ausloest.
        return fetch("/api/session/activity", { method: "POST", keepalive: true, headers: { Accept: "application/json" } })
            .then(async response => {
                if (response.ok) update(await response.json());
                return response.ok;
            })
            .catch(() => false);
    }

    function onActivity(event) {
        if (!boot || ended || !event.isTrusted || document.visibilityState !== "visible") return;
        let stored = 0;
        try { stored = Number(window.sessionStorage.getItem(ACTIVITY_KEY)) || 0; } catch (_) { /* egal */ }
        if (Date.now() - Math.max(stored, lastActivity) < ACTIVITY_INTERVAL_MS) return;
        reportActivity();
    }

    function tick() {
        if (!boot || ended) return;
        const due = deadlines();
        if (!due) return;
        const now = serverNow();
        if (now >= Math.min(due.idle, due.absolute)) {
            check();
            return;
        }
        if (due.absolute <= due.idle && due.absolute - now <= WARN_BEFORE_MS) {
            if (dismissedAbsolute !== null && Math.abs(due.absolute - dismissedAbsolute) < ACTIVITY_INTERVAL_MS) hideBanner();
            else showBanner("absolute", due.absolute);
            return;
        }
        if (due.idle - now <= WARN_BEFORE_MS) {
            // Aktivitaet in einem anderen Tab verlaengert auch hier: vor dem Hinweis und danach jede Minute
            // nachfragen. Ein verschobener Ablauf blendet den Hinweis wieder aus.
            if (Date.now() - idleCheckedAt >= ACTIVITY_INTERVAL_MS) {
                idleCheckedAt = Date.now();
                check();
                if (ui?.kind !== "idle") return;
            }
            showBanner("idle", due.idle);
            return;
        }
        hideBanner();
    }

    function end(code) {
        if (ended || !boot) return;
        const due = deadlines();
        const lapsed = due && serverNow() >= Math.min(due.idle, due.absolute) - 5000;
        ended = code === "session_expired" || lapsed ? TEXT.expired
            : code === "session_revoked" ? TEXT.revoked
            : TEXT.missing;
        focusBefore = document.activeElement;
        setLocked(true);
        showBanner("ended");
        // Ein offener nativer Dialog liegt im Top Layer ueber dem Banner: dann gleich die Anmeldung zeigen.
        // App-Overlays (.ui-modal-overlay u. a.) liegen per z-index darunter (session.css).
        if (document.querySelector("dialog:modal")) openRelogin();
    }

    function resume() {
        ended = null;
        idleCheckedAt = 0;
        dismissedAbsolute = null;
        if (ui?.dialog.open) ui.dialog.close();
        setLocked(false);
        hideBanner();
        if (focusBefore?.isConnected) focusBefore.focus({ preventScroll: true });
        focusBefore = null;
        if (typeof window.showFlash === "function") window.showFlash(TEXT.resumed, "success");
        window.dispatchEvent(new CustomEvent("sofa:session-resumed"));
    }

    // ---- Oberflaeche ----

    function build() {
        if (ui) return ui;
        const banner = document.createElement("div");
        banner.className = "session-banner";
        banner.hidden = true;
        banner.innerHTML = '<p class="session-banner-text"></p><button type="button" class="session-banner-action"></button>';

        const dialog = document.createElement("dialog");
        dialog.className = "session-dialog";
        dialog.setAttribute("aria-labelledby", "session-dialog-title");
        dialog.innerHTML = `
            <form class="session-form" novalidate>
                <span class="session-logo" aria-hidden="true"></span>
                <h2 id="session-dialog-title">Erneut anmelden</h2>
                <p class="session-notice"></p>
                <div class="session-error" role="alert" tabindex="-1" hidden></div>
                <label for="session-pnr" class="session-visually-hidden">Personalnummer</label>
                <input id="session-pnr" name="pnr" type="text" autocomplete="username" autocapitalize="none"
                       spellcheck="false" placeholder="Personalnummer" required>
                <label for="session-password" class="session-visually-hidden">Passwort</label>
                <div class="session-password">
                    <input id="session-password" name="password" type="password" autocomplete="current-password"
                           placeholder="Passwort" required>
                    <button type="button" class="session-reveal" aria-label="Passwort anzeigen" aria-pressed="false"
                            aria-controls="session-password">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>
                </div>
                <button type="submit" class="session-submit"><span>Anmelden</span><span aria-hidden="true">→</span></button>
                <button type="button" class="session-cancel">Abbrechen</button>
            </form>`;
        document.body.append(banner, dialog);

        const form = dialog.querySelector("form");
        ui = {
            banner, dialog, form,
            text: banner.querySelector(".session-banner-text"),
            action: banner.querySelector(".session-banner-action"),
            notice: dialog.querySelector(".session-notice"),
            error: dialog.querySelector(".session-error"),
            pnr: dialog.querySelector("#session-pnr"),
            password: dialog.querySelector("#session-password"),
            reveal: dialog.querySelector(".session-reveal"),
            submit: dialog.querySelector(".session-submit"),
            kind: null,
            busy: false,
        };

        ui.action.addEventListener("click", () => {
            if (ui.kind === "ended") openRelogin();
            else if (ui.kind === "idle") reportActivity().then(ok => { if (!ok) check(); });
            else if (ui.kind === "absolute") {
                dismissedAbsolute = deadlines()?.absolute ?? null;
                hideBanner();
            }
        });
        ui.reveal.addEventListener("click", () => setPasswordVisible(ui.password.type === "password"));
        for (const field of [ui.pnr, ui.password]) field.addEventListener("input", () => field.removeAttribute("aria-invalid"));
        dialog.querySelector(".session-cancel").addEventListener("click", () => dialog.close());
        dialog.addEventListener("close", () => {
            ui.password.value = "";
            setPasswordVisible(false);
            if (ended && !ui.banner.hidden) ui.action.focus();
        });
        form.addEventListener("submit", submitLogin);
        return ui;
    }

    function formatTime(serverMs) {
        return new Date(serverMs - clockOffset).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    }

    function showBanner(kind, at) {
        build();
        const texts = {
            idle: [`Deine Sitzung läuft um ${formatTime(at)} Uhr ab.`, "Weiterarbeiten"],
            absolute: [`Deine Sitzung endet um ${formatTime(at)} Uhr. Bitte speichere deine Arbeit.`, "OK"],
            ended: [ended, "Erneut anmelden"],
        }[kind];
        if (ui.kind === kind && !ui.banner.hidden && ui.text.textContent === texts[0]) return;
        ui.kind = kind;
        ui.banner.dataset.kind = kind;
        ui.banner.setAttribute("role", kind === "ended" ? "alert" : "status");
        ui.text.textContent = texts[0];
        ui.action.textContent = texts[1];
        const header = document.querySelector(".main-header");
        ui.banner.style.top = `${Math.max(0, header ? header.getBoundingClientRect().bottom : 0) + 12}px`;
        ui.banner.hidden = false;
        if (kind === "ended") ui.action.focus({ preventScroll: true });
    }

    function hideBanner() {
        if (!ui || ui.banner.hidden) return;
        ui.banner.hidden = true;
        ui.kind = null;
    }

    // Alles ausser Banner und Anmeldedialog ist gesperrt, solange die Sitzung fehlt.
    function setLocked(locked) {
        document.body.classList.toggle("session-locked", locked);
        for (const element of document.body.children) {
            if (element === ui?.banner || element === ui?.dialog || element.tagName === "SCRIPT") continue;
            if (locked) {
                if (!element.inert) {
                    element.inert = true;
                    element.dataset.sessionInert = "";
                }
            } else if (element.dataset.sessionInert !== undefined) {
                element.inert = false;
                delete element.dataset.sessionInert;
            }
        }
    }

    function setPasswordVisible(show) {
        ui.password.type = show ? "text" : "password";
        ui.reveal.setAttribute("aria-pressed", String(show));
        ui.reveal.setAttribute("aria-label", show ? "Passwort verbergen" : "Passwort anzeigen");
    }

    function showError(message, credentials) {
        ui.error.textContent = message;
        ui.error.hidden = false;
        for (const field of [ui.pnr, ui.password]) {
            if (credentials) field.setAttribute("aria-invalid", "true");
            else field.removeAttribute("aria-invalid");
        }
        ui.error.focus();
    }

    function setBusy(busy) {
        ui.busy = busy;
        ui.submit.disabled = busy;
        ui.form.setAttribute("aria-busy", String(busy));
        ui.submit.firstElementChild.textContent = busy ? "Anmeldung läuft …" : "Anmelden";
    }

    async function openRelogin() {
        build();
        // Vielleicht hat sich in einem anderen Tab schon jemand angemeldet.
        await check();
        if (!ended) return;
        ui.notice.textContent = `${ended} Bitte melde dich erneut an.`;
        ui.error.hidden = true;
        if (!ui.pnr.value) ui.pnr.value = boot.pnr || "";
        if (!ui.dialog.open) ui.dialog.showModal();
        (ui.pnr.value ? ui.password : ui.pnr).focus();
    }

    async function submitLogin(event) {
        event.preventDefault();
        if (ui.busy) return;
        const pnr = ui.pnr.value.trim();
        const password = ui.password.value;
        if (!pnr || !password) {
            showError(TEXT.missingFields, false);
            return;
        }
        setPasswordVisible(false);
        setBusy(true);
        try {
            // Direkt, ohne Wrapper: es gibt keine Sitzung, deren CSRF-Token passen koennte.
            const response = await nativeFetch("/api/session/login", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ pnr, password }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const detail = data?.detail || {};
                showError(typeof detail.message === "string" && detail.message ? detail.message : TEXT.failed,
                    detail.code === "invalid_credentials");
                ui.password.value = "";
                return;
            }
            ui.password.value = "";
            update(data);  // anderes Konto: neu laden; sonst weiter in diesem Tab
        } catch (_) {
            showError(TEXT.unreachable, false);
        } finally {
            setBusy(false);
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        const data = window.sofaSession;
        if (!data || typeof data !== "object" || data.user_id == null) return;
        boot = data;
        update({ session: data.info });
        for (const type of ACTIVITY_EVENTS) {
            document.addEventListener(type, onActivity, { capture: true, passive: true });
        }
        window.setInterval(tick, CHECK_EVERY_MS);
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
        // Aus dem bfcache: Zustand kann veraltet sein (z. B. Logout in einem anderen Tab).
        window.addEventListener("pageshow", event => { if (event.persisted) check(); });
    });

    window.SofaSession = { update, check, reportActivity };
})();
