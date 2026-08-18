let isDeploying = false;
let isDestroying = false;
let eventSource = null;
let sessionRefreshInterval = null;
let lastSubmittedSession = null;
const CURRENT_SESSION_STORAGE_KEY =
  'privalyse_current_session_id';

function readStoredCurrentSessionId() {
  try {
    return window.sessionStorage.getItem(
      CURRENT_SESSION_STORAGE_KEY
    );
  } catch (_) {
    return null;
  }
}

function setCurrentSessionId(sessionId) {
  const normalized =
    typeof sessionId === 'string' && sessionId.trim() !== ''
      ? sessionId.trim()
      : null;

  currentSessionId = normalized;

  try {
    if (normalized) {
      window.sessionStorage.setItem(
        CURRENT_SESSION_STORAGE_KEY,
        normalized
      );
    } else {
      window.sessionStorage.removeItem(
        CURRENT_SESSION_STORAGE_KEY
      );
    }
  } catch (_) {
    // L'application continue même si sessionStorage est indisponible.
  }
}

let currentSessionId =
  readStoredCurrentSessionId();
let lastKnownSession = null;
let multipleSessionWarningShown = false;
let creationBlockedByActiveSession = false;

function authHeaders() {
  return {
    'Content-Type': 'application/json'
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getSelectedMode() {
  return document.querySelector('input[name="sessionMode"]:checked')?.value || 'individual';
}



function getDurationLabel() {
  const durationSelect = document.getElementById('sessionTtlHours');
  return durationSelect?.selectedOptions[0]?.textContent.trim() || '6 heures';
}

function updateWorkspaceNameCount() {
  const input = document.getElementById('workspaceName');
  const counter = document.getElementById('workspaceNameCount');

  if (input && counter) {
    counter.textContent = `${input.value.length} / ${input.maxLength}`;
  }
}

function setupCustomDurationSelect() {
  const select = document.getElementById('sessionTtlHours');
  const host = select?.closest('.select-with-icon');

  if (!select || !host || host.querySelector('[data-custom-select]')) return;

  const custom = document.createElement('div');
  custom.className = 'custom-select';
  custom.dataset.customSelect = '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'sessionTtlHoursMenu');
  trigger.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg><span class="custom-select-value"></span><svg class="custom-select-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"/></svg>';

  const menu = document.createElement('div');
  menu.id = 'sessionTtlHoursMenu';
  menu.className = 'custom-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;

  const valueElement = trigger.querySelector('.custom-select-value');
  const options = Array.from(select.options);

  const sync = () => {
    const selected = select.selectedOptions[0];
    valueElement.textContent = selected?.textContent || '';
    menu.querySelectorAll('[role="option"]').forEach((option) => {
      const active = option.dataset.value === select.value;
      option.setAttribute('aria-selected', String(active));
      option.classList.toggle('is-selected', active);
    });
  };

  options.forEach((option) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'option');
    item.dataset.value = option.value;
    item.textContent = option.textContent;
    item.addEventListener('click', () => {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    });
    menu.appendChild(item);
  });

  const close = () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };

  trigger.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  });

  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }

    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(menu.querySelectorAll('[role="option"]'));
    const current = items.findIndex((item) => item.dataset.value === select.value);
    const next = event.key === 'ArrowDown' ? Math.min(current + 1, items.length - 1) : Math.max(current - 1, 0);
    items[next]?.focus();
  });

  menu.addEventListener('keydown', (event) => {
    const items = Array.from(menu.querySelectorAll('[role="option"]'));
    const current = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      close();
      trigger.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = event.key === 'ArrowDown' ? Math.min(current + 1, items.length - 1) : Math.max(current - 1, 0);
      items[next]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      items[current]?.click();
    }
  });

  document.addEventListener('click', (event) => {
    if (!custom.contains(event.target)) close();
  });

  custom.append(trigger, menu);
  host.appendChild(custom);
  select.classList.add('native-duration-select');
  sync();
}

