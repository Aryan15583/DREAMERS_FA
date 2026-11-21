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

function ageFromDob(dob) {
  const b = new Date(dob), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}
function ageGroup(a) { return a < 8 ? 'U8' : a < 10 ? 'U10' : a < 12 ? 'U12' : a < 14 ? 'U14' : a < 16 ? 'U16' : a < 18 ? 'U18' : 'Senior'; }

document.addEventListener('DOMContentLoaded', () => { const y = $('#year'); if (y) y.textContent = new Date().getFullYear(); });
