// Dreamers FA — club admin panel
const state = { locations: [], period: new Date().toISOString().slice(0, 7), view: 'dashboard', filters: {} };
const AGE_GROUPS = ['U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Senior'];
const view = () => $('#view');
const STATUS_LABEL = { pending: 'new', active: 'active', inactive: 'ex-player' };
const LEFT_REASONS = ['Stopped coming', 'Moved away', 'Joined another club', 'Studies / exams', 'Injury', 'Fees', 'Other'];

const feeText = (n) => (n > 0 ? money(n) : '—'); // fees are optional; show a dash when none is set

function toast(msg, isError) {
  $$('.toast').forEach((x) => x.remove()); // show one message at a time
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}
function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').showModal();
  return $('#modal-body');
}
const closeModal = () => $('#modal').close();
const formData = (form) => Object.fromEntries(new FormData(form));
const opts = (list, selected, blank) =>
  (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  list.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(v)}" ${String(v) === String(selected ?? '') ? 'selected' : ''}>${esc(l)}</option>`;
  }).join('');
const locOpts = (sel, blank) => opts(state.locations.map((l) => [l.id, l.name]), sel, blank);

async function guarded(fn) {
  try { return await fn(); } catch (e) {
    if (e.status === 401) return showLogin();
    toast(e.message, true);
  }
}

// ---------- auth ----------
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/admin/login', { method: 'POST', body: formData(e.target) });
    e.target.reset();
    start(r.username);
  } catch (err) { $('#login-alert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
});
$('#logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/api/admin/logout', { method: 'POST' }); showLogin(); });

async function start(username) {
  $('#login').hidden = true; $('#app').hidden = false;
  $('#who').textContent = username;
  [state.locations, state.wa] = await Promise.all([api('/api/locations'), api('/api/admin/settings')]);
  const v = location.hash.slice(1);
  go(['dashboard', 'registrations', 'notifications', 'players', 'explayers', 'fees', 'locations', 'news', 'fixtures', 'settings'].includes(v) ? v : 'dashboard');
}
$$('.sidebar .nav-item').forEach((b) => b.addEventListener('click', () => { go(b.dataset.view); $('.sidebar').classList.remove('open'); }));

// Each page load gets a number; an older page that finishes loading after you moved on is ignored.
let viewSeq = 0;
const stale = (seq) => seq !== viewSeq;

function go(v) {
  viewSeq++;
  state.selected = new Set();
  state.view = v;
  history.replaceState(null, '', '#' + v);
  $$('.sidebar .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  ({ dashboard, registrations, notifications: notificationsView, players, explayers, fees, locations: locationsView, news: newsView, fixtures: fixturesView, settings })[v]();
}
const refresh = () => go(state.view);

async function updatePendingBadge() {
  const list = await api('/api/admin/players?status=pending&source=form');
  const b = $('#pending-count');
  b.hidden = !list.length; b.textContent = list.length;
}

// ---------- dashboard ----------
async function dashboard() {
  const seq = viewSeq;
  await guarded(async () => {
    const d = await api('/api/admin/dashboard?period=' + state.period);
    if (stale(seq)) return;
    updatePendingBadge();
    const maxAg = Math.max(1, ...d.byAgeGroup.map((a) => a.players));
    view().innerHTML = `
      <div class="page-head"><h1>Dashboard</h1>
        <div class="actions"><label style="flex-direction:row;align-items:center">Month <input type="month" id="period" value="${state.period}" style="width:auto"></label></div>
      </div>
      <div class="kpis">
        <div class="kpi"><span>Active players</span><b>${d.active}</b></div>
        <div class="kpi warn"><span>Pending approval</span><b>${d.pending}</b></div>
        <div class="kpi ok"><span>Paid · ${esc(fmtMonth(d.period))}</span><b>${d.paid}</b></div>
        <div class="kpi bad"><span>Unpaid</span><b>${d.unpaid}</b></div>
        ${d.collected > 0 || d.due > 0 ? `<div class="kpi ok"><span>Collected</span><b>${money(d.collected)}</b></div>
        <div class="kpi bad"><span>Outstanding</span><b>${money(d.due)}</b></div>` : ''}
      </div>
      <div class="cols-2">
        <div class="panel">
          <div class="panel-head"><h3>By location</h3></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Location</th><th class="num">Players</th><th>Paid</th><th class="num">Collected</th><th class="num">Outstanding</th></tr></thead>
            <tbody>${d.byLocation.map((l) => `<tr>
              <td class="name">${esc(l.name)}</td><td class="num">${l.players}</td>
              <td><div style="display:flex;gap:8px;align-items:center"><div class="bar" style="flex:1"><i style="width:${l.players ? (l.paid / l.players) * 100 : 0}%"></i></div><span class="sub">${l.paid}/${l.players}</span></div></td>
              <td class="num">${feeText(l.collected)}</td><td class="num">${feeText(l.due)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No locations yet</td></tr>'}
            </tbody></table></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>By age group</h3></div>
          <div class="panel-body">${d.byAgeGroup.map((a) => `<div class="ag-row"><span class="pill group">${a.group}</span><div class="bar"><i style="width:${(a.players / maxAg) * 100}%"></i></div><b class="num">${a.players}</b></div>`).join('')}</div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Latest registrations</h3><button class="btn btn-sm btn-primary" onclick="state.regFilters={status:'pending'};go('registrations')">Review registrations</button></div>
        <div class="table-wrap"><table><tbody>${d.recent.map(playerRow).join('') || '<tr><td class="muted">No players yet</td></tr>'}</tbody></table></div>
      </div>`;
    $('#period').addEventListener('change', (e) => { if (e.target.value) { state.period = e.target.value; dashboard(); } });
    bindPlayerRows();
  });
}

// ---------- players ----------
function playerRow(p, { select } = {}) {
  return `<tr class="clickable" data-id="${p.id}">
    ${select ? pickCell(p) : ''}
    <td><div class="name">${esc(p.first_name)} ${esc(p.last_name)}</div><div class="sub">${[esc(p.position || '—'), p.standard ? `Std ${esc(p.standard)}` : '', p.jersey_number != null ? '#' + p.jersey_number : ''].filter(Boolean).join(' · ')}</div></td>
    <td><span class="pill group">${p.age_group}</span> <span class="sub">${p.age} yrs</span></td>
    <td>${esc(p.location_name || '—')}</td>
    <td><div>${esc(p.phone || p.guardian_phone || '—')}</div><div class="sub">${esc(p.guardian_name || '')}</div></td>
    <td><span class="pill ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>${p.left_on ? `<div class="sub">left ${fmtDate(p.left_on)}</div>` : ''}</td>
    <td><span class="pill ${p.fee_status}">${p.fee_status === 'n/a' ? '—' : p.fee_status}</span> ${p.fee > 0 ? `<span class="sub">${money(p.fee)}</span>` : ''}</td>
    <td class="num">${rowActions(p)}</td>
  </tr>`;
}
// ---------- tick players, then act on them (Players, Registrations, Ex-players) ----------
const pickCell = (p) => `<td class="pick"><input type="checkbox" data-pick="${p.id}" aria-label="Select ${esc(p.first_name)} ${esc(p.last_name)}" ${state.selected?.has(String(p.id)) ? 'checked' : ''}></td>`;
const pickHead = '<th class="pick"><input type="checkbox" id="pick-all" aria-label="Select all"></th>';
const bulkBarHtml = (exPage) => `<div class="bulk-bar" id="bulk-bar" hidden>
    <b id="bulk-count"></b>
    ${exPage ? '<button class="btn btn-sm btn-primary" id="bulk-ex">↩ Re-join</button>' : '<button class="btn btn-sm btn-primary" id="bulk-ex">🗂 Add to Ex-players</button>'}
    <button class="btn btn-sm btn-light" id="bulk-edit">✎ Edit</button>
    <button class="btn btn-sm btn-danger" id="bulk-del">🗑 Delete</button>
    <button class="btn btn-sm btn-outline bulk-clear" id="bulk-clear">Clear</button>
  </div>`;
// Wire up the tick boxes and the action bar for the rows just drawn
function setupSelection(list, { exPage } = {}) {
  state.selected = new Set([...(state.selected || [])].filter((id) => list.some((p) => String(p.id) === id)));
  const picks = $$('[data-pick]');
  const byId = new Map(list.map((p) => [String(p.id), p]));
  const names = () => [...state.selected].map((id) => byId.get(id)).filter(Boolean).map((p) => `${p.first_name} ${p.last_name}`);
  const sync = () => {
    const n = state.selected.size;
    $('#bulk-bar').hidden = !n;
    $('#bulk-count').textContent = n === 1 ? `${names()[0]} selected` : `${n} players selected`;
    $('#bulk-edit').textContent = n > 1 ? `✎ Edit ${n}` : '✎ Edit';
    $('#pick-all').checked = picks.length > 0 && picks.every((c) => c.checked);
    $('#pick-all').indeterminate = n > 0 && !$('#pick-all').checked;
  };
  picks.forEach((c) => c.addEventListener('change', () => { c.checked ? state.selected.add(c.dataset.pick) : state.selected.delete(c.dataset.pick); sync(); }));
  $('#pick-all').onchange = (e) => { picks.forEach((c) => { c.checked = e.target.checked; c.checked ? state.selected.add(c.dataset.pick) : state.selected.delete(c.dataset.pick); }); sync(); };
  $('#bulk-clear').onclick = () => { state.selected.clear(); picks.forEach((c) => { c.checked = false; }); sync(); };
  $('#bulk-ex').onclick = async () => {
    const ids = [...state.selected];
    if (!exPage) return markLeft(ids, names()[0] || '');
    if (!confirm(`Bring ${ids.length === 1 ? names()[0] : ids.length + ' players'} back as active?`)) return;
    await guarded(async () => {
      const r = await api('/api/admin/players/bulk-update', { method: 'POST', body: { ids, changes: { status: 'active' } } });
      toast(r.updated === 1 ? `${names()[0]} is back in the squad` : `${r.updated} players are back in the squad`); refresh();
    });
  };
  $('#bulk-edit').onclick = () => (state.selected.size === 1 ? editPlayer([...state.selected][0]) : bulkEdit([...state.selected]));
  $('#bulk-del').onclick = async () => {
    const ids = [...state.selected];
    const who = ids.length === 1 ? names()[0] : `${ids.length} players`;
    if (!confirm(`Delete ${who}? This removes their details and payment records for good.\n\nTip: use “Add to Ex-players” instead to keep them for your records.`)) return;
    await guarded(async () => {
      const r = await api('/api/admin/players/bulk-delete', { method: 'POST', body: { ids } });
      toast(r.deleted === 1 ? `${who} deleted` : `${r.deleted} players deleted`); refresh();
    });
  };
  sync();
}
// Change centre / status / position / standard for several players at once
function bulkEdit(ids) {
  const keep = 'Keep as is';
  openModal(`Edit ${ids.length} players`, `<form id="bulk-form" style="display:grid;gap:14px">
    <p class="muted" style="margin:0">Choose only what you want to change. Everything left on <b>${keep}</b> stays the same for each player.</p>
    <div id="bulk-alert"></div>
    <div class="grid">
      <label>Centre<select name="location_id">${locOpts('', keep)}</select></label>
      <label>Status<select name="status">${opts([['active', 'Active'], ['pending', 'New (waiting for approval)'], ['inactive', 'Ex-player']], '', keep)}</select></label>
      <label>Position<select name="position">${opts(POSITIONS.map((v) => [v, POSITION_LABELS[v] || v]), '', keep)}</select></label>
      <label>Standard (class)<select name="standard">${opts(STANDARDS, '', keep)}</select></label>
    </div>
    <div class="modal-foot"><span></span><button class="btn btn-primary">Save changes for ${ids.length} players</button></div>
  </form>`);
  $('#bulk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const changes = Object.fromEntries(Object.entries(formData(e.target)).filter(([, v]) => v));
    try {
      const r = await api('/api/admin/players/bulk-update', { method: 'POST', body: { ids, changes } });
      closeModal(); toast(`${r.updated} players updated`); refresh();
    } catch (err) { $('#bulk-alert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
  });
}

// Edit / Delete (and Approve for new registrations) buttons used in every player table
function rowActions(p, { group } = {}) {
  return `<div class="row-actions">
    ${group ? `<button class="btn btn-sm btn-wa" data-act="group" data-id="${p.id}" title="Send the WhatsApp group link to the parent">${waIcon} Group link</button>` : ''}
    ${p.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-act="approve" data-id="${p.id}">✓ Approve</button>` : ''}
    ${p.status !== 'inactive' ? `<button class="btn btn-sm btn-outline" style="color:var(--muted)" data-act="leave" data-id="${p.id}" data-name="${esc(p.first_name)} ${esc(p.last_name)}" title="Keep for records in the Ex-players list">🗂 Make ex-player</button>` : ''}
    ${p.status === 'inactive' ? `<button class="btn btn-sm btn-primary" data-act="rejoin" data-id="${p.id}" data-name="${esc(p.first_name)} ${esc(p.last_name)}">↩ Re-join</button>` : ''}
    <button class="btn btn-sm btn-outline" style="color:var(--navy)" data-act="edit" data-id="${p.id}">✎ Edit</button>
    <button class="btn btn-sm btn-outline" style="color:var(--bad)" data-act="remove" data-id="${p.id}" data-name="${esc(p.first_name)} ${esc(p.last_name)}">Delete</button>
  </div>`;
}
function bindPlayerRows(scope = view()) {
  $$('tr.clickable[data-id]', scope).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, .pick')) playerModal(tr.dataset.id); }));
  $$('[data-act]', scope).forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = b.dataset.id;
    if (b.dataset.act === 'edit') return editPlayer(id);
    if (b.dataset.act === 'remove') return removePlayer(id, b.dataset.name);
    if (b.dataset.act === 'group') return sendGroupLink(state.rows?.get(id));
    if (b.dataset.act === 'leave') return markLeft([id], b.dataset.name);
    if (b.dataset.act === 'rejoin') {
      if (!confirm(`Bring ${b.dataset.name} back as an active player?`)) return;
      await guarded(async () => { await api(`/api/admin/players/${id}`, { method: 'PUT', body: { status: 'active', left_on: '', left_reason: '' } }); toast(`${b.dataset.name} is back in the squad`); refresh(); });
    }
    if (b.dataset.act === 'approve') {
      b.disabled = true;
      await guarded(async () => { await api(`/api/admin/players/${id}`, { method: 'PUT', body: { status: 'active' } }); toast('Approved — player is now active'); refresh(); });
    }
  }));
}
async function editPlayer(id) {
  await guarded(async () => {
    const p = await api('/api/admin/players/' + id);
    openModal(`Edit · ${p.first_name} ${p.last_name}`, playerFormHtml(p));
    bindPlayerForm(p);
  });
}
// Move one or more players to Ex-players (kept for records), with the date and reason
function markLeft(ids, name) {
  const who = ids.length === 1 ? name : `${ids.length} players`;
  openModal(`Make ${who} ex-player${ids.length === 1 ? '' : 's'}`, `<form id="left-form" style="display:grid;gap:14px">
    <p class="muted" style="margin:0">${esc(who)} ${ids.length === 1 ? 'moves' : 'move'} to <b>Ex-players</b> for your records. Details and payment history are kept, and you can bring anyone back with <b>↩ Re-join</b>.</p>
    <div class="grid">
      <label>Left on<input type="date" name="left_on" value="${new Date().toISOString().slice(0, 10)}" required></label>
      <label>Reason<select name="left_reason">${opts(LEFT_REASONS, 'Stopped coming')}</select></label>
    </div>
    <div class="modal-foot"><span></span><button class="btn btn-primary">Move to Ex-players</button></div>
  </form>`);
  $('#left-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await guarded(async () => {
      const r = await api('/api/admin/players/move-to-ex', { method: 'POST', body: { ...formData(e.target), ids } });
      closeModal(); toast(ids.length === 1 ? `${name} moved to Ex-players` : `${r.moved} players moved to Ex-players`);
      state.selected = new Set(); refresh();
    });
  });
}

