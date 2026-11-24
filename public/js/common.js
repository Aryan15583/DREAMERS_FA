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
function showInstallHelp() {
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
  $('.install-help', dlg).innerHTML = `<div class="install-app"><img src="/img/icon-192.png" alt="" width="64" height="64"><div><b>Dreamers FA</b><span>Free · works like an app · no app store needed</span></div></div>${steps}`;
  dlg.showModal();
}
