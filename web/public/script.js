let selectedModel = null;
let selectedInstanceType = null;
let isDeploying = false;
let isDestroying = false;
let eventSource = null;
let sessionRefreshInterval = null;
let ipAutoCidrApplied = false;
let lastSubmittedSession = null;

const MODEL_CATALOG = [
  {
    title: 'Modeles legers',
    items: [
      { id: 'qwen-mini', name: 'Qwen Mini', pull: 'qwen2.5:0.5b', tag: 'Ultra leger' },
      { id: 'llama3-1b', name: 'Llama 3.2 1B', pull: 'llama3.2:1b', tag: 'Polyvalent' },
      { id: 'phi3-mini', name: 'Phi 3 Mini', pull: 'phi3:mini', tag: 'Compact' },
      { id: 'phi4-mini', name: 'Phi 4 Mini', pull: 'phi4-mini', tag: 'Petit mais solide' }
    ]
  },
  {
    title: 'Generalistes puissants',
    items: [
      { id: 'qwen-7b', name: 'Qwen 2.5 7B', pull: 'qwen2.5:7b', tag: 'Bon equilibre' },
      { id: 'qwen-14b', name: 'Qwen 2.5 14B', pull: 'qwen2.5:14b', tag: 'Plus qualitatif' },
      { id: 'gpt-oss-20b', name: 'GPT-OSS 20B', pull: 'gpt-oss:20b', tag: 'Tres puissant' },
      { id: 'mistral-small-24b', name: 'Mistral Small 24B', pull: 'mistral-small3.2:24b', tag: 'Tres lourd' }
    ]
  },
  {
    title: 'Code et non restreints',
    items: [
      { id: 'qwen-coder-14b', name: 'Qwen Coder 14B', pull: 'qwen2.5-coder:14b', tag: 'Special code' },
      { id: 'dolphin3-8b', name: 'Dolphin 3 8B', pull: 'dolphin3:8b', tag: 'Moins filtre' },
      { id: 'llama2-uncensored-7b', name: 'Llama2 Uncensored 7B', pull: 'llama2-uncensored:7b', tag: 'Moins restreint' }
    ]
  }
];

function getAdminToken() {
  return localStorage.getItem('terminiatorAdminToken') || '';
}

function authHeaders() {
  return { 'Content-Type': 'application/json' };
}

function isValidIPv4Cidr(cidr) {
  if (typeof cidr !== 'string') return false;
  const value = cidr.trim();
  const match = value.match(/^(\d{1,3})(?:\.(\d{1,3})){3}\/(\d{1,2})$/);
  if (!match || value === '0.0.0.0/0') return false;

  const parts = value.split('/');
  const octets = parts[0].split('.').map((part) => Number.parseInt(part, 10));
  const prefix = Number.parseInt(parts[1], 10);

  return (
    octets.length === 4 &&
    octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    Number.isInteger(prefix) &&
    prefix >= 0 &&
    prefix <= 32
  );
}

function isValidUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

async function detectPublicCidr() {
  const allowedCidrInput = document.getElementById('allowedCidr');
  if (!allowedCidrInput || allowedCidrInput.value.trim() !== '' || ipAutoCidrApplied) {
    return;
  }

  try {
    const response = await fetch('/api/public-cidr');
    if (!response.ok) return;
    const data = await response.json();
    const cidr = typeof data.cidr === 'string' ? data.cidr.trim() : '';
    if (!cidr) return;

    allowedCidrInput.value = cidr;
    localStorage.setItem('allowedCidr', allowedCidrInput.value);
    ipAutoCidrApplied = true;
  } catch (_) {
    // fallback to manual entry in advanced settings
  }
}

function addLog(message, type = 'info') {
  handleLog({
    message,
    type,
    timestamp: new Date().toISOString()
  });
}

