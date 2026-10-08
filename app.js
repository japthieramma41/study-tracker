/* ══════════════════════════════════════════════
   StudyFlow – app.js
   Daily Study Tracker Application Logic
══════════════════════════════════════════════ */

'use strict';

/* ─── Constants ─── */
const STORAGE_KEYS = {
  tasks:       'sf_tasks',
  dailyStats:  'sf_daily_stats',
  streak:      'sf_streak',
  lastActive:  'sf_last_active',
  dailyGoal:   'sf_daily_goal',
  theme:       'sf_theme',
  focusSessions: 'sf_focus_sessions',
};

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/* ─── State ─── */
let state = {
  tasks: [],           // All tasks keyed by date
  dailyStats: {},      // { 'YYYY-MM-DD': { total, completed, hoursPlanned, hoursCompleted } }
  streak: 0,
  lastActive: null,
  dailyGoal: 80,
  theme: 'dark',
  focusSessions: [],   // { date, taskId, durationSec }
  editingTaskId: null,
  focusTaskId: null,
  focusTimer: null,
  focusElapsed: 0,
  focusRunning: false,
  focusTotalSec: 0,
  currentFilter: 'all',
  weeklyChartInstance: null,
  trendChartInstance: null,
};

/* ════════════════════════════════════════════
   STORAGE HELPERS
════════════════════════════════════════════ */
function save(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.warn('Save failed:', e); }
}
function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

function loadState() {
  state.tasks        = load(STORAGE_KEYS.tasks, []);
  state.dailyStats   = load(STORAGE_KEYS.dailyStats, {});
  state.streak       = load(STORAGE_KEYS.streak, 0);
  state.lastActive   = load(STORAGE_KEYS.lastActive, null);
  state.dailyGoal    = load(STORAGE_KEYS.dailyGoal, 80);
  state.theme        = load(STORAGE_KEYS.theme, 'dark');
  state.focusSessions = load(STORAGE_KEYS.focusSessions, []);
}

function saveState() {
  save(STORAGE_KEYS.tasks, state.tasks);
  save(STORAGE_KEYS.dailyStats, state.dailyStats);
  save(STORAGE_KEYS.streak, state.streak);
  save(STORAGE_KEYS.lastActive, state.lastActive);
  save(STORAGE_KEYS.dailyGoal, state.dailyGoal);
  save(STORAGE_KEYS.theme, state.theme);
  save(STORAGE_KEYS.focusSessions, state.focusSessions);
}

/* ════════════════════════════════════════════
   DATE HELPERS
════════════════════════════════════════════ */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function dateKey(d) {
  if (typeof d === 'string') return d;
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().split('T')[0];
}

function getWeekDates() {
  const today = new Date();
  const day = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7)); // Mon of this week
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(dateKey(d));
  }
  return dates;
}

