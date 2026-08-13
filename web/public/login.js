(() => {
  const form = document.getElementById('login-form');
  const message = document.getElementById('message');
  const button = document.getElementById('submit-button');
  let challenge = null;
  let timer = null;
  const panel = document.createElement('section');
  panel.className = 'mfa-login-panel';
  panel.hidden = true;
  panel.innerHTML = '<h2>Vérification MFA</h2><input id="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><button id="mfa-verify" type="button">Vérifier</button><button id="mfa-recovery-toggle" type="button">Utiliser un code de récupération</button><input id="mfa-recovery" hidden maxlength="32"><button id="mfa-back" type="button">Retour</button><p id="mfa-message" aria-live="polite"></p>';
  form.after(panel);
  const code = panel.querySelector('#mfa-code'); const recovery = panel.querySelector('#mfa-recovery'); const result = panel.querySelector('#mfa-message');
  function reset() { challenge = null; clearInterval(timer); panel.hidden = true; form.hidden = false; code.value = ''; recovery.value = ''; }
  async function finish(url, body) { const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Code ou challenge invalide.'); window.location.href = '/'; }
  panel.querySelector('#mfa-verify').onclick = async () => { try { await finish('/api/auth/mfa/verify', { challenge, code: code.value }); } catch (e) { result.textContent = e.message; } };
  panel.querySelector('#mfa-recovery-toggle').onclick = () => { recovery.hidden = !recovery.hidden; code.hidden = !recovery.hidden; panel.querySelector('#mfa-verify').textContent = recovery.hidden ? 'Vérifier' : 'Utiliser'; };
  recovery.addEventListener('change', async () => { if (!recovery.hidden) { try { await finish('/api/auth/mfa/recovery', { challenge, recoveryCode: recovery.value }); } catch (e) { result.textContent = e.message; } } });
  panel.querySelector('#mfa-back').onclick = reset;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;

    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email: document.getElementById('email').value.trim(), password: document.getElementById('password').value }) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 202 && data.mfaRequired) { challenge = data.challenge; form.hidden = true; panel.hidden = false; let remaining = data.expiresIn; timer = setInterval(() => { remaining -= 1; if (remaining <= 0) { result.textContent = 'Le challenge a expiré.'; reset(); } }, 1000); return; }
      if (!response.ok) { message.textContent = data.error || 'Connexion impossible.'; return; }
      window.location.href = '/';
    } catch (error) {
      message.textContent = 'Connexion impossible.';
    } finally {
      button.disabled = false;
    }
  }, true);
})();