function updateLifecycleStepper(session = null, operation = {}) {
  const steps = Array.from(document.querySelectorAll('.lifecycle li'));
  if (steps.length < 4) return;

  const isRunning = operation.status === 'running';
  let activeIndex = 0;
  let stateLabel = 'Configuration';

  if (isRunning && operation.type === 'destroy') {
    activeIndex = 3;
    stateLabel = 'Destruction';
  } else if (isRunning && operation.type === 'deploy') {
    activeIndex = 1;
    stateLabel = 'Préparation en cours';
  } else if (session?.status === 'ready') {
    activeIndex = 2;
    stateLabel = 'Utilisation';
  } else if (session?.status === 'provisioning') {
    activeIndex = 1;
    stateLabel = 'Préparation en cours';
  }

  steps.forEach((step, index) => {
    const state = index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-active' : 'is-pending';
    step.dataset.step = ['configuration', 'provisioning', 'utilisation', 'destruction'][index];
    step.classList.remove('is-pending', 'is-active', 'is-complete');
    step.classList.add(state);
    step.setAttribute('aria-current', state === 'is-active' ? 'step' : 'false');
    const marker = step.querySelector(':scope > span');
    if (marker) {
      marker.innerHTML = state === 'is-complete'
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-8"/></svg>'
        : String(index + 1);
    }
  });

  const card = document.querySelector('.lifecycle-card');
  let status = card?.querySelector('.lifecycle-state');
  if (card && !status) {
    status = document.createElement('p');
    status.className = 'lifecycle-state';
    card.querySelector('h2')?.after(status);
  }
  if (status) status.textContent = `État actuel : ${stateLabel}`;
}

function getGroupLabel() {
  const groupSelect = document.getElementById('groupId');
  return groupSelect?.selectedOptions[0]?.textContent.trim() || '';
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
      handleLog(JSON.parse(event.data));
    } catch (error) {
      console.error('Log SSE invalide', error);
    }
  };

  eventSource.onerror = () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

function handleLog(log) {
  const logsDiv = document.getElementById('logs');
  const logsSection = document.getElementById('logsSection');

  if (logsDiv) {
    const line = document.createElement('div');
    line.className = `log-line log-${log.type || 'info'}`;
    line.textContent =
      `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.message}`;

    logsDiv.appendChild(line);
    logsDiv.scrollTop = logsDiv.scrollHeight;
  }

  if (logsSection) {
    logsSection.style.display = 'block';
  }
}

function updateGroupVisibility() {
  const mode = getSelectedMode();
  const groupSection = document.getElementById('groupSection');
  const groupSelect = document.getElementById('groupId');

  if (groupSection) {
    groupSection.style.display = mode === 'team' ? 'grid' : 'none';
  }

  if (groupSelect) {
    groupSelect.required = mode === 'team';
  }

  updateSummaryPreview();
}