function formatTime12(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

function calcDuration(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
}

function fmtMinutes(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/* ════════════════════════════════════════════
   TASK HELPERS
════════════════════════════════════════════ */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayTasks() {
  const today = todayStr();
  return state.tasks.filter(t => t.date === today);
}

function tasksByDate(dateStr) {
  return state.tasks.filter(t => t.date === dateStr).sort((a,b) => {
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return a.startTime.localeCompare(b.startTime);
  });
}

/* ════════════════════════════════════════════
   STATS CALCULATION
════════════════════════════════════════════ */
function calcDayStats(dateStr) {
  const tasks = tasksByDate(dateStr);
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const hoursPlanned = tasks.reduce((a, t) => a + calcDuration(t.startTime, t.endTime), 0);
  const hoursCompleted = tasks.filter(t => t.completed)
    .reduce((a, t) => a + calcDuration(t.startTime, t.endTime), 0);
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, hoursPlanned, hoursCompleted, pct };
}

function calcWeekStats() {
  const dates = getWeekDates();
  let totalPlanned = 0, totalCompleted = 0, totalHours = 0;
  let bestDay = null, bestPct = -1;
  let goalsMet = 0;

  const dayData = dates.map(d => {
    const s = calcDayStats(d);
    totalPlanned   += s.total;
    totalCompleted += s.completed;
    totalHours     += s.hoursCompleted;
    if (s.pct > bestPct && s.total > 0) { bestPct = s.pct; bestDay = d; }
    if (s.pct >= state.dailyGoal && s.total > 0) goalsMet++;
    return { date: d, ...s };
  });

  const weeklyAvg = totalPlanned > 0
    ? Math.round((totalCompleted / totalPlanned) * 100) : 0;

  return { dates, dayData, totalPlanned, totalCompleted, totalHours, weeklyAvg, bestDay, bestPct, goalsMet };
}

/* ════════════════════════════════════════════
   STREAK LOGIC
════════════════════════════════════════════ */
function updateStreak() {
  const today = todayStr();
  const todayStats = calcDayStats(today);

  if (state.lastActive === today) return; // already processed today

  if (state.lastActive) {
    const last = new Date(state.lastActive);
    const diff = Math.floor((new Date(today) - last) / 86400000);
    if (diff === 1) {
      // Consecutive day — check if yesterday's goal was met
      const yStats = calcDayStats(state.lastActive);
      if (yStats.pct >= state.dailyGoal && yStats.total > 0) {
        state.streak += 1;
      } else {
        state.streak = 0;
      }
    } else if (diff > 1) {
      state.streak = 0;
    }
  }

  state.lastActive = today;
  saveState();
}

/* ════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════ */
function navigateTo(sectionId) {
  // Hide all sections
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const section = document.getElementById(`section-${sectionId}`);
  if (section) section.classList.add('active');

  document.querySelectorAll(`[data-section="${sectionId}"]`).forEach(el => {
    el.classList.add('active');
  });

  // Close sidebar on mobile
  closeSidebar();

  // Render section-specific content
  switch(sectionId) {
    case 'dashboard': renderDashboard(); break;
    case 'planner':   renderPlanner(); break;
    case 'timeline':  renderTimeline(); break;
    case 'weekly':    renderWeekly(); break;
    case 'stats':     renderStats(); break;
    case 'focus':     renderFocus(); break;
    case 'review':    renderReview(); break;
  }
}

/* ════════════════════════════════════════════
   SIDEBAR
════════════════════════════════════════════ */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}

/* ════════════════════════════════════════════
   THEME
════════════════════════════════════════════ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  // Update Chart.js defaults
  updateChartDefaults(theme);
}

function updateChartDefaults(theme) {
  const isDark = theme === 'dark';
  Chart.defaults.color = isDark ? '#8b95b0' : '#4b5563';
  Chart.defaults.borderColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme(state.theme);
  save(STORAGE_KEYS.theme, state.theme);
  // Redraw charts with new theme
  renderWeekly();
  renderStats();
}

/* ════════════════════════════════════════════
   TOAST NOTIFICATIONS
════════════════════════════════════════════ */
function showToast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

/* ════════════════════════════════════════════
   MODAL HELPERS
════════════════════════════════════════════ */
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

/* ════════════════════════════════════════════
   TASK MODAL – ADD / EDIT
════════════════════════════════════════════ */
function openAddTaskModal(dateStr) {
  state.editingTaskId = null;
  const form = document.getElementById('taskForm');
  form.reset();
  document.getElementById('modalTitle').textContent = 'Add Task';
  document.getElementById('taskDate').value = dateStr || todayStr();
  openModal('taskModal');
  document.getElementById('taskName').focus();
}

function openEditTaskModal(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  state.editingTaskId = taskId;
  document.getElementById('modalTitle').textContent = 'Edit Task';
  document.getElementById('taskName').value      = task.name;
  document.getElementById('taskSubject').value   = task.subject || '';
  document.getElementById('taskStart').value     = task.startTime || '';
  document.getElementById('taskEnd').value       = task.endTime || '';
  document.getElementById('taskPriority').value  = task.priority || 'medium';
  document.getElementById('taskDate').value      = task.date || todayStr();
  document.getElementById('taskNotes').value     = task.notes || '';
  openModal('taskModal');
  document.getElementById('taskName').focus();
}

