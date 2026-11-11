/* Loginseite: Passwortanzeige, Fokus, kein zweiter Submit. Funktioniert auch ohne JS (normales Formular). */
(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const form = $('auth-form');
    const pnr = $('auth-pnr');
    const password = $('auth-password');
    const reveal = $('auth-show-password');
    const submit = $('auth-submit');
    const error = $('auth-error');
    let busy = false;

    reveal.hidden = false;
    reveal.addEventListener('click', () => {
        const show = password.type === 'password';
        password.type = show ? 'text' : 'password';
        reveal.setAttribute('aria-pressed', String(show));
        reveal.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
    });

    for (const field of [pnr, password]) {
        field.addEventListener('input', () => {
            field.removeAttribute('aria-invalid');
            field.removeAttribute('aria-describedby');
        });
    }

    form.addEventListener('submit', event => {
        if (busy) { event.preventDefault(); return; }
        busy = true;
        // Passwort nie im Klartextfeld absenden lassen (Autofill-/Verlaufsrisiko).
        password.type = 'password';
        submit.disabled = true;
        form.setAttribute('aria-busy', 'true');
        $('auth-submit-label').textContent = 'Anmeldung läuft …';
        $('auth-submit-status').textContent = 'Anmeldung wird geprüft …';
    });

    // Zurück-Navigation aus dem bfcache: Formular wieder bedienbar machen.
    window.addEventListener('pageshow', () => {
        busy = false;
        submit.disabled = false;
        form.removeAttribute('aria-busy');
        $('auth-submit-label').textContent = 'Anmelden';
        $('auth-submit-status').textContent = '';
    });

    if (error) error.focus();
    else if (pnr.value) password.focus();
    else pnr.focus();
})();
