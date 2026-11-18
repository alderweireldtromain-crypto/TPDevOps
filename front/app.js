'use strict';

const API_URL = '/api';
const PRIORITY_LABELS = {
  low: 'Basse',
  normal: 'Normale',
  high: 'Haute',
};

const state = {
  tasks: [],
  filter: 'all',
  online: false,
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
  taskList: document.querySelector('#task-list'),
  empty: document.querySelector('#empty-state'),
  emptyTitle: document.querySelector('#empty-title'),
  emptyText: document.querySelector('#empty-text'),
  filters: document.querySelectorAll('[data-filter]'),
  refresh: document.querySelector('#refresh-button'),
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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

function renderTasks() {
  const visibleTasks = state.tasks.filter((task) => {
    if (state.filter === 'done') return task.done;
    if (state.filter === 'pending') return !task.done;
    return true;
  });

  elements.taskList.innerHTML = visibleTasks
    .map(
      (task) => `
        <li class="task ${task.done ? 'is-done' : ''}">
          <label class="task__check" title="${task.done ? 'Marquer comme à faire' : 'Marquer comme terminée'}">
            <input
              type="checkbox"
              data-action="toggle"
              data-id="${task.id}"
              ${task.done ? 'checked' : ''}
              aria-label="Terminer la tâche ${escapeHtml(task.title)}"
            >
            <span class="task__box" aria-hidden="true">✓</span>
          </label>

          <div class="task__body">
            <p class="task__title">${escapeHtml(task.title)}</p>
            ${task.description ? `<p class="task__description">${escapeHtml(task.description)}</p>` : ''}
            <div class="task__meta">
              <span class="priority priority--${escapeHtml(task.priority)}">${escapeHtml(PRIORITY_LABELS[task.priority] || task.priority)}</span>
              <span>Créée le ${escapeHtml(formatDate(task.created_at))}</span>
            </div>
          </div>

          <div class="task__actions">
            <button
              type="button"
              class="task__delete"
              data-action="delete"
              data-id="${task.id}"
              title="Supprimer"
              aria-label="Supprimer la tâche ${escapeHtml(task.title)}"
            >×</button>
          </div>
        </li>
      `,
    )
    .join('');

  elements.empty.hidden = visibleTasks.length > 0;

  if (state.filter === 'done') {
    elements.emptyTitle.textContent = 'Aucune tâche terminée';
    elements.emptyText.textContent = 'Cochez une tâche pour la retrouver ici.';
  } else if (state.filter === 'pending') {
    elements.emptyTitle.textContent = 'Tout est à jour';
    elements.emptyText.textContent = 'Aucune tâche en cours dans le backlog.';
  } else {
    elements.emptyTitle.textContent = 'Aucune tâche';
    elements.emptyText.textContent = 'Ajoutez votre première tâche avec le formulaire ci-dessus.';
  }

  updateStats();
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
  renderTasks();
}

async function refresh() {
  clearTimeout(state.retryTimer);
  elements.refresh.disabled = true;

  try {
    await Promise.all([loadInfo(), loadTasks()]);
    state.online = true;
    setStatus('ok', 'API connectée');
    hideBanner();
  } catch (error) {
    state.online = false;
    setStatus('down', 'API indisponible');
    showBanner(
      `${error.message} — la base de données ou l'API est peut-être encore en cours de démarrage.`,
      { error: true },
    );
    scheduleRetry();
  } finally {
    elements.refresh.disabled = false;
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
    showToast('Tâche ajoutée au backlog.');
    hideBanner();
  } catch (error) {
    showToast(error.message, { error: true });
  } finally {
    elements.submit.disabled = false;
  }
}

async function toggleTask(id, done) {
  try {
    await api(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ done }),
    });
    await loadTasks();
    showToast(done ? 'Tâche terminée.' : 'Tâche remise en cours.');
  } catch (error) {
    showToast(error.message, { error: true });
    await loadTasks().catch(() => {});
  }
}

async function deleteTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  const label = task ? `« ${task.title} »` : 'cette tâche';

  if (!window.confirm(`Supprimer ${label} ?`)) return;

  try {
    await api(`/tasks/${id}`, { method: 'DELETE' });
    await loadTasks();
    showToast('Tâche supprimée.');
  } catch (error) {
    showToast(error.message, { error: true });
  }
}

function setFilter(filter) {
  state.filter = filter;

  elements.filters.forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  renderTasks();
}

elements.form.addEventListener('submit', createTask);

elements.taskList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-action="toggle"]');
  if (!checkbox) return;
  toggleTask(Number(checkbox.dataset.id), checkbox.checked);
});

elements.taskList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="delete"]');
  if (!button) return;
  deleteTask(Number(button.dataset.id));
});

elements.filters.forEach((button) => {
  button.addEventListener('click', () => setFilter(button.dataset.filter));
});

elements.refresh.addEventListener('click', refresh);
elements.bannerRetry.addEventListener('click', refresh);

refresh();