function handleTaskFormSubmit(e) {
  e.preventDefault();
  const name     = document.getElementById('taskName').value.trim();
  const subject  = document.getElementById('taskSubject').value.trim();
  const start    = document.getElementById('taskStart').value;
  const end      = document.getElementById('taskEnd').value;
  const priority = document.getElementById('taskPriority').value;
  const date     = document.getElementById('taskDate').value || todayStr();
  const notes    = document.getElementById('taskNotes').value.trim();

  if (!name) { showToast('Task name is required.', 'error'); return; }
  if (start && end && start >= end) {
    showToast('End time must be after start time.', 'error'); return;
  }

  if (state.editingTaskId) {
    const idx = state.tasks.findIndex(t => t.id === state.editingTaskId);
    if (idx !== -1) {
      state.tasks[idx] = { ...state.tasks[idx], name, subject, startTime: start, endTime: end, priority, date, notes };
      showToast('Task updated!', 'success');
    }
    state.editingTaskId = null;
  } else {
    state.tasks.push({ id: genId(), name, subject, startTime: start, endTime: end, priority, date, notes, completed: false, createdAt: Date.now() });
    showToast('Task added!', 'success');
  }

  saveState();
  closeModal('taskModal');
  refreshCurrentSection();
}

/* ════════════════════════════════════════════
   TASK OPERATIONS
════════════════════════════════════════════ */
function toggleTask(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.completed = !task.completed;
  saveState();
  checkGoalAchievement();
  refreshCurrentSection();
}

function deleteTask(taskId) {
  if (!confirm('Delete this task?')) return;
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  saveState();
  refreshCurrentSection();
  showToast('Task deleted.', 'info');
}

function refreshCurrentSection() {
  const active = document.querySelector('.section.active');
  if (!active) return;
  const id = active.id.replace('section-', '');
  navigateTo(id);
}

/* ════════════════════════════════════════════
   GOAL
════════════════════════════════════════════ */
function checkGoalAchievement() {
  const today = todayStr();
  const s = calcDayStats(today);
  if (s.total === 0) return;

  const pctEl   = document.getElementById('goalPercent');
  const statEl  = document.getElementById('goalStatus');
  if (!pctEl) return;

  pctEl.textContent = `${s.pct}%`;

  if (s.pct >= state.dailyGoal) {
    pctEl.style.color = 'var(--accent-green)';
    statEl.textContent = '✅ Goal achieved!';
  } else {
    pctEl.style.color = 'var(--accent-orange)';
    statEl.textContent = `Keep going! ${state.dailyGoal - s.pct}% more to reach your goal.`;
  }
}

/* ════════════════════════════════════════════
   RENDER – DASHBOARD
════════════════════════════════════════════ */
function renderDashboard() {
  const today = todayStr();
  const now   = new Date();
  const s     = calcDayStats(today);
  const week  = calcWeekStats();

  // Date heading
  const dayName = DAYS[now.getDay()];
  const dateStr = now.toLocaleDateString('en-US', { month:'long', day:'numeric' });
  document.getElementById('todayTitle').textContent = `${dayName}, ${dateStr}`;

  const hour = now.getHours();
  let greet = hour < 12 ? "Good morning! Let's crush today." :
              hour < 17 ? "Good afternoon! Stay focused." :
                          "Good evening! Keep pushing.";
  document.getElementById('todaySubtitle').textContent = greet;

  // Streak
  document.getElementById('streakNumber').textContent = state.streak;
  document.getElementById('streakCountSidebar').textContent = state.streak;

  // Goal card
  document.getElementById('goalTarget').textContent = `${state.dailyGoal}%`;
  checkGoalAchievement();
  if (s.total === 0) {
    document.getElementById('goalPercent').textContent = '0%';
    document.getElementById('goalPercent').style.color = '';
    document.getElementById('goalStatus').textContent = 'Add tasks to get started.';
  }

  // Stats cards
  document.getElementById('statTotalTasks').textContent = s.total;
  document.getElementById('statCompleted').textContent  = s.completed;
  document.getElementById('statRemaining').textContent  = s.total - s.completed;
  document.getElementById('statHoursPlanned').textContent  = fmtMinutes(s.hoursPlanned);
  document.getElementById('statHoursDone').textContent     = fmtMinutes(s.hoursCompleted);
  document.getElementById('statWeeklyAvg').textContent     = `${week.weeklyAvg}%`;

  // Progress bar
  document.getElementById('progressFill').style.width   = `${s.pct}%`;
  document.getElementById('progressPctBadge').textContent = `${s.pct}%`;
  document.getElementById('progressDetail').textContent = `Tasks: ${s.completed} / ${s.total} completed`;
  document.getElementById('progressTimeDetail').textContent =
    `Study Time: ${fmtMinutes(s.hoursCompleted)} / ${fmtMinutes(s.hoursPlanned)}`;
  document.getElementById('progressTrack').setAttribute('aria-valuenow', s.pct);

  // Today task list (compact)
  renderDashboardTasks(today);
}

