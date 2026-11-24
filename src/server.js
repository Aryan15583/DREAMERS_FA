const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db, ready, hashPassword, verifyPassword, setSetting } = require('./db');
const { sendPush, sendPushTo } = require('./push');

const app = express();
app.set('trust proxy', 1); // behind Vercel's proxy: lets secure cookies and req.ip work
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
// Locally Express serves the pages; on Vercel the public/ folder is served directly.
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Make sure the database is set up before handling any API request
let settings = {};
app.use('/api', async (req, res, next) => {
  try { settings = await ready(); next(); } catch (e) {
    console.error(e);
    res.status(503).json({ error: 'The database is not available right now. Please try again in a minute.' });
  }
});

// ---------- helpers ----------
const SESSION_HOURS = 12;

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', settings.session_secret).update(data).digest('base64url');
  return `${data}.${mac}`;
}
function unsign(token) {
  if (!token || !token.includes('.')) return null;
  const [data, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', settings.session_secret).update(data).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch { return null; }
}
function requireAdmin(req, res, next) {
  const s = unsign(req.cookies.dfa_session);
  if (!s) return res.status(401).json({ error: 'Please log in' });
  req.admin = s;
  next();
}

const currentPeriod = () => new Date().toISOString().slice(0, 7);
const isPeriod = (p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p || '');
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
const str = (v, max = 500) => (v === undefined || v === null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => (v === '' || v === undefined || v === null || isNaN(Number(v)) ? null : Number(v));

function ageOn(dob, ref = new Date()) {
  const b = new Date(dob);
  let age = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) age--;
  return age;
}
const AGE_GROUPS = ['U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Senior'];
function ageGroup(age) {
  if (age < 8) return 'U8';
  if (age < 10) return 'U10';
  if (age < 12) return 'U12';
  if (age < 14) return 'U14';
  if (age < 16) return 'U16';
  if (age < 18) return 'U18';
  return 'Senior';
}

// Training sessions for a centre: [{ days: ['Mon','Wed'], start: '17:00', end: '19:00', group: 'U8–U12', note: '' }]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t || '');
function parseSchedule(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = raw.trim() ? JSON.parse(raw) : []; } catch { return { error: 'Timings could not be read' }; } }
  if (list == null) list = [];
  if (!Array.isArray(list)) return { error: 'Timings could not be read' };
  if (list.length > 20) return { error: 'A centre can have at most 20 sessions' };
  const out = [];
  for (const [i, s] of list.entries()) {
    const n = `Session ${i + 1}`;
    const days = DAYS.filter((d) => Array.isArray(s?.days) && s.days.includes(d));
    if (!days.length) return { error: `${n}: choose at least one day` };
    if (!isTime(s.start) || !isTime(s.end)) return { error: `${n}: enter a start and end time` };
    if (s.end <= s.start) return { error: `${n}: end time must be after start time` };
    out.push({ days, start: s.start, end: s.end, group: str(s.group, 40) || 'All ages', note: str(s.note, 80) });
  }
  out.sort((a, b) => DAYS.indexOf(a.days[0]) - DAYS.indexOf(b.days[0]) || a.start.localeCompare(b.start));
  return { value: out };
}
const readSchedule = (txt) => { try { return JSON.parse(txt || '[]'); } catch { return []; } };

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