function updateSummaryPreview() {
  const preview = document.getElementById('sessionSummaryPreview');
  if (!preview) return;

  const workspaceName =
    document.getElementById('workspaceName')?.value.trim() ||
    'Analyse de contrats';

  const mode = getSelectedMode();
  const modeLabel = mode === 'team' ? 'Équipe' : 'Individuel';
  const durationLabel = getDurationLabel();
  const groupLabel = mode === 'team' ? getGroupLabel() : '';

  preview.innerHTML =
    `<div class="summary-grid">` +
    `<div class="summary-item"><span>Nom</span><strong>${escapeHtml(workspaceName)}</strong></div>` +
    `<div class="summary-item"><span>Mode</span><strong>${modeLabel}</strong></div>` +
    (mode === 'team'
      ? `<div class="summary-item"><span>Groupe</span><strong>${escapeHtml(groupLabel || 'Aucun groupe sélectionné')}</strong></div>`
      : '') +
    `<div class="summary-item"><span>Durée</span><strong>${escapeHtml(durationLabel)}</strong></div>` +
    `<div class="summary-item"><span>Sécurité</span><strong>Suppression automatique</strong></div>` +
    `</div>`;
}
async function loadAvailableGroups() {
  const groupSelect =
    document.getElementById('groupId');

  if (!groupSelect) {
    return;
  }

  groupSelect.replaceChildren();

  const loadingOption =
    document.createElement('option');

  loadingOption.value = '';
  loadingOption.textContent =
    'Chargement des groupes…';

  groupSelect.appendChild(loadingOption);
  groupSelect.disabled = true;

  try {
    const response = await fetch(
      '/api/groups',
      {
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        `Erreur HTTP ${response.status}`
      );
    }

    const groups =
      Array.isArray(data.groups)
        ? data.groups
        : [];

    groupSelect.replaceChildren();

    const placeholder =
      document.createElement('option');

    placeholder.value = '';

    placeholder.textContent =
      groups.length > 0
        ? 'Sélectionner un groupe'
        : 'Aucun groupe disponible';

    groupSelect.appendChild(placeholder);

    groups.forEach((group) => {
      const option =
        document.createElement('option');

      option.value = group.id;
      option.textContent = group.name;

      groupSelect.appendChild(option);
    });

    groupSelect.disabled =
      groups.length === 0;
  } catch (error) {
    groupSelect.replaceChildren();

    const errorOption =
      document.createElement('option');

    errorOption.value = '';
    errorOption.textContent =
      'Impossible de charger les groupes';

    groupSelect.appendChild(errorOption);
    groupSelect.disabled = true;

    addLog(
      `Erreur chargement groupes : ${error.message}`,
      'error'
    );
  }

  updateSummaryPreview();
}
function setupFormInteractions() {
  const workspaceName = document.getElementById('workspaceName');
  const duration = document.getElementById('sessionTtlHours');
  const groupId = document.getElementById('groupId');
  const modeInputs = document.querySelectorAll('input[name="sessionMode"]');

  workspaceName?.addEventListener('input', updateSummaryPreview);
  workspaceName?.addEventListener('input', updateWorkspaceNameCount);
  duration?.addEventListener('change', updateSummaryPreview);
  groupId?.addEventListener('change', updateSummaryPreview);

  modeInputs.forEach((input) => {
    input.addEventListener('change', updateGroupVisibility);
  });

  updateGroupVisibility();
  updateWorkspaceNameCount();
  setupCustomDurationSelect();
  loadAvailableGroups();
}

function collectDeployPayload() {
  return {
    workspaceName:
      document.getElementById('workspaceName')?.value.trim() || '',
    sessionTtlHours:
      Number.parseInt(
        document.getElementById('sessionTtlHours')?.value || '',
        10
      ),
    sessionMode: getSelectedMode(),
    groupId:
      document.getElementById('groupId')?.value || null,
    
  };
}

function validateDeployPayload(payload) {
  if (!payload.workspaceName) {
    return 'Renseigne un nom pour l’espace sécurisé.';
  }

  if (
    !Number.isInteger(payload.sessionTtlHours) ||
    payload.sessionTtlHours < 1 ||
    payload.sessionTtlHours > 168
  ) {
    return 'La durée sélectionnée est invalide.';
  }

  if (
    !['individual', 'team'].includes(payload.sessionMode)
  ) {
    return 'Le mode de travail sélectionné est invalide.';
  }

  if (payload.sessionMode === 'team' && !payload.groupId) {
    return 'Sélectionne un groupe pour créer un espace en équipe.';
  }

  return null;
}

function resetUiForNewOperation(operationType) {
  const logsDiv = document.getElementById('logs');
  const logsSection = document.getElementById('logsSection');
  const summary = document.getElementById('sessionSummary');

  if (logsDiv) {
    logsDiv.innerHTML = '';
  }

  if (logsSection) {
    logsSection.style.display = 'block';
    logsSection.open = true;
  }

  if (!summary) return;

  summary.classList.remove('ready');

  if (operationType === 'deploy') {
    updateLifecycleStepper(lastSubmittedSession, { type: 'deploy', status: 'running' });
    summary.textContent = 'Création de l’espace sécurisé en cours...';
  } else if (operationType === 'destroy') {
    updateLifecycleStepper(lastKnownSession, { type: 'destroy', status: 'running' });
    summary.textContent = 'Suppression de l’espace en cours...';
  }
}

function formatDateTime(value) {
  if (!value) return 'Non disponible';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Non disponible';
  }

  return date.toLocaleString('fr-FR');
}

