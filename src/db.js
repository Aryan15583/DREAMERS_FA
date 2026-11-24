// Database access for Dreamers FA.
// Uses libSQL (SQLite-compatible):
//   - locally: a file in ./data (or DATA_DIR)
//   - on Vercel: a Turso database (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');
const webpush = require('web-push');

const ON_VERCEL = !!process.env.VERCEL;

function makeClient() {
  if (process.env.TURSO_DATABASE_URL) {
    return createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  if (ON_VERCEL) {
    throw new Error('TURSO_DATABASE_URL is not set. Add it (and TURSO_AUTH_TOKEN) in Vercel > Project > Settings > Environment Variables, then redeploy.');
  }
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  return createClient({ url: 'file:' + path.join(dir, 'dreamers.db') });
}

let client;
const conn = () => (client ||= makeClient());
const clean = (args) => args.map((a) => (a === undefined ? null : a));
const toObjects = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

const db = {
  async all(sql, ...args) { return toObjects(await conn().execute({ sql, args: clean(args) })); },
  async get(sql, ...args) { return (await db.all(sql, ...args))[0]; },
  async run(sql, ...args) {
    const r = await conn().execute({ sql, args: clean(args) });
    return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected };
  },
  // Several writes in one transaction: db.batch([[sql, ...args], ...])
  async batch(statements) {
    return conn().batch(statements.map(([sql, ...args]) => ({ sql, args: clean(args) })), 'write');
  },
  exec(sql) { return conn().executeMultiple(sql); },
};

const SCHEMA = `
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
  monthly_fee REAL NOT NULL DEFAULT 0,
  map_url TEXT,
  schedule TEXT
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
  standard TEXT,
  blood_group TEXT,
  registered_via TEXT,
  group_link_sent_at TEXT,
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

-- Devices that turned on notifications. One row per browser/app install;
-- is_public = club news for parents/players, is_admin = new-registration alerts for admins.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  location_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notifications sent from the admin panel
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

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

async function getSetting(key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : null;
}
async function setSetting(key, value) {
  await db.run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

const DEFAULT_WA_TEMPLATE = `Hello {guardian},

This is a friendly reminder from Dreamers Football Association ⚽💙

The {month} training fee for {player} ({location}) is still pending. Please pay at your earliest convenience.

If you have already paid, please ignore this message. Thank you!`;

const DEFAULT_GROUP_MESSAGE = `Hello {guardian},

Welcome to Dreamers Football Association! ⚽💙
We have received {player}'s registration for {location}.

Please join our WhatsApp group for training updates and announcements:
{link}