// Keep these lists in sync with public/js/common.js
const POSITIONS = ['Fresher', 'Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
const STANDARDS = ['Jr KG', 'Sr KG', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', 'College', 'Not studying'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', "Don't know"];

async function playerFields(b, { admin }) {
  const p = {
    first_name: str(b.first_name, 80),
    last_name: str(b.last_name, 80),
    dob: str(b.dob, 10),
    gender: str(b.gender, 20),
    location_id: num(b.location_id),
    position: str(b.position, 40),
    standard: str(b.standard, 20),
    blood_group: str(b.blood_group, 20),
    phone: str(b.phone, 30),
    email: str(b.email, 120),
    guardian_name: str(b.guardian_name, 120),
    guardian_phone: str(b.guardian_phone, 30),
    address: str(b.address, 300),
    notes: str(b.notes, 2000),
  };
  if (admin) {
    p.monthly_fee = num(b.monthly_fee);
    p.status = ['pending', 'active', 'inactive'].includes(b.status) ? b.status : 'active';
    p.jersey_number = num(b.jersey_number);
    p.joined_on = isDate(b.joined_on) ? b.joined_on : null;
    // ex-players: when and why they left (cleared again when a player re-joins)
    p.left_on = p.status === 'inactive' ? (isDate(b.left_on) ? b.left_on : new Date().toISOString().slice(0, 10)) : null;
    p.left_reason = p.status === 'inactive' ? str(b.left_reason, 120) : null;
  }
  const errors = [];
  if (!p.first_name) errors.push('First name is required');
  if (!p.last_name) errors.push('Last name is required');
  if (!isDate(p.dob)) errors.push('Valid date of birth is required');
  else if (new Date(p.dob) > new Date()) errors.push('Date of birth cannot be in the future');
  if (!p.location_id || !(await db.get('SELECT 1 AS x FROM locations WHERE id = ?', p.location_id))) errors.push('Please choose a location');
  if (!p.phone && !p.guardian_phone) errors.push('A phone number is required');
  if (p.position && !POSITIONS.includes(p.position)) errors.push('Please choose a playing position from the list');
  if (p.standard && !STANDARDS.includes(p.standard)) errors.push('Please choose the standard (class) from the list');
  if (p.blood_group && !BLOOD_GROUPS.includes(p.blood_group)) errors.push('Please choose a blood group from the list');
  if (!admin) { // the public registration form must have these
    if (!p.standard) errors.push('Standard (class) is required');
    if (!p.blood_group) errors.push('Blood group is required');
    if (!p.position) errors.push('Playing position is required (choose Fresher if the player is new)');
  }
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) errors.push('Email address looks invalid');
  return { p, errors };
}

// Decorate a player row with age, age group, effective fee and fee status for a period
function decorate(row, period) {
  const age = ageOn(row.dob);
  const fee = row.monthly_fee ?? row.location_fee ?? 0;
  return {
    ...row,
    age,
    age_group: ageGroup(age),
    fee,
    period,
    fee_status: row.paid_amount != null ? 'paid' : row.status === 'active' ? 'unpaid' : 'n/a',
  };
}

async function listPlayers(period) {
  const rows = await db.all(`
    SELECT p.*, l.name AS location_name, l.monthly_fee AS location_fee,
           pay.amount AS paid_amount, pay.paid_on AS paid_on,
           (SELECT MAX(sent_at) FROM reminders r WHERE r.player_id = p.id AND r.period = pay_period.period) AS last_reminder,
           (SELECT COUNT(*) FROM reminders r WHERE r.player_id = p.id AND r.period = pay_period.period) AS reminder_count
    FROM players p
    CROSS JOIN (SELECT ? AS period) pay_period
    LEFT JOIN locations l ON l.id = p.location_id
    LEFT JOIN payments pay ON pay.player_id = p.id AND pay.period = pay_period.period
    ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE
  `, period);
  return rows.map((r) => decorate(r, period));
}

// Every word typed must appear somewhere in the name, phone numbers or parent's name ("kabir sh" finds Kabir Shah)
function matchesSearch(p, query) {
  const hay = `${p.first_name} ${p.last_name} ${p.phone || ''} ${p.guardian_name || ''} ${p.guardian_phone || ''}`.toLowerCase();
  const digits = hay.replace(/[\s-]/g, '');
  return String(query).toLowerCase().split(/\s+/).filter(Boolean)
    .every((w) => hay.includes(w) || (/^\+?\d[\d\s-]*$/.test(w) && digits.includes(w.replace(/\D/g, ''))));
}

function filterPlayers(list, q) {
  return list.filter((p) =>
    (!q.location || String(p.location_id) === String(q.location)) &&
    (!q.age_group || p.age_group === q.age_group) &&
    (!q.status || (q.status === 'current' ? p.status !== 'inactive' : p.status === q.status)) &&
    (!q.fee || p.fee_status === q.fee) &&
    (!q.source || p.registered_via === q.source) &&
    (!q.position || p.position === q.position) &&
    (!q.q || matchesSearch(p, q.q))
  );
}

// ---------- public API ----------
app.get('/api/locations', wrap(async (req, res) => {
  const rows = await db.all('SELECT id, name, address, monthly_fee, map_url, schedule FROM locations ORDER BY name');
  res.json(rows.map((l) => ({ ...l, schedule: readSchedule(l.schedule) })));
}));