function getSessionStatusLabel(status) {
  if (status === 'ready') return 'Prête';
  if (status === 'provisioning') return 'Préparation';
  if (status === 'error') return 'Erreur';
  return status || 'En cours';
}

function renderSessionSelector(sessions = []) {
  const summary = document.getElementById('sessionSummary');
  const openSessionBtn = document.getElementById('openSessionBtn');
  const destroyBtn = document.getElementById('destroyBtn');

  if (!summary) return;

  const safeSessions = Array.isArray(sessions)
    ? sessions
    : [];

  summary.classList.remove('empty-state');
  summary.classList.add('has-session');

  const options = safeSessions
    .map((item) => {
      const ownerLabel = item.isOwner
        ? 'créée par vous'
        : 'partagée';
      const shortId = String(item.id || '').slice(0, 8);

      return (
        `<option value="${escapeHtml(item.id)}">` +
        `${escapeHtml(item.name || 'Espace')} — ` +
        `${escapeHtml(getSessionStatusLabel(item.status))} — ` +
        `${escapeHtml(ownerLabel)} — ${escapeHtml(shortId)}` +
        `</option>`
      );
    })
    .join('');

  summary.innerHTML =
    '<div class="session-status">' +
      '<span class="status-pill warning"><i></i>Sélection requise</span>' +
    '</div>' +
    '<strong class="session-title">Plusieurs espaces sont actifs</strong>' +
    '<span style="color:var(--text-secondary);margin-top:6px;">' +
      'Sélectionnez explicitement l’espace à ouvrir ou à supprimer.' +
    '</span>' +
    '<select id="activeSessionSelector" ' +
      'style="margin-top:14px;width:100%;height:42px;border-radius:8px;' +
      'border:1px solid var(--border);background:var(--field-bg);' +
      'color:var(--text-primary);padding:0 12px;">' +
      '<option value="">Choisir un espace…</option>' +
      options +
    '</select>';

  if (openSessionBtn) {
    openSessionBtn.disabled = true;
  }

  if (destroyBtn) {
    destroyBtn.disabled = true;
  }

  const selector =
    document.getElementById('activeSessionSelector');

  selector?.addEventListener('change', () => {
    const selectedId = selector.value || null;

    if (!selectedId) {
      return;
    }

    setCurrentSessionId(selectedId);
    multipleSessionWarningShown = false;
    refreshSessionSummary();
  });
}

function applyOperationState(operation = {}) {
  const deployBtn = document.getElementById('deployBtn');
  const openSessionBtn = document.getElementById('openSessionBtn');
  const destroyBtn = document.getElementById('destroyBtn');

  const isRunning = operation.status === 'running';

  isDeploying = isRunning && operation.type === 'deploy';
  isDestroying = isRunning && operation.type === 'destroy';

  if (deployBtn) {
    deployBtn.disabled =
      isRunning || creationBlockedByActiveSession;
    deployBtn.classList.toggle('running', isDeploying);
    deployBtn.textContent = isDeploying
      ? 'Création en cours...'
      : creationBlockedByActiveSession
        ? 'Une session est déjà active'
        : 'Créer l’espace sécurisé';
  }

  if (openSessionBtn && isRunning) {
    openSessionBtn.disabled = true;
  }

  if (destroyBtn) {
    destroyBtn.disabled =
      isRunning || !currentSessionId;
    destroyBtn.classList.toggle('running', isDestroying);
    destroyBtn.textContent = isDestroying
      ? 'Suppression en cours...'
      : 'Supprimer l’espace';
  }
}

