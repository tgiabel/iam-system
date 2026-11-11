/* Development-only UX simulation. No fetch, cookies, or real authentication. */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const scenario = $('auth-scenario');
    const form = $('auth-form');
    const password = $('auth-password');
    const pnr = $('auth-pnr');
    const error = $('auth-error');
    const notice = $('auth-notice');
    const submit = $('auth-submit');
    const draft = $('auth-draft');
    const scenarios = new Set(Array.from(scenario.options, option => option.value));
    // Texte kommen aus app/login_errors.py, damit Vorschau und echter Login gleich lauten.
    const messages = JSON.parse(document.body.dataset.messages || '{}');
    const themes = ['light', 'dark', 'servodata'];
    const themeLabels = ['Hell', 'Dunkel', 'Servodata'];
    let state = 'login';
    let target = '/';
    let resume = false;
    let busy = false;
    let attempt = 0;
    let initial = true;

    // This only constrains the displayed demo target; real redirects need server validation.
    function safeTarget(raw) {
        try {
            if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\s]/.test(raw)) return '/';
            const url = new URL(raw, location.origin);
            if (url.origin !== location.origin || !/^\/(?:$|tasks(?:\/|$)|workspace(?:\/|$)|reports\/|users(?:\/|$)|roles(?:\/|$)|systems(?:\/|$)|computers(?:\/|$))/.test(url.pathname)) return '/';
            return url.pathname + url.search + url.hash;
        } catch (_) { return '/'; }
    }

    function writeUrl() {
        const url = new URL(location.href);
        url.search = '';
        url.searchParams.set('state', state);
        if (target !== '/') url.searchParams.set('next', target);
        history.replaceState(null, '', url);
    }

    function clearError() {
        error.hidden = true;
        error.textContent = '';
        for (const field of [pnr, password]) {
            field.removeAttribute('aria-invalid');
            field.setAttribute('aria-describedby', 'preview-hint');
        }
    }

    function showError(kind, focus) {
        error.textContent = messages[kind];
        error.hidden = false;
        if (kind === 'credentials') {
            for (const field of [pnr, password]) {
                field.setAttribute('aria-invalid', 'true');
                field.setAttribute('aria-describedby', 'auth-error preview-hint');
            }
        }
        if (focus) error.focus();
    }

    function concealPassword() {
        password.type = 'password';
        $('auth-show-password').setAttribute('aria-pressed', 'false');
        $('auth-show-password').setAttribute('aria-label', 'Passwort anzeigen');
    }

    function render(focus = true) {
        const app = ['authenticated', 'denied', 'draft'].includes(state);
        $('auth-entry').hidden = app;
        $('auth-app').hidden = !app;
        $('auth-expire').hidden = !app || state === 'draft';
        $('auth-expired').hidden = state !== 'draft';
        $('auth-app-body').inert = state === 'draft';
        $('auth-app-nav').inert = state === 'draft';
        $('auth-denied').hidden = state !== 'denied';
        $('auth-app-grid').hidden = state === 'denied';
        scenario.value = state;
        clearError();
        notice.hidden = true;
        notice.dataset.kind = 'info';
        if (state === 'expired') {
            notice.textContent = 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.';
            notice.hidden = false;
        } else if (state === 'logout') {
            notice.textContent = 'Du bist abgemeldet.';
            notice.dataset.kind = 'success';
            notice.hidden = false;
        } else if (messages[state]) {
            showError(state, false);
        }
        const path = target.split(/[?#]/)[0];
        const title = state === 'denied' ? 'Zugriff auf diese Seite' : path === '/' ? 'Dashboard' : path.startsWith('/tasks') ? 'Aufgaben' : path.startsWith('/workspace') ? 'Workspace' : 'Dein Arbeitsbereich';
        $('auth-app-title').textContent = title;
        $('auth-destination').textContent = target;
        $('auth-return-message').textContent = resume ? 'Wieder angemeldet. Dein Entwurf ist noch da, aber nicht gespeichert.' : target === '/' ? 'Du bist angemeldet.' : 'Du bist angemeldet und an deinem ursprünglichen Ziel.';
        document.querySelectorAll('[data-preview-target]').forEach(button => {
            if (button.dataset.previewTarget === path && state !== 'denied') button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
        document.title = `${app ? title : 'Anmelden'} | SOFA · Vorschau`;
        writeUrl();
        if (focus) {
            if (state === 'draft') $('auth-relogin').focus();
            else if (app) $('auth-app-title').focus();
            else if (messages[state]) error.focus();
            else if (resume && pnr.value) password.focus();
            else pnr.focus();
        }
    }

    function setBusy(value) {
        busy = value;
        submit.disabled = value;
        scenario.disabled = value;
        pnr.readOnly = value;
        password.readOnly = value;
        form.setAttribute('aria-busy', String(value));
        $('auth-submit-label').textContent = value ? 'Anmeldung läuft …' : 'Anmelden';
        $('auth-submit-status').textContent = value ? 'Anmeldung wird geprüft …' : '';
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        if (busy) return;
        clearError();
        const outcome = state;
        const currentAttempt = ++attempt;
        setBusy(true);
        window.setTimeout(() => {
            if (attempt !== currentAttempt) return;
            setBusy(false);
            password.value = '';
            concealPassword();
            if (messages[outcome]) {
                showError(outcome, true);
                return;
            }
            state = 'authenticated';
            render();
        }, 650);
    });
    $('auth-show-password').addEventListener('click', () => {
        const reveal = password.type === 'password';
        password.type = reveal ? 'text' : 'password';
        $('auth-show-password').setAttribute('aria-pressed', String(reveal));
        $('auth-show-password').setAttribute('aria-label', reveal ? 'Passwort verbergen' : 'Passwort anzeigen');
    });
    for (const field of [pnr, password]) field.addEventListener('input', clearError);

    scenario.addEventListener('change', () => {
        state = scenario.value;
        resume = false;
        password.value = '';
        concealPassword();
        $('auth-save-status').textContent = '';
        if (state === 'draft') draft.value = draft.value || 'Rückfrage zur Aufgabe für morgen vorbereiten.';
        if (state === 'logout') { pnr.value = ''; draft.value = ''; target = '/'; }
        render();
    });
    document.querySelectorAll('[data-preview-target]').forEach(button => button.addEventListener('click', () => {
        if (state === 'draft') return;
        target = safeTarget(button.dataset.previewTarget);
        state = 'authenticated';
        resume = false;
        render();
    }));
    $('auth-expire').addEventListener('click', () => { state = 'draft'; render(); });
    $('auth-relogin').addEventListener('click', () => {
        state = 'expired';
        resume = true;
        $('auth-save-status').textContent = '';
        password.value = '';
        concealPassword();
        render();
    });
    $('auth-logout').addEventListener('click', () => {
        state = 'logout';
        resume = false;
        target = '/';
        draft.value = '';
        pnr.value = '';
        password.value = '';
        concealPassword();
        $('auth-save-status').textContent = '';
        render();
    });
    $('auth-save-draft').addEventListener('click', () => {
        $('auth-save-status').textContent = 'Speichern simuliert. Es werden keine Daten übertragen.';
    });

    function updateThemeLabel() {
        const theme = document.documentElement.dataset.theme;
        $('auth-theme').textContent = `Theme: ${themeLabels[themes.indexOf(theme)] || themeLabels[0]}`;
    }
    $('auth-theme').addEventListener('click', () => {
        const current = document.documentElement.dataset.theme;
        document.documentElement.dataset.theme = themes[(themes.indexOf(current) + 1) % themes.length];
        // Deliberately don't change the actual application's saved theme.
        updateThemeLabel();
    });

    function loadLocation() {
        ++attempt;
        setBusy(false);
        const params = new URLSearchParams(location.search);
        state = scenarios.has(params.get('state')) ? params.get('state') : 'login';
        target = safeTarget(params.get('next'));
        resume = false;
        password.value = '';
        concealPassword();
        if (state === 'draft') draft.value = draft.value || 'Rückfrage zur Aufgabe für morgen vorbereiten.';
        render(!initial);
        initial = false;
    }
    window.addEventListener('popstate', loadLocation);
    loadLocation();
    updateThemeLabel();
})();