app.get('/api/news', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json(await db.all('SELECT * FROM news ORDER BY published_at DESC, id DESC LIMIT ?', limit));
}));

app.get('/api/news/:id', wrap(async (req, res) => {
  const n = await db.get('SELECT * FROM news WHERE id = ?', req.params.id);
  n ? res.json(n) : res.status(404).json({ error: 'Not found' });
}));

app.get('/api/fixtures', wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM fixtures ORDER BY match_date'));
}));

app.get('/api/stats', wrap(async (req, res) => {
  const row = await db.get(`SELECT
    (SELECT COUNT(*) FROM players WHERE status = 'active') AS players,
    (SELECT COUNT(*) FROM locations) AS locations,
    (SELECT COUNT(*) FROM fixtures WHERE score_us > score_them) AS wins`);
  res.json({ ...row, teams: AGE_GROUPS.length });
}));

app.post('/api/register', wrap(async (req, res) => {
  if (req.body.website) return res.json({ ok: true }); // honeypot for bots
  const { p, errors } = await playerFields(req.body, { admin: false });
  if (!req.body.consent) errors.push('Please accept the consent checkbox');
  if (isDate(p.dob) && ageOn(p.dob) < 18 && !p.guardian_name) errors.push('Guardian name is required for players under 18');
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  const r = await db.run(`INSERT INTO players(first_name,last_name,dob,gender,location_id,position,standard,blood_group,phone,email,guardian_name,guardian_phone,address,notes,status,registered_via)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','form')`,
    p.first_name, p.last_name, p.dob, p.gender, p.location_id, p.position, p.standard, p.blood_group, p.phone, p.email,
    p.guardian_name, p.guardian_phone, p.address, p.notes);
  // Alert club admins who turned on notifications (never blocks or breaks the registration)
  try {
    const loc = await db.get('SELECT name FROM locations WHERE id = ?', p.location_id);
    await sendPush(settings, 'admin', {
      title: 'New registration 📝',
      body: `${p.first_name} ${p.last_name} · ${ageGroup(ageOn(p.dob))} · ${loc?.name || ''}`,
      url: '/admin#registrations',
      tag: 'registration-' + r.lastInsertRowid,
    }, siteOrigin(req));
  } catch (e) { console.error('[push] registration alert failed:', e.message); }
  const link = await db.get("SELECT value FROM settings WHERE key = 'wa_group_link'");
  res.json({ ok: true, id: r.lastInsertRowid, group_link: link?.value || null }); // shown on the "registration received" screen
}));

