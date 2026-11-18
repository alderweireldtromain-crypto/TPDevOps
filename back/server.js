'use strict';

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const APP_ENV = process.env.APP_ENV || 'dev';
const APP_VERSION = process.env.APP_VERSION || 'dev';

const PRIORITIES = ['low', 'normal', 'high'];
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'appuser',
  password: process.env.PGPASSWORD || 'devpassword',
  database: process.env.PGDATABASE || 'appdb',
  connectionTimeoutMillis: 5000,
});

pool.on('error', (error) => {
  console.error(`[db] erreur sur un client inactif : ${error.message}`);
});

let schemaReady = false;

function normalizeTaskInput(body, { partial = false } = {}) {
  const input = body && typeof body === 'object' ? body : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const errors = [];
  const value = {};

  if (!partial || has('title')) {
    if (typeof input.title !== 'string' || input.title.trim().length === 0) {
      errors.push('Le titre est obligatoire.');
    } else if (input.title.trim().length > MAX_TITLE_LENGTH) {
      errors.push(`Le titre ne doit pas dépasser ${MAX_TITLE_LENGTH} caractères.`);
    } else {
      value.title = input.title.trim();
    }
  }

  if (has('description')) {
    if (typeof input.description !== 'string') {
      errors.push('La description doit être une chaîne de caractères.');
    } else if (input.description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`La description ne doit pas dépasser ${MAX_DESCRIPTION_LENGTH} caractères.`);
    } else {
      value.description = input.description.trim();
    }
  } else if (!partial) {
    value.description = '';
  }

  if (has('priority')) {
    if (!PRIORITIES.includes(input.priority)) {
      errors.push(`La priorité doit être l'une des valeurs suivantes : ${PRIORITIES.join(', ')}.`);
    } else {
      value.priority = input.priority;
    }
  } else if (!partial) {
    value.priority = 'normal';
  }

  if (has('done')) {
    if (typeof input.done !== 'boolean') {
      errors.push('Le champ done doit être un booléen.');
    } else {
      value.done = input.done;
    }
  }

  return { errors, value };
}

async function initSchema() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [20261118]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priority VARCHAR(16) NOT NULL DEFAULT 'normal'
          CHECK (priority IN ('low', 'normal', 'high')),
        done BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM tasks');

    if (rows[0].count === 0) {
      await client.query(
        `INSERT INTO tasks (title, description, priority, done) VALUES
          ('Déployer l''environnement de validation', 'Créer le namespace val et vérifier les trois services.', 'high', FALSE),
          ('Configurer le runner self-hosted', 'Installer le runner GitHub Actions sur le poste Kubernetes.', 'normal', FALSE),
          ('Ajouter les fonctionnalités du groupe', 'Chaque membre livre 3 fonctionnalités via une branche feature/*.', 'low', FALSE)`,
      );
    }

    await client.query('COMMIT');
    schemaReady = true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function connectDatabase() {
  while (!schemaReady) {
    try {
      await initSchema();
      console.log('[db] schéma initialisé, API prête');
    } catch (error) {
      console.error(`[db] indisponible (${error.message}), nouvelle tentative dans 3 s`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '64kb' }));

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

app.get('/readyz', async (req, res) => {
  if (!schemaReady) {
    return res.status(503).json({ status: 'starting', database: 'pending' });
  }

  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ready', database: 'up' });
  } catch (error) {
    return res.status(503).json({ status: 'not-ready', database: 'down' });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({
      status: 'ok',
      environment: APP_ENV,
      version: APP_VERSION,
      database: 'up',
    });
  } catch (error) {
    return res.status(503).json({
      status: 'degraded',
      environment: APP_ENV,
      version: APP_VERSION,
      database: 'down',
    });
  }
});

app.get('/api/info', (req, res) => {
  res.json({
    name: 'taskflow',
    environment: APP_ENV,
    version: APP_VERSION,
    node: process.version,
  });
});

app.get('/api/stats', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE done)::int AS done,
        COUNT(*) FILTER (WHERE NOT done)::int AS pending
      FROM tasks
    `);
    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/tasks', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, title, description, priority, done, created_at, updated_at
      FROM tasks
      ORDER BY done ASC, created_at DESC
    `);
    return res.json({ count: rows.length, tasks: rows });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/tasks', async (req, res, next) => {
  const { errors, value } = normalizeTaskInput(req.body);

  if (errors.length > 0) {
    return res.status(400).json({ error: errors[0] });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO tasks (title, description, priority, done)
       VALUES ($1, $2, $3, FALSE)
       RETURNING id, title, description, priority, done, created_at, updated_at`,
      [value.title, value.description, value.priority],
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/tasks/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  const { errors, value } = normalizeTaskInput(req.body, { partial: true });

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Identifiant de tâche invalide.' });
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: errors[0] });
  }

  const fields = [];
  const params = [];

  for (const column of ['title', 'description', 'priority', 'done']) {
    if (Object.prototype.hasOwnProperty.call(value, column)) {
      params.push(value[column]);
      fields.push(`${column} = $${params.length}`);
    }
  }

  if (fields.length === 0) {
    return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  }

  params.push(id);
  fields.push('updated_at = NOW()');

  try {
    const { rows } = await pool.query(
      `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${params.length}
       RETURNING id, title, description, priority, done, created_at, updated_at`,
      params,
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Tâche introuvable.' });
    }

    return res.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/tasks/:id', async (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Identifiant de tâche invalide.' });
  }

  try {
    const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Tâche introuvable.' });
    }

    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route inconnue.' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error(`[api] ${error.message}`);

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corps JSON invalide.' });
  }

  const dbCodes = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND',
    '08001', '08004', '08006', '57P01', '57P03',
  ]);
  const dbMessage = /connection terminated|connection timeout|terminating connection|server closed the connection/i;

  if (dbCodes.has(error.code) || dbMessage.test(error.message)) {
    return res.status(503).json({ error: 'Base de données indisponible.' });
  }

  return res.status(500).json({ error: 'Erreur interne du serveur.' });
});

const server = app.listen(PORT, () => {
  console.log(`[api] taskflow (${APP_ENV}, ${APP_VERSION}) écoute sur le port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
});

connectDatabase();
