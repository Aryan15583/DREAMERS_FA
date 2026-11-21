(async function () {
  const form = $('#reg-form');
  try {
    const locs = await api('/api/locations');
    const params = new URLSearchParams(location.search);
    $('#loc-options').innerHTML = locs.map((l, i) => `
      <label class="loc-option">
        <input type="radio" name="location_id" value="${l.id}" ${params.get('location') == l.id || (locs.length === 1 && i === 0) ? 'checked' : ''} required />
        <b>${esc(l.name)}</b>
        ${l.address ? `<small>${esc(l.address)}</small>` : ''}
        <a class="map-link" href="${esc(mapLink(l))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">View on map ↗</a>
        ${l.training_days ? `<small>${esc(l.training_days)}</small>` : ''}
      </label>`).join('') || '<div class="hint">No centres available yet — please check back soon.</div>';
  } catch {
    $('#loc-options').innerHTML = '<div class="alert alert-error">Could not load centres. Please refresh the page.</div>';
  }

  form.dob.addEventListener('change', () => {
    if (!form.dob.value) return;
    const a = ageFromDob(form.dob.value);
    $('#age-hint').textContent = a >= 0 ? `Age ${a} · ${ageGroup(a)} group` : 'Date of birth cannot be in the future';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.consent = form.consent.checked;
    const alert = $('#reg-alert');
    const errs = [];
    if (!data.location_id) errs.push('Please choose a training centre');
    if (!data.first_name?.trim() || !data.last_name?.trim()) errs.push('Please enter the player’s full name');
    if (!data.dob) errs.push('Please enter date of birth');
    if (!data.phone?.trim() && !data.guardian_phone?.trim()) errs.push('Please give at least one phone number');
    if (data.dob && ageFromDob(data.dob) < 18 && !data.guardian_name?.trim()) errs.push('Guardian name is required for players under 18');
    if (!data.consent) errs.push('Please tick the consent box');
    if (errs.length) { alert.innerHTML = `<div class="alert alert-error">${errs.map(esc).join('<br>')}</div>`; alert.scrollIntoView({ block: 'center' }); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      await api('/api/register', { method: 'POST', body: data });
      form.hidden = true; $('#reg-success').hidden = false;
      $('#reg-success').scrollIntoView({ block: 'center' });
    } catch (err) {
      alert.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      alert.scrollIntoView({ block: 'center' });
    } finally { btn.disabled = false; btn.textContent = 'Submit registration'; }
  });
})();
