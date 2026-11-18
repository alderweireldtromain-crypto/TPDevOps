'use strict';

const API_URL = '/api';

const state = {
  tasks: [],
  retryTimer: null,
};

const elements = {
  apiStatus: document.querySelector('#api-status'),
  apiStatusLabel: document.querySelector('#api-status-label'),
  envBadge: document.querySelector('#env-badge'),
  versionLabel: document.querySelector('#version-label'),
  banner: document.querySelector('#banner'),
  bannerText: document.querySelector('#banner-text'),
  bannerRetry: document.querySelector('#banner-retry'),
  form: document.querySelector('#task-form'),
  title: document.querySelector('#task-title'),
  priority: document.querySelector('#task-priority'),
  description: document.querySelector('#task-description'),
  submit: document.querySelector('#submit-button'),
  statTotal: document.querySelector('#stat-total'),
  statPending: document.querySelector('#stat-pending'),
  statDone: document.querySelector('#stat-done'),
  toast: document.querySelector('#toast'),
};

let toastTimer = null;

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  }

  return payload;
}

function setStatus(mode, label) {
  elements.apiStatus.className = `status status--${mode}`;
  elements.apiStatusLabel.textContent = label;
}

function showBanner(message, { error = false } = {}) {
  elements.bannerText.textContent = message;
  elements.banner.classList.toggle('banner--error', error);
  elements.banner.hidden = false;
}

function hideBanner() {
  elements.banner.hidden = true;
}

function showToast(message, { error = false } = {}) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle('toast--error', error);
  elements.toast.hidden = false;

  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function updateStats() {
  const total = state.tasks.length;
  const done = state.tasks.filter((task) => task.done).length;

  elements.statTotal.textContent = total;
  elements.statPending.textContent = total - done;
  elements.statDone.textContent = done;
}

async function loadInfo() {
  const info = await api('/info');
  elements.envBadge.textContent = info.environment;
  elements.versionLabel.textContent = `version ${info.version}`;
  document.title = `TaskFlow · ${info.environment}`;
}

async function loadTasks() {
  const data = await api('/tasks');
  state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  updateStats();
}

async function refresh() {
  clearTimeout(state.retryTimer);

  try {
    await Promise.all([loadInfo(), loadTasks()]);
    setStatus('ok', 'API connectée');
    hideBanner();
  } catch (error) {
    setStatus('down', 'API indisponible');
    showBanner(
      `${error.message} — la base de données ou l'API est peut-être encore en cours de démarrage.`,
      { error: true },
    );
    scheduleRetry();
  }
}

function scheduleRetry() {
  clearTimeout(state.retryTimer);
  state.retryTimer = setTimeout(refresh, 5000);
}

async function createTask(event) {
  event.preventDefault();

  const title = elements.title.value.trim();
  if (!title) {
    elements.title.focus();
    return;
  }

  elements.submit.disabled = true;

  try {
    await api('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title,
        priority: elements.priority.value,
        description: elements.description.value.trim(),
      }),
    });

    elements.form.reset();
    elements.priority.value = 'normal';
    elements.title.focus();
    await loadTasks();
    showToast('Tâche ajoutée.');
    hideBanner();
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    elements.submit.disabled = false;
  }
}

elements.form.addEventListener('submit', createTask);
elements.bannerRetry.addEventListener('click', refresh);

refresh();