// ---------- notifications: devices turn them on / off ----------
const siteOrigin = (req) => `${req.protocol}://${req.get('host')}`;
function readSubscription(b) {
  const s = b?.subscription || {};
  const endpoint = str(s.endpoint, 1000);
  const p256dh = str(s.keys?.p256dh, 200);
  const auth = str(s.keys?.auth, 100);
  if (!endpoint || !/^https:\/\//.test(endpoint) || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}
const isAdminRequest = (req) => !!unsign(req.cookies.dfa_session);

app.get('/api/push/key', (req, res) => res.json({ key: settings.vapid_public }));

// Turn notifications on for this device. audience: 'public' (club news) or 'admin' (new registrations, admins only)
app.post('/api/push/subscribe', wrap(async (req, res) => {
  const sub = readSubscription(req.body);
  if (!sub) return res.status(400).json({ error: 'This browser sent an invalid subscription' });
  const audience = req.body.audience === 'admin' ? 'admin' : 'public';
  if (audience === 'admin' && !isAdminRequest(req)) return res.status(401).json({ error: 'Please log in' });
  const col = audience === 'admin' ? 'is_admin' : 'is_public';
  // the centre this family follows, for "Practice today" reminders (public only; empty = club news only)
  let loc = audience === 'public' ? num(req.body.location_id) : null;
  if (loc != null && !(await db.get('SELECT 1 AS x FROM locations WHERE id = ?', loc))) loc = null;
  if (audience === 'public') {
    await db.run(`INSERT INTO push_subscriptions(endpoint, p256dh, auth, is_public, location_id) VALUES(?, ?, ?, 1, ?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, is_public = 1, location_id = excluded.location_id`,
      sub.endpoint, sub.p256dh, sub.auth, loc);
  } else {
    await db.run(`INSERT INTO push_subscriptions(endpoint, p256dh, auth, ${col}) VALUES(?, ?, ?, 1)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, ${col} = 1`, sub.endpoint, sub.p256dh, sub.auth);
  }
  res.json({ ok: true });
}));

// Turn notifications off for this device (for one audience; the row goes when neither is left)
app.post('/api/push/unsubscribe', wrap(async (req, res) => {
  const endpoint = str(req.body?.endpoint, 1000);
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  const col = req.body.audience === 'admin' ? 'is_admin' : 'is_public';
  await db.batch([
    [`UPDATE push_subscriptions SET ${col} = 0 WHERE endpoint = ?`, endpoint],
    ['DELETE FROM push_subscriptions WHERE endpoint = ? AND is_public = 0 AND is_admin = 0', endpoint],
  ]);
  res.json({ ok: true });
}));

// Which notifications this device has turned on
app.post('/api/push/status', wrap(async (req, res) => {
  const row = await db.get('SELECT is_public, is_admin, location_id FROM push_subscriptions WHERE endpoint = ?', str(req.body?.endpoint, 1000) || '');
  res.json({ public: !!row?.is_public, admin: !!row?.is_admin, location_id: row?.location_id ?? null });
}));

// ---------- auth ----------
const loginAttempts = new Map();
app.post('/api/admin/login', wrap(async (req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!(await db.get('SELECT 1 AS x FROM admins LIMIT 1'))) {
    return res.status(503).json({ error: 'Admin account not set up yet: add ADMIN_PASSWORD in the hosting settings and redeploy.' });
  }
  const { username, password } = req.body || {};
  const admin = await db.get('SELECT * FROM admins WHERE username = ?', String(username || ''));
  if (!admin || !verifyPassword(String(password || ''), admin.password_hash)) {
    a.n++; loginAttempts.set(ip, a);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  loginAttempts.delete(ip);
  const token = sign({ id: admin.id, u: admin.username, exp: Date.now() + SESSION_HOURS * 3600e3 });
  res.cookie('dfa_session', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: SESSION_HOURS * 3600e3 });
  res.json({ ok: true, username: admin.username });
}));

app.post('/api/admin/logout', (req, res) => { res.clearCookie('dfa_session'); res.json({ ok: true }); });

const admin = express.Router();
admin.use(requireAdmin);
app.use('/api/admin', admin);

admin.get('/me', (req, res) => res.json({ username: req.admin.u }));

admin.post('/password', wrap(async (req, res) => {
  const { current, next } = req.body || {};
  const row = await db.get('SELECT * FROM admins WHERE id = ?', req.admin.id);
  if (!row || !verifyPassword(String(current || ''), row.password_hash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (!next || String(next).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  await db.run('UPDATE admins SET password_hash = ? WHERE id = ?', hashPassword(String(next)), row.id);
  res.json({ ok: true });
}));

// ---------- dashboard ----------
admin.get('/dashboard', wrap(async (req, res) => {
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod();
  const [all, locations] = await Promise.all([listPlayers(period), db.all('SELECT id, name FROM locations ORDER BY name')]);
  const active = all.filter((p) => p.status === 'active');
  const paid = active.filter((p) => p.fee_status === 'paid');
  const unpaid = active.filter((p) => p.fee_status === 'unpaid');
  const byLocation = locations.map((l) => {
    const ps = active.filter((p) => p.location_id === l.id);
    return {
      ...l,
      players: ps.length,
      paid: ps.filter((p) => p.fee_status === 'paid').length,
      collected: ps.reduce((s, p) => s + (p.paid_amount || 0), 0),
      due: ps.filter((p) => p.fee_status === 'unpaid').reduce((s, p) => s + p.fee, 0),
    };
  });
  const byAgeGroup = AGE_GROUPS.map((g) => ({ group: g, players: active.filter((p) => p.age_group === g).length }));
  res.json({
    period,
    total: all.length,
    active: active.length,
    pending: all.filter((p) => p.status === 'pending').length,
    paid: paid.length,
    unpaid: unpaid.length,
    collected: active.reduce((s, p) => s + (p.paid_amount || 0), 0),
    due: unpaid.reduce((s, p) => s + p.fee, 0),
    byLocation,
    byAgeGroup,
    recent: [...all].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5),
  });
}));

// ---------- players ----------
admin.get('/players', wrap(async (req, res) => {
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod();
  res.json(filterPlayers(await listPlayers(period), req.query));
}));

admin.get('/players.csv', wrap(async (req, res) => {
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod();
  const rows = filterPlayers(await listPlayers(period), req.query);
  const cols = ['id', 'first_name', 'last_name', 'dob', 'age', 'age_group', 'standard', 'blood_group', 'gender', 'location_name', 'position', 'jersey_number',
    'phone', 'email', 'guardian_name', 'guardian_phone', 'address', 'notes', 'status', 'left_on', 'left_reason', 'registered_via', 'created_at', 'fee', 'period', 'fee_status', 'paid_on', 'joined_on'];
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // avoid spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="dreamers-players-${period}.csv"`);
  res.send('﻿' + csv);
}));

admin.get('/players/:id', wrap(async (req, res) => {
  const row = await db.get(`SELECT p.*, l.name AS location_name, l.monthly_fee AS location_fee,
      pay.amount AS paid_amount, pay.paid_on AS paid_on
    FROM players p LEFT JOIN locations l ON l.id = p.location_id
    LEFT JOIN payments pay ON pay.player_id = p.id AND pay.period = ?
    WHERE p.id = ?`, currentPeriod(), req.params.id);
  if (!row) return res.status(404).json({ error: 'Player not found' });
  const [payments, reminders] = await Promise.all([
    db.all('SELECT * FROM payments WHERE player_id = ? ORDER BY period DESC', row.id),
    db.all('SELECT period, sent_at FROM reminders WHERE player_id = ? ORDER BY sent_at DESC LIMIT 20', row.id),
  ]);
  res.json({ ...decorate(row, currentPeriod()), payments, reminders });
}));

const PLAYER_COLS = ['first_name', 'last_name', 'dob', 'gender', 'location_id', 'position', 'standard', 'blood_group', 'phone', 'email', 'guardian_name',
  'guardian_phone', 'address', 'notes', 'monthly_fee', 'status', 'jersey_number', 'joined_on', 'left_on', 'left_reason'];

admin.post('/players', wrap(async (req, res) => {
  const { p, errors } = await playerFields(req.body, { admin: true });
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  if (!p.joined_on && p.status === 'active') p.joined_on = new Date().toISOString().slice(0, 10);
  const r = await db.run(`INSERT INTO players(${PLAYER_COLS.join(',')}, registered_via) VALUES(${PLAYER_COLS.map(() => '?').join(',')}, 'admin')`,
    ...PLAYER_COLS.map((c) => p[c]));
  res.json({ ok: true, id: r.lastInsertRowid });
}));

// Move players to Ex-players (kept for records): { ids: [..], left_on, left_reason }
admin.post('/players/move-to-ex', wrap(async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return res.status(400).json({ error: 'Choose at least one player' });
  if (ids.length > 500) return res.status(400).json({ error: 'Too many players at once (max 500)' });
  const leftOn = isDate(req.body.left_on) ? req.body.left_on : new Date().toISOString().slice(0, 10);
  const r = await db.run(`UPDATE players SET status = 'inactive', left_on = ?, left_reason = ? WHERE id IN (${ids.map(() => '?').join(',')}) AND status != 'inactive'`,
    leftOn, str(req.body.left_reason, 120), ...ids);
  res.json({ ok: true, moved: r.changes });
}));

admin.put('/players/:id', wrap(async (req, res) => {
  const existing = await db.get('SELECT * FROM players WHERE id = ?', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Player not found' });
  const { p, errors } = await playerFields({ ...existing, ...req.body }, { admin: true });
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  if (!p.joined_on && p.status === 'active') p.joined_on = existing.joined_on || new Date().toISOString().slice(0, 10);
  await db.run(`UPDATE players SET ${PLAYER_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    ...PLAYER_COLS.map((c) => p[c]), existing.id);
  res.json({ ok: true });
}));

admin.delete('/players/:id', wrap(async (req, res) => {
  // remove the player's payments and reminders too (done explicitly so it works on every database host)
  await db.batch([
    ['DELETE FROM payments WHERE player_id = ?', req.params.id],
    ['DELETE FROM reminders WHERE player_id = ?', req.params.id],
    ['DELETE FROM players WHERE id = ?', req.params.id],
  ]);
  res.json({ ok: true });
}));

// ---------- payments ----------
admin.post('/players/:id/payments', wrap(async (req, res) => {
  const player = await db.get('SELECT p.*, l.monthly_fee AS location_fee FROM players p LEFT JOIN locations l ON l.id = p.location_id WHERE p.id = ?', req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const period = req.body.period || currentPeriod();
  if (!isPeriod(period)) return res.status(400).json({ error: 'Month must look like 2026-01' });
  const amount = num(req.body.amount) ?? player.monthly_fee ?? player.location_fee ?? 0;
  if (amount < 0) return res.status(400).json({ error: 'Amount cannot be negative' });
  const paidOn = isDate(req.body.paid_on) ? req.body.paid_on : new Date().toISOString().slice(0, 10);
  await db.run(`INSERT INTO payments(player_id, period, amount, paid_on, method, note) VALUES(?,?,?,?,?,?)
    ON CONFLICT(player_id, period) DO UPDATE SET amount = excluded.amount, paid_on = excluded.paid_on, method = excluded.method, note = excluded.note`,
    player.id, period, amount, paidOn, str(req.body.method, 30) || 'Cash', str(req.body.note, 300));
  res.json({ ok: true });
}));

admin.delete('/players/:id/payments/:period', wrap(async (req, res) => {
  await db.run('DELETE FROM payments WHERE player_id = ? AND period = ?', req.params.id, req.params.period);
  res.json({ ok: true });
}));

// ---------- reminders & settings ----------
admin.post('/players/:id/reminders', wrap(async (req, res) => {
  const player = await db.get('SELECT id FROM players WHERE id = ?', req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const period = isPeriod(req.body.period) ? req.body.period : currentPeriod();
  await db.run('INSERT INTO reminders(player_id, period, channel, phone) VALUES(?, ?, ?, ?)', player.id, period, 'whatsapp', str(req.body.phone, 30));
  res.json({ ok: true });
}));

// ---------- notifications (admin) ----------
admin.get('/notifications', wrap(async (req, res) => {
  const [counts, history] = await Promise.all([
    db.get('SELECT COALESCE(SUM(is_public), 0) AS public, COALESCE(SUM(is_admin), 0) AS admin FROM push_subscriptions'),
    db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT 30'),
  ]);
  res.json({ subscribers: counts, history });
}));

admin.post('/notifications', wrap(async (req, res) => {
  const title = str(req.body.title, 80);
  const body = str(req.body.body, 300);
  const url = str(req.body.url, 200) || '/';
  if (!title) return res.status(400).json({ error: 'Please write a title' });
  if (!/^\/(?!\/)[^\s]*$/.test(url)) return res.status(400).json({ error: 'Choose which page opens when the notification is tapped' });
  const result = await sendPush(settings, 'public', { title, body, url, tag: 'news-' + Date.now() }, siteOrigin(req));
  await db.run('INSERT INTO notifications(title, body, url, delivered, failed) VALUES(?, ?, ?, ?, ?)', title, body, url, result.delivered, result.failed);
  res.json({ ok: true, ...result });
}));

// ---------- "Practice today" reminders, per centre ----------
const CLUB_TZ = process.env.CLUB_TIMEZONE || 'Asia/Kolkata';
const todayInClub = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: CLUB_TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, date: `${parts.year}-${parts.month}-${parts.day}` }; // weekday like 'Mon'
};
const fmt12 = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtRange = (a, b) => { const x = fmt12(a), y = fmt12(b); return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)} – ${y}` : `${x} – ${y}`; };

// One message per centre that has training today, e.g. "Practice today @ 5 – 7 PM (U8–U12) at Bhakshala"
async function practiceToday(locationIds) {
  const { weekday, date } = todayInClub();
  const [locs, subs, s] = await Promise.all([
    db.all('SELECT id, name, address, schedule FROM locations ORDER BY name'),
    db.all('SELECT location_id, COUNT(*) AS n FROM push_subscriptions WHERE is_public = 1 AND location_id IS NOT NULL GROUP BY location_id'),
    db.all("SELECT key, value FROM settings WHERE key IN ('practice_title', 'practice_message', 'practice_auto', 'practice_last_sent')"),
  ]);
  const cfg = Object.fromEntries(s.map((r) => [r.key, r.value]));
  const counts = Object.fromEntries(subs.map((r) => [r.location_id, r.n]));
  const items = locs.filter((l) => !locationIds || locationIds.includes(l.id)).map((l) => {
    const sessions = readSchedule(l.schedule).filter((x) => x.days.includes(weekday));
    const time = sessions.map((x) => fmtRange(x.start, x.end) + (sessions.length > 1 || (x.group && x.group !== 'All ages') ? ` (${x.group})` : '')).join(' and ');
    const fill = (t) => (t || '').replace(/\{time\}/g, time).replace(/\{location\}/g, l.name).replace(/\{address\}/g, l.address || l.name);
    return { location_id: l.id, location: l.name, sessions, subscribers: counts[l.id] || 0,
      title: fill(cfg.practice_title), body: sessions.length ? fill(cfg.practice_message) : null };
  });
  return { weekday, date, auto: cfg.practice_auto === '1', last_sent: cfg.practice_last_sent || null,
    title: cfg.practice_title, message: cfg.practice_message, items };
}

async function sendPracticeReminders(origin, locationIds) {
  const p = await practiceToday(locationIds);
  const results = [];
  for (const it of p.items.filter((i) => i.body)) {
    const subs = { vapid_public: settings.vapid_public, vapid_private: settings.vapid_private };
    const r = await sendPushTo(subs, 'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE is_public = 1 AND location_id = ?', [it.location_id],
      { title: it.title, body: it.body, url: '/#academy', tag: `practice-${p.date}-${it.location_id}` }, origin);
    await db.run('INSERT INTO notifications(title, body, url, delivered, failed) VALUES(?, ?, ?, ?, ?)', `${it.title} · ${it.location}`, it.body, '/#academy', r.delivered, r.failed);
    results.push({ location: it.location, ...r });
  }
  await setSetting('practice_last_sent', p.date);
  return { date: p.date, results };
}

admin.get('/practice', wrap(async (req, res) => res.json(await practiceToday())));

admin.put('/practice', wrap(async (req, res) => {
  const title = str(req.body.practice_title, 80);
  const message = str(req.body.practice_message, 300);
  if (!title || !message) return res.status(400).json({ error: 'Title and message are required' });
  if (!message.includes('{time}')) return res.status(400).json({ error: 'The message must contain {time} where the practice time goes' });
  await setSetting('practice_title', title);
  await setSetting('practice_message', message);
  await setSetting('practice_auto', req.body.practice_auto ? '1' : '0');
  res.json({ ok: true });
}));

admin.post('/practice/send', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.location_ids) ? req.body.location_ids.map(Number).filter(Boolean) : null;
  res.json({ ok: true, ...(await sendPracticeReminders(siteOrigin(req), ids)) });
}));

// Daily automatic reminders, called by Vercel Cron (vercel.json). Needs CRON_SECRET set in Vercel.
app.get('/api/cron/practice', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Not allowed' });
  const p = await practiceToday();
  if (!p.auto) return res.json({ ok: true, skipped: 'automatic reminders are off' });
  if (p.last_sent === p.date) return res.json({ ok: true, skipped: 'already sent today' });
  res.json({ ok: true, ...(await sendPracticeReminders(siteOrigin(req))) });
}));

admin.post('/players/:id/group-link-sent', wrap(async (req, res) => {
  const r = await db.run("UPDATE players SET group_link_sent_at = datetime('now') WHERE id = ?", req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Player not found' });
  res.json({ ok: true });
}));

const SETTING_KEYS = ['wa_template', 'wa_country_code', 'wa_group_link', 'wa_group_message'];
admin.get('/settings', wrap(async (req, res) => {
  const rows = await db.all(`SELECT key, value FROM settings WHERE key IN (${SETTING_KEYS.map(() => '?').join(',')})`, ...SETTING_KEYS);
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json(Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k] || ''])));
}));