function connectLogStream() {
  if (eventSource) return;
  eventSource = new EventSource('/api/stream');

  eventSource.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data);
      handleLog(log);
    } catch (error) {
      console.error('Log SSE invalide', error, event.data);
    }
  };

  eventSource.onerror = (error) => {
    console.error('Erreur SSE', error);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

function handleLog(log) {
  const logsDiv = document.getElementById('logs');
  if (logsDiv) {
    const line = document.createElement('div');
    line.className = `log-line log-${log.type}`;
    line.textContent = `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.message}`;
    logsDiv.appendChild(line);
    logsDiv.scrollTop = logsDiv.scrollHeight;
  }

  const logsSection = document.getElementById('logsSection');
  if (logsSection && logsSection.style.display === 'none') {
    logsSection.style.display = 'block';
  }
}

function resetUiForNewOperation(op) {
  const logsDiv = document.getElementById('logs');
  const logsSection = document.getElementById('logsSection');
  const summary = document.getElementById('sessionSummary');

  if (logsDiv) {
    logsDiv.innerHTML = '';
  }

  if (logsSection) {
    logsSection.style.display = 'block';
  }

  if (!summary) return;

  summary.classList.remove('ready');
  if (op === 'deploy') {
    summary.textContent = 'Creation de la session en cours...';
  } else if (op === 'destroy') {
    summary.textContent = 'Destruction de la session en cours...';
  } else {
    summary.textContent = 'Aucune session active.';
  }
}

function formatDateTime(iso) {
  if (!iso) return 'n/a';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString();
}

function normalizeOperationType(type) {
  return type || 'idle';
}

function applyOperationState(operation = {}) {
  const deployBtn = document.getElementById('deployBtn');
  const openSessionBtn = document.getElementById('openSessionBtn');
  const destroyBtn = document.getElementById('destroyBtn');
  const normalizedType = normalizeOperationType(operation.type);
  const isRunning = operation.status === 'running';

  isDeploying = isRunning && normalizedType === 'deploy';
  isDestroying = isRunning && normalizedType === 'destroy';

  if (deployBtn) {
    deployBtn.disabled = isRunning;
    deployBtn.classList.toggle('running', isDeploying);
    deployBtn.textContent = isDeploying ? 'Creation en cours...' : 'Creer la session';
  }

  if (openSessionBtn) {
    openSessionBtn.disabled = true;
  }

  if (destroyBtn) {
    destroyBtn.disabled = isRunning;
    destroyBtn.classList.toggle('running', isDestroying);
    destroyBtn.textContent = isDestroying ? 'Destruction en cours...' : 'Detruire la session et le reseau';
  }
}

function humanizeErrorMessage(errorText) {
  if (!errorText) return 'Erreur cote backend. Regarde le journal.';
  if (errorText.includes('trusted_header')) {
    return 'Le mode sans mot de passe demande un proxy ou un SSO d entreprise deja configure.';
  }
  if (errorText.includes('allowedCidr')) {
    return 'Le reseau autorise est invalide. Reessaie avec l adresse detectee automatiquement ou un /32 connu.';
  }
  if (errorText.includes('Terraform introuvable')) {
    return 'Terraform est introuvable sur le serveur TerminIAtor.';
  }
  if (errorText.includes('VcpuLimitExceeded')) {
    return 'Le quota AWS de vCPU est insuffisant pour cette machine.';
  }
  if (errorText.includes('OpenWebUI')) {
    return 'La session AWS est creee mais OpenWebUI n est pas encore disponible.';
  }
  return errorText;
}

function renderSessionSummary(session, draftSession = null, operation = {}) {
  const summary = document.getElementById('sessionSummary');
  if (!summary) return;

  const fallbackSession = lastSubmittedSession || {};
  const fallbackDraft = draftSession || fallbackSession;
  const isRunning = operation.status === 'running';
  if ((!session || !session.active) && !isRunning && !fallbackDraft) {
    summary.classList.remove('ready');
    summary.innerHTML = 'Aucune session active.';
    return;
  }

  summary.classList.add('ready');
  const statusLabel = isRunning
      ? operation.type === 'destroy'
      ? 'Destruction en cours'
      : (session && session.status === 'provisioning') ||
        (fallbackDraft && fallbackDraft.status === 'provisioning')
        ? 'Session en preparation'
        : 'Creation en cours'
    : (session && session.status) === 'ready'
      ? 'Session active'
      : (session && session.status) === 'provisioning'
      ? 'Session en preparation'
      : fallbackDraft && fallbackDraft.status === 'provisioning'
      ? 'Session en preparation'
      : 'Session';
  const isReady =
    (session && session.status === 'ready') ||
    (!isRunning && session && session.active && session.status !== 'provisioning');
  const rawAccessUrl =
    (session && session.accessUrl) || (fallbackDraft && fallbackDraft.accessUrl) || null;
  const access = isReady && rawAccessUrl
    ? `<a href="${rawAccessUrl}" target="_blank" rel="noopener noreferrer">${rawAccessUrl}</a>`
    : isRunning
      ? 'Le lien sera utilisable quand la session sera prete.'
      : rawAccessUrl || 'URL indisponible';
  const effectiveName =
    (session && session.workspaceName) || (fallbackDraft && fallbackDraft.workspaceName) || 'Session IA';
  const effectiveMode =
    (session && session.authMode) || (fallbackDraft && fallbackDraft.authMode) || 'local_admin';
  const effectiveTeamSize =
    (session && session.teamSizeHint) || (fallbackDraft && fallbackDraft.teamSizeHint) || 'n/a';
  const effectiveExpiresAt =
    (session && session.expiresAt) || (fallbackDraft && fallbackDraft.expiresAt) || null;
  const effectiveInstance =
    (session && session.instanceType) || (fallbackDraft && fallbackDraft.instanceType) || 'n/a';
  const effectiveModel =
    (session && session.modelLabel) || (fallbackDraft && fallbackDraft.modelLabel) || 'n/a';
  const effectiveAdminEmail =
    (session && session.adminEmail) || (fallbackDraft && fallbackDraft.adminEmail) || 'n/a';
  const effectiveNotes =
    (session && session.accessNotes) || (fallbackDraft && fallbackDraft.accessNotes) || '';
  const autoOpenAvailable = Boolean(session && session.autoOpenAvailable);
  const proxyUrl = (session && session.proxyUrl) || null;
  summary.innerHTML =
    `<strong>${statusLabel}</strong><br>` +
    `Nom : ${effectiveName}<br>` +
    `Acces : ${access}<br>` +
    `Mode : ${effectiveMode === 'trusted_header' ? 'SSO / proxy entreprise' : 'Compte admin local'}<br>` +
    `Machine : ${effectiveInstance}<br>` +
    `Modele : ${effectiveModel}<br>` +
    `Admin : ${effectiveAdminEmail}<br>` +
    `Equipe : ${effectiveTeamSize} utilisateur(s)<br>` +
    `Expire : ${formatDateTime(effectiveExpiresAt)}` +
    (autoOpenAvailable && proxyUrl ? `<br>Passerelle locale : ${proxyUrl}` : '') +
    (effectiveNotes ? `<br>Acces : ${effectiveNotes}` : '');

  const openSessionBtn = document.getElementById('openSessionBtn');
  if (openSessionBtn) {
    openSessionBtn.disabled = !autoOpenAvailable || isRunning;
  }
}

async function refreshSessionSummary() {
  try {
    const response = await fetch('/api/session', {
      method: 'GET'
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data && data.session) {
      applyOperationState(data.operation || {});
      renderSessionSummary(data.session, data.draftSession || null, data.operation || {});
    }
  } catch (_) {
    // keep previous UI on refresh failures
  }
}

function renderModelCatalog() {
  const container = document.getElementById('modelCatalog');
  if (!container) return [];

  container.innerHTML = '';

  MODEL_CATALOG.forEach((group) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'model-group';

    const title = document.createElement('h3');
    title.className = 'model-family-title';
    title.textContent = group.title;

    const grid = document.createElement('div');
    grid.className = 'models-grid';

    group.items.forEach((model) => {
      const card = document.createElement('div');
      card.className = 'model-card';
      card.dataset.model = model.id;
      card.innerHTML = `
        <h3>${model.name}</h3>
        <p class="model-desc">${model.pull}</p>
        <span class="model-tag">${model.tag}</span>
      `;
      grid.appendChild(card);
    });

    wrapper.appendChild(title);
    wrapper.appendChild(grid);
    container.appendChild(wrapper);
  });

  return Array.from(container.querySelectorAll('.model-card'));
}

function setupModelSelection() {
  const modelCatalog = document.getElementById('modelCatalog');
  const selectedModelDiv = document.getElementById('selectedModel');
  const selectedModelNameSpan = document.getElementById('selectedModelName');

  if (!modelCatalog || !selectedModelDiv || !selectedModelNameSpan) return;

  const cards = renderModelCatalog();
  if (!cards.length) return;

  const applyModelSelection = (card) => {
    cards.forEach((item) => item.classList.remove('selected'));
    card.classList.add('selected');
    selectedModel = card.dataset.model;
    selectedModelDiv.style.display = 'block';
    selectedModelNameSpan.textContent = card.querySelector('h3').textContent;
    localStorage.setItem('selectedModel', selectedModel);
  };

  const savedModel = localStorage.getItem('selectedModel');
  const initialCard = cards.find((card) => card.dataset.model === savedModel) || cards[0];
  applyModelSelection(initialCard);

  if (modelCatalog.dataset.clickBound !== '1') {
    modelCatalog.addEventListener('click', (event) => {
      const card = event.target.closest('.model-card');
      if (!card || !modelCatalog.contains(card)) return;
      applyModelSelection(card);
    });
    modelCatalog.dataset.clickBound = '1';
  }
}

function setupInstanceSelection() {
  const cards = Array.from(document.querySelectorAll('.instance-card'));
  const selectedInstanceDiv = document.getElementById('selectedInstance');
  const selectedInstanceNameSpan = document.getElementById('selectedInstanceName');

  if (!cards.length || !selectedInstanceDiv || !selectedInstanceNameSpan) return;

  const savedInstance = localStorage.getItem('selectedInstanceType');
  const initialCard = cards.find((card) => card.dataset.instance === savedInstance)
    || cards.find((card) => card.dataset.instance === 'g4dn.xlarge')
    || cards[0];

  const applyInstanceSelection = (card) => {
    cards.forEach((item) => item.classList.remove('selected'));
    card.classList.add('selected');
    selectedInstanceType = card.dataset.instance;
    selectedInstanceDiv.style.display = 'block';
    selectedInstanceNameSpan.textContent = selectedInstanceType;
    localStorage.setItem('selectedInstanceType', selectedInstanceType);
  };

  applyInstanceSelection(initialCard);

  cards.forEach((card) => {
    card.addEventListener('click', () => applyInstanceSelection(card));
  });
}

function saveFieldOnChange(id) {
  const input = document.getElementById(id);
  if (!input) return;

  const saved = localStorage.getItem(id);
  if (saved !== null) {
    input.value = saved;
  }

  input.addEventListener('change', () => {
    localStorage.setItem(id, input.value.trim());
  });
}

function setupPersistentFields() {
  [
    'workspaceName',
    'sessionTtlHours',
    'teamSizeHint',
    'allowedCidr',
    'workspaceUrl',
    'authMode',
    'trustedEmailHeader',
    'trustedNameHeader',
    'trustedGroupsHeader',
    'trustedRoleHeader',
    'owuiName',
    'owuiEmail'
  ].forEach(saveFieldOnChange);
}

function updateAuthModeUi() {
  const authMode = document.getElementById('authMode')?.value || 'local_admin';
  const trustedHeaderFields = document.getElementById('trustedHeaderFields');
  const passwordField = document.getElementById('passwordField');
  const passwordInput = document.getElementById('owuiPassword');

  if (trustedHeaderFields) {
    trustedHeaderFields.style.display = authMode === 'trusted_header' ? 'grid' : 'none';
  }

  if (passwordField) {
    passwordField.style.display = authMode === 'trusted_header' ? 'none' : 'flex';
  }

  if (passwordInput) {
    passwordInput.required = authMode !== 'trusted_header';
    if (authMode === 'trusted_header') {
      passwordInput.value = '';
    }
  }
}

function setupAuthMode() {
  const authMode = document.getElementById('authMode');
  if (!authMode) return;

  updateAuthModeUi();
  authMode.addEventListener('change', () => {
    localStorage.setItem('authMode', authMode.value);
    updateAuthModeUi();
  });
}

function collectDeployPayload() {
  const authMode = document.getElementById('authMode')?.value || 'local_admin';
  const payload = {
    workspaceName: (document.getElementById('workspaceName')?.value || '').trim(),
    sessionTtlHours: (document.getElementById('sessionTtlHours')?.value || '').trim(),
    teamSizeHint: (document.getElementById('teamSizeHint')?.value || '').trim(),
    allowedCidr: (document.getElementById('allowedCidr')?.value || '').trim(),
    workspaceUrl: (document.getElementById('workspaceUrl')?.value || '').trim(),
    authMode,
    trustedEmailHeader: (document.getElementById('trustedEmailHeader')?.value || '').trim(),
    trustedNameHeader: (document.getElementById('trustedNameHeader')?.value || '').trim(),
    trustedGroupsHeader: (document.getElementById('trustedGroupsHeader')?.value || '').trim(),
    trustedRoleHeader: (document.getElementById('trustedRoleHeader')?.value || '').trim(),
    owuiName: (document.getElementById('owuiName')?.value || '').trim(),
    owuiEmail: (document.getElementById('owuiEmail')?.value || '').trim(),
    owuiPassword: document.getElementById('owuiPassword')?.value || '',
    aiChoice: selectedModel,
    instanceType: selectedInstanceType
  };

  return payload;
}

function validateDeployPayload(payload) {
  if (!payload.workspaceName) {
    return 'Renseigne un nom de session.';
  }
  if (payload.allowedCidr && !isValidIPv4Cidr(payload.allowedCidr)) {
    return 'Le CIDR doit etre un IPv4 restrictif, par exemple 203.0.113.10/32.';
  }
  if (!isValidUrl(payload.workspaceUrl)) {
    return 'L URL publique de la session est invalide.';
  }
  if (!payload.owuiEmail) {
    return 'Renseigne l email admin OpenWebUI.';
  }
  if (payload.authMode === 'trusted_header' && !payload.workspaceUrl) {
    return 'Le mode sans mot de passe demande une URL d entreprise ou un proxy deja configure.';
  }
  if (payload.authMode === 'local_admin' && payload.owuiPassword.length < 8) {
    return 'Le mot de passe admin doit faire au moins 8 caracteres.';
  }
  if (!selectedModel || !selectedInstanceType) {
    return 'Choisis un modele et une instance.';
  }
  if (!payload.allowedCidr) {
    return 'Le CIDR n a pas pu etre detecte automatiquement. Ouvre les parametres avances pour le renseigner.';
  }
  return null;
}

function setupDeployButton() {
  const deployBtn = document.getElementById('deployBtn');
  const logsSection = document.getElementById('logsSection');
  if (!deployBtn) return;

  deployBtn.addEventListener('click', async () => {
    if (isDeploying) return;

    const payload = collectDeployPayload();
    const validationError = validateDeployPayload(payload);
    if (validationError) {
      window.alert(validationError);
      return;
    }

    resetUiForNewOperation('deploy');
    lastSubmittedSession = {
      workspaceName: payload.workspaceName,
      authMode: payload.authMode,
      teamSizeHint: Number.parseInt(payload.teamSizeHint, 10) || payload.teamSizeHint,
      sessionTtlHours: Number.parseInt(payload.sessionTtlHours, 10) || payload.sessionTtlHours,
      allowedCidr: payload.allowedCidr,
      status: 'provisioning',
      expiresAt: null,
      accessUrl: payload.workspaceUrl || null
    };
    localStorage.setItem('lastSubmittedSession', JSON.stringify(lastSubmittedSession));
    isDeploying = true;
    deployBtn.disabled = true;
    deployBtn.classList.add('running');
    deployBtn.textContent = 'Creation en cours...';

    if (logsSection) {
      logsSection.style.display = 'block';
    }

    addLog(`Creation demandee pour la session ${payload.workspaceName}`, 'info');

    try {
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errorText = 'Erreur cote backend. Regarde le journal.';
        try {
          const data = await response.json();
          if (data && data.error) errorText = data.error;
        } catch (_) {
          // ignore parse errors
        }
        errorText = humanizeErrorMessage(errorText);
        addLog(`Erreur backend deploy: ${errorText}`, 'error');
        window.alert(errorText);
      } else {
        addLog('Commande envoyee. Suis la progression dans le journal.', 'success');
        setTimeout(() => {
          refreshSessionSummary();
        }, 1000);
      }
    } catch (error) {
      addLog(`Erreur de connexion backend : ${error.message}`, 'error');
      window.alert('Erreur de connexion au backend.');
    } finally {
      isDeploying = false;
      deployBtn.disabled = false;
      deployBtn.classList.remove('running');
      deployBtn.textContent = 'Creer la session';
    }
  });
}