// ---------- ex-players (left the club / not continuing) ----------
async function explayers() {
  const seq = viewSeq;
  const f = state.exFilters || (state.exFilters = {});
  view().innerHTML = `
    <div class="page-head"><h1>Ex-players</h1>
      <div class="actions"><a class="btn btn-sm btn-outline" style="color:var(--navy)" id="ex-csv">⬇ Export</a></div></div>
    <p class="muted" style="margin-top:-8px">Players who left the club or are not continuing. Their details and payment history are kept. Use <b>↩ Re-join</b> to bring someone back.</p>
    <div class="panel">
      <form class="filters" id="ex-filters">
        <input type="search" name="q" placeholder="Search name or phone…" value="${esc(f.q || '')}" />
        <select name="location">${locOpts(f.location, 'All centres')}</select>
        <select name="age_group">${opts(AGE_GROUPS, f.age_group, 'All ages')}</select>
      </form>
      <div class="table-wrap"><table class="sticky-actions">
        <thead><tr>${pickHead}<th>Player</th><th>Age</th><th>Centre</th><th>Contact</th><th>Left on</th><th>Reason</th><th class="num">Actions</th></tr></thead>
        <tbody id="ex-rows"><tr><td colspan="8" class="muted">Loading…</td></tr></tbody>
      </table></div>
      ${bulkBarHtml(true)}
      <div class="panel-body muted" id="ex-count" style="font-size:13px"></div>
    </div>`;
  const load = () => guarded(async () => {
    if (stale(seq)) return;
    const q = new URLSearchParams({ status: 'inactive', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
    const list = (await api('/api/admin/players?' + q)).sort((a, b) => (b.left_on || '').localeCompare(a.left_on || ''));
    if (stale(seq)) return;
    $('#ex-csv').href = '/api/admin/players.csv?' + q;
    $('#ex-rows').innerHTML = list.map((p) => `<tr class="clickable" data-id="${p.id}">${pickCell(p)}
      <td><div class="name">${esc(p.first_name)} ${esc(p.last_name)}</div><div class="sub">${esc(p.position || '')}${p.standard ? ' · Std ' + esc(p.standard) : ''}</div></td>
      <td><span class="pill group">${p.age_group}</span> <span class="sub">${p.age} yrs</span></td>
      <td>${esc(p.location_name || '—')}</td>
      <td><div>${esc(p.guardian_phone || p.phone || '—')}</div><div class="sub">${esc(p.guardian_name || '')}</div></td>
      <td>${p.left_on ? fmtDate(p.left_on) : '—'}</td>
      <td>${esc(p.left_reason || '—')}</td>
      <td class="num">${rowActions(p)}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="muted">No ex-players yet. Use <b>🗂 Make ex-player</b> on a player (or tick several on the Players page) when someone stops coming.</td></tr>';
    setupSelection(list, { exPage: true });
    $('#ex-count').textContent = `${list.length} ex-player${list.length === 1 ? '' : 's'}`;
    bindPlayerRows();
  });
  let t;
  $('#ex-filters').addEventListener('input', (e) => {
    Object.assign(f, formData($('#ex-filters')));
    clearTimeout(t); t = setTimeout(load, e.target.type === 'search' ? 250 : 0);
  });
  $('#ex-filters').addEventListener('submit', (e) => e.preventDefault());
  load();
}

async function removePlayer(id, name) {
  if (!confirm(`Delete ${name}? This removes their registration, details and payment records. It cannot be undone.`)) return;
  await guarded(async () => { await api(`/api/admin/players/${id}`, { method: 'DELETE' }); toast(`${name} deleted`); refresh(); });
}
function playerQuery() {
  const f = { ...state.filters, period: state.period };
  return new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
}

// ---------- registrations (everything parents submit on /register) ----------
async function registrations() {
  const seq = viewSeq;
  const f = state.regFilters || (state.regFilters = { status: 'pending' });
  const formUrl = location.origin + '/register';
  view().innerHTML = `
    <div class="page-head"><h1>Registrations</h1>
      <div class="actions">
        <button class="btn btn-sm btn-outline" style="color:var(--navy)" id="copy-link">🔗 Copy form link</button>
        <a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Dreamers Football Association — Player Registration Form ⚽\nPlease fill in your child's details here: ${formUrl}`)}">${waIcon} Share form</a>
        <a class="btn btn-sm btn-outline" style="color:var(--navy)" id="reg-csv">⬇ Export</a>
      </div>
    </div>
    <p class="muted" style="margin-top:-8px">Every form parents submit at <a href="/register" target="_blank">${esc(formUrl)}</a> appears here automatically. Approve to add the player to the squad.</p>
    <div class="panel">
      <form class="filters" id="reg-filters">
        <select name="status">${opts([['pending', 'New (waiting for approval)'], ['active', 'Approved'], ['inactive', 'Ex-players']], f.status, 'All registrations')}</select>
        <select name="location">${locOpts(f.location, 'All centres')}</select>
        <select name="position">${opts(POSITIONS.map((v) => [v, POSITION_LABELS[v] || v]), f.position, 'All positions')}</select>
        <input type="search" name="q" placeholder="Search name or phone…" value="${esc(f.q || '')}" />
      </form>
      <div class="table-wrap"><table class="reg-table sticky-actions">
        <thead><tr>${pickHead}<th>Submitted</th><th>Player</th><th>Birth date · Age</th><th>Std</th><th>Blood</th><th>Position</th><th>Centre</th><th>Parent / guardian</th><th>Medical</th><th>Status</th><th class="num">Actions</th></tr></thead>
        <tbody id="reg-rows"><tr><td colspan="12" class="muted">Loading…</td></tr></tbody>
      </table></div>
      ${bulkBarHtml(false)}
      <div class="panel-body muted" id="reg-count" style="font-size:13px"></div>
    </div>`;
  $('#copy-link').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(formUrl); toast('Form link copied'); } catch { prompt('Copy this link:', formUrl); }
  });
  const load = () => guarded(async () => {
    if (stale(seq)) return;
    const q = new URLSearchParams({ source: 'form', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
    const list = (await api('/api/admin/players?' + q)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (stale(seq)) return;
    $('#reg-csv').href = '/api/admin/players.csv?' + q;
    state.rows = new Map(list.map((p) => [String(p.id), p]));
    $('#reg-rows').innerHTML = list.map((p) => `<tr class="clickable" data-id="${p.id}">${pickCell(p)}
      <td><div>${fmtDate(fromSqlUtc(p.created_at), { day: 'numeric', month: 'short' })}</div><div class="sub">${fromSqlUtc(p.created_at).toLocaleTimeString(CLUB.locale, { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()}</div></td>
      <td><div class="name">${esc(p.first_name)} ${esc(p.last_name)}</div><div class="sub">${esc(p.gender || '')}</div></td>
      <td><div>${fmtDate(p.dob)}</div><div class="sub">${p.age} yrs · ${p.age_group}</div></td>
      <td>${esc(p.standard || '—')}</td>
      <td>${p.blood_group ? `<span class="pill unpaid">${esc(BLOOD_LABELS[p.blood_group] || p.blood_group)}</span>` : '—'}</td>
      <td>${esc(POSITION_LABELS[p.position] || p.position || '—')}</td>
      <td>${esc(p.location_name || '—')}</td>
      <td><div>${esc(p.guardian_name || '—')}</div><div class="sub">${esc(p.guardian_phone || p.phone || '')}</div></td>
      <td class="clip" title="${esc(p.notes || '')}">${esc(p.notes || '—')}</td>
      <td><span class="pill ${p.status}">${p.status === 'pending' ? 'new' : p.status === 'active' ? 'approved' : 'ex-player'}</span>${p.group_link_sent_at ? `<div class="sub">✓ Group link sent ${fmtDate(fromSqlUtc(p.group_link_sent_at), { day: 'numeric', month: 'short' })}</div>` : ''}</td>
      <td class="num">${rowActions(p, { group: true })}</td>
    </tr>`).join('') || '<tr><td colspan="12" class="muted">No registrations here yet. Share the form link with parents to get started.</td></tr>';
    setupSelection(list);
    $('#reg-count').textContent = `${list.length} registration${list.length === 1 ? '' : 's'}`;
    bindPlayerRows();
    updatePendingBadge();
  });
  let t;
  $('#reg-filters').addEventListener('input', (e) => {
    Object.assign(f, formData($('#reg-filters')));
    clearTimeout(t); t = setTimeout(load, e.target.type === 'search' ? 250 : 0);
  });
  $('#reg-filters').addEventListener('submit', (e) => e.preventDefault());
  load();
}

async function players() {
  const seq = viewSeq;
  if (!('status' in state.filters)) state.filters.status = 'current';
  const f = state.filters;
  view().innerHTML = `
    <div class="page-head"><h1>Players</h1>
      <div class="actions">
        <a class="btn btn-sm btn-outline" style="color:var(--navy)" id="csv">⬇ Export CSV</a>
        <button class="btn btn-sm btn-primary" id="add-player">+ Add player</button>
      </div>
    </div>
    <div class="panel">
      <form class="filters" id="filters">
        <input type="search" name="q" placeholder="Search name or phone…" value="${esc(f.q || '')}" />
        <select name="location">${locOpts(f.location, 'All locations')}</select>
        <select name="age_group">${opts(AGE_GROUPS, f.age_group, 'All ages')}</select>
        <select name="status">${opts([['current', 'Current players'], ['active', 'Active'], ['pending', 'New (waiting)'], ['inactive', 'Ex-players']], f.status, 'Everyone (incl. ex-players)')}</select>
        <select name="fee">${opts([['paid', 'Paid'], ['unpaid', 'Unpaid']], f.fee, 'Any fee status')}</select>
        <input type="month" name="period" value="${state.period}" title="Fee month" />
      </form>
      <div class="table-wrap"><table class="sticky-actions">
        <thead><tr>${pickHead}<th>Player</th><th>Age</th><th>Location</th><th>Contact</th><th>Status</th><th>Fee</th><th class="num">Actions</th></tr></thead>
        <tbody id="player-rows"><tr><td colspan="8" class="muted">Loading…</td></tr></tbody>
      </table></div>
      ${bulkBarHtml(false)}
      <div class="panel-body muted" id="player-count" style="font-size:13px"></div>
    </div>`;
  const load = () => guarded(async () => {
    if (stale(seq)) return;
    const list = await api('/api/admin/players?' + playerQuery());
    if (stale(seq)) return;
    $('#csv').href = '/api/admin/players.csv?' + playerQuery();
    $('#player-rows').innerHTML = list.map((p) => playerRow(p, { select: true })).join('') || '<tr><td colspan="8" class="muted">No players match these filters.</td></tr>';
    setupSelection(list);
    $('#player-count').textContent = `${list.length} player${list.length === 1 ? '' : 's'} · fee status for ${fmtMonth(state.period)}`;
    bindPlayerRows();
    updatePendingBadge();
  });
  let t;
  $('#filters').addEventListener('input', (e) => {
    const d = formData($('#filters'));
    if (d.period) state.period = d.period;
    delete d.period;
    state.filters = d;
    clearTimeout(t); t = setTimeout(load, e.target.type === 'search' ? 250 : 0);
  });
  $('#filters').addEventListener('submit', (e) => e.preventDefault());
  $('#add-player').addEventListener('click', () => playerForm());
  load();
}

function playerFormHtml(p = {}) {
  return `<form id="player-form">
    <div id="pf-alert"></div>
    <div class="grid">
      <label><span>First name <span class="req">*</span></span><input name="first_name" value="${esc(p.first_name)}" required></label>
      <label><span>Last name <span class="req">*</span></span><input name="last_name" value="${esc(p.last_name)}" required></label>
      <label><span>Date of birth <span class="req">*</span></span><input type="date" name="dob" value="${esc(p.dob)}" required></label>
      <label>Gender<select name="gender">${opts(['Male', 'Female', 'Other'], p.gender, '—')}</select></label>
      <label><span>Location <span class="req">*</span></span><select name="location_id" required>${locOpts(p.location_id, 'Choose…')}</select></label>
      <label>Position<select name="position">${opts(POSITIONS.map((v) => [v, POSITION_LABELS[v] || v]), p.position, '—')}</select></label>
      <label>Standard (class)<select name="standard">${opts(STANDARDS, p.standard, '—')}</select></label>
      <label>Blood group<select name="blood_group">${opts(BLOOD_GROUPS.map((v) => [v, BLOOD_LABELS[v] || v]), p.blood_group, '—')}</select></label>
      <label>Status<select name="status">${opts([['active', 'Active'], ['pending', 'New (waiting for approval)'], ['inactive', 'Ex-player (left the club)']], p.status || 'active')}</select></label>
      ${p.status === 'inactive' ? `<label>Left on<input type="date" name="left_on" value="${esc(p.left_on)}"></label>
      <label>Reason for leaving<input name="left_reason" value="${esc(p.left_reason)}" list="left-reasons"></label>
      <datalist id="left-reasons">${LEFT_REASONS.map((r) => `<option value="${r}">`).join('')}</datalist>` : ''}
      <label>Jersey number<input type="number" min="0" max="99" name="jersey_number" value="${esc(p.jersey_number)}"></label>
      <label>Monthly fee override<input type="number" min="0" step="any" name="monthly_fee" value="${esc(p.monthly_fee)}" placeholder="Use location fee"><span class="hint">Leave empty to use the location's fee (e.g. set a discount or scholarship here).</span></label>
      <label>Joined on<input type="date" name="joined_on" value="${esc(p.joined_on)}"></label>
      <label>Phone<input name="phone" value="${esc(p.phone)}"></label>
      <label>Email<input type="email" name="email" value="${esc(p.email)}"></label>
      <label>Guardian name<input name="guardian_name" value="${esc(p.guardian_name)}"></label>
      <label>Guardian phone<input name="guardian_phone" value="${esc(p.guardian_phone)}"></label>
      <label class="full">Address<input name="address" value="${esc(p.address)}"></label>
      <label class="full">Notes<textarea name="notes">${esc(p.notes)}</textarea></label>
    </div>
    <div class="modal-foot">
      ${p.id ? '<button type="button" class="btn btn-sm btn-danger" id="del-player">Delete player</button>' : '<span></span>'}
      <button class="btn btn-primary" type="submit">${p.id ? 'Save changes' : 'Add player'}</button>
    </div>
  </form>`;
}
function bindPlayerForm(p = {}) {
  $('#player-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(p.id ? `/api/admin/players/${p.id}` : '/api/admin/players', { method: p.id ? 'PUT' : 'POST', body: formData(e.target) });
      closeModal(); toast(p.id ? 'Player updated' : 'Player added'); refresh();
    } catch (err) { $('#pf-alert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
  });
  const del = $('#del-player');
  if (del) del.addEventListener('click', async () => {
    if (!confirm(`Delete ${p.first_name} ${p.last_name} and all their payment records? This cannot be undone.`)) return;
    await guarded(() => api(`/api/admin/players/${p.id}`, { method: 'DELETE' }));
    closeModal(); toast('Player deleted'); refresh();
  });
}
function playerForm() { openModal('Add player', playerFormHtml()); bindPlayerForm(); }

async function playerModal(id) {
  await guarded(async () => {
    const p = await api('/api/admin/players/' + id);
    const body = openModal(`${p.first_name} ${p.last_name}`, `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        <span class="pill group">${p.age_group} · ${p.age} yrs</span>
        <span class="pill ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>
        ${p.position ? `<span class="pill">${esc(POSITION_LABELS[p.position] || p.position)}</span>` : ''}
        ${p.standard ? `<span class="pill">Std ${esc(p.standard)}</span>` : ''}
        ${p.blood_group ? `<span class="pill unpaid" title="Blood group">🩸 ${esc(BLOOD_LABELS[p.blood_group] || p.blood_group)}</span>` : ''}
        <span class="pill">${esc(p.location_name || 'No location')}</span>
        ${p.fee > 0 ? `<span class="pill">Fee ${money(p.fee)}/month</span>` : ''}
        <span class="pill">Registered ${fmtDate(p.created_at)}</span>
      </div>
      ${p.status === 'pending' ? `<div class="alert alert-ok" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">New registration — approve to make this player active.<button class="btn btn-sm btn-primary" id="approve">Approve player</button></div>` : ''}
      ${p.status === 'inactive'
        ? `<div class="alert ex-banner"><span>🗂 <b>Ex-player</b>${p.left_on ? ` since ${fmtDate(p.left_on)}` : ''}${p.left_reason ? ` · ${esc(p.left_reason)}` : ''}. Kept for records.</span>
            <button class="btn btn-sm btn-primary" id="m-rejoin">↩ Re-join</button></div>`
        : `<div class="ex-row"><button class="btn btn-sm btn-outline" style="color:var(--muted)" id="m-leave">🗂 Make ex-player</button>
            <span class="hint">Left the club or not continuing? Keep them in Ex-players for your records.</span></div>`}
      <fieldset>
        <legend>Fees &amp; payments</legend>
        ${p.status === 'active' && !p.payments.some((x) => x.period === state.period) ? `
        <div class="alert alert-error" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <span>${esc(fmtMonth(state.period))} fee${p.fee > 0 ? ` of ${money(p.fee)}` : ''} is unpaid.${p.reminders.length ? ` Last reminder: ${fmtDate(fromSqlUtc(p.reminders[0].sent_at), { day: 'numeric', month: 'short' })}.` : ''}</span>
          <button class="btn btn-sm btn-wa" type="button" id="wa-remind">${waIcon} WhatsApp reminder</button>
        </div>` : ''}
        <form class="pay-row" id="pay-form">
          <label>Month<input type="month" name="period" value="${state.period}" required></label>
          <label>Amount<input type="number" step="any" min="0" name="amount" value="${p.fee > 0 ? p.fee : ''}" placeholder="Optional"></label>
          <label>Paid on<input type="date" name="paid_on" value="${new Date().toISOString().slice(0, 10)}"></label>
          <label>Method<select name="method">${opts(['Cash', 'UPI', 'Bank transfer', 'Card', 'Other'], 'Cash')}</select></label>
          <button class="btn btn-primary" type="submit">Record</button>
        </form>
        <div class="table-wrap" style="margin-top:14px"><table>
          <thead><tr><th>Month</th><th class="num">Amount</th><th>Paid on</th><th>Method</th><th></th></tr></thead>
          <tbody>${p.payments.map((x) => `<tr><td>${esc(fmtMonth(x.period))}</td><td class="num">${feeText(x.amount)}</td><td>${fmtDate(x.paid_on)}</td><td>${esc(x.method || '')}</td>
            <td class="num"><button class="btn btn-sm btn-outline" style="color:var(--bad)" data-undo="${x.period}">Remove</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No payments recorded yet.</td></tr>'}</tbody>
        </table></div>
      </fieldset>
      <fieldset><legend>Details</legend>${playerFormHtml(p)}</fieldset>`);
    bindPlayerForm(p);
    $('#pay-form', body).addEventListener('submit', async (e) => {
      e.preventDefault();
      await guarded(async () => { await api(`/api/admin/players/${p.id}/payments`, { method: 'POST', body: formData(e.target) }); toast('Payment recorded'); playerModal(p.id); refreshBehind(); });
    });
    $$('[data-undo]', body).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Remove payment for ${fmtMonth(b.dataset.undo)}?`)) return;
      await guarded(async () => { await api(`/api/admin/players/${p.id}/payments/${b.dataset.undo}`, { method: 'DELETE' }); toast('Payment removed'); playerModal(p.id); refreshBehind(); });
    }));
    const wr = $('#wa-remind', body);
    if (wr) wr.addEventListener('click', () => {
      if (sendReminder(p, state.period)) { toast('WhatsApp opened — press send there'); setTimeout(() => { playerModal(p.id); refreshBehind(); }, 400); }
    });
    const ml = $('#m-leave', body);
    if (ml) ml.addEventListener('click', () => markLeft([p.id], `${p.first_name} ${p.last_name}`));
    const mr = $('#m-rejoin', body);
    if (mr) mr.addEventListener('click', async () => {
      await guarded(async () => { await api(`/api/admin/players/${p.id}`, { method: 'PUT', body: { status: 'active', left_on: '', left_reason: '' } }); toast(`${p.first_name} is back in the squad`); playerModal(p.id); refreshBehind(); });
    });
    const ap = $('#approve', body);
    if (ap) ap.addEventListener('click', async () => {
      await guarded(async () => { await api(`/api/admin/players/${p.id}`, { method: 'PUT', body: { status: 'active' } }); toast('Player approved'); playerModal(p.id); refreshBehind(); });
    });
  });
}
// re-render the page under the modal without closing it
function refreshBehind() { if (state.view !== 'settings') go(state.view); }

// ---------- WhatsApp reminders ----------
// Uses WhatsApp click-to-chat (wa.me): opens WhatsApp Web / the app with the message filled in.
// The admin presses Send in WhatsApp, so no WhatsApp Business account or API key is needed.
const fromSqlUtc = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z') : null);
function normalizePhone(raw) {
  const t = String(raw || '').trim();
  if (!t) return null;
  let d = t.replace(/\D/g, '');
  if (t.startsWith('+')) { /* already international */ }
  else if (d.startsWith('00')) d = d.slice(2);
  else {
    d = d.replace(/^0+/, '');
    if (d.length <= 10) d = (state.wa?.wa_country_code || '91') + d;
  }
  return d.length >= 8 && d.length <= 15 ? d : null;
}
// Under-18s: message the guardian first. Adults: message the player first.
function reminderContact(p) {
  const order = p.age < 18 ? [p.guardian_phone, p.phone] : [p.phone, p.guardian_phone];
  for (const raw of order) { const n = normalizePhone(raw); if (n) return { raw, number: n }; }
  return null;
}
function reminderText(p, period) {
  const vars = {
    player: `${p.first_name} ${p.last_name}`,
    first_name: p.first_name,
    guardian: (p.age < 18 && p.guardian_name) || p.first_name,
    month: fmtMonth(period),
    amount: p.fee > 0 ? money(p.fee) : '',
    location: p.location_name || '',
    club: 'Dreamers Football Association',
  };
  return (state.wa?.wa_template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
const waIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';
// Fill {placeholders} in a WhatsApp message for a player
function fillMessage(tpl, p, extra = {}) {
  const vars = {
    player: `${p.first_name} ${p.last_name}`,
    first_name: p.first_name,
    guardian: (p.age < 18 && p.guardian_name) || p.first_name,
    location: p.location_name || '',
    club: 'Dreamers Football Association',
    ...extra,
  };
  return (tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
// Opens WhatsApp with the welcome message and group link, addressed to the parent
function sendGroupLink(p) {
  if (!p) return;
  const link = state.wa?.wa_group_link;
  if (!link) { toast('Add your WhatsApp group link in Settings first', true); return; }
  const c = reminderContact(p);
  if (!c) { toast(`No valid phone number for ${p.first_name} ${p.last_name}`, true); return; }
  window.open(`https://wa.me/${c.number}?text=${encodeURIComponent(fillMessage(state.wa.wa_group_message, p, { link }))}`, '_blank', 'noopener');
  api(`/api/admin/players/${p.id}/group-link-sent`, { method: 'POST' }).catch(() => {});
  toast('WhatsApp opened — press send there');
  setTimeout(refresh, 500);
}

function reminderStatus(p) {
  if (!p.reminder_count) return '';
  return `<div class="sub">💬 Reminded${p.reminder_count > 1 ? ` ${p.reminder_count}×` : ''} · ${fmtDate(fromSqlUtc(p.last_reminder), { day: 'numeric', month: 'short' })}</div>`;
}
// Must be called directly from a click handler so the browser allows the new tab.
function sendReminder(p, period) {
  const c = reminderContact(p);
  if (!c) { toast(`No valid phone number for ${p.first_name} ${p.last_name}`, true); return false; }
  window.open(`https://wa.me/${c.number}?text=${encodeURIComponent(reminderText(p, period))}`, '_blank', 'noopener');
  api(`/api/admin/players/${p.id}/reminders`, { method: 'POST', body: { period, phone: c.raw } }).catch(() => {});
  p.reminder_count = (p.reminder_count || 0) + 1;
  p.last_reminder = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return true;
}

function reminderQueue(unpaid, period, onDone) {
  const list = [...unpaid].sort((a, b) => (a.reminder_count || 0) - (b.reminder_count || 0));
  const body = openModal(`WhatsApp reminders · ${fmtMonth(period)}`, `
    <p class="muted" style="margin-top:0">Press <b>Send</b> for each player. WhatsApp opens with the message ready — press send there, then come back for the next one.
      Players not reminded yet are listed first.</p>
    <div class="table-wrap"><table><tbody>${list.map((p, i) => {
      const c = reminderContact(p);
      return `<tr data-row="${i}">
        <td><div class="name">${esc(p.first_name)} ${esc(p.last_name)}</div><div class="sub">${esc(p.location_name || '')}${p.fee > 0 ? ` · ${money(p.fee)}` : ''}</div>${reminderStatus(p)}</td>
        <td>${c ? `<div>${esc(c.raw)}</div><div class="sub">${p.age < 18 && c.raw === p.guardian_phone ? 'Guardian' : 'Player'}</div>` : '<span class="pill unpaid">No phone</span>'}</td>
        <td class="num">${c ? `<button class="btn btn-sm btn-wa" data-send="${i}">${waIcon} Send</button>` : ''}</td>
      </tr>`;
    }).join('') || '<tr><td class="muted">Everyone has paid for this month 🎉</td></tr>'}</tbody></table></div>`);
  $$('[data-send]', body).forEach((b) => b.addEventListener('click', () => {
    const p = list[b.dataset.send];
    if (!sendReminder(p, period)) return;
    b.outerHTML = '<span class="pill paid">✓ Opened</span>';
    const next = $$('[data-send]', body)[0];
    if (next) next.focus();
  }));
  $('#modal').addEventListener('close', onDone, { once: true });
}

// ---------- fees (quick monthly collection) ----------
async function fees() {
  const seq = viewSeq;
  const f = state.feeFilters || (state.feeFilters = {});
  view().innerHTML = `
    <div class="page-head"><h1>Fees</h1>
      <div class="actions">
        <a class="btn btn-sm btn-outline" style="color:var(--navy)" id="fee-csv">⬇ Export unpaid list</a>
        <button class="btn btn-sm btn-wa" id="remind-all" disabled>${waIcon} Remind unpaid</button>
      </div>
    </div>
    <div class="kpis" id="fee-kpis"></div>
    <div class="panel">
      <form class="filters" id="fee-filters">
        <input type="month" name="period" value="${state.period}" />
        <select name="location">${locOpts(f.location, 'All locations')}</select>
        <select name="age_group">${opts(AGE_GROUPS, f.age_group, 'All ages')}</select>
        <select name="fee">${opts([['unpaid', 'Unpaid only'], ['paid', 'Paid only']], f.fee, 'Paid & unpaid')}</select>
        <input type="search" name="q" placeholder="Search…" value="${esc(f.q || '')}" />
      </form>
      <div class="table-wrap"><table>
        <thead><tr><th>Player</th><th>Location</th><th>Contact</th><th class="num">Fee</th><th>Status</th><th></th></tr></thead>
        <tbody id="fee-rows"></tbody>
      </table></div>
    </div>`;
  const load = () => guarded(async () => {
    if (stale(seq)) return;
    const q = new URLSearchParams({ status: 'active', period: state.period, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
    const list = await api('/api/admin/players?' + q);
    if (stale(seq)) return;
    $('#fee-csv').href = '/api/admin/players.csv?' + new URLSearchParams({ ...Object.fromEntries(q), fee: 'unpaid' });
    const paid = list.filter((p) => p.fee_status === 'paid');
    const unpaid = list.filter((p) => p.fee_status === 'unpaid');
    const ra = $('#remind-all');
    ra.disabled = !unpaid.length;
    ra.innerHTML = `${waIcon} Remind unpaid (${unpaid.length})`;
    ra.onclick = () => reminderQueue(unpaid, state.period, load);
    $('#fee-kpis').innerHTML = `
      <div class="kpi"><span>${esc(fmtMonth(state.period))}</span><b>${list.length}</b></div>
      <div class="kpi ok"><span>Paid</span><b>${paid.length}</b></div>
      <div class="kpi bad"><span>Unpaid</span><b>${unpaid.length}</b></div>
      ${list.some((p) => p.fee > 0 || p.paid_amount > 0) ? `<div class="kpi ok"><span>Collected</span><b>${money(paid.reduce((s, p) => s + p.paid_amount, 0))}</b></div>
      <div class="kpi bad"><span>Outstanding</span><b>${money(unpaid.reduce((s, p) => s + p.fee, 0))}</b></div>` : ''}`;
    $('#fee-rows').innerHTML = list.map((p) => `<tr>
      <td><div class="name">${esc(p.first_name)} ${esc(p.last_name)}</div><div class="sub">${p.age_group}</div></td>
      <td>${esc(p.location_name || '—')}</td>
      <td>${esc(p.phone || p.guardian_phone || '—')}</td>
      <td class="num">${feeText(p.paid_amount || p.fee)}</td>
      <td><span class="pill ${p.fee_status}">${p.fee_status}</span>${p.paid_on ? `<div class="sub">${fmtDate(p.paid_on)}</div>` : reminderStatus(p)}</td>
      <td class="num" style="white-space:nowrap">${p.fee_status === 'paid'
        ? `<button class="btn btn-sm btn-outline" style="color:var(--muted)" data-unpay="${p.id}">Undo</button>`
        : `${reminderContact(p)
            ? `<button class="btn btn-sm btn-wa" data-remind="${p.id}" title="Send WhatsApp reminder">${waIcon} Remind</button>`
            : `<button class="btn btn-sm btn-wa" disabled title="No valid phone number saved — open the player to add one">${waIcon} Remind</button>`}
           <button class="btn btn-sm btn-primary" data-pay="${p.id}">Mark paid</button>`}
        <button class="btn btn-sm btn-outline" style="color:var(--navy)" data-open="${p.id}">Open</button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">No active players match.</td></tr>';
    $$('[data-pay]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      await guarded(async () => { await api(`/api/admin/players/${b.dataset.pay}/payments`, { method: 'POST', body: { period: state.period } }); toast('Marked as paid'); load(); });
    }));
    $$('[data-unpay]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Mark this fee as unpaid again?')) return;
      await guarded(async () => { await api(`/api/admin/players/${b.dataset.unpay}/payments/${state.period}`, { method: 'DELETE' }); load(); });
    }));
    $$('[data-open]').forEach((b) => b.addEventListener('click', () => playerModal(b.dataset.open)));
    $$('[data-remind]').forEach((b) => b.addEventListener('click', () => {
      const p = list.find((x) => String(x.id) === b.dataset.remind);
      if (sendReminder(p, state.period)) { toast('WhatsApp opened — press send there'); setTimeout(load, 400); }
    }));
  });
  let t;
  $('#fee-filters').addEventListener('input', (e) => {
    const d = formData($('#fee-filters'));
    if (d.period) state.period = d.period;
    delete d.period;
    Object.assign(f, d);
    clearTimeout(t); t = setTimeout(load, e.target.type === 'search' ? 250 : 0);
  });
  $('#fee-filters').addEventListener('submit', (e) => e.preventDefault());
  load();
}

// ---------- 12-hour time picker: Hour · Minutes · AM/PM (saved as 24-hour "HH:MM") ----------
function timePicker(key, value, caption) {
  let h = '', m = '00', ap = 'PM';
  if (/^\d{2}:\d{2}$/.test(value || '')) {
    const H = Number(value.slice(0, 2));
    h = String(H % 12 || 12); m = value.slice(3); ap = H < 12 ? 'AM' : 'PM';
  }
  const mins = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
  if (m && !mins.includes(m)) mins.push(m), mins.sort();
  return `<div class="time-pick" data-k="${key}">
    ${caption ? `<span class="tp-cap">${caption}</span>` : ''}
    <select data-part="h" aria-label="${caption || 'Time'} hour"><option value="">Hour</option>${Array.from({ length: 12 }, (_, i) => String(i + 1)).map((x) => `<option ${x === h ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <span class="tp-colon">:</span>
    <select data-part="m" aria-label="${caption || 'Time'} minutes">${mins.map((x) => `<option ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <select data-part="ap" aria-label="AM or PM">${['AM', 'PM'].map((x) => `<option ${x === ap ? 'selected' : ''}>${x}</option>`).join('')}</select>
  </div>`;
}
function readTime(el) {
  const h = $('[data-part=h]', el).value;
  if (!h) return '';
  const H = (Number(h) % 12) + ($('[data-part=ap]', el).value === 'PM' ? 12 : 0);
  return `${String(H).padStart(2, '0')}:${$('[data-part=m]', el).value || '00'}`;
}

// ---------- generic list editor (locations / news / fixtures) ----------
function listEditor({ title, endpoint, items, render, fields, label, onOpen, serialize }) {
  view().innerHTML = `
    <div class="page-head"><h1>${title}</h1><div class="actions"><button class="btn btn-sm btn-primary" id="add">+ Add ${label}</button></div></div>
    <div class="panel">${items.map((it, i) => `<div class="list-item"><div>${render(it)}</div>
      <div style="display:flex;gap:6px;flex:none"><button class="btn btn-sm btn-outline" style="color:var(--navy)" data-edit="${i}">Edit</button>
      <button class="btn btn-sm btn-outline" style="color:var(--bad)" data-del="${i}">Delete</button></div></div>`).join('') || `<div class="panel-body muted">No ${label}s yet.</div>`}</div>`;
  const edit = (it = {}) => {
    openModal(it.id ? `Edit ${label}` : `Add ${label}`, `<form id="ed-form"><div id="ed-alert"></div><div class="grid">${fields(it)}</div>
      <div class="modal-foot"><span></span><button class="btn btn-primary">Save</button></div></form>`);
    if (onOpen) onOpen($('#ed-form'), it);
    $('#ed-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = formData(e.target);
        if (serialize) serialize(e.target, data);
        await api(it.id ? `${endpoint}/${it.id}` : endpoint, { method: it.id ? 'PUT' : 'POST', body: data });
        closeModal(); toast('Saved'); refresh();
      } catch (err) { $('#ed-alert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
    });
  };
  $('#add').addEventListener('click', () => edit());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => edit(items[b.dataset.edit])));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete this ${label}?`)) return;
    await guarded(() => api(`${endpoint}/${items[b.dataset.del].id}`, { method: 'DELETE' }));
    toast('Deleted'); refresh();
  }));
}

async function locationsView() {
  const seq = viewSeq;
  await guarded(async () => {
    state.locations = await api('/api/locations');
    if (stale(seq)) return;
    listEditor({
      title: 'Locations', label: 'location', endpoint: '/api/admin/locations', items: state.locations,
      render: (l) => `<div class="name">${esc(l.name)} <a href="${esc(mapLink(l))}" target="_blank" rel="noopener" class="hint" style="font-weight:500">${l.map_url ? 'map pin ↗' : 'map search ↗ (add exact link)'}</a></div><div class="sub">${[esc(l.address || ''), l.schedule?.length ? l.schedule.map((s) => `${esc(fmtDays(s.days))} ${esc(fmtTimeRange(s.start, s.end))} (${esc(s.group)})`).join('; ') : '<span class="muted">No timings yet</span>', l.monthly_fee > 0 ? `<b>${money(l.monthly_fee)}</b>/month` : ''].filter(Boolean).join(' · ')}</div>`,
      fields: (l) => `
        <label class="full"><span>Name <span class="req">*</span></span><input name="name" value="${esc(l.name)}" required></label>
        <label class="full">Address<input name="address" value="${esc(l.address)}"></label>
        <div class="full">
          <div class="sched-title">Training timings</div>
          <div id="sched-rows"></div>
          <button type="button" class="btn btn-sm btn-outline" style="color:var(--navy)" id="sched-add">+ Add session</button>
          <span class="hint" style="display:block;margin-top:6px">One row per session, e.g. Mon, Wed, Fri · 5–7 PM · U8–U12. Leave empty and the website shows "To be announced".</span>
        </div>
        <label>Monthly fee <span class="hint">(optional, not shown on the website)</span><input type="number" min="0" step="any" name="monthly_fee" value="${esc(l.monthly_fee ?? 0)}"></label>
        <label class="full">Google Maps link<input name="map_url" value="${esc(l.map_url)}" placeholder="https://maps.app.goo.gl/…">
          <span class="hint">In Google Maps, open the ground → Share → Copy link, and paste it here. Leave empty to search by name and address.</span></label>`,
      onOpen: (form, l) => {
        const rows = $('#sched-rows', form);
        const addRow = (s = { days: [], start: '', end: '', group: '', note: '' }) => {
          const row = document.createElement('div');
          row.className = 'sched-row';
          row.innerHTML = `
            <div class="day-picks">${WEEK.map((d) => `<label class="day-pick"><input type="checkbox" value="${d}" ${s.days.includes(d) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
            ${timePicker('start', s.start, 'From')}
            ${timePicker('end', s.end, 'To')}
            <input data-k="group" value="${esc(s.group)}" placeholder="Age group, e.g. U8–U12" list="group-list" aria-label="Age group">
            <input data-k="note" value="${esc(s.note)}" placeholder="Note (optional)" aria-label="Note">
            <button type="button" class="close-btn" title="Remove session" aria-label="Remove session">×</button>`;
          $('.close-btn', row).addEventListener('click', () => row.remove());
          rows.appendChild(row);
        };
        (l.schedule || []).forEach(addRow);
        if (!(l.schedule || []).length) addRow();
        $('#sched-add', form).addEventListener('click', () => addRow());
        if (!$('#group-list')) document.body.insertAdjacentHTML('beforeend',
          `<datalist id="group-list">${['All ages', ...AGE_GROUPS, 'U8–U12', 'U14–U18', 'Goalkeepers'].map((g) => `<option value="${g}">`).join('')}</datalist>`);
      },
      serialize: (form, data) => {
        data.schedule = $$('.sched-row', form).map((r) => ({
          days: $$('.day-pick input:checked', r).map((c) => c.value),
          start: readTime($('[data-k=start]', r)), end: readTime($('[data-k=end]', r)),
          group: $('[data-k=group]', r).value, note: $('[data-k=note]', r).value,
        })).filter((s) => s.days.length || s.start || s.end || s.note); // ignore completely empty rows
      },
    });
  });
}

async function newsView() {
  const seq = viewSeq;
  await guarded(async () => {
    const items = await api('/api/news?limit=100');
    if (stale(seq)) return;
    listEditor({
      title: 'News', label: 'article', endpoint: '/api/admin/news', items,
      render: (n) => `<div class="name">${esc(n.title)}</div><div class="sub">${fmtDate(n.published_at)} · ${esc(n.summary || '')}</div>`,
      fields: (n) => `
        <label class="full"><span>Title <span class="req">*</span></span><input name="title" value="${esc(n.title)}" required></label>
        <label class="full">Summary<input name="summary" value="${esc(n.summary)}" placeholder="One line shown on the news card"></label>
        <label class="full">Full story<textarea name="body" style="min-height:180px">${esc(n.body)}</textarea></label>
        <label>Image URL<input name="image_url" value="${esc(n.image_url)}" placeholder="https://…"></label>
        <label>Publish date<input type="date" name="published_at" value="${esc(n.published_at || new Date().toISOString().slice(0, 10))}"></label>`,
    });
  });
}

async function fixturesView() {
  const seq = viewSeq;
  await guarded(async () => {
    const items = (await api('/api/fixtures')).reverse();
    if (stale(seq)) return;
    listEditor({
      title: 'Fixtures & results', label: 'fixture', endpoint: '/api/admin/fixtures', items,
      render: (f) => `<div class="name">Dreamers FA ${esc(f.team)} vs ${esc(f.opponent)} ${f.score_us != null && f.score_them != null ? `<span class="pill ${f.score_us > f.score_them ? 'paid' : f.score_us < f.score_them ? 'unpaid' : 'pending'}">${f.score_us}–${f.score_them}</span>` : ''}</div>
        <div class="sub">${fmtDateTime(f.match_date)} · ${esc(f.home_away)} · ${esc(f.venue || '')} · ${esc(f.competition || 'Friendly')}</div>`,
      fields: (f) => `
        <label><span>Our team <span class="req">*</span></span><select name="team">${opts(AGE_GROUPS, f.team || 'Senior')}</select></label>
        <label><span>Opponent <span class="req">*</span></span><input name="opponent" value="${esc(f.opponent)}" required></label>
        <label><span>Match date <span class="req">*</span></span><input type="date" data-k="match_day" value="${esc((f.match_date || '').slice(0, 10))}" required></label>
        <div class="field"><span class="field-label">Kick-off time <span class="req">*</span></span>${timePicker('match_time', (f.match_date || '').slice(11, 16))}</div>
        <label>Home / away<select name="home_away">${opts(['Home', 'Away'], f.home_away)}</select></label>
        <label>Venue<input name="venue" value="${esc(f.venue)}"></label>
        <label>Competition<input name="competition" value="${esc(f.competition)}" placeholder="League, Cup, Friendly…"></label>
        <label>Our score<input type="number" min="0" name="score_us" value="${esc(f.score_us)}"><span class="hint">Fill in both scores after the match to show it as a result.</span></label>
        <label>Their score<input type="number" min="0" name="score_them" value="${esc(f.score_them)}"></label>`,
      serialize: (form, data) => {
        const day = $('[data-k=match_day]', form).value;
        const time = readTime($('[data-k=match_time]', form));
        if (!day) throw new Error('Choose the match date');
        if (!time) throw new Error('Choose the kick-off time (hour and AM/PM)');
        data.match_date = `${day}T${time}`;
      },
    });
  });
}

// ---------- notifications ----------
const NOTIFY_PAGES = [['/', 'Home page'], ['/#news', 'News'], ['/#fixtures', 'Fixtures & results'], ['/#academy', 'Training centres & timings'], ['/register', 'Registration form']];
async function notificationsView() {
  const seq = viewSeq;
  await guarded(async () => {
    const [data, news, fixtures, practice] = await Promise.all([api('/api/admin/notifications'), api('/api/news?limit=1'), api('/api/fixtures'), api('/api/admin/practice')]);
    if (stale(seq)) return;
    const n = data.subscribers.public;
    const next = fixtures.find((f) => f.score_us == null && new Date(f.match_date) >= Date.now());
    const quick = {
      news: news[0] && { title: news[0].title, body: news[0].summary || '', url: '/#news' },
      match: next && { title: `Matchday: Dreamers FA ${next.team} vs ${next.opponent} ⚽`, body: `${fmtDateTime(next.match_date)}${next.venue ? ' · ' + next.venue : ''}. Come and support the team!`, url: '/#fixtures' },
      cancel: { title: 'Training cancelled today 🌧️', body: 'Today’s training is cancelled due to rain. See you at the next session!', url: '/#academy' },
      open: { title: 'Registrations are open 📝', body: 'Register your child for Dreamers FA in 2 minutes.', url: '/register' },
    };
    view().innerHTML = `
      <div class="page-head"><h1>Notifications</h1></div>
      <div class="kpis">
        <div class="kpi"><span>People with notifications on</span><b>${n}</b></div>
        <div class="kpi"><span>Admin devices getting alerts</span><b>${data.subscribers.admin}</b></div>
      </div>
      <div class="panel" id="practice-panel">
        <div class="panel-head"><h3>Practice today · ${esc(practice.weekday)} ${fmtDate(practice.date, { day: 'numeric', month: 'short' })}</h3>
          <button class="btn btn-sm btn-primary" id="pr-send" ${practice.items.some((i) => i.body && i.subscribers) ? '' : 'disabled'}>🔔 Send practice reminders</button></div>
        <div class="panel-body">
          <p class="muted" style="margin-top:0">Each family gets the reminder for <b>their own centre</b>, with that centre’s time from today’s training timings (Locations).
            ${practice.last_sent === practice.date ? '<b style="color:var(--ok)">✓ Sent today.</b>' : ''}</p>
          <div class="pr-grid">${practice.items.map((i) => `<div class="pr-card ${i.body ? '' : 'off'}">
            <div class="pr-head"><b>${esc(i.location)}</b><span class="pill">${i.subscribers} ${i.subscribers === 1 ? 'family' : 'families'}</span></div>
            ${i.body ? `<div class="nt-preview"><img src="/img/icon-192.png" alt=""><div><b>${esc(i.title)}</b><span>${esc(i.body)}</span></div></div>`
              : `<p class="muted" style="margin:6px 0 0">No training on ${esc(practice.weekday)} in this centre’s timings, so no reminder is sent.</p>`}
          </div>`).join('')}</div>
          <details class="pr-settings"><summary>Message &amp; automatic sending</summary>
            <form id="pr-form" style="display:grid;gap:12px;margin-top:12px">
              <div id="pr-alert"></div>
              <label>Title<input name="practice_title" maxlength="80" value="${esc(practice.title)}"></label>
              <label>Message<input name="practice_message" maxlength="300" value="${esc(practice.message)}">
                <span class="hint">{time} = today’s session time(s), {location} = centre name, {address} = centre address.</span></label>
              <label class="check"><input type="checkbox" name="practice_auto" ${practice.auto ? 'checked' : ''}> Send automatically every morning at 7:30 AM (on the live site)</label>
              <button class="btn btn-sm btn-primary" style="justify-self:start">Save</button>
            </form></details>
        </div>
      </div>
      <div class="cols-2">
        <div class="panel"><div class="panel-head"><h3>Send a notification</h3></div>
          <form class="panel-body" id="nt-form" style="display:grid;gap:14px">
            <div id="nt-alert"></div>
            <div class="nt-quick"><span class="hint">Quick start:</span>
              ${quick.news ? '<button type="button" class="btn btn-sm btn-outline" style="color:var(--navy)" data-q="news">📰 Latest news</button>' : ''}
              ${quick.match ? '<button type="button" class="btn btn-sm btn-outline" style="color:var(--navy)" data-q="match">⚽ Next match</button>' : ''}
              <button type="button" class="btn btn-sm btn-outline" style="color:var(--navy)" data-q="cancel">🌧️ Training cancelled</button>
              <button type="button" class="btn btn-sm btn-outline" style="color:var(--navy)" data-q="open">📝 Registrations open</button>
            </div>
            <label><span>Title <span class="req">*</span></span><input name="title" maxlength="80" required placeholder="e.g. Training cancelled today"></label>
            <label>Message<textarea name="body" maxlength="300" placeholder="A short message (up to 300 characters)"></textarea></label>
            <label>When tapped, open<select name="url">${opts(NOTIFY_PAGES, '/')}</select></label>
            <div><div class="hint" style="margin-bottom:6px">Preview</div>
              <div class="nt-preview"><img src="/img/icon-192.png" alt=""><div><b id="nt-p-title">Title</b><span id="nt-p-body"></span><small>Dreamers FA · now</small></div></div></div>
            <button class="btn btn-primary" style="justify-self:start" ${n ? '' : 'disabled'}>🔔 Send to ${n} ${n === 1 ? 'person' : 'people'}</button>
            ${n ? '' : '<p class="hint" style="margin:0">Nobody has turned on notifications yet. Share the website or app and ask parents to tap <b>🔔 Get notifications</b>.</p>'}
          </form></div>
        <div>
          <div class="panel"><div class="panel-head"><h3>Alerts on this device</h3></div>
            <div class="panel-body" style="display:grid;gap:10px">
              <p style="margin:0">Get a notification on this phone or computer whenever a parent submits the registration form.</p>
              <button class="btn btn-primary" id="admin-push" style="justify-self:start">…</button>
              <div class="hint" id="admin-push-note"></div>
            </div></div>
          <div class="panel"><div class="panel-head"><h3>Sent</h3></div>
            ${data.history.map((h) => `<div class="list-item"><div><div class="name">${esc(h.title)}</div><div class="sub">${esc(h.body || '')}</div>
              <div class="sub">${fmtDateTime(fromSqlUtc(h.sent_at))} · delivered to ${h.delivered}${h.failed ? `, ${h.failed} failed` : ''}</div></div></div>`).join('') || '<div class="panel-body muted">Nothing sent yet.</div>'}
          </div>
        </div>
      </div>`;
    const form = $('#nt-form');
    const preview = () => { $('#nt-p-title').textContent = form.title.value || 'Title'; $('#nt-p-body').textContent = form.body.value; };
    form.addEventListener('input', preview); preview();
    $$('[data-q]', form).forEach((b) => b.addEventListener('click', () => {
      const q = quick[b.dataset.q];
      form.title.value = q.title.slice(0, 80); form.body.value = q.body.slice(0, 300); form.url.value = q.url; preview();
    }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(form);
      if (!confirm(`Send “${d.title}” to ${n} ${n === 1 ? 'person' : 'people'}?`)) return;
      const btn = $('button:not([type])', form); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const r = await api('/api/admin/notifications', { method: 'POST', body: d });
        toast(`Sent to ${r.delivered} ${r.delivered === 1 ? 'device' : 'devices'}${r.failed ? ` (${r.failed} could not be reached)` : ''}`);
        refresh();
      } catch (err) { $('#nt-alert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; btn.disabled = false; btn.textContent = `🔔 Send to ${n} ${n === 1 ? 'person' : 'people'}`; }
    });
    // practice reminders
    $('#pr-send').addEventListener('click', async () => {
      const targets = practice.items.filter((i) => i.body && i.subscribers);
      if (!confirm(`Send today’s practice reminder to ${targets.map((i) => `${i.location} (${i.subscribers})`).join(', ')}?`)) return;
      $('#pr-send').disabled = true;
      try {
        const r = await api('/api/admin/practice/send', { method: 'POST', body: {} });
        const total = r.results.reduce((s, x) => s + x.delivered, 0);
        toast(`Practice reminders sent to ${total} ${total === 1 ? 'device' : 'devices'}`);
        refresh();
      } catch (err) { toast(err.message, true); $('#pr-send').disabled = false; }
    });
    $('#pr-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      try {
        await api('/api/admin/practice', { method: 'PUT', body: { ...d, practice_auto: !!d.practice_auto } });
        toast('Practice reminder settings saved'); refresh();
      } catch (err) { $('#pr-alert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
    });
    // this device: new-registration alerts
    const ab = $('#admin-push');
    const showState = async () => {
      let on = false;
      try { on = pushSupported() && (await pushStatus()).admin; } catch {}
      if (stale(seq)) return;
      ab.dataset.on = on ? '1' : '';
      ab.textContent = on ? '✓ Alerts on — turn off' : '🔔 Turn on alerts';
      ab.className = on ? 'btn btn-outline' : 'btn btn-primary';
      if (on) ab.style.color = 'var(--navy)'; else ab.style.color = '';
      $('#admin-push-note').innerHTML = !pushSupported()
        ? (isIOS() && !isInstalled() ? 'On iPhone: add the app to your Home Screen first (sidebar → <b>Install app</b>), then open it and turn alerts on.' : 'This browser can’t show notifications. Use Chrome, Edge or the installed app.')
        : on ? 'You’ll get an alert for every new registration on this device.' : '';
    };
    ab.addEventListener('click', async () => {
      ab.disabled = true;
      try {
        if (ab.dataset.on) { await disablePush('admin'); toast('Alerts turned off on this device'); }
        else { await enablePush('admin'); toast('Alerts on — you’ll be notified of new registrations'); }
      } catch (err) {
        if (err.message === 'ios-install') showInstallHelp(IOS_NOTIFY_NOTE); else toast(err.message, true);
      } finally { ab.disabled = false; showState(); }
    });
    showState();
  });
}

// ---------- settings ----------
function settings() {
  view().innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="panel" style="max-width:820px"><div class="panel-head"><h3>WhatsApp group</h3></div>
      <form class="panel-body" id="grp-form" style="display:grid;gap:14px">
        <div id="grp-alert"></div>
        <label>Group invite link<input name="wa_group_link" value="${esc(state.wa?.wa_group_link)}" placeholder="https://chat.whatsapp.com/…" inputmode="url">
          <span class="hint">In WhatsApp, open the group → group name → <b>Invite via link</b> → Copy link, and paste it here.
          Parents then see a <b>Join our WhatsApp group</b> button straight after registering, and you can send it from <b>Registrations</b> → <b>Group link</b>.</span></label>
        <label>Welcome message<textarea name="wa_group_message" style="min-height:190px">${esc(state.wa?.wa_group_message)}</textarea>
          <span class="hint">Placeholders: {guardian} {player} {first_name} {location} {club} and <b>{link}</b> (required: where the group link goes).</span></label>
        <div><div class="hint" style="margin-bottom:6px">Preview</div><div id="grp-preview" class="wa-bubble"></div></div>
        <button class="btn btn-primary" style="justify-self:start">Save WhatsApp group</button>
      </form></div>
    <div class="panel" style="max-width:820px"><div class="panel-head"><h3>WhatsApp fee reminder</h3></div>
      <form class="panel-body" id="wa-form" style="display:grid;gap:14px">
        <div id="wa-alert"></div>
        <label>Default country code<input name="wa_country_code" value="${esc(state.wa?.wa_country_code)}" inputmode="numeric" style="max-width:140px">
          <span class="hint">Added to 10-digit numbers saved without one (91 = India).</span></label>
        <label>Message<textarea name="wa_template" style="min-height:200px">${esc(state.wa?.wa_template)}</textarea>
          <span class="hint">Placeholders: {guardian} {player} {first_name} {month} {location} {club} — and {amount} if you set fees.</span></label>
        <div><div class="hint" style="margin-bottom:6px">Preview</div><div id="wa-preview" class="wa-bubble"></div></div>
        <button class="btn btn-primary" style="justify-self:start">Save reminder settings</button>
      </form></div>
    <div class="panel" style="max-width:520px"><div class="panel-head"><h3>Change password</h3></div>
      <form class="panel-body" id="pw-form" style="display:grid;gap:14px">
        <div id="pw-alert"></div>
        <label>Current password<input type="password" name="current" required autocomplete="current-password"></label>
        <label>New password<input type="password" name="next" minlength="8" required autocomplete="new-password"></label>
        <button class="btn btn-primary">Update password</button>
      </form></div>`;
  const waForm = $('#wa-form');
  const sample = { first_name: 'Aarav', last_name: 'Sharma', guardian_name: 'Priya Sharma', age: 11, fee: state.locations[0]?.monthly_fee || 0, location_name: state.locations[0]?.name || 'Bhakshala' };
  const preview = () => {
    const saved = state.wa; state.wa = { ...saved, wa_template: waForm.wa_template.value };
    $('#wa-preview').textContent = reminderText(sample, state.period);
    state.wa = saved;
  };
  waForm.addEventListener('input', preview); preview();
  const grpForm = $('#grp-form');
  const grpPreview = () => {
    $('#grp-preview').textContent = fillMessage(grpForm.wa_group_message.value, sample, { link: grpForm.wa_group_link.value.trim() || 'https://chat.whatsapp.com/…' });
  };
  grpForm.addEventListener('input', grpPreview); grpPreview();
  grpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/settings', { method: 'PUT', body: formData(grpForm) });
      state.wa = await api('/api/admin/settings');
      $('#grp-alert').innerHTML = ''; toast(state.wa.wa_group_link ? 'WhatsApp group link saved' : 'Saved (no group link yet)');
    } catch (err) { $('#grp-alert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
  });
  waForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { wa_template, wa_country_code } = formData(waForm);
      await api('/api/admin/settings', { method: 'PUT', body: { wa_template, wa_country_code } });
      state.wa = await api('/api/admin/settings');
      waForm.wa_country_code.value = state.wa.wa_country_code;
      $('#wa-alert').innerHTML = ''; toast('Reminder settings saved');
    } catch (err) { $('#wa-alert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/admin/password', { method: 'POST', body: formData(e.target) }); e.target.reset(); toast('Password updated'); }
    catch (err) { $('#pw-alert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
  });
}

// ---------- find any player (search bar above every page) ----------
(function setupFind() {
  const input = $('#find'), box = $('#find-results');
  let t, seq = 0, results = [];
  const close = () => { box.hidden = true; };
  const where = (p) => (p.status === 'inactive' ? 'Ex-player' : p.status === 'pending' ? 'New registration' : 'Active');
  async function search() {
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    const mine = ++seq;
    try {
      results = await api('/api/admin/players?' + new URLSearchParams({ q }));
    } catch (e) { if (e.status === 401) showLogin(); return; }
    if (mine !== seq) return; // a newer search is running
    box.innerHTML = results.slice(0, 8).map((p, i) => `<button type="button" class="find-item" data-i="${i}">
        <span><b>${esc(p.first_name)} ${esc(p.last_name)}</b><small>${p.age} yrs · ${esc(p.location_name || 'No centre')}${p.guardian_name ? ' · ' + esc(p.guardian_name) : ''}</small></span>
        <span class="pill ${p.status}">${where(p)}</span></button>`).join('')
      + (results.length > 8 ? `<button type="button" class="find-item find-all">See all ${results.length} results →</button>` : '')
      + (results.length ? '' : `<div class="find-empty">No player found for “${esc(q)}”</div>`);
    box.hidden = false;
  }
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 200); });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) search(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); input.blur(); }
    if (e.key === 'Enter' && results[0]) { e.preventDefault(); close(); playerModal(results[0].id); }
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.find-item');
    if (!b) return;
    close();
    if (b.classList.contains('find-all')) { state.filters = { status: '', q: input.value.trim() }; go('players'); return; }
    playerModal(results[b.dataset.i].id);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.global-search')) close(); });
})();

// ---------- boot ----------
api('/api/admin/me').then((m) => start(m.username)).catch(showLogin);
