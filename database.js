/* ══════════════════════════════════════════════
   StudyFlow – database.js
   SQLite schema & initialization
══════════════════════════════════════════════ */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Store DB in a persistent directory
const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'studyflow.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Create Tables ──
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    subject     TEXT,
    start_time  TEXT,
    end_time    TEXT,
    priority    TEXT NOT NULL DEFAULT 'medium',
    date        TEXT NOT NULL,
    notes       TEXT,
    completed   INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id     TEXT PRIMARY KEY,
    daily_goal  INTEGER NOT NULL DEFAULT 80,
    theme       TEXT NOT NULL DEFAULT 'dark',
    streak      INTEGER NOT NULL DEFAULT 0,
    last_active TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS focus_sessions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    task_id      TEXT,
    date         TEXT NOT NULL,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_focus_user_date ON focus_sessions(user_id, date);
`);

module.exports = db;
