const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const app = express();
const PORT = 3001;

const TERRAFORM_DIR = path.join(__dirname, '..');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const clients = [];

const currentOperation = {
  type: 'idle',
  status: 'idle',
  phase: 'idle',
  cancelReadiness: false,
  logs: []
};

const AI_PULL_MAP = {
  'qwen-mini': 'qwen2.5:0.5b',
  'llama3-1b': 'llama3.2:1b',
  'phi3-mini': 'phi3:mini',
  'phi4-mini': 'phi4-mini',
  'qwen-7b': 'qwen2.5:7b',
  'qwen-14b': 'qwen2.5:14b',
  'qwen-coder-14b': 'qwen2.5-coder:14b',
  'gpt-oss': 'gpt-oss:20b',
  'gpt-oss-20b': 'gpt-oss:20b',
  'mistral-small-24b': 'mistral-small3.2:24b',
  'dolphin3-8b': 'dolphin3:8b',
  'llama2-uncensored-7b': 'llama2-uncensored:7b'
};

function pushLog(message, type = 'info') {
  const log = {
    message,
    type,
    timestamp: new Date().toISOString()
  };
  currentOperation.logs.push(log);

  const data = `data: ${JSON.stringify(log)}\n\n`;
  clients.forEach((res) => res.write(data));
}

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  currentOperation.logs.forEach((log) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });

  clients.push(res);

  req.on('close', () => {
    const idx = clients.indexOf(res);
    if (idx !== -1) clients.splice(idx, 1);
  });
});

