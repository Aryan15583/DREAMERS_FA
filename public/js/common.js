// Shared helpers for all pages
window.CLUB = { currency: '₹', locale: 'en-IN' }; // change currency symbol / locale here

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => CLUB.currency + Number(n || 0).toLocaleString(CLUB.locale, { maximumFractionDigits: 2 });
const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (d ? new Date(d).toLocaleDateString(CLUB.locale, opts) : '');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(CLUB.locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
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