function renderSessionSummary(
  session,
  draftSession = null,
  operation = {}
) {
  const summary = document.getElementById('sessionSummary');
  const openSessionBtn = document.getElementById('openSessionBtn');

  if (!summary) return;

  const fallback = draftSession || lastSubmittedSession;
  const activeSession = session?.active ? session : null;
  const displayedSession = activeSession || fallback;
  const isRunning = operation.status === 'running';

  if (!displayedSession && !isRunning) {
    summary.classList.remove('ready');
    summary.classList.add('empty-state');
    summary.classList.remove('has-session');
    summary.innerHTML =
      '<span class="empty-icon" aria-hidden="true">◈</span>' +
      '<strong class="session-title">Aucun espace actif</strong>' +
      '<span>Configurez un environnement sécurisé pour commencer votre analyse.</span>';

    if (openSessionBtn) {
      openSessionBtn.disabled = true;
    }

    return;
  }

  const status =
    activeSession?.status ||
    fallback?.status ||
    (isRunning ? 'provisioning' : 'unknown');

  const statusLabel =
    operation.type === 'destroy' && isRunning
      ? 'Suppression en cours'
      : status === 'ready'
        ? 'Espace prêt'
        : status === 'provisioning'
          ? 'Préparation en cours'
          : 'Espace sécurisé';

  const workspaceName =
    displayedSession?.workspaceName ||
    displayedSession?.name ||
    'Analyse de contrats';

  const sessionMode =
    displayedSession?.sessionMode ||
    displayedSession?.mode ||
    'individual';


  const expiresAt =
    displayedSession?.expiresAt ||
    null;

  const canOpen =
    status === 'ready' &&
    Boolean(activeSession?.autoOpenAvailable) &&
    !isRunning;



  summary.classList.remove('empty-state');
  summary.classList.add('has-session');
  summary.classList.toggle('ready', status === 'ready');

  const statusClass = status === 'ready' ? 'success' : status === 'provisioning' ? 'warning' : 'neutral';
  const statusText = status === 'ready' ? 'Prêt' : status === 'provisioning' ? 'Préparation' : 'En attente';
  summary.innerHTML =
    `<div class="session-status"><span class="status-pill ${statusClass}"><i></i>${statusText}</span></div>` +
    `<strong class="session-title">${escapeHtml(statusLabel)}</strong>` +
    `<div class="session-details"><div class="session-detail"><span>Nom</span><strong>${escapeHtml(workspaceName)}</strong></div>` +
    `<div class="session-detail"><span>Mode</span><strong>${sessionMode === 'team' ? 'Équipe' : 'Individuel'}</strong></div>` +
    `<div class="session-detail"><span>Expiration</span><strong>${escapeHtml(formatDateTime(expiresAt))}</strong></div></div>` +
    (status === 'provisioning' ? '<div class="indeterminate-progress" aria-label="Préparation en cours"></div>' : '') +
    (status === 'ready' && activeSession?.autoOpenAvailable
      ? '<div class="session-inline-link">Accès disponible</div>'
      : '');

  if (openSessionBtn) {
    openSessionBtn.disabled = !canOpen;
  }

}

async function refreshSessionSummary() {
  try {
    const requestUrl = currentSessionId
      ? `/api/session?sessionId=${encodeURIComponent(currentSessionId)}`
      : '/api/session';

    const response = await fetch(requestUrl);

    if (!response.ok) {
      // Un identifiant mémorisé peut devenir invalide après destruction,
      // expiration, changement de compte ou retrait d'un groupe.
      if (
        currentSessionId &&
        (response.status === 400 || response.status === 403)
      ) {
        setCurrentSessionId(null);
        return refreshSessionSummary();
      }
      return;
    }

    const data = await response.json();

    creationBlockedByActiveSession =
      data.canCreateSession === false;

    const selectedSessionId =
      data.session?.databaseSessionId || null;

    if (selectedSessionId) {
      setCurrentSessionId(selectedSessionId);
      multipleSessionWarningShown = false;
    } else if (data.selectionRequired) {
      // Plusieurs sessions sont accessibles : aucune sélection implicite.
      setCurrentSessionId(null);

      if (!multipleSessionWarningShown) {
        addLog(
          'Plusieurs sessions sont accessibles. Sélectionnez explicitement l’espace à ouvrir ou à supprimer.',
          'info'
        );
        multipleSessionWarningShown = true;
      }
    } else {
      setCurrentSessionId(null);
      multipleSessionWarningShown = false;
    }

    lastKnownSession = data.session || data.draftSession || null;

    applyOperationState(data.operation || {});
    updateLifecycleStepper(
      data.session || data.draftSession || null,
      data.operation || {}
    );

    if (data.selectionRequired) {
      renderSessionSelector(data.sessions || []);
    } else {
      renderSessionSummary(
        data.session || null,
        data.draftSession || null,
        data.operation || {}
      );
    }
  } catch (_) {
    // On conserve l’état actuel en cas d’erreur réseau temporaire.
  }
}

