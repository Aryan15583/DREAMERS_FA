const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db, hashPassword, verifyPassword, getSetting, setSetting } = require('./db');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// ---------- helpers ----------
const SECRET = getSetting('session_secret');
const SESSION_HOURS = 12;

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${mac}`;
}
function unsign(token) {
  if (!token || !token.includes('.')) return null;
  const [data, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  return payload.exp > Date.now() ? payload : null;
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

const wrap = (fn) => (req, res) => {
  try { fn(req, res); } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

function playerFields(b, { admin }) {
  const p = {
    first_name: str(b.first_name, 80),
    last_name: str(b.last_name, 80),
    dob: str(b.dob, 10),
    gender: str(b.gender, 20),
    location_id: num(b.location_id),
    position: str(b.position, 40),
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
  }
  const errors = [];
  if (!p.first_name) errors.push('First name is required');
  if (!p.last_name) errors.push('Last name is required');
  if (!isDate(p.dob)) errors.push('Valid date of birth is required');
  else if (new Date(p.dob) > new Date()) errors.push('Date of birth cannot be in the future');
  if (!p.location_id || !db.prepare('SELECT 1 FROM locations WHERE id = ?').get(p.location_id)) errors.push('Please choose a location');
  if (!p.phone && !p.guardian_phone) errors.push('A phone number is required');
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

function listPlayers(period) {
  return db.prepare(`
    SELECT p.*, l.name AS location_name, l.monthly_fee AS location_fee,
           pay.amount AS paid_amount, pay.paid_on AS paid_on,
           (SELECT MAX(sent_at) FROM reminders r WHERE r.player_id = p.id AND r.period = pay_period.period) AS last_reminder,
           (SELECT COUNT(*) FROM reminders r WHERE r.player_id = p.id AND r.period = pay_period.period) AS reminder_count
    FROM players p
    CROSS JOIN (SELECT ? AS period) pay_period
    LEFT JOIN locations l ON l.id = p.location_id
    LEFT JOIN payments pay ON pay.player_id = p.id AND pay.period = pay_period.period
    ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE
  `).all(period).map((r) => decorate(r, period));
}

function filterPlayers(list, q) {
  return list.filter((p) =>
    (!q.location || String(p.location_id) === String(q.location)) &&
    (!q.age_group || p.age_group === q.age_group) &&
    (!q.status || p.status === q.status) &&
    (!q.fee || p.fee_status === q.fee) &&
    (!q.q || `${p.first_name} ${p.last_name} ${p.phone || ''} ${p.guardian_name || ''} ${p.guardian_phone || ''}`
      .toLowerCase().includes(String(q.q).toLowerCase()))
  );
}

// ---------- public API ----------
app.get('/api/locations', wrap((req, res) => {
  res.json(db.prepare('SELECT id, name, address, training_days, monthly_fee, map_url FROM locations ORDER BY name').all());
}));

app.get('/api/news', wrap((req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json(db.prepare('SELECT * FROM news ORDER BY published_at DESC, id DESC LIMIT ?').all(limit));
}));

app.get('/api/news/:id', wrap((req, res) => {
  const n = db.prepare('SELECT * FROM news WHERE id = ?').get(req.params.id);
  n ? res.json(n) : res.status(404).json({ error: 'Not found' });
}));

app.get('/api/fixtures', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM fixtures ORDER BY match_date').all());
}));

app.get('/api/stats', wrap((req, res) => {
  const players = db.prepare("SELECT COUNT(*) c FROM players WHERE status = 'active'").get().c;
  const locations = db.prepare('SELECT COUNT(*) c FROM locations').get().c;
  const wins = db.prepare('SELECT COUNT(*) c FROM fixtures WHERE score_us > score_them').get().c;
  res.json({ players, locations, wins, teams: AGE_GROUPS.length });
}));

app.post('/api/register', wrap((req, res) => {
  if (req.body.website) return res.json({ ok: true }); // honeypot for bots
  const { p, errors } = playerFields(req.body, { admin: false });
  if (!req.body.consent) errors.push('Please accept the consent checkbox');
  if (isDate(p.dob) && ageOn(p.dob) < 18 && !p.guardian_name) errors.push('Guardian name is required for players under 18');
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  const r = db.prepare(`INSERT INTO players(first_name,last_name,dob,gender,location_id,position,phone,email,guardian_name,guardian_phone,address,notes,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending')`).run(
    p.first_name, p.last_name, p.dob, p.gender, p.location_id, p.position, p.phone, p.email,
    p.guardian_name, p.guardian_phone, p.address, p.notes);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
}));