function setupDestroyButton() {
  const destroyBtn = document.getElementById('destroyBtn');
  const logsSection = document.getElementById('logsSection');
  if (!destroyBtn) return;

  destroyBtn.addEventListener('click', async () => {
    if (isDestroying) return;

    if (!window.confirm('Tu vas supprimer la session, la VM et le reseau AWS associe. Continuer ?')) {
      return;
    }

    resetUiForNewOperation('destroy');
    isDestroying = true;
    destroyBtn.disabled = true;
    destroyBtn.classList.add('running');
    destroyBtn.textContent = 'Destruction en cours...';

    if (logsSection) {
      logsSection.style.display = 'block';
    }

    addLog('Destruction demandee.', 'info');

    try {
      const response = await fetch('/api/destroy', {
        method: 'POST',
        headers: authHeaders()
      });

      if (!response.ok) {
        let errorText = 'Erreur cote backend. Regarde le journal.';
        try {
          const data = await response.json();
          if (data && data.error) errorText = data.error;
        } catch (_) {
          // ignore parse errors
        }
        errorText = humanizeErrorMessage(errorText);
        addLog(`Erreur backend destroy: ${errorText}`, 'error');
        window.alert(errorText);
      } else {
        addLog('Destruction lancee. Suis la progression dans le journal.', 'success');
        setTimeout(() => {
          refreshSessionSummary();
        }, 1000);
      }
    } catch (error) {
      addLog(`Erreur de connexion backend : ${error.message}`, 'error');
      window.alert('Erreur de connexion au backend.');
    } finally {
      isDestroying = false;
      destroyBtn.disabled = false;
      destroyBtn.classList.remove('running');
      destroyBtn.textContent = 'Detruire la session et le reseau';
    }
  });
}