function humanizeErrorMessage(errorText) {
  if (!errorText) {
    return 'Une erreur est survenue côté serveur.';
  }

  if (
    errorText.includes('group') ||
    errorText.includes('groupe')
  ) {
    return 'Le groupe sélectionné est introuvable ou non autorisé.';
  }

  if (errorText.includes('Terraform introuvable')) {
    return 'Terraform est introuvable sur le serveur Privalyse.';
  }

  if (errorText.includes('VcpuLimitExceeded')) {
    return 'Le quota Infomaniak Public Cloud disponible est insuffisant.';
  }

  return errorText;
}

function setupDeployButton() {
  const deployBtn = document.getElementById('deployBtn');

  if (!deployBtn) return;

  deployBtn.addEventListener('click', async () => {
    if (isDeploying) return;

    if (creationBlockedByActiveSession) {
      window.alert(
        'Une session est déjà active pour votre compte. Supprimez-la avant d’en créer une nouvelle.'
      );
      return;
    }

    const payload = collectDeployPayload();
    const validationError = validateDeployPayload(payload);

    if (validationError) {
      window.alert(validationError);
      return;
    }

    resetUiForNewOperation('deploy');

    lastSubmittedSession = {
      ...payload,
      status: 'provisioning',
      expiresAt: null
    };


    isDeploying = true;
    deployBtn.disabled = true;
    deployBtn.classList.add('running');
    deployBtn.textContent = 'Création en cours...';

    addLog(
      `Création demandée pour l’espace ${payload.workspaceName}.`,
      'info'
    );

    try {
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errorText = 'Une erreur est survenue côté serveur.';

        try {
          const data = await response.json();

          if (data?.error) {
            errorText = data.error;
          }

          if (data?.code === 'ACTIVE_SESSION_EXISTS') {
            creationBlockedByActiveSession = true;

            if (data?.sessionId) {
              setCurrentSessionId(data.sessionId);
            }
          }
        } catch (_) {
          // La réponse du serveur n’est pas au format JSON.
        }

        errorText = humanizeErrorMessage(errorText);
        addLog(`Erreur de création : ${errorText}`, 'error');
        window.alert(errorText);
        return;
      }

      const data = await response.json();

      if (data?.sessionId) {
        setCurrentSessionId(data.sessionId);
      }

      creationBlockedByActiveSession = true;

      addLog(
        'La création de l’espace sécurisé a été lancée.',
        'success'
      );

      window.setTimeout(refreshSessionSummary, 1000);
    } catch (error) {
      addLog(
        `Erreur de connexion au serveur : ${error.message}`,
        'error'
      );

      window.alert('Impossible de contacter le serveur.');
    } finally {
      isDeploying = false;
      deployBtn.disabled =
        creationBlockedByActiveSession;
      deployBtn.classList.remove('running');
      deployBtn.textContent =
        creationBlockedByActiveSession
          ? 'Une session est déjà active'
          : 'Créer l’espace sécurisé';
    }
  });
}