// Saves only the settings that were sent, so each settings form can be saved on its own
admin.put('/settings', wrap(async (req, res) => {
  const b = req.body || {};
  const updates = {};
  if ('wa_template' in b) {
    updates.wa_template = str(b.wa_template, 2000);
    if (!updates.wa_template) return res.status(400).json({ error: 'Reminder message cannot be empty' });
  }
  if ('wa_country_code' in b) {
    updates.wa_country_code = String(b.wa_country_code ?? '').replace(/\D/g, '');
    if (!updates.wa_country_code || updates.wa_country_code.length > 4) return res.status(400).json({ error: 'Country code should be 1–4 digits, e.g. 91' });
  }
  if ('wa_group_link' in b) {
    updates.wa_group_link = str(b.wa_group_link, 200) || '';
    if (updates.wa_group_link && !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,}\/?(\?.*)?$/.test(updates.wa_group_link)) {
      return res.status(400).json({ error: 'Paste the group invite link from WhatsApp. It looks like https://chat.whatsapp.com/AbC123…' });
    }
  }
  if ('wa_group_message' in b) {
    updates.wa_group_message = str(b.wa_group_message, 2000);
    if (!updates.wa_group_message) return res.status(400).json({ error: 'Group message cannot be empty' });
    if (!updates.wa_group_message.includes('{link}')) return res.status(400).json({ error: 'The group message must contain {link} where the group link goes' });
  }
  for (const [k, v] of Object.entries(updates)) await setSetting(k, v);
  res.json({ ok: true });
}));