function renderDashboardTasks(dateStr) {
  const container = document.getElementById('dashboardTaskList');
  const tasks = tasksByDate(dateStr);

  if (tasks.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <span class="empty-icon">🌱</span>
      <p>No tasks yet. Add your first task and start building your day.</p>
      <button class="btn btn-primary btn-sm" onclick="openAddTaskModal()">+ Add Task</button>
    </div>`;
    return;
  }

  container.innerHTML = tasks.map(t => `
    <div class="task-compact ${t.completed ? 'completed' : ''}" data-id="${t.id}">
      <div class="task-checkbox ${t.completed ? 'checked' : ''}" onclick="toggleTask('${t.id}')" role="checkbox" aria-checked="${t.completed}" tabindex="0">
        ${t.completed ? '✓' : ''}
      </div>
      <div class="task-name">${escHtml(t.name)}</div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:.5rem">
        ${t.startTime ? `<span class="task-time" style="font-size:.75rem;color:var(--text-muted)">${formatTime12(t.startTime)}</span>` : ''}
        <span class="priority-badge priority-${t.priority}">${t.priority}</span>
      </div>
    </div>
  `).join('');
}

/* ════════════════════════════════════════════
   RENDER – PLANNER
════════════════════════════════════════════ */
function renderPlanner() {
  const today = todayStr();
  let tasks = tasksByDate(today);

  const filter = state.currentFilter;
  if (filter === 'pending')   tasks = tasks.filter(t => !t.completed);
  if (filter === 'completed') tasks = tasks.filter(t => t.completed);
  if (filter === 'high')      tasks = tasks.filter(t => t.priority === 'high');
  if (filter === 'medium')    tasks = tasks.filter(t => t.priority === 'medium');
  if (filter === 'low')       tasks = tasks.filter(t => t.priority === 'low');

  const container = document.getElementById('taskList');

  if (tasks.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <span class="empty-icon">📋</span>
      <p>${filter === 'all' ? 'No tasks yet. Add your first task and start building your day.' : 'No tasks match this filter.'}</p>
    </div>`;
    return;
  }

  container.innerHTML = tasks.map(t => renderTaskItem(t)).join('');
}

function renderTaskItem(t) {
  const dur = calcDuration(t.startTime, t.endTime);
  return `
    <div class="task-item ${t.completed ? 'completed' : ''}" data-id="${t.id}">
      <div class="task-checkbox ${t.completed ? 'checked' : ''}"
        onclick="toggleTask('${t.id}')" role="checkbox" aria-checked="${t.completed}" tabindex="0"
        onkeydown="if(event.key==='Enter'||event.key===' ')toggleTask('${t.id}')">
        ${t.completed ? '✓' : ''}
      </div>
      <div class="task-content">
        <div class="task-name">${escHtml(t.name)}</div>
        <div class="task-meta">
          ${t.startTime ? `<span class="task-time">${formatTime12(t.startTime)} – ${formatTime12(t.endTime)}</span>` : ''}
          ${t.subject ? `<span class="task-subject">${escHtml(t.subject)}</span>` : ''}
          <span class="priority-badge priority-${t.priority}">${t.priority}</span>
          ${dur > 0 ? `<span class="task-duration">${fmtMinutes(dur)}</span>` : ''}
        </div>
        ${t.notes ? `<div class="task-notes">${escHtml(t.notes)}</div>` : ''}
      </div>
      <div class="task-actions">
        <button class="btn btn-icon btn-ghost" onclick="openEditTaskModal('${t.id}')" title="Edit" aria-label="Edit task">✏️</button>
        <button class="btn btn-icon btn-danger" onclick="deleteTask('${t.id}')" title="Delete" aria-label="Delete task">🗑</button>
      </div>
    </div>
  `;
}

