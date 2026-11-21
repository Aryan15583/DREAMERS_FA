// Dreamers FA — club admin panel
const state = { locations: [], period: new Date().toISOString().slice(0, 7), view: 'dashboard', filters: {} };
const AGE_GROUPS = ['U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Senior'];
const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
const view = () => $('#view');

function toast(msg, isError) {
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
  state.locations = await api('/api/locations');
  const v = location.hash.slice(1);
  go(['dashboard', 'players', 'fees', 'locations', 'news', 'fixtures', 'settings'].includes(v) ? v : 'dashboard');
}
$$('.sidebar .nav-item').forEach((b) => b.addEventListener('click', () => { go(b.dataset.view); $('.sidebar').classList.remove('open'); }));

function go(v) {
  state.view = v;
  history.replaceState(null, '', '#' + v);
  $$('.sidebar .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  ({ dashboard, players, fees, locations: locationsView, news: newsView, fixtures: fixturesView, settings })[v]();
}
const refresh = () => go(state.view);

async function updatePendingBadge() {
  const list = await api('/api/admin/players?status=pending');
  const b = $('#pending-count');
  b.hidden = !list.length; b.textContent = list.length;
}

// ---------- dashboard ----------
async function dashboard() {
  await guarded(async () => {
    const d = await api('/api/admin/dashboard?period=' + state.period);
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
        <div class="kpi ok"><span>Collected</span><b>${money(d.collected)}</b></div>
        <div class="kpi bad"><span>Outstanding</span><b>${money(d.due)}</b></div>
      </div>
      <div class="cols-2">
        <div class="panel">
          <div class="panel-head"><h3>By location</h3></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Location</th><th class="num">Players</th><th>Paid</th><th class="num">Collected</th><th class="num">Outstanding</th></tr></thead>
            <tbody>${d.byLocation.map((l) => `<tr>
              <td class="name">${esc(l.name)}</td><td class="num">${l.players}</td>
              <td><div style="display:flex;gap:8px;align-items:center"><div class="bar" style="flex:1"><i style="width:${l.players ? (l.paid / l.players) * 100 : 0}%"></i></div><span class="sub">${l.paid}/${l.players}</span></div></td>
              <td class="num">${money(l.collected)}</td><td class="num">${money(l.due)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No locations yet</td></tr>'}
            </tbody></table></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>By age group</h3></div>
          <div class="panel-body">${d.byAgeGroup.map((a) => `<div class="ag-row"><span class="pill group">${a.group}</span><div class="bar"><i style="width:${(a.players / maxAg) * 100}%"></i></div><b class="num">${a.players}</b></div>`).join('')}</div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Latest registrations</h3><button class="btn btn-sm btn-primary" onclick="state.filters={status:'pending'};go('players')">Review pending</button></div>
        <div class="table-wrap"><table><tbody>${d.recent.map(playerRow).join('') || '<tr><td class="muted">No players yet</td></tr>'}</tbody></table></div>
      </div>`;
    $('#period').addEventListener('change', (e) => { if (e.target.value) { state.period = e.target.value; dashboard(); } });
    bindPlayerRows();
  });
}

// ---------- players ----------
function playerRow(p) {
  return `<tr class="clickable" data-id="${p.id}">
    <td><div class="name">${esc(p.first_name)} ${esc(p.last_name)}</div><div class="sub">${esc(p.position || '—')}${p.jersey_number != null ? ' · #' + p.jersey_number : ''}</div></td>
    <td><span class="pill group">${p.age_group}</span> <span class="sub">${p.age} yrs</span></td>
    <td>${esc(p.location_name || '—')}</td>
    <td><div>${esc(p.phone || p.guardian_phone || '—')}</div><div class="sub">${esc(p.guardian_name || '')}</div></td>
    <td><span class="pill ${p.status}">${p.status}</span></td>
    <td><span class="pill ${p.fee_status}">${p.fee_status === 'n/a' ? '—' : p.fee_status}</span> <span class="sub">${money(p.fee)}</span></td>
  </tr>`;
}
function bindPlayerRows() {
  $$('tr.clickable[data-id]', view()).forEach((tr) => tr.addEventListener('click', () => playerModal(tr.dataset.id)));
}
function playerQuery() {
  const f = { ...state.filters, period: state.period };
  return new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
}

async function players() {
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
        <select name="status">${opts([['active', 'Active'], ['pending', 'Pending'], ['inactive', 'Inactive']], f.status, 'Any status')}</select>
        <select name="fee">${opts([['paid', 'Paid'], ['unpaid', 'Unpaid']], f.fee, 'Any fee status')}</select>
        <input type="month" name="period" value="${state.period}" title="Fee month" />
      </form>
      <div class="table-wrap"><table>
        <thead><tr><th>Player</th><th>Age</th><th>Location</th><th>Contact</th><th>Status</th><th>Fee</th></tr></thead>
        <tbody id="player-rows"><tr><td colspan="6" class="muted">Loading…</td></tr></tbody>
      </table></div>
      <div class="panel-body muted" id="player-count" style="font-size:13px"></div>
    </div>`;
  const load = () => guarded(async () => {
    $('#csv').href = '/api/admin/players.csv?' + playerQuery();
    const list = await api('/api/admin/players?' + playerQuery());
    $('#player-rows').innerHTML = list.map(playerRow).join('') || '<tr><td colspan="6" class="muted">No players match these filters.</td></tr>';
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
      <label>Position<select name="position">${opts(POSITIONS, p.position, '—')}</select></label>
      <label>Status<select name="status">${opts([['active', 'Active'], ['pending', 'Pending'], ['inactive', 'Inactive']], p.status || 'active')}</select></label>
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
        <span class="pill ${p.status}">${p.status}</span>
        <span class="pill">${esc(p.location_name || 'No location')}</span>
        <span class="pill">Fee ${money(p.fee)}/month</span>
        <span class="pill">Registered ${fmtDate(p.created_at)}</span>
      </div>
      ${p.status === 'pending' ? `<div class="alert alert-ok" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">New registration — approve to make this player active.<button class="btn btn-sm btn-primary" id="approve">Approve player</button></div>` : ''}
      <fieldset>
        <legend>Fees &amp; payments</legend>
        <form class="pay-row" id="pay-form">
          <label>Month<input type="month" name="period" value="${state.period}" required></label>
          <label>Amount<input type="number" step="any" min="0" name="amount" value="${p.fee}"></label>
          <label>Paid on<input type="date" name="paid_on" value="${new Date().toISOString().slice(0, 10)}"></label>
          <label>Method<select name="method">${opts(['Cash', 'UPI', 'Bank transfer', 'Card', 'Other'], 'Cash')}</select></label>
          <button class="btn btn-primary" type="submit">Record</button>
        </form>
        <div class="table-wrap" style="margin-top:14px"><table>
          <thead><tr><th>Month</th><th class="num">Amount</th><th>Paid on</th><th>Method</th><th></th></tr></thead>
          <tbody>${p.payments.map((x) => `<tr><td>${esc(fmtMonth(x.period))}</td><td class="num">${money(x.amount)}</td><td>${fmtDate(x.paid_on)}</td><td>${esc(x.method || '')}</td>
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
    const ap = $('#approve', body);
    if (ap) ap.addEventListener('click', async () => {
      await guarded(async () => { await api(`/api/admin/players/${p.id}`, { method: 'PUT', body: { status: 'active' } }); toast('Player approved'); playerModal(p.id); refreshBehind(); });
    });
  });
}
// re-render the page under the modal without closing it
function refreshBehind() { if (state.view !== 'settings') go(state.view); }

// ---------- fees (quick monthly collection) ----------
async function fees() {
  const f = state.feeFilters || (state.feeFilters = {});
  view().innerHTML = `
    <div class="page-head"><h1>Fees</h1>
      <div class="actions"><a class="btn btn-sm btn-outline" style="color:var(--navy)" id="fee-csv">⬇ Export unpaid list</a></div>
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
    const q = new URLSearchParams({ status: 'active', period: state.period, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
    const list = await api('/api/admin/players?' + q);
    $('#fee-csv').href = '/api/admin/players.csv?' + new URLSearchParams({ ...Object.fromEntries(q), fee: 'unpaid' });
    const paid = list.filter((p) => p.fee_status === 'paid');
    const unpaid = list.filter((p) => p.fee_status === 'unpaid');
    $('#fee-kpis').innerHTML = `
      <div class="kpi"><span>${esc(fmtMonth(state.period))}</span><b>${list.length}</b></div>
      <div class="kpi ok"><span>Paid</span><b>${paid.length}</b></div>
      <div class="kpi bad"><span>Unpaid</span><b>${unpaid.length}</b></div>
      <div class="kpi ok"><span>Collected</span><b>${money(paid.reduce((s, p) => s + p.paid_amount, 0))}</b></div>
      <div class="kpi bad"><span>Outstanding</span><b>${money(unpaid.reduce((s, p) => s + p.fee, 0))}</b></div>`;
    $('#fee-rows').innerHTML = list.map((p) => `<tr>
      <td><div class="name">${esc(p.first_name)} ${esc(p.last_name)}</div><div class="sub">${p.age_group}</div></td>
      <td>${esc(p.location_name || '—')}</td>
      <td>${esc(p.phone || p.guardian_phone || '—')}</td>
      <td class="num">${money(p.paid_amount ?? p.fee)}</td>
      <td><span class="pill ${p.fee_status}">${p.fee_status}</span>${p.paid_on ? `<div class="sub">${fmtDate(p.paid_on)}</div>` : ''}</td>
      <td class="num">${p.fee_status === 'paid'
        ? `<button class="btn btn-sm btn-outline" style="color:var(--muted)" data-unpay="${p.id}">Undo</button>`
        : `<button class="btn btn-sm btn-primary" data-pay="${p.id}">Mark paid</button>`}
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

// ---------- generic list editor (locations / news / fixtures) ----------
function listEditor({ title, endpoint, items, render, fields, label }) {
  view().innerHTML = `
    <div class="page-head"><h1>${title}</h1><div class="actions"><button class="btn btn-sm btn-primary" id="add">+ Add ${label}</button></div></div>
    <div class="panel">${items.map((it, i) => `<div class="list-item"><div>${render(it)}</div>
      <div style="display:flex;gap:6px;flex:none"><button class="btn btn-sm btn-outline" style="color:var(--navy)" data-edit="${i}">Edit</button>
      <button class="btn btn-sm btn-outline" style="color:var(--bad)" data-del="${i}">Delete</button></div></div>`).join('') || `<div class="panel-body muted">No ${label}s yet.</div>`}</div>`;
  const edit = (it = {}) => {
    openModal(it.id ? `Edit ${label}` : `Add ${label}`, `<form id="ed-form"><div id="ed-alert"></div><div class="grid">${fields(it)}</div>
      <div class="modal-foot"><span></span><button class="btn btn-primary">Save</button></div></form>`);
    $('#ed-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(it.id ? `${endpoint}/${it.id}` : endpoint, { method: it.id ? 'PUT' : 'POST', body: formData(e.target) });
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
  await guarded(async () => {
    state.locations = await api('/api/locations');
    listEditor({
      title: 'Locations', label: 'location', endpoint: '/api/admin/locations', items: state.locations,
      render: (l) => `<div class="name">${esc(l.name)}</div><div class="sub">${esc(l.address || '')} · ${esc(l.training_days || '')} · <b>${money(l.monthly_fee)}</b>/month</div>`,
      fields: (l) => `
        <label class="full"><span>Name <span class="req">*</span></span><input name="name" value="${esc(l.name)}" required></label>
        <label class="full">Address<input name="address" value="${esc(l.address)}"></label>
        <label>Training days &amp; times<input name="training_days" value="${esc(l.training_days)}" placeholder="Mon, Wed · 5–7 PM"></label>
        <label>Monthly fee<input type="number" min="0" step="any" name="monthly_fee" value="${esc(l.monthly_fee ?? 0)}"></label>`,
    });
  });
}

async function newsView() {
  await guarded(async () => {
    const items = await api('/api/news?limit=100');
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
  await guarded(async () => {
    const items = (await api('/api/fixtures')).reverse();
    listEditor({
      title: 'Fixtures & results', label: 'fixture', endpoint: '/api/admin/fixtures', items,
      render: (f) => `<div class="name">Dreamers FA ${esc(f.team)} vs ${esc(f.opponent)} ${f.score_us != null && f.score_them != null ? `<span class="pill ${f.score_us > f.score_them ? 'paid' : f.score_us < f.score_them ? 'unpaid' : 'pending'}">${f.score_us}–${f.score_them}</span>` : ''}</div>
        <div class="sub">${fmtDateTime(f.match_date)} · ${esc(f.home_away)} · ${esc(f.venue || '')} · ${esc(f.competition || 'Friendly')}</div>`,
      fields: (f) => `
        <label><span>Our team <span class="req">*</span></span><select name="team">${opts(AGE_GROUPS, f.team || 'Senior')}</select></label>
        <label><span>Opponent <span class="req">*</span></span><input name="opponent" value="${esc(f.opponent)}" required></label>
        <label><span>Date &amp; time <span class="req">*</span></span><input type="datetime-local" name="match_date" value="${esc(f.match_date)}" required></label>
        <label>Home / away<select name="home_away">${opts(['Home', 'Away'], f.home_away)}</select></label>
        <label>Venue<input name="venue" value="${esc(f.venue)}"></label>
        <label>Competition<input name="competition" value="${esc(f.competition)}" placeholder="League, Cup, Friendly…"></label>
        <label>Our score<input type="number" min="0" name="score_us" value="${esc(f.score_us)}"><span class="hint">Fill in both scores after the match to show it as a result.</span></label>
        <label>Their score<input type="number" min="0" name="score_them" value="${esc(f.score_them)}"></label>`,
    });
  });
}

// ---------- settings ----------
function settings() {
  view().innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="panel" style="max-width:520px"><div class="panel-head"><h3>Change password</h3></div>
      <form class="panel-body" id="pw-form" style="display:grid;gap:14px">
        <div id="pw-alert"></div>
        <label>Current password<input type="password" name="current" required autocomplete="current-password"></label>
        <label>New password<input type="password" name="next" minlength="8" required autocomplete="new-password"></label>
        <button class="btn btn-primary">Update password</button>
      </form></div>`;
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/admin/password', { method: 'POST', body: formData(e.target) }); e.target.reset(); toast('Password updated'); }
    catch (err) { $('#pw-alert').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; }
  });
}

// ---------- boot ----------
api('/api/admin/me').then((m) => start(m.username)).catch(showLogin);
