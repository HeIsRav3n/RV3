'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

const USE_DB = !!(process.env.DATABASE_URL || '').trim();

let neon;
if (USE_DB) {
  try { neon = require('@neondatabase/serverless').neon; } catch {}
}

function sql() { return neon(process.env.DATABASE_URL); }

const FILE = path.join(config.dataDir, 'tasks.json');

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

async function ensureTable() {
  await sql()`
    CREATE TABLE IF NOT EXISTS rv3_tasks (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

async function loadTasks() {
  if (USE_DB && neon) {
    try {
      await ensureTable();
      const rows = await sql()`
        SELECT data FROM rv3_tasks
        WHERE status IN ('queued','running')
        ORDER BY
          CASE WHEN (data->>'priority')::boolean THEN 0 ELSE 1 END,
          created_at ASC
      `;
      return rows.map(r => r.data);
    } catch (e) {
      console.error('taskStore.loadTasks error:', e.message);
      return [];
    }
  }
  ensureDir();
  if (!fs.existsSync(FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

async function getTask(id) {
  if (USE_DB && neon) {
    try {
      await ensureTable();
      const rows = await sql()`SELECT data FROM rv3_tasks WHERE id = ${id}`;
      return rows[0]?.data || null;
    } catch (e) {
      console.error('taskStore.getTask error:', e.message);
      return null;
    }
  }
  const tasks = JSON.parse(fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '[]');
  return tasks.find(t => t.id === id) || null;
}

async function saveTask(task) {
  if (USE_DB && neon) {
    try {
      await ensureTable();
      await sql()`
        INSERT INTO rv3_tasks (id, data, status)
        VALUES (${task.id}, ${JSON.stringify(task)}, ${task.status || 'queued'})
        ON CONFLICT (id) DO UPDATE SET
          data = EXCLUDED.data,
          status = EXCLUDED.status,
          updated_at = NOW()
      `;
    } catch (e) {
      console.error('taskStore.saveTask error:', e.message);
    }
    return;
  }
  ensureDir();
  let tasks = [];
  try { tasks = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) tasks[idx] = task; else tasks.unshift(task);
  fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2));
}

async function updateTaskStatus(id, status, extra = {}) {
  if (USE_DB && neon) {
    try {
      await sql()`
        UPDATE rv3_tasks
        SET status = ${status},
            data = data || ${JSON.stringify({ status, ...extra })},
            updated_at = NOW()
        WHERE id = ${id}
      `;
    } catch (e) {
      console.error('taskStore.updateTaskStatus error:', e.message);
    }
    return;
  }
  ensureDir();
  let tasks = [];
  try { tasks = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  const t = tasks.find(t => t.id === id);
  if (t) { Object.assign(t, { status, ...extra }); fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2)); }
}

async function deleteTask(id) {
  if (USE_DB && neon) {
    try {
      await sql()`DELETE FROM rv3_tasks WHERE id = ${id}`;
    } catch (e) {
      console.error('taskStore.deleteTask error:', e.message);
    }
    return;
  }
  ensureDir();
  let tasks = [];
  try { tasks = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  fs.writeFileSync(FILE, JSON.stringify(tasks.filter(t => t.id !== id), null, 2));
}

module.exports = { loadTasks, getTask, saveTask, updateTaskStatus, deleteTask };