/* ════════════════════════════════════════════
   RENDER – TIMELINE
════════════════════════════════════════════ */
function renderTimeline() {
  const today = todayStr();
  document.getElementById('timelineDate').textContent = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

  const tasks = tasksByDate(today).filter(t => t.startTime);
  const container = document.getElementById('timelineView');

  if (tasks.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <span class="empty-icon">⏱</span>
      <p>Add tasks with start and end times to see your daily timeline.</p>
    </div>`;
    return;
  }

  container.innerHTML = tasks.map(t => {
    const dur = calcDuration(t.startTime, t.endTime);
    return `
      <div class="timeline-item">
        <div class="timeline-dot ${t.completed ? 'completed' : ''}"></div>
        <div class="timeline-time">${formatTime12(t.startTime)}</div>
        <div class="timeline-card ${t.completed ? 'completed' : ''}">
          <div class="timeline-task-name">${escHtml(t.name)}</div>
          <div class="timeline-meta">
            ${t.startTime ? `<span>${formatTime12(t.startTime)} → ${formatTime12(t.endTime)}</span>` : ''}
            ${t.subject ? `<span class="task-subject">${escHtml(t.subject)}</span>` : ''}
            <span class="priority-badge priority-${t.priority}">${t.priority}</span>
            ${dur > 0 ? `<span>${fmtMinutes(dur)}</span>` : ''}
            ${t.completed ? '<span style="color:var(--accent-green);font-weight:600">✓ Done</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ════════════════════════════════════════════
   RENDER – WEEKLY PROGRESS
════════════════════════════════════════════ */
function renderWeekly() {
  const week = calcWeekStats();

  document.getElementById('weeklyAvgStat').textContent   = `${week.weeklyAvg}%`;
  document.getElementById('weeklyTasksStat').textContent = `${week.totalCompleted} / ${week.totalPlanned}`;

  const bestDayEl = document.getElementById('bestDayStat');
  if (week.bestDay) {
    const d = new Date(week.bestDay + 'T12:00:00');
    bestDayEl.textContent = DAYS[d.getDay()];
  } else {
    bestDayEl.textContent = '—';
  }

  // Build chart data
  const labels = week.dayData.map(d => {
    const dt = new Date(d.date + 'T12:00:00');
    return DAYS_SHORT[dt.getDay()];
  });
  const data   = week.dayData.map(d => d.pct);
  const today  = todayStr();
  const bgColors = week.dayData.map(d =>
    d.date === today ? 'rgba(79,142,247,0.9)' : 'rgba(79,142,247,0.4)'
  );
  const borderColors = week.dayData.map(() => 'rgba(79,142,247,1)');

  drawWeeklyChart(labels, data, bgColors, borderColors);

  // Day breakdown cards
  const breakdown = document.getElementById('dayBreakdown');
  breakdown.innerHTML = week.dayData.map(d => {
    const dt = new Date(d.date + 'T12:00:00');
    const isToday = d.date === today;
    const color = d.pct >= 80 ? 'var(--accent-green)' :
                  d.pct >= 50 ? 'var(--accent-yellow)' :
                  d.total > 0 ? 'var(--accent-red)' : 'var(--text-muted)';
    return `
      <div class="day-card ${isToday ? 'today' : ''}">
        <div class="day-name">${DAYS_SHORT[dt.getDay()]}</div>
        <div class="day-pct" style="color:${color}">${d.total > 0 ? d.pct+'%' : '—'}</div>
        <div style="font-size:.7rem;color:var(--text-muted);margin-top:2px">${d.completed}/${d.total}</div>
      </div>
    `;
  }).join('');
}

function drawWeeklyChart(labels, data, bgColors, borderColors) {
  const canvas = document.getElementById('weeklyChart');
  if (!canvas) return;

  if (state.weeklyChartInstance) {
    state.weeklyChartInstance.destroy();
    state.weeklyChartInstance = null;
  }

  const isDark = state.theme === 'dark';
  state.weeklyChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Completion %',
        data,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.parsed.y}% completed`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: v => v + '%',
            color: isDark ? '#8b95b0' : '#4b5563',
          },
          grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }
        },
        x: {
          ticks: { color: isDark ? '#8b95b0' : '#4b5563' },
          grid: { display: false }
        }
      }
    }
  });
}

/* ════════════════════════════════════════════
   RENDER – STATISTICS
════════════════════════════════════════════ */
function renderStats() {
  const today = todayStr();
  const todayS = calcDayStats(today);
  const week   = calcWeekStats();

  // All-time stats
  const allTasks   = state.tasks;
  const allDone    = allTasks.filter(t => t.completed).length;
  const allMissed  = allTasks.filter(t => !t.completed).length;
  const allHours   = allTasks.filter(t => t.completed)
    .reduce((a,t) => a + calcDuration(t.startTime, t.endTime), 0);

  document.getElementById('sdDailyRate').textContent   = `${todayS.pct}%`;
  document.getElementById('sdWeeklyRate').textContent  = `${week.weeklyAvg}%`;
  document.getElementById('sdTotalHours').textContent  = fmtMinutes(allHours);
  document.getElementById('sdTasksDone').textContent   = allDone;
  document.getElementById('sdTasksMissed').textContent = allMissed;
  document.getElementById('sdStreak').textContent      = `${state.streak} days`;
  document.getElementById('sdGoalsMet').textContent    = `${week.goalsMet} / 7`;

  const bestDayEl = document.getElementById('sdBestDay');
  if (week.bestDay) {
    const d = new Date(week.bestDay + 'T12:00:00');
    bestDayEl.textContent = DAYS[d.getDay()];
  } else {
    bestDayEl.textContent = '—';
  }

  // Trend chart – last 14 days
  const dates14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates14.push(dateKey(d));
  }
  const labels14 = dates14.map(d => {
    const dt = new Date(d + 'T12:00:00');
    return `${dt.getMonth()+1}/${dt.getDate()}`;
  });
  const data14 = dates14.map(d => calcDayStats(d).pct);

  drawTrendChart(labels14, data14);
}

function drawTrendChart(labels, data) {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;

  if (state.trendChartInstance) {
    state.trendChartInstance.destroy();
    state.trendChartInstance = null;
  }

  const isDark = state.theme === 'dark';
  state.trendChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Completion %',
        data,
        borderColor: '#4f8ef7',
        backgroundColor: 'rgba(79,142,247,0.12)',
        borderWidth: 2.5,
        pointBackgroundColor: '#4f8ef7',
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y}%` } }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            callback: v => v + '%',
            color: isDark ? '#8b95b0' : '#4b5563',
          },
          grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }
        },
        x: {
          ticks: { color: isDark ? '#8b95b0' : '#4b5563' },
          grid: { display: false }
        }
      }
    }
  });
}