// ---------- auth ----------
const loginAttempts = new Map();
app.post('/api/admin/login', wrap((req, res) => {
  const ip = req.ip;
  const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const { username, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username || ''));
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

admin.post('/password', wrap((req, res) => {
  const { current, next } = req.body || {};
  const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!row || !verifyPassword(String(current || ''), row.password_hash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (!next || String(next).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(String(next)), row.id);
  res.json({ ok: true });
}));

// ---------- dashboard ----------
admin.get('/dashboard', wrap((req, res) => {
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod();
  const all = listPlayers(period);
  const active = all.filter((p) => p.status === 'active');
  const paid = active.filter((p) => p.fee_status === 'paid');
  const unpaid = active.filter((p) => p.fee_status === 'unpaid');
  const byLocation = db.prepare('SELECT id, name FROM locations ORDER BY name').all().map((l) => {
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
admin.get('/players', wrap((req, res) => {
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod();
  res.json(filterPlayers(listPlayers(period), req.query));
}));

admin.get('/players.csv', wrap((req, res) => {
  const period = isPeriod(req.query.period) ? req.query.period : currentPeriod();
  const rows = filterPlayers(listPlayers(period), req.query);
  const cols = ['id', 'first_name', 'last_name', 'dob', 'age', 'age_group', 'gender', 'location_name', 'position', 'jersey_number',
    'phone', 'email', 'guardian_name', 'guardian_phone', 'address', 'status', 'fee', 'period', 'fee_status', 'paid_on', 'joined_on'];
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

admin.get('/players/:id', wrap((req, res) => {
  const row = db.prepare(`SELECT p.*, l.name AS location_name, l.monthly_fee AS location_fee,
      pay.amount AS paid_amount, pay.paid_on AS paid_on
    FROM players p LEFT JOIN locations l ON l.id = p.location_id
    LEFT JOIN payments pay ON pay.player_id = p.id AND pay.period = ?
    WHERE p.id = ?`).get(currentPeriod(), req.params.id);
  if (!row) return res.status(404).json({ error: 'Player not found' });
  const payments = db.prepare('SELECT * FROM payments WHERE player_id = ? ORDER BY period DESC').all(row.id);
  const reminders = db.prepare('SELECT period, sent_at FROM reminders WHERE player_id = ? ORDER BY sent_at DESC LIMIT 20').all(row.id);
  res.json({ ...decorate(row, currentPeriod()), payments, reminders });
}));

const PLAYER_COLS = ['first_name', 'last_name', 'dob', 'gender', 'location_id', 'position', 'phone', 'email', 'guardian_name',
  'guardian_phone', 'address', 'notes', 'monthly_fee', 'status', 'jersey_number', 'joined_on'];

admin.post('/players', wrap((req, res) => {
  const { p, errors } = playerFields(req.body, { admin: true });
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  if (!p.joined_on && p.status === 'active') p.joined_on = new Date().toISOString().slice(0, 10);
  const r = db.prepare(`INSERT INTO players(${PLAYER_COLS.join(',')}) VALUES(${PLAYER_COLS.map(() => '?').join(',')})`)
    .run(...PLAYER_COLS.map((c) => p[c]));
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
}));

admin.put('/players/:id', wrap((req, res) => {
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Player not found' });
  const { p, errors } = playerFields({ ...existing, ...req.body }, { admin: true });
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  if (!p.joined_on && p.status === 'active') p.joined_on = existing.joined_on || new Date().toISOString().slice(0, 10);
  db.prepare(`UPDATE players SET ${PLAYER_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    .run(...PLAYER_COLS.map((c) => p[c]), existing.id);
  res.json({ ok: true });
}));

admin.delete('/players/:id', wrap((req, res) => {
  db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- payments ----------
admin.post('/players/:id/payments', wrap((req, res) => {
  const player = db.prepare('SELECT p.*, l.monthly_fee AS location_fee FROM players p LEFT JOIN locations l ON l.id = p.location_id WHERE p.id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const period = req.body.period || currentPeriod();
  if (!isPeriod(period)) return res.status(400).json({ error: 'Month must look like 2026-01' });
  const amount = num(req.body.amount) ?? player.monthly_fee ?? player.location_fee ?? 0;
  if (amount < 0) return res.status(400).json({ error: 'Amount cannot be negative' });
  const paidOn = isDate(req.body.paid_on) ? req.body.paid_on : new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT INTO payments(player_id, period, amount, paid_on, method, note) VALUES(?,?,?,?,?,?)
    ON CONFLICT(player_id, period) DO UPDATE SET amount = excluded.amount, paid_on = excluded.paid_on, method = excluded.method, note = excluded.note`)
    .run(player.id, period, amount, paidOn, str(req.body.method, 30) || 'Cash', str(req.body.note, 300));
  res.json({ ok: true });
}));

admin.delete('/players/:id/payments/:period', wrap((req, res) => {
  db.prepare('DELETE FROM payments WHERE player_id = ? AND period = ?').run(req.params.id, req.params.period);
  res.json({ ok: true });
}));

// ---------- reminders & settings ----------
admin.post('/players/:id/reminders', wrap((req, res) => {
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const period = isPeriod(req.body.period) ? req.body.period : currentPeriod();
  db.prepare('INSERT INTO reminders(player_id, period, channel, phone) VALUES(?, ?, ?, ?)')
    .run(player.id, period, 'whatsapp', str(req.body.phone, 30));
  res.json({ ok: true });
}));

admin.get('/settings', wrap((req, res) => {
  res.json({ wa_template: getSetting('wa_template') || '', wa_country_code: getSetting('wa_country_code') || '' });
}));

admin.put('/settings', wrap((req, res) => {
  const tpl = str(req.body.wa_template, 2000);
  const cc = String(req.body.wa_country_code ?? '').replace(/\D/g, '');
  if (!tpl) return res.status(400).json({ error: 'Message template cannot be empty' });
  if (!cc || cc.length > 4) return res.status(400).json({ error: 'Country code should be 1–4 digits, e.g. 91' });
  setSetting('wa_template', tpl);
  setSetting('wa_country_code', cc);
  res.json({ ok: true });
}));

// ---------- generic CRUD for locations / news / fixtures ----------
function crud(name, table, fields, validate) {
  admin.post(`/${name}`, wrap((req, res) => {
    const v = pick(req.body, fields); const err = validate(v);
    if (err) return res.status(400).json({ error: err });
    const r = db.prepare(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...fields.map((f) => v[f]));
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  }));
  admin.put(`/${name}/:id`, wrap((req, res) => {
    const v = pick(req.body, fields); const err = validate(v);
    if (err) return res.status(400).json({ error: err });
    db.prepare(`UPDATE ${table} SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...fields.map((f) => v[f]), req.params.id);
    res.json({ ok: true });
  }));
  admin.delete(`/${name}/:id`, wrap((req, res) => {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  }));
}
const NUMERIC = new Set(['monthly_fee', 'score_us', 'score_them']);
function pick(body, fields) {
  const o = {};
  for (const f of fields) o[f] = NUMERIC.has(f) ? num(body[f]) : str(body[f], f === 'body' ? 20000 : 500);
  return o;
}

crud('locations', 'locations', ['name', 'address', 'training_days', 'monthly_fee', 'map_url'], (v) => {
  if (!v.name) return 'Name is required';
  if (v.map_url && !/^https:\/\/[^\s]+$/i.test(v.map_url)) return 'Google Maps link must start with https://';
  if (v.monthly_fee == null) v.monthly_fee = 0;
  if (v.monthly_fee < 0) return 'Fee cannot be negative';
});
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dreamers FA running at http://localhost:${PORT}`));
