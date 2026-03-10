let selectedModel = null;
let selectedInstanceType = null;
let isDeploying = false;
let isDestroying = false;
let eventSource = null;

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

function connectLogStream() {
  if (eventSource) return;

  eventSource = new EventSource('http://localhost:3001/api/stream');

  eventSource.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data);
      handleLog(log);
    } catch (e) {
      console.error('Log SSE invalide', e, event.data);
    }
  };

  eventSource.onerror = (err) => {
    console.error('Erreur SSE', err);
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

  const iaStatus = document.getElementById('iaStatus');
  if (!iaStatus) return;

  if (
    log.type === 'info' &&
    (log.message.includes('Test de disponibilite IA') ||
      log.message.includes('Test Ollama'))
  ) {
    iaStatus.classList.remove('ready');
    iaStatus.classList.add('loading');
    iaStatus.innerHTML = '<span class="spinner"></span> Deploiement IA en cours (10 a 30 minutes possibles)...';
  }

  if (log.type === 'ia-ready') {
    iaStatus.classList.remove('loading');
    iaStatus.classList.add('ready');

    const match = log.message.match(/http:\/\/[^\s]+/);
    const url = match ? match[0] : null;

    if (url) {
      iaStatus.innerHTML = `IA prete : <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    } else {
      iaStatus.textContent = 'IA prete';
    }
  }
}

function addLog(message, type = 'info') {
  handleLog({
    message,
    type,
    timestamp: new Date().toISOString()
  });
}

function resetUiForNewOperation(op) {
  const logsDiv = document.getElementById('logs');
  const logsSection = document.getElementById('logsSection');
  const iaStatus = document.getElementById('iaStatus');

  if (logsDiv) {
    logsDiv.innerHTML = '';
  }

  if (logsSection) {
    logsSection.style.display = 'block';
  }

  if (iaStatus) {
    iaStatus.classList.remove('loading', 'ready');

    if (op === 'deploy') {
      iaStatus.textContent = 'Deploiement en cours...';
    } else if (op === 'destroy') {
      iaStatus.textContent = 'Destruction en cours...';
    } else {
      iaStatus.textContent = 'IA non deployee.';
    }
  }
}

function renderModelCatalog() {
  const container = document.getElementById('modelCatalog');
  if (!container) return [];

  // Idempotent render: evite les listes dupliquees si l'init est appelee plusieurs fois.
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
        <div class="model-icon"></div>
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
    cards.forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');

    selectedModel = card.dataset.model;
    selectedModelDiv.style.display = 'block';
    selectedModelNameSpan.textContent = card.querySelector('h3').textContent;

    localStorage.setItem('selectedModel', selectedModel);
  };

  const savedModel = localStorage.getItem('selectedModel');
  const initialCard = cards.find((c) => c.dataset.model === savedModel) || cards[0];
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
  const cards = document.querySelectorAll('.instance-card');
  const selectedInstanceDiv = document.getElementById('selectedInstance');
  const selectedInstanceNameSpan = document.getElementById('selectedInstanceName');

  if (!cards.length) return;

  const savedInstance = localStorage.getItem('selectedInstanceType');
  let initialCard = null;

  if (savedInstance) {
    initialCard = Array.from(cards).find((c) => c.dataset.instance === savedInstance) || null;
  }

  if (!initialCard) {
    initialCard =
      Array.from(cards).find((c) => c.dataset.instance === 'g4dn.xlarge') ||
      cards[0];
  }

  cards.forEach((c) => c.classList.remove('selected'));
  initialCard.classList.add('selected');

  selectedInstanceType = initialCard.dataset.instance;
  selectedInstanceDiv.style.display = 'block';
  selectedInstanceNameSpan.textContent = selectedInstanceType;

  cards.forEach((card) => {
    card.addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');

      selectedInstanceType = card.dataset.instance;
      selectedInstanceDiv.style.display = 'block';
      selectedInstanceNameSpan.textContent = selectedInstanceType;

      localStorage.setItem('selectedInstanceType', selectedInstanceType);
    });
  });
}

function setupDeployButton() {
  const deployBtn = document.getElementById('deployBtn');
  const logsSection = document.getElementById('logsSection');

  deployBtn.addEventListener('click', async () => {
    if (!selectedModel || !selectedInstanceType || isDeploying) return;
    resetUiForNewOperation('deploy');
    isDeploying = true;
    deployBtn.disabled = true;
    deployBtn.classList.add('running');
    deployBtn.textContent = 'Deploiement en cours...';

    if (logsSection) {
      logsSection.style.display = 'block';
    }

    addLog(`Deploiement demande (modele=${selectedModel}, instance=${selectedInstanceType})`, 'info');

    try {
      const res = await fetch('http://localhost:3001/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiChoice: selectedModel,
          instanceType: selectedInstanceType
        })
      });

      if (!res.ok) {
        let errText = 'Erreur cote backend (deploy). Regarde les logs.';
        try {
          const data = await res.json();
          if (data && data.error) errText = data.error;
        } catch (_) {
          // ignore JSON parse issue and keep default message
        }
        addLog(`Erreur backend deploy: ${errText}`, 'error');
        alert(errText);
      } else {
        addLog('Commande de deploiement envoyee. Suis la progression dans les logs.', 'success');
      }
    } catch (e) {
      addLog(`Erreur de connexion backend : ${e.message}`, 'error');
      alert('Erreur de connexion au backend.');
    } finally {
      isDeploying = false;
      deployBtn.disabled = false;
      deployBtn.classList.remove('running');
      deployBtn.textContent = 'Deployer';
    }
  });
}

function setupDestroyButton() {
  const destroyBtn = document.getElementById('destroyBtn');
  const logsSection = document.getElementById('logsSection');

  destroyBtn.addEventListener('click', async () => {
    if (isDestroying) return;

    if (!confirm('Tu es sur de vouloir detruire l\'infrastructure ?')) {
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

    addLog('Commande de destruction envoyee.', 'info');

    try {
      const res = await fetch('http://localhost:3001/api/destroy', {
        method: 'POST'
      });

      if (!res.ok) {
        addLog('Erreur backend destroy', 'error');
        alert('Erreur cote backend (destroy). Regarde les logs.');
      } else {
        addLog('Destruction demandee. Suis la progression dans les logs.', 'success');
      }
    } catch (e) {
      addLog(`Erreur de connexion backend : ${e.message}`, 'error');
      alert('Erreur de connexion au backend.');
    } finally {
      isDestroying = false;
      destroyBtn.disabled = false;
      destroyBtn.classList.remove('running');
      destroyBtn.textContent = 'Detruire';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  connectLogStream();
  setupModelSelection();
  setupInstanceSelection();
  setupDeployButton();
  setupDestroyButton();
});