/* ════════════════════════════════════════════
   RENDER – FOCUS MODE
════════════════════════════════════════════ */
function renderFocus() {
  const today = todayStr();
  const pendingTasks = tasksByDate(today).filter(t => !t.completed && t.name);

  const listEl = document.getElementById('focusTaskList');
  if (pendingTasks.length === 0) {
    listEl.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem">All done! No pending tasks.</p>';
  } else {
    listEl.innerHTML = pendingTasks.map(t => `
      <div class="focus-task-option" onclick="startFocusSession('${t.id}')">
        <div class="task-name">${escHtml(t.name)}</div>
        <div class="task-time">${t.startTime ? `${formatTime12(t.startTime)} – ${formatTime12(t.endTime)}` : ''} ${t.subject ? '· '+escHtml(t.subject) : ''}</div>
      </div>
    `).join('');
  }

  // Focus stats
  const todaySessions = state.focusSessions.filter(s => s.date === today);
  document.getElementById('focusSessionsToday').textContent = todaySessions.length;
  const focusMin = Math.floor(todaySessions.reduce((a,s) => a + (s.durationSec||0), 0) / 60);
  document.getElementById('focusTimeToday').textContent = focusMin > 0 ? fmtMinutes(focusMin) : '0m';
  document.getElementById('focusTasksDone').textContent = calcDayStats(today).completed;

  // Show selector, hide timer
  document.getElementById('focusSelector').style.display = '';
  document.getElementById('focusTimer').style.display = 'none';
}

