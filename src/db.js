const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'dreamers.db'));

db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  training_days TEXT,
  monthly_fee REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dob TEXT NOT NULL,
  gender TEXT,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  position TEXT,
  phone TEXT,
  email TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  address TEXT,
  monthly_fee REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  jersey_number INTEGER,
  joined_on TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_on TEXT NOT NULL,
  method TEXT,
  note TEXT,
  UNIQUE(player_id, period)
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  phone TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS reminders_player_period ON reminders(player_id, period);

CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT,
  image_url TEXT,
  published_at TEXT NOT NULL DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS fixtures (
  id INTEGER PRIMARY KEY,
  team TEXT NOT NULL,
  opponent TEXT NOT NULL,
  match_date TEXT NOT NULL,
  venue TEXT,
  home_away TEXT DEFAULT 'Home',
  competition TEXT,
  score_us INTEGER,
  score_them INTEGER
);
`);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// ---- first-run seed ----
if (!getSetting('session_secret')) setSetting('session_secret', crypto.randomBytes(32).toString('hex'));

const DEFAULT_WA_TEMPLATE = `Hello {guardian},

This is a friendly reminder from Dreamers Football Association ⚽💙

The {month} training fee for {player} ({location}) of {amount} is still pending. Please pay at your earliest convenience.

If you have already paid, please ignore this message. Thank you!`;
if (!getSetting('wa_template')) setSetting('wa_template', DEFAULT_WA_TEMPLATE);
if (!getSetting('wa_country_code')) setSetting('wa_country_code', process.env.WA_COUNTRY_CODE || '91');

if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
  const user = process.env.ADMIN_USER || 'admin';
  const pw = process.env.ADMIN_PASSWORD || 'dreamers123';
  db.prepare('INSERT INTO admins(username, password_hash) VALUES(?, ?)').run(user, hashPassword(pw));
  console.log(`[setup] Created admin user "${user}"${process.env.ADMIN_PASSWORD ? '' : ' with default password "dreamers123" — change it in Admin > Settings'}`);
}

// The club's training centres (fees and timings are set in Admin > Locations)
const CLUB_LOCATIONS = [
  ['Bhakshala', 'Dombivli (W)'],
  ["St Joseph's CBSC Turf", 'Near Regency, Dombivli (E)'],
  ['Legends Arena Turf', 'Dombivli (E)'],
];

// One-time: replace the original placeholder centres with the club's real ones (keeps player links)
if (!getSetting('real_locations_v1')) {
  const placeholders = ['Main Ground', 'North Centre', 'South Centre'];
  const rows = db.prepare("SELECT id, name FROM locations WHERE address = 'Update this address in Admin > Locations' ORDER BY id").all()
    .filter((r) => placeholders.includes(r.name));
  const upd = db.prepare('UPDATE locations SET name = ?, address = ?, training_days = NULL, monthly_fee = 0 WHERE id = ?');
  rows.forEach((r, i) => { if (CLUB_LOCATIONS[i]) upd.run(CLUB_LOCATIONS[i][0], CLUB_LOCATIONS[i][1], r.id); });
  db.prepare("UPDATE fixtures SET venue = 'Bhakshala, Dombivali (W)' WHERE venue = 'Main Ground'").run();
  setSetting('real_locations_v1', '1');
}

// One-time: St Joseph's address and "Dombivli" spelling (only touches values that were never edited)
if (!getSetting('real_locations_v2')) {
  db.prepare("UPDATE locations SET address = 'Near Regency, Dombivli (E)' WHERE name = 'St Joseph''s CBSC Turf' AND address IS NULL").run();
  db.prepare("UPDATE locations SET address = 'Dombivli (W)' WHERE address = 'Dombivali (W)'").run();
  db.prepare("UPDATE locations SET address = 'Dombivli (E)' WHERE address = 'Dombivali (E)'").run();
  db.prepare("UPDATE fixtures SET venue = 'Bhakshala, Dombivli (W)' WHERE venue = 'Bhakshala, Dombivali (W)'").run();
  setSetting('real_locations_v2', '1');
}

if (!getSetting('seeded') && process.env.NO_SAMPLE_DATA !== '1') {
  const loc = db.prepare('INSERT INTO locations(name, address, training_days, monthly_fee) VALUES(?, ?, ?, ?)');
  for (const [name, address] of CLUB_LOCATIONS) loc.run(name, address, null, 0);

  const news = db.prepare('INSERT INTO news(title, summary, body, published_at) VALUES(?, ?, ?, ?)');
  const today = new Date().toISOString().slice(0, 10);
  news.run('Registrations open for the new season', 'Players of all ages can now register online at any of our centres.',
    'Registrations for the new season are now open. Choose your nearest centre, fill in the online form and our coaches will get in touch to confirm your trial session.', today);
  news.run('Welcome to the new Dreamers FA website', 'Fixtures, results, news and online registration — all in one place.',
    'Our new website brings everything about the club together. Follow the latest news, check fixtures and results, and register new players online.', today);

  const fx = db.prepare('INSERT INTO fixtures(team, opponent, match_date, venue, home_away, competition) VALUES(?, ?, ?, ?, ?, ?)');
  const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 16); };
  fx.run('Senior', 'City United', d(7), 'Bhakshala, Dombivli (W)', 'Home', 'League');
  fx.run('U14', 'Rising Stars Academy', d(10), 'Away ground', 'Away', 'Youth Cup');

  setSetting('seeded', '1');
}

module.exports = { db, hashPassword, verifyPassword, getSetting, setSetting };