// ---------- generic CRUD for locations / news / fixtures ----------
function crud(name, table, fields, validate, { beforeDelete } = {}) {
  admin.post(`/${name}`, wrap(async (req, res) => {
    const v = pick(req.body, fields); const err = validate(v);
    if (err) return res.status(400).json({ error: err });
    const r = await db.run(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`, ...fields.map((f) => v[f]));
    res.json({ ok: true, id: r.lastInsertRowid });
  }));
  admin.put(`/${name}/:id`, wrap(async (req, res) => {
    const v = pick(req.body, fields); const err = validate(v);
    if (err) return res.status(400).json({ error: err });
    await db.run(`UPDATE ${table} SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`, ...fields.map((f) => v[f]), req.params.id);
    res.json({ ok: true });
  }));
  admin.delete(`/${name}/:id`, wrap(async (req, res) => {
    await db.batch([...(beforeDelete ? beforeDelete(req.params.id) : []), [`DELETE FROM ${table} WHERE id = ?`, req.params.id]]);
    res.json({ ok: true });
  }));
}
const NUMERIC = new Set(['monthly_fee', 'score_us', 'score_them']);
function pick(body, fields) {
  const o = {};
  for (const f of fields) {
    if (f === 'schedule') { const r = parseSchedule(body.schedule); o.schedule = r.value ? JSON.stringify(r.value) : null; o._scheduleError = r.error; }
    else o[f] = NUMERIC.has(f) ? num(body[f]) : str(body[f], f === 'body' ? 20000 : 500);
  }
  return o;
}

crud('locations', 'locations', ['name', 'address', 'monthly_fee', 'map_url', 'schedule'], (v) => {
  if (!v.name) return 'Name is required';
  if (v._scheduleError) return v._scheduleError;
  if (v.map_url && !/^https:\/\/[^\s]+$/i.test(v.map_url)) return 'Google Maps link must start with https://';
  if (v.monthly_fee == null) v.monthly_fee = 0;
  if (v.monthly_fee < 0) return 'Fee cannot be negative';
}, { beforeDelete: (id) => [['UPDATE players SET location_id = NULL WHERE location_id = ?', id]] }); // players stay, just without a centre
crud('news', 'news', ['title', 'summary', 'body', 'image_url', 'published_at'], (v) => {
  if (!v.title) return 'Title is required';
  if (v.image_url && !/^https?:\/\//i.test(v.image_url)) return 'Image URL must start with http:// or https://';
  if (!isDate(v.published_at)) v.published_at = new Date().toISOString().slice(0, 10);
});
crud('fixtures', 'fixtures', ['team', 'opponent', 'match_date', 'venue', 'home_away', 'competition', 'score_us', 'score_them'], (v) => {
  if (!v.team || !v.opponent) return 'Team and opponent are required';
  if (!v.match_date || isNaN(Date.parse(v.match_date))) return 'Match date is required';
  if (!['Home', 'Away'].includes(v.home_away)) v.home_away = 'Home';
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;

// Running locally with `npm start` (on Vercel the app is loaded from api/index.js instead)
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  ready()
    .then(() => app.listen(PORT, () => console.log(`Dreamers FA running at http://localhost:${PORT}`)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