function startFocusSession(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  state.focusTaskId = taskId;
  state.focusRunning = false;
  state.focusElapsed = 0;

  // Default 25 min (pomodoro), or task duration if available
  const dur = calcDuration(task.startTime, task.endTime);
  state.focusTotalSec = (dur > 0 ? dur : 25) * 60;

  document.getElementById('focusTaskName').textContent    = task.name;
  document.getElementById('focusSubjectName').textContent = task.subject || '';
  updateTimerDisplay();

  document.getElementById('focusSelector').style.display = 'none';
  document.getElementById('focusTimer').style.display    = '';
  document.getElementById('focusStartBtn').style.display = '';
  document.getElementById('focusPauseBtn').style.display = 'none';
}

function updateTimerDisplay() {
  const remaining = Math.max(0, state.focusTotalSec - state.focusElapsed);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  document.getElementById('timerDigits').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

  // Ring progress
  const circumference = 2 * Math.PI * 88; // r=88
  const offset = circumference * (state.focusElapsed / state.focusTotalSec);
  const ring = document.getElementById('timerRingProgress');
  if (ring) {
    ring.setAttribute('stroke-dasharray', circumference.toFixed(1));
    ring.setAttribute('stroke-dashoffset', (circumference - offset).toFixed(1));
  }
}

function focusStart() {
  if (state.focusRunning) return;
  state.focusRunning = true;
  document.getElementById('focusStartBtn').style.display  = 'none';
  document.getElementById('focusPauseBtn').style.display  = '';

  state.focusTimer = setInterval(() => {
    state.focusElapsed++;
    updateTimerDisplay();
    if (state.focusElapsed >= state.focusTotalSec) {
      focusFinish();
    }
  }, 1000);
}

function focusPause() {
  if (!state.focusRunning) return;
  state.focusRunning = false;
  clearInterval(state.focusTimer);
  document.getElementById('focusStartBtn').style.display  = '';
  document.getElementById('focusPauseBtn').style.display  = 'none';
}

function focusFinish() {
  clearInterval(state.focusTimer);
  state.focusRunning = false;

  // Log session
  const session = {
    date: todayStr(),
    taskId: state.focusTaskId,
    durationSec: state.focusElapsed,
  };
  state.focusSessions.push(session);

  // Mark task complete
  const task = state.tasks.find(t => t.id === state.focusTaskId);
  if (task && !task.completed) {
    task.completed = true;
    showToast(`"${task.name}" marked as complete! 🎉`, 'success', 4000);
  }

  saveState();
  renderFocus();
  renderDashboard();
}

function focusCancel() {
  clearInterval(state.focusTimer);
  state.focusRunning = false;
  state.focusElapsed = 0;
  state.focusTaskId  = null;
  document.getElementById('focusSelector').style.display = '';
  document.getElementById('focusTimer').style.display    = 'none';
}

