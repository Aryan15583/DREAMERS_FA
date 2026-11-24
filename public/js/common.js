// Shared helpers for all pages
window.CLUB = { currency: '₹', locale: 'en-IN' }; // change currency symbol / locale here

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => CLUB.currency + Number(n || 0).toLocaleString(CLUB.locale, { maximumFractionDigits: 2 });
const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(d).toLocaleDateString(CLUB.locale, opts) : '');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(CLUB.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\b(am|pm)\b/g, (x) => x.toUpperCase()) : '');
const fmtMonth = (p) => (p ? new Date(p + '-01T00:00').toLocaleDateString(CLUB.locale, { month: 'long', year: 'numeric' }) : '');

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

// Exact pin if one was saved, otherwise a Google Maps search for the centre
function mapLink(l) {
  if (l.map_url) return l.map_url;
  const q = [l.name, l.address, l.address && /dombivli/i.test(l.address) ? '' : 'Dombivli', 'Maharashtra'].filter(Boolean).join(', ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

// ---- player form choices (keep in sync with src/server.js) ----
const POSITIONS = ['Fresher', 'Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
const POSITION_LABELS = { Fresher: 'Fresher (new player)' };
const STANDARDS = ['Jr KG', 'Sr KG', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', 'College', 'Not studying'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', "Don't know"];
const BLOOD_LABELS = { 'A-': 'A−', 'B-': 'B−', 'AB-': 'AB−', 'O-': 'O−' };
const optionList = (values, labels = {}) => values.map((v) => `<option value="${esc(v)}">${esc(labels[v] || v)}</option>`).join('');

// ---- training timings ----
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
function fmtTimeRange(a, b) {
  const [x, y] = [fmtTime(a), fmtTime(b)];
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)} – ${y}` : `${x} – ${y}`; // "5 – 7 PM", "11 AM – 1 PM"
}
function fmtDays(days) {
  const idx = days.map((d) => WEEK.indexOf(d)).sort((a, b) => a - b);
  if (idx.length === 7) return 'Every day';
  if (idx.join() === '0,1,2,3,4') return 'Mon – Fri';
  if (idx.join() === '5,6') return 'Sat & Sun';
  const runs = [];
  for (const i of idx) { const r = runs[runs.length - 1]; if (r && i === r[1] + 1) r[1] = i; else runs.push([i, i]); }
  return runs.map(([a, b]) => (b - a >= 2 ? `${WEEK[a]} – ${WEEK[b]}` : b > a ? `${WEEK[a]}, ${WEEK[b]}` : WEEK[a])).join(', ');
}

function ageFromDob(dob) {
  const b = new Date(dob), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}
function ageGroup(a) { return a < 8 ? 'U8' : a < 10 ? 'U10' : a < 12 ? 'U12' : a < 14 ? 'U14' : a < 16 ? 'U16' : a < 18 ? 'U18' : 'Senior'; }

document.addEventListener('DOMContentLoaded', () => { const y = $('#year'); if (y) y.textContent = new Date().getFullYear(); });

// ---- small pop-up message for the public pages ----
function notice(msg, isError) {
  $$('.toast').forEach((x) => x.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// ---- push notifications ----
// audience 'public' = club news for parents/players, 'admin' = new-registration alerts for club admins
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const IOS_NOTIFY_NOTE = `<div class="alert alert-ok" style="margin-bottom:14px">On iPhone, notifications work once the app is on your Home Screen
  (iOS 16.4 or newer). Add it with the steps below, open <b>Dreamers FA</b> from your Home Screen, then tap <b>Get notifications</b> again.</div>`;
function b64ToBytes(b64) {
  const raw = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function currentPushSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function pushStatus() {
  const sub = await currentPushSub();
  if (!sub) return { public: false, admin: false };
  return api('/api/push/status', { method: 'POST', body: { endpoint: sub.endpoint } });
}
async function enablePush(audience, locationId = null) {
  if (!pushSupported()) {
    const e = new Error(isIOS() && !isInstalled() ? 'ios-install' : 'This browser can’t show notifications. Use Chrome on Android, or the installed app on iPhone.');
    throw e;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser’s site settings (tap the lock icon next to the address), then try again.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api('/api/push/key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  }
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), audience, location_id: locationId } });
}
async function disablePush(audience) {
  const sub = await currentPushSub();
  if (!sub) return;
  await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint, audience } });
  const st = await pushStatus();
  if (!st.public && !st.admin) await sub.unsubscribe();
}
// Ask which training centre the family follows (for "Practice today" reminders). Resolves to an id, '' (club news only) or null (cancelled).
async function chooseCentre() {
  let locs = [];
  try { locs = await api('/api/locations'); } catch {}
  return new Promise((resolve) => {
    let dlg = $('#centre-dialog');
    if (dlg) dlg.remove();
    document.body.insertAdjacentHTML('beforeend', `<dialog id="centre-dialog"><form method="dialog">
      <div class="modal-head"><h3>Get notifications</h3><button type="button" class="close-btn" aria-label="Close" value="cancel">×</button></div>
      <div class="modal-body">
        <p style="margin-top:0">Which centre does your child train at? You’ll get a <b>“Practice today”</b> reminder with the time for that centre, plus club news.</p>
        <div class="loc-options">${locs.map((l) => `<label class="loc-option"><input type="radio" name="centre" value="${l.id}"><b>${esc(l.name)}</b>${l.address ? `<small>${esc(l.address)}</small>` : ''}</label>`).join('')}
          <label class="loc-option"><input type="radio" name="centre" value=""><b>Club news only</b><small>No practice reminders</small></label></div>
        <div class="modal-foot"><span></span><button class="btn btn-primary" value="ok">🔔 Turn on notifications</button></div>
      </div></form></dialog>`);
    dlg = $('#centre-dialog');
    let choice = null;
    $('.close-btn', dlg).addEventListener('click', () => dlg.close());
    dlg.querySelector('form').addEventListener('submit', (e) => {
      const picked = dlg.querySelector('input[name=centre]:checked');
      if (!picked) { e.preventDefault(); notice('Please choose a centre (or “Club news only”)', true); return; }
      choice = picked.value;
    });
    dlg.addEventListener('close', () => { resolve(choice); dlg.remove(); }, { once: true });
    dlg.showModal();
  });
}

// "Get notifications" buttons on the public pages
async function refreshNotifyButtons() {
  const btns = $$('[data-notify]');
  if (!btns.length) return;
  let on = false;
  try { on = pushSupported() && (await pushStatus()).public; } catch {}
  btns.forEach((b) => { b.dataset.on = on ? '1' : ''; b.textContent = on ? '🔔 Notifications on' : '🔔 Get notifications'; });
}
document.addEventListener('DOMContentLoaded', refreshNotifyButtons);
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-notify]');
  if (!btn) return;
  e.preventDefault();
  try {
    if (btn.dataset.on) {
      if (!confirm('Turn off notifications from Dreamers FA on this device?')) return;
      await disablePush('public');
      notice('Notifications turned off');
    } else {
      if (!pushSupported()) throw new Error(isIOS() && !isInstalled() ? 'ios-install' : 'This browser can’t show notifications. Use Chrome on Android, or the installed app on iPhone.');
      // straight after registering we already know the centre; otherwise ask
      const centre = btn.dataset.location || await chooseCentre();
      if (centre == null) return;
      btn.disabled = true;
      await enablePush('public', centre ? Number(centre) : null);
      notice('Notifications are on! You’ll get club news, match updates and training changes.');
    }
  } catch (err) {
    if (err.message === 'ios-install') showInstallHelp(IOS_NOTIFY_NOTE);
    else notice(err.message, true);
  } finally { btn.disabled = false; refreshNotifyButtons(); }
});

// ---- "Download app": install the website as an app on the phone / computer ----
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
let installPrompt = null;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);
function hideInstallButtons() { $$('[data-install]').forEach((b) => { b.hidden = true; }); }
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; hideInstallButtons(); });
document.addEventListener('DOMContentLoaded', () => { if (isInstalled()) hideInstallButtons(); });
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-install]');
  if (!btn) return;
  e.preventDefault();
  if (installPrompt) { // Android / Chrome / Edge: the browser's own install dialog
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    if (outcome === 'accepted') hideInstallButtons();
    return;
  }
  showInstallHelp();
});
function showInstallHelp(note = '') {
  let steps;
  if (isIOS()) {
    steps = `<p><b>On iPhone / iPad</b> (use <b>Safari</b>):</p>
      <ol><li>Tap the <b>Share</b> button <span aria-hidden="true">⬆️</span> at the bottom of the screen.</li>
      <li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. The Dreamers FA app appears on your home screen.</li></ol>`;
  } else if (isAndroid()) {
    steps = `<p><b>On Android</b> (use <b>Chrome</b>):</p>
      <ol><li>Tap the <b>⋮</b> menu at the top right.</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</li><li>Tap <b>Install</b>.</li></ol>`;
  } else {
    steps = `<p><b>On a computer</b> (Chrome or Edge): click the install icon <span aria-hidden="true">⊕</span> at the right end of the address bar, or open the menu and choose <b>Install Dreamers FA</b>.</p>
      <p><b>On your phone:</b> open this website and tap <b>Download app</b>.</p>`;
  }
  let dlg = $('#install-dialog');
  if (!dlg) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="install-dialog"><div class="modal-head"><h3>Get the Dreamers FA app</h3>
      <button class="close-btn" aria-label="Close" onclick="this.closest('dialog').close()">×</button></div><div class="modal-body install-help"></div></dialog>`);
    dlg = $('#install-dialog');
  }
  $('.install-help', dlg).innerHTML = `${note}<div class="install-app"><img src="/img/icon-192.png" alt="" width="64" height="64"><div><b>Dreamers FA</b><span>Free · works like an app · no app store needed</span></div></div>${steps}`;
  dlg.showModal();
}
