let isDeploying = false;
let isDestroying = false;
let eventSource = null;
let sessionRefreshInterval = null;
let lastSubmittedSession = null;
let currentSessionId = null;

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
    `<strong>${escapeHtml(workspaceName)}</strong><br />` +
    `Mode : ${modeLabel}<br />` +
    (mode === 'team'
      ? `Groupe : ${escapeHtml(groupLabel || 'Aucun groupe sélectionné')}<br />`
      : '') +
    `Durée : ${escapeHtml(durationLabel)}<br />` +
    `Suppression automatique à expiration`;
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
  duration?.addEventListener('change', updateSummaryPreview);
  groupId?.addEventListener('change', updateSummaryPreview);

  modeInputs.forEach((input) => {
    input.addEventListener('change', updateGroupVisibility);
  });

  updateGroupVisibility();
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
    summary.textContent = 'Création de l’espace sécurisé en cours...';
  } else if (operationType === 'destroy') {
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

function applyOperationState(operation = {}) {
  const deployBtn = document.getElementById('deployBtn');
  const openSessionBtn = document.getElementById('openSessionBtn');
  const destroyBtn = document.getElementById('destroyBtn');

  const isRunning = operation.status === 'running';

  isDeploying = isRunning && operation.type === 'deploy';
  isDestroying = isRunning && operation.type === 'destroy';

  if (deployBtn) {
    deployBtn.disabled = isRunning;
    deployBtn.classList.toggle('running', isDeploying);
    deployBtn.textContent = isDeploying
      ? 'Création en cours...'
      : 'Créer l’espace sécurisé';
  }

  if (openSessionBtn && isRunning) {
    openSessionBtn.disabled = true;
  }

  if (destroyBtn) {
    destroyBtn.disabled = isRunning;
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
    summary.textContent = 'Aucun espace actif.';

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



  summary.classList.toggle('ready', status === 'ready');

  summary.innerHTML =
    `<strong>${escapeHtml(statusLabel)}</strong><br />` +
    `Nom : ${escapeHtml(workspaceName)}<br />` +
   `Mode : ${sessionMode === 'team' ? 'Équipe' : 'Individuel'}<br />` +
   `Expiration : ${escapeHtml(formatDateTime(expiresAt))}` +
    (status === 'ready' && activeSession?.autoOpenAvailable
      ? `<br />Accès : <a href="#" id="sessionAccessLink">Ouvrir l’espace</a>`
      : '');

  if (openSessionBtn) {
    openSessionBtn.disabled = !canOpen;
  }

  const sessionAccessLink =
    document.getElementById('sessionAccessLink');

  if (sessionAccessLink) {
    sessionAccessLink.addEventListener('click', (event) => {
      event.preventDefault();

      if (
        openSessionBtn &&
        !openSessionBtn.disabled
      ) {
        openSessionBtn.click();
      }
    });
  }
}

async function refreshSessionSummary() {
  try {
    const response = await fetch('/api/session');

    if (!response.ok) return;

    const data = await response.json();

    currentSessionId =
      data.session?.databaseSessionId || null;

    applyOperationState(data.operation || {});
    renderSessionSummary(
      data.session || null,
      data.draftSession || null,
      data.operation || {}
    );
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
        currentSessionId = data.sessionId;
      }

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
      deployBtn.disabled = false;
      deployBtn.classList.remove('running');
      deployBtn.textContent = 'Créer l’espace sécurisé';
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
        currentSessionId = null;

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

        destroyBtn.disabled = false;
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

  connectLogStream();
  refreshSessionSummary();

  sessionRefreshInterval =
    window.setInterval(refreshSessionSummary, 15000);
});