function setupDestroyButton() {
  const destroyBtn =
    document.getElementById('destroyBtn');

  const modal =
    document.getElementById('deleteModal');

  const cancelBtn =
    document.getElementById('cancelDeleteBtn');

  const confirmBtn =
    document.getElementById('confirmDeleteBtn');

  if (
    !destroyBtn ||
    !modal ||
    !cancelBtn ||
    !confirmBtn
  ) {
    return;
  }

  function openModal() {
    modal.classList.add('visible');
    modal.setAttribute(
      'aria-hidden',
      'false'
    );

    document.body.style.overflow = 'hidden';
    confirmBtn.focus();
  }

  function closeModal() {
    modal.classList.remove('visible');
    modal.setAttribute(
      'aria-hidden',
      'true'
    );

    document.body.style.overflow = '';
    destroyBtn.focus();
  }

  destroyBtn.addEventListener(
    'click',
    () => {
      if (isDestroying) {
        return;
      }

      if (!currentSessionId) {
        addLog(
          'Aucune session accessible à supprimer.',
          'error'
        );
        return;
      }

      openModal();
    }
  );

  cancelBtn.addEventListener(
    'click',
    closeModal
  );

  modal.addEventListener(
    'click',
    (event) => {
      if (event.target === modal) {
        closeModal();
      }
    }
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key === 'Escape' &&
        modal.classList.contains('visible')
      ) {
        closeModal();
      }
    }
  );

  confirmBtn.addEventListener(
    'click',
    async () => {
      if (isDestroying) {
        return;
      }

      if (!currentSessionId) {
        closeModal();

        addLog(
          'Aucune session accessible à supprimer.',
          'error'
        );

        return;
      }

      closeModal();
      resetUiForNewOperation('destroy');

      isDestroying = true;
      destroyBtn.disabled = true;
      destroyBtn.classList.add('running');
      destroyBtn.textContent =
        'Suppression en cours...';

      addLog(
        'Suppression de l’espace demandée.',
        'info'
      );

      try {
        const response = await fetch(
          '/api/destroy',
          {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              sessionId:
                currentSessionId
            })
          }
        );

        if (!response.ok) {
          let errorText =
            'La suppression a échoué.';

          try {
            const data =
              await response.json();

            if (data?.error) {
              errorText =
                data.error;
            }
          } catch (_) {
            // La réponse du serveur n’est pas au format JSON.
          }

          errorText =
            humanizeErrorMessage(
              errorText
            );

          addLog(
            `Erreur de suppression : ${errorText}`,
            'error'
          );

          return;
        }

        lastSubmittedSession = null;
        setCurrentSessionId(null);

        addLog(
          'L’espace et ses données ont été supprimés.',
          'success'
        );

        window.setTimeout(
          refreshSessionSummary,
          1000
        );
      } catch (error) {
        addLog(
          `Erreur de connexion au serveur : ${error.message}`,
          'error'
        );
      } finally {
        isDestroying = false;

        destroyBtn.disabled =
          !currentSessionId;
        destroyBtn.classList.remove(
          'running'
        );

        destroyBtn.textContent =
          'Supprimer l’espace';
      }
    }
  );
}

function setupOpenSessionButton() {
  const openSessionBtn = document.getElementById('openSessionBtn');

  if (!openSessionBtn) return;

  openSessionBtn.addEventListener('click', async () => {
    if (openSessionBtn.disabled) return;

    const initialText = openSessionBtn.textContent;

    openSessionBtn.disabled = true;
    openSessionBtn.textContent = 'Ouverture...';

    try {
      if (!currentSessionId) {
        throw new Error(
          'Aucune session accessible à ouvrir.'
        );
      }

      const response = await fetch('/api/session/open', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          sessionId: currentSessionId
        })
      });

      if (!response.ok) {
        let errorText = 'Impossible d’ouvrir l’espace.';

        try {
          const data = await response.json();

          if (data?.error) {
            errorText = data.error;
          }
        } catch (_) {
          // La réponse du serveur n’est pas au format JSON.
        }

        throw new Error(errorText);
      }

      const data = await response.json();

      if (!data.openUrl) {
        throw new Error('Le lien d’ouverture est indisponible.');
      }

      window.open(data.openUrl, '_blank', 'noopener');
      addLog('L’espace sécurisé a été ouvert.', 'success');
    } catch (error) {
      addLog(`Erreur d’ouverture : ${error.message}`, 'error');
      window.alert(error.message);
    } finally {
      openSessionBtn.textContent = initialText;
      refreshSessionSummary();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupFormInteractions();
  setupDeployButton();
  setupOpenSessionButton();
  setupDestroyButton();
  updateLifecycleStepper(null, {});

  connectLogStream();
  refreshSessionSummary();
  sessionRefreshInterval =
    window.setInterval(refreshSessionSummary, 15000);
});