One Team. One Dream.`;

// The club's training centres (fees and timings are set in Admin > Locations)
const CLUB_LOCATIONS = [
  ['Bhakshala', 'Dombivli (W)'],
  ["St Joseph's CBSC Turf", 'Near Regency, Dombivli (E)'],
  ['Legends Arena Turf', 'Dombivli (E)'],
];

// Create tables, run one-time upgrades and first-run setup. Safe to run on every start.
async function init() {
  await db.exec(SCHEMA);

  // Columns added after the first release
  const cols = async (t) => (await db.all(`PRAGMA table_info(${t})`)).map((c) => c.name);
  const locCols = await cols('locations');
  if (!locCols.includes('map_url')) await db.run('ALTER TABLE locations ADD COLUMN map_url TEXT');
  if (!locCols.includes('schedule')) await db.run('ALTER TABLE locations ADD COLUMN schedule TEXT'); // JSON list of training sessions
  const subCols = await cols('push_subscriptions');
  if (!subCols.includes('location_id')) await db.run('ALTER TABLE push_subscriptions ADD COLUMN location_id INTEGER'); // centre the family follows
  const playerCols = await cols('players');
  if (!playerCols.includes('left_on')) await db.run('ALTER TABLE players ADD COLUMN left_on TEXT');       // ex-players: date they left
  if (!playerCols.includes('left_reason')) await db.run('ALTER TABLE players ADD COLUMN left_reason TEXT');
  if (!playerCols.includes('standard')) await db.run('ALTER TABLE players ADD COLUMN standard TEXT'); // school class, e.g. "5th"
  if (!playerCols.includes('blood_group')) await db.run('ALTER TABLE players ADD COLUMN blood_group TEXT');
  if (!playerCols.includes('group_link_sent_at')) await db.run('ALTER TABLE players ADD COLUMN group_link_sent_at TEXT'); // when the WhatsApp group link was sent
  if (!playerCols.includes('registered_via')) { // 'form' = parent used the registration form, 'admin' = added by the club
    await db.run('ALTER TABLE players ADD COLUMN registered_via TEXT');
    await db.run("UPDATE players SET registered_via = CASE WHEN status = 'pending' THEN 'form' ELSE 'admin' END");
  }

  const settings = Object.fromEntries((await db.all('SELECT key, value FROM settings')).map((r) => [r.key, r.value]));
  const set = async (k, v) => { await setSetting(k, v); settings[k] = v; };

  if (!settings.session_secret) await set('session_secret', crypto.randomBytes(32).toString('hex'));
  if (!settings.wa_template) await set('wa_template', DEFAULT_WA_TEMPLATE);
  else if (!settings.wa_template_v2 && settings.wa_template.includes('({location}) of {amount} is still pending')) {
    await set('wa_template', settings.wa_template.replace(' of {amount} is still pending', ' is still pending'));
  }
  if (!settings.wa_template_v2) await set('wa_template_v2', '1');
  if (!settings.wa_group_message) await set('wa_group_message', DEFAULT_GROUP_MESSAGE);
  if (!settings.practice_title) await set('practice_title', 'Practice today ⚽');
  if (!settings.practice_message) await set('practice_message', 'Practice today @ {time} at {location}. See you there!');
  if (settings.practice_auto == null) await set('practice_auto', '0');
  // Keys that identify this site to the phone's notification service (created once, kept in the database)
  if (!settings.vapid_public || !settings.vapid_private) {
    const keys = webpush.generateVAPIDKeys();
    await set('vapid_public', keys.publicKey);
    await set('vapid_private', keys.privateKey);
  }
  if (!settings.wa_country_code) await set('wa_country_code', process.env.WA_COUNTRY_CODE || '91');

  // First admin account. On the live site a password must be provided (never the default one).
  if (!(await db.get('SELECT 1 AS x FROM admins LIMIT 1'))) {
    const user = process.env.ADMIN_USER || 'admin';
    const pw = process.env.ADMIN_PASSWORD || (ON_VERCEL ? null : 'dreamers123');
    if (pw) {
      await db.run('INSERT INTO admins(username, password_hash) VALUES(?, ?)', user, hashPassword(pw));
      console.log(`[setup] Created admin user "${user}"${process.env.ADMIN_PASSWORD ? '' : ' with default password "dreamers123" — change it in Admin > Settings'}`);
    } else {
      console.error('[setup] No admin account yet: set ADMIN_PASSWORD in Vercel environment variables and redeploy.');
    }
  }

  // One-time: replace the original placeholder centres with the club's real ones (keeps player links)
  if (!settings.real_locations_v1) {
    const placeholders = ['Main Ground', 'North Centre', 'South Centre'];
    const rows = (await db.all("SELECT id, name FROM locations WHERE address = 'Update this address in Admin > Locations' ORDER BY id"))
      .filter((r) => placeholders.includes(r.name));
    for (const [i, r] of rows.entries()) {
      if (CLUB_LOCATIONS[i]) await db.run('UPDATE locations SET name = ?, address = ?, training_days = NULL, monthly_fee = 0 WHERE id = ?', CLUB_LOCATIONS[i][0], CLUB_LOCATIONS[i][1], r.id);
    }
    await db.run("UPDATE fixtures SET venue = 'Bhakshala, Dombivali (W)' WHERE venue = 'Main Ground'");
    await set('real_locations_v1', '1');
  }

  // One-time: St Joseph's address and "Dombivli" spelling (only touches values that were never edited)
  if (!settings.real_locations_v2) {
    await db.batch([
      ["UPDATE locations SET address = 'Near Regency, Dombivli (E)' WHERE name = 'St Joseph''s CBSC Turf' AND address IS NULL"],
      ["UPDATE locations SET address = 'Dombivli (W)' WHERE address = 'Dombivali (W)'"],
      ["UPDATE locations SET address = 'Dombivli (E)' WHERE address = 'Dombivali (E)'"],
      ["UPDATE fixtures SET venue = 'Bhakshala, Dombivli (W)' WHERE venue = 'Bhakshala, Dombivali (W)'"],
    ]);
    await set('real_locations_v2', '1');
  }

  if (!settings.seeded && process.env.NO_SAMPLE_DATA !== '1') {
    const today = new Date().toISOString().slice(0, 10);
    const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 16); };
    await db.batch([
      ...CLUB_LOCATIONS.map(([name, address]) => ['INSERT INTO locations(name, address, monthly_fee) VALUES(?, ?, 0)', name, address]),
      ['INSERT INTO news(title, summary, body, published_at) VALUES(?, ?, ?, ?)', 'Registrations open for the new season',
        'Players of all ages can now register online at any of our centres.',
        'Registrations for the new season are now open. Choose your nearest centre, fill in the online form and our coaches will get in touch to confirm your trial session.', today],
      ['INSERT INTO news(title, summary, body, published_at) VALUES(?, ?, ?, ?)', 'Welcome to the new Dreamers FA website',
        'Fixtures, results, news and online registration — all in one place.',
        'Our new website brings everything about the club together. Follow the latest news, check fixtures and results, and register new players online.', today],
      ['INSERT INTO fixtures(team, opponent, match_date, venue, home_away, competition) VALUES(?, ?, ?, ?, ?, ?)', 'Senior', 'City United', d(7), 'Bhakshala, Dombivli (W)', 'Home', 'League'],
      ['INSERT INTO fixtures(team, opponent, match_date, venue, home_away, competition) VALUES(?, ?, ?, ?, ?, ?)', 'U14', 'Rising Stars Academy', d(10), 'Away ground', 'Away', 'Youth Cup'],
    ]);
    await set('seeded', '1');
  }

  return settings;
}

// Run setup once per server instance; if it fails (e.g. database unreachable), try again on the next request.
let readyPromise = null;
function ready() {
  if (!readyPromise) readyPromise = init().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}

module.exports = { db, ready, hashPassword, verifyPassword, getSetting, setSetting };
