/* ══════════════════════════════════════════════
   StudyFlow – server.js
   Express REST API + serves frontend
══════════════════════════════════════════════ */

'use strict';

const express   = require('express');
const cors      = require('cors');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path      = require('path');
const db        = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'studyflow-secret-change-in-prod-2024';

/* ─── Middleware ─── */
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(_dirname));

/* ─── Auth Middleware ─── */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/* ════════════════════════════════════════════
   AUTH ROUTES
════════════════════════════════════════════ */

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const id       = uuidv4();
  const hashed   = bcrypt.hashSync(password, 10);

  db.prepare('INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)')
    .run(id, name.trim(), email.toLowerCase().trim(), hashed);

  db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(id);

  const token = jwt.sign({ id, name, email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user: { id, name, email: email.toLowerCase() } });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user);
});

/* ════════════════════════════════════════════
   TASKS ROUTES
════════════════════════════════════════════ */

// GET /api/tasks?date=YYYY-MM-DD  (all tasks or filtered by date)
app.get('/api/tasks', requireAuth, (req, res) => {
  const { date } = req.query;
  let rows;
  if (date) {
    rows = db.prepare('SELECT * FROM tasks WHERE user_id = ? AND date = ? ORDER BY start_time ASC')
              .all(req.user.id, date);
  } else {
    rows = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY date DESC, start_time ASC')
              .all(req.user.id);
  }
  // Convert completed integer → boolean
  res.json(rows.map(t => ({ ...t, completed: t.completed === 1 })));
});

// POST /api/tasks
app.post('/api/tasks', requireAuth, (req, res) => {
  const { name, subject, startTime, endTime, priority, date, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Task name is required.' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO tasks (id, user_id, name, subject, start_time, end_time, priority, date, notes, completed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(id, req.user.id, name.trim(), subject || null, startTime || null, endTime || null,
         priority || 'medium', date || new Date().toISOString().split('T')[0], notes || null);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  res.status(201).json({ ...task, completed: task.completed === 1 });
});

// PUT /api/tasks/:id
app.put('/api/tasks/:id', requireAuth, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?')
                  .get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const { name, subject, startTime, endTime, priority, date, notes, completed } = req.body;

  db.prepare(`
    UPDATE tasks
    SET name = ?, subject = ?, start_time = ?, end_time = ?, priority = ?,
        date = ?, notes = ?, completed = ?
    WHERE id = ? AND user_id = ?
  `).run(
    name      ?? task.name,
    subject   ?? task.subject,
    startTime ?? task.start_time,
    endTime   ?? task.end_time,
    priority  ?? task.priority,
    date      ?? task.date,
    notes     ?? task.notes,
    completed !== undefined ? (completed ? 1 : 0) : task.completed,
    req.params.id, req.user.id
  );

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json({ ...updated, completed: updated.completed === 1 });
});

// DELETE /api/tasks/:id
app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?')
                  .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Task not found.' });
  res.json({ success: true });
});

/* ════════════════════════════════════════════
   SETTINGS ROUTES
════════════════════════════════════════════ */

// GET /api/settings
app.get('/api/settings', requireAuth, (req, res) => {
  const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
  res.json(settings || { user_id: req.user.id, daily_goal: 80, theme: 'dark', streak: 0, last_active: null });
});

// PUT /api/settings
app.put('/api/settings', requireAuth, (req, res) => {
  const { daily_goal, theme, streak, last_active } = req.body;

  const existing = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
  if (!existing) {
    db.prepare('INSERT INTO user_settings (user_id, daily_goal, theme, streak, last_active) VALUES (?,?,?,?,?)')
      .run(req.user.id, daily_goal ?? 80, theme ?? 'dark', streak ?? 0, last_active ?? null);
  } else {
    db.prepare(`
      UPDATE user_settings
      SET daily_goal = ?, theme = ?, streak = ?, last_active = ?
      WHERE user_id = ?
    `).run(
      daily_goal  ?? existing.daily_goal,
      theme       ?? existing.theme,
      streak      ?? existing.streak,
      last_active ?? existing.last_active,
      req.user.id
    );
  }

  const updated = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(req.user.id);
  res.json(updated);
});

/* ════════════════════════════════════════════
   FOCUS SESSIONS ROUTES
════════════════════════════════════════════ */

// GET /api/focus-sessions?date=YYYY-MM-DD
app.get('/api/focus-sessions', requireAuth, (req, res) => {
  const { date } = req.query;
  let rows;
  if (date) {
    rows = db.prepare('SELECT * FROM focus_sessions WHERE user_id = ? AND date = ?')
              .all(req.user.id, date);
  } else {
    rows = db.prepare('SELECT * FROM focus_sessions WHERE user_id = ? ORDER BY created_at DESC')
              .all(req.user.id);
  }
  res.json(rows);
});

// POST /api/focus-sessions
app.post('/api/focus-sessions', requireAuth, (req, res) => {
  const { taskId, date, durationSec } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO focus_sessions (id, user_id, task_id, date, duration_sec) VALUES (?,?,?,?,?)')
    .run(id, req.user.id, taskId || null, date || new Date().toISOString().split('T')[0], durationSec || 0);

  const session = db.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(id);
  res.status(201).json(session);
});

/* ════════════════════════════════════════════
   CATCH-ALL → serve frontend
════════════════════════════════════════════ */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname,'index.html'));
});

/* ─── Start Server ─── */
app.listen(PORT, () => {
  console.log(`✅ StudyFlow server running on port ${PORT}`);
});