function runTerraform(args) {
  return new Promise((resolve, reject) => {
    pushLog(`terraform ${args.join(' ')}`, 'info');

    const proc = spawn('terraform', args, { cwd: TERRAFORM_DIR, shell: true });

    proc.stdout.on('data', (data) => {
      data
        .toString()
        .split('\n')
        .forEach((line) => {
          if (line.trim() !== '') pushLog(line, 'terraform');
        });
    });

    proc.stderr.on('data', (data) => {
      data
        .toString()
        .split('\n')
        .forEach((line) => {
          if (line.trim() !== '') pushLog(line, 'error');
        });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        pushLog(`terraform ${args[0]} termine (code 0)`, 'success');
        resolve();
      } else {
        pushLog(`terraform ${args[0]} sorti avec le code ${code}`, 'error');
        reject(new Error(`Terraform exited with code ${code}`));
      }
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOperationToLeaveRunning(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (currentOperation.status !== 'running') {
      return true;
    }
    await sleep(200);
  }

  return currentOperation.status !== 'running';
}

function checkHttpStatus(url, acceptedStatuses = [200]) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      if (acceptedStatuses.includes(res.statusCode)) {
        resolve();
      } else {
        reject(new Error(`Status ${res.statusCode}`));
      }
    });

    req.on('error', reject);
    req.setTimeout(4000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

function checkModelAvailable(tagsUrl, modelName) {
  return new Promise((resolve, reject) => {
    const req = http.get(tagsUrl, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Status ${res.statusCode}`));
        return;
      }

      let raw = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        raw += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const models = Array.isArray(parsed.models) ? parsed.models : [];
          const found = models.some((m) => m && m.name === modelName);
          if (found) {
            resolve();
          } else {
            reject(new Error(`modele ${modelName} absent`));
          }
        } catch (e) {
          reject(new Error(`JSON invalide sur /api/tags: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(6000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

function getReadinessBudget(instanceType) {
  const isGpuInstance = /^(g|p)\d/i.test(instanceType || '');

  if (isGpuInstance) {
    // GPU: le premier chargement peut prendre plusieurs minutes.
    return { maxAttempts: 120, delayMs: 5000 }; // 10 min
  }

  // CPU: initialisation et inference initiale beaucoup plus longues.
  return { maxAttempts: 360, delayMs: 5000 }; // 30 min
}

function createOpenWebUiAccount(ip, owuiName, owuiEmail, owuiPassword) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      name: owuiName,
      email: owuiEmail,
      password: owuiPassword
    });

    const reqOptions = {
      hostname: ip,
      port: 3000,
      path: '/api/v1/auths/signup',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    const req = http.request(reqOptions, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: raw });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

async function autoSignupOpenWebUi(ip, owuiName, owuiEmail, owuiPassword) {
  pushLog(`Creation du compte admin OpenWebUI (${owuiEmail})...`, 'info');

  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const result = await createOpenWebUiAccount(ip, owuiName, owuiEmail, owuiPassword);

      if (result.statusCode === 200 || result.statusCode === 201) {
        pushLog(`Compte admin OpenWebUI cree avec succes (${owuiEmail})`, 'success');
        return true;
      }

      // Si le compte existe deja
      if (result.body && result.body.toLowerCase().includes('already')) {
        pushLog(`Le compte OpenWebUI (${owuiEmail}) existe deja`, 'info');
        return true;
      }

      pushLog(
        `Signup tentative ${attempt}/15 echouee (HTTP ${result.statusCode}): ${result.body}`,
        'info'
      );
    } catch (e) {
      pushLog(
        `Signup tentative ${attempt}/15 erreur: ${e.message}`,
        'info'
      );
    }

    await sleep(3000);
  }

  pushLog('Impossible de creer le compte admin OpenWebUI apres 15 tentatives', 'error');
  return false;
}

async function waitForIaReady(ip, instanceType, expectedModel = null) {
  const ollamaUrl = `http://${ip}:11434/api/version`;
  const ollamaTagsUrl = `http://${ip}:11434/api/tags`;
  const openWebUiUrl = `http://${ip}:3000/`;

  const { maxAttempts, delayMs } = getReadinessBudget(instanceType);
  const totalMinutes = Math.round((maxAttempts * delayMs) / 60000);

  pushLog(
    `Test Ollama/OpenWebUI sur ${ollamaUrl} (fenetre d'attente: ~${totalMinutes} min, instance=${instanceType}, modele=${expectedModel || 'n/a'})`,
    'info'
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (currentOperation.cancelReadiness) {
      pushLog('Attente readiness interrompue a la demande utilisateur', 'info');
      return { ready: false, cancelled: true };
    }

    try {
      await checkHttpStatus(ollamaUrl, [200]);
      await checkHttpStatus(openWebUiUrl, [200, 301, 302, 307, 308]);
      if (expectedModel) {
        await checkModelAvailable(ollamaTagsUrl, expectedModel);
      }

      pushLog(`OpenWebUI pret sur ${openWebUiUrl}`, 'ia-ready');
      return { ready: true, url: openWebUiUrl, cancelled: false };
    } catch (e) {
      pushLog(`IA pas encore prete (tentative ${attempt}/${maxAttempts})`, 'info');

      const sliceMs = 500;
      for (let waited = 0; waited < delayMs; waited += sliceMs) {
        if (currentOperation.cancelReadiness) {
          pushLog('Attente readiness interrompue a la demande utilisateur', 'info');
          return { ready: false, cancelled: true };
        }
        await sleep(Math.min(sliceMs, delayMs - waited));
      }
    }
  }

  pushLog(`IA toujours pas prete apres ${maxAttempts} tentatives`, 'error');
  return { ready: false, cancelled: false };
}

app.post('/api/deploy', async (req, res) => {
  const { aiChoice, instanceType, owuiName, owuiEmail, owuiPassword } = req.body;

  if (currentOperation.status === 'running') {
    return res.status(409).json({
      ok: false,
      error: `Operation ${currentOperation.type} deja en cours`
    });
  }

  if (!aiChoice) {
    return res.status(400).json({ ok: false, error: 'aiChoice manquant' });
  }

  if (!owuiEmail || !owuiPassword) {
    return res.status(400).json({ ok: false, error: 'Email et mot de passe OpenWebUI requis' });
  }

  const finalInstanceType =
    typeof instanceType === 'string' && instanceType.trim() !== ''
      ? instanceType.trim()
      : 'g4dn.xlarge';
  const finalOwuiName = typeof owuiName === 'string' && owuiName.trim() !== '' ? owuiName.trim() : 'Admin';
  const expectedModel = AI_PULL_MAP[aiChoice] || null;

  try {
    currentOperation.type = 'deploy';
    currentOperation.status = 'running';
    currentOperation.phase = 'terraform';
    currentOperation.cancelReadiness = false;
    currentOperation.logs = [];

    pushLog(
      `Nouveau deployment (ai_choice=${aiChoice}, instance_type=${finalInstanceType})`,
      'info'
    );
    pushLog(`Compte OpenWebUI: ${owuiEmail}`, 'info');
    if (expectedModel) {
      pushLog(`Modele attendu cote Ollama: ${expectedModel}`, 'info');
    }

    const tfvarsPath = path.join(TERRAFORM_DIR, 'terraform.tfvars');
    const tfvarsContent =
      `ai_choice = "${aiChoice}"\n` +
      `instance_type = "${finalInstanceType}"\n` +
      `owui_name = "${finalOwuiName}"\n` +
      `owui_email = "${owuiEmail}"\n` +
      `owui_password = "${owuiPassword}"\n`;
    fs.writeFileSync(tfvarsPath, tfvarsContent);

    pushLog(
      `terraform.tfvars mis a jour (ai_choice=${aiChoice}, instance_type=${finalInstanceType})`,
      'info'
    );

    await runTerraform(['init', '-input=false']);

    await runTerraform([
      'apply',
      '-auto-approve',
      `-var=ai_choice=${aiChoice}`,
      `-var=instance_type=${finalInstanceType}`,
      `-var=owui_name=${finalOwuiName}`,
      `-var=owui_email=${owuiEmail}`,
      `-var=owui_password=${owuiPassword}`
    ]);

    const ipOutput = spawnSync('terraform', ['output', '-raw', 'ec2_public_ip'], {
      cwd: TERRAFORM_DIR,
      encoding: 'utf8',
      shell: true
    });

    if (ipOutput.status === 0) {
      const ip = ipOutput.stdout.trim();
      pushLog(`IP publique IA : ${ip}`, 'info');

      currentOperation.phase = 'readiness';
      const readiness = await waitForIaReady(ip, finalInstanceType, expectedModel);
      if (readiness.cancelled) {
        currentOperation.type = 'idle';
        currentOperation.status = 'idle';
        currentOperation.phase = 'idle';
        currentOperation.cancelReadiness = false;
        pushLog(
          'Deploy interrompu pendant les tentatives readiness pour permettre une destruction',
          'info'
        );
        return res.status(409).json({
          ok: false,
          error: 'Deploy interrompu pour permettre la destruction'
        });
      }

      // Creer le compte admin OpenWebUI maintenant que l'API est prete
      if (readiness.ready && owuiEmail && owuiPassword) {
        currentOperation.phase = 'signup';
        await autoSignupOpenWebUi(ip, finalOwuiName, owuiEmail, owuiPassword);
      }
    } else {
      pushLog('Impossible de recuperer ec2_public_ip', 'error');
    }

    currentOperation.status = 'success';
    currentOperation.phase = 'idle';
    currentOperation.cancelReadiness = false;
    return res.json({ ok: true });
  } catch (e) {
    currentOperation.status = 'error';
    currentOperation.phase = 'idle';
    currentOperation.cancelReadiness = false;
    const message = String(e && e.message ? e.message : e);
    if (message.includes('VcpuLimitExceeded')) {
      const quotaHelp =
        'Quota AWS vCPU insuffisant pour cette instance. ' +
        'Utilise g4dn.xlarge (4 vCPU) ou demande une augmentation de quota EC2 vCPU.';
      pushLog(quotaHelp, 'error');
      pushLog(`Erreur deploy: ${message}`, 'error');
      return res.status(409).json({ ok: false, error: quotaHelp });
    }

    pushLog(`Erreur deploy: ${message}`, 'error');
    return res.status(500).json({ ok: false, error: message });
  }
});

app.post('/api/destroy', async (req, res) => {
  if (currentOperation.status === 'running') {
    const canInterruptReadiness =
      currentOperation.type === 'deploy' && currentOperation.phase === 'readiness';

    if (canInterruptReadiness) {
      pushLog(
        'Destruction demandee pendant les tentatives readiness, interruption en cours...',
        'info'
      );
      currentOperation.cancelReadiness = true;

      const released = await waitForOperationToLeaveRunning(30000);
      if (!released) {
        return res.status(409).json({
          ok: false,
          error:
            'Impossible d interrompre le deploy pour le moment. Reessaie dans quelques secondes.'
        });
      }
    } else {
      return res.status(409).json({
        ok: false,
        error: `Operation ${currentOperation.type} deja en cours`
      });
    }
  }

  try {
    currentOperation.type = 'destroy';
    currentOperation.status = 'running';
    currentOperation.phase = 'terraform';
    currentOperation.cancelReadiness = false;
    currentOperation.logs = [];
    pushLog('Destruction demandee', 'info');

    await runTerraform(['destroy', '-auto-approve']);

    currentOperation.status = 'success';
    currentOperation.phase = 'idle';
    return res.json({ ok: true });
  } catch (e) {
    currentOperation.status = 'error';
    currentOperation.phase = 'idle';
    currentOperation.cancelReadiness = false;
    pushLog(`Erreur destroy: ${e.message}`, 'error');
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur backend demarre sur http://localhost:${PORT}`);
  console.log(`Dossier Terraform : ${TERRAFORM_DIR}`);
});