/* ════════════════════════════════════════════
   RENDER – WEEKLY REVIEW
════════════════════════════════════════════ */
function renderReview() {
  const week  = calcWeekStats();
  const dates = getWeekDates();
  const startDate = new Date(dates[0] + 'T12:00:00');
  const endDate   = new Date(dates[6] + 'T12:00:00');

  document.getElementById('reviewWeekRange').textContent =
    `${startDate.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${endDate.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;

  document.getElementById('revTasksPlanned').textContent = week.totalPlanned;
  document.getElementById('revTasksDone').textContent    = week.totalCompleted;
  document.getElementById('revRate').textContent         = `${week.weeklyAvg}%`;
  document.getElementById('revHours').textContent        = fmtMinutes(week.totalHours);
  document.getElementById('revStreak').textContent       = state.streak;

  const bestDayEl = document.getElementById('revBestDay');
  if (week.bestDay) {
    const d = new Date(week.bestDay + 'T12:00:00');
    bestDayEl.textContent = DAYS[d.getDay()];
  } else {
    bestDayEl.textContent = '—';
  }

  // Motivational message
  const msgEl = document.getElementById('reviewMessage');
  if (week.totalPlanned === 0) {
    msgEl.textContent = 'No tasks this week yet. Start adding tasks to see your weekly review!';
  } else if (week.weeklyAvg >= 90) {
    msgEl.textContent = '🏆 Exceptional week! You crushed it. Your consistency is building the future version of you. Keep this momentum going!';
  } else if (week.weeklyAvg >= 75) {
    msgEl.textContent = '🔥 Great week! You showed up and got things done. A little more consistency and you\'ll be unstoppable!';
  } else if (week.weeklyAvg >= 50) {
    msgEl.textContent = '💪 Decent week! You\'re making progress. Identify what held you back and tackle it next week. You have the potential!';
  } else if (week.weeklyAvg > 0) {
    msgEl.textContent = '🌱 It was a tough week, but you still showed up. Every day is a fresh start. Plan better, execute better — you\'ve got this!';
  } else {
    msgEl.textContent = 'Start completing tasks to generate your weekly review message. You got this!';
  }
}

/* ════════════════════════════════════════════
   UTILITY
════════════════════════════════════════════ */
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ════════════════════════════════════════════
   INIT & EVENT BINDING
════════════════════════════════════════════ */
function bindEvents() {
  // Sidebar navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.section);
    });
  });

  // Topbar buttons
  document.getElementById('menuBtn').addEventListener('click', openSidebar);
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('overlay').addEventListener('click', closeSidebar);
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Add task buttons
  document.getElementById('addTaskBtn').addEventListener('click', () => openAddTaskModal());
  document.getElementById('plannerAddBtn').addEventListener('click', () => openAddTaskModal());

  // Dashboard shortcut
  document.getElementById('dashAddTaskBtn')?.addEventListener('click', () => openAddTaskModal());
  document.getElementById('viewAllTasks')?.addEventListener('click', () => navigateTo('planner'));

  // Task form
  document.getElementById('taskForm').addEventListener('submit', handleTaskFormSubmit);
  document.getElementById('modalClose').addEventListener('click', () => closeModal('taskModal'));
  document.getElementById('cancelTaskBtn').addEventListener('click', () => closeModal('taskModal'));

  // Goal modal
  document.getElementById('editGoalBtn').addEventListener('click', () => {
    document.getElementById('goalInput').value = state.dailyGoal;
    openModal('goalModal');
  });
  document.getElementById('goalModalClose').addEventListener('click', () => closeModal('goalModal'));
  document.getElementById('cancelGoalBtn').addEventListener('click', () => closeModal('goalModal'));
  document.getElementById('saveGoalBtn').addEventListener('click', () => {
    const val = parseInt(document.getElementById('goalInput').value, 10);
    if (val >= 1 && val <= 100) {
      state.dailyGoal = val;
      saveState();
      closeModal('goalModal');
      renderDashboard();
      showToast(`Daily goal set to ${val}%`, 'success');
    } else {
      showToast('Please enter a value between 1 and 100.', 'error');
    }
  });

  // Close modals on overlay click
  document.getElementById('taskModal').addEventListener('click', e => {
    if (e.target === document.getElementById('taskModal')) closeModal('taskModal');
  });
  document.getElementById('goalModal').addEventListener('click', e => {
    if (e.target === document.getElementById('goalModal')) closeModal('goalModal');
  });

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentFilter = btn.dataset.filter;
      renderPlanner();
    });
  });

  // Focus mode buttons
  document.getElementById('focusStartBtn').addEventListener('click', focusStart);
  document.getElementById('focusPauseBtn').addEventListener('click', focusPause);
  document.getElementById('focusFinishBtn').addEventListener('click', focusFinish);
  document.getElementById('focusCancelBtn').addEventListener('click', focusCancel);

  // Keyboard: close modals on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal('taskModal');
      closeModal('goalModal');
      closeSidebar();
    }
  });
}

/* ── Boot ── */
function init() {
  loadState();
  applyTheme(state.theme);
  updateChartDefaults(state.theme);
  updateStreak();
  bindEvents();

  // Set default date in task form
  document.getElementById('taskDate').value = todayStr();

  // Start on dashboard
  navigateTo('dashboard');
}

document.addEventListener('DOMContentLoaded', init);

/* ─── Expose functions needed by inline onclick handlers ─── */
window.openAddTaskModal   = openAddTaskModal;
window.openEditTaskModal  = openEditTaskModal;
window.toggleTask         = toggleTask;
window.deleteTask         = deleteTask;
window.startFocusSession  = startFocusSession;
window.navigateTo         = navigateTo;