function setupOpenSessionButton() {
  const openSessionBtn = document.getElementById('openSessionBtn');
  if (!openSessionBtn) return;

  openSessionBtn.addEventListener('click', async () => {
    if (openSessionBtn.disabled) return;

    openSessionBtn.disabled = true;
    const initialText = openSessionBtn.textContent;
    openSessionBtn.textContent = 'Ouverture...';

    try {
      const response = await fetch('/api/session/open', {
        method: 'POST',
        headers: authHeaders()
      });

      if (!response.ok) {
        let errorText = 'Ouverture automatique impossible.';
        try {
          const data = await response.json();
          if (data && data.error) errorText = data.error;
        } catch (_) {
          // ignore parse errors
        }
        errorText = humanizeErrorMessage(errorText);
        addLog(`Erreur ouverture session: ${errorText}`, 'error');
        window.alert(errorText);
        return;
      }

      const data = await response.json();
      if (!data.openUrl) {
        throw new Error('Lien d ouverture indisponible');
      }

      window.open(data.openUrl, '_blank', 'noopener');
      addLog('Passerelle OpenWebUI ouverte dans un nouvel onglet.', 'success');
    } catch (error) {
      addLog(`Erreur ouverture session: ${error.message}`, 'error');
      window.alert('Impossible d ouvrir la session automatiquement.');
    } finally {
      openSessionBtn.textContent = initialText;
      refreshSessionSummary();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    const saved = localStorage.getItem('lastSubmittedSession');
    if (saved) {
      lastSubmittedSession = JSON.parse(saved);
    }
  } catch (_) {
    lastSubmittedSession = null;
  }
  connectLogStream();
  setupPersistentFields();
  setupAuthMode();
  setupModelSelection();
  setupInstanceSelection();
  setupDeployButton();
  setupOpenSessionButton();
  setupDestroyButton();
  refreshSessionSummary();
  detectPublicCidr();
  sessionRefreshInterval = setInterval(refreshSessionSummary, 15000);
});
