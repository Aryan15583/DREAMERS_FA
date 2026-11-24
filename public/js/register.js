(async function () {
  const form = $('#reg-form');
  form.standard.insertAdjacentHTML('beforeend', optionList(STANDARDS));
  form.blood_group.insertAdjacentHTML('beforeend', optionList(BLOOD_GROUPS, BLOOD_LABELS));
  form.position.insertAdjacentHTML('beforeend', optionList(POSITIONS, POSITION_LABELS));

  let locs = [];
  try {
    locs = await api('/api/locations');
    const params = new URLSearchParams(location.search);
    $('#loc-options').innerHTML = locs.map((l, i) => `
      <label class="loc-option">
        <input type="radio" name="location_id" value="${l.id}" ${params.get('location') == l.id || (locs.length === 1 && i === 0) ? 'checked' : ''} required />
        <b>${esc(l.name)}</b>
        ${l.address ? `<small>${esc(l.address)}</small>` : ''}
        ${(l.schedule || []).map((s) => `<small>🕒 ${esc(fmtDays(s.days))} · ${esc(fmtTimeRange(s.start, s.end))} · ${esc(s.group)}</small>`).join('')}
        <a class="map-link" href="${esc(mapLink(l))}" target="_blank" rel="noopener">View on map ↗</a>
      </label>`).join('') || '<div class="hint">No centres available yet — please check back soon.</div>';
  } catch {
    $('#loc-options').innerHTML = '<div class="alert alert-error">Could not load centres. Please refresh the page.</div>';
  }

  const age = () => (form.dob.value ? ageFromDob(form.dob.value) : null);
  form.dob.addEventListener('change', () => {
    const a = age();
    $('#age').value = a != null && a >= 0 ? `${a} year${a === 1 ? '' : 's'}` : '';
    $('#age-hint').textContent = a == null ? 'Calculated automatically.' : a >= 0 ? `${ageGroup(a)} age group` : 'Birth date cannot be in the future';
  });

  // clear the red outline as soon as a field is fixed
  const clear = (e) => { e.target.closest('label')?.classList.remove('invalid'); e.target.closest('.regform-section')?.classList.remove('invalid'); };
  form.addEventListener('input', clear);
  form.addEventListener('change', clear);

  function check(data) {
    const errs = [];
    const bad = (name, msg) => {
      errs.push(msg);
      const el = form.elements[name];
      const field = el instanceof RadioNodeList ? el[0]?.closest('.regform-section') : el?.closest('label');
      field?.classList.add('invalid');
    };
    const a = age();
    if (!data.first_name?.trim()) bad('first_name', 'Player first name');
    if (!data.last_name?.trim()) bad('last_name', 'Player surname');
    if (!data.dob) bad('dob', 'Birth date');
    else if (a < 0) bad('dob', 'Birth date cannot be in the future');
    if (!data.standard) bad('standard', 'Standard (class)');
    if (!data.blood_group) bad('blood_group', 'Blood group (choose “Don’t know” if unsure)');
    if (!data.position) bad('position', 'Playing position (choose Fresher if new)');
    if (!data.location_id) bad('location_id', 'Training centre');
    if ((a == null || a < 18) && !data.guardian_name?.trim()) bad('guardian_name', 'Parent / guardian name');
    if (!data.guardian_phone?.trim() && !data.phone?.trim()) bad('guardian_phone', 'Parent mobile number');
    else if (data.guardian_phone?.trim() && data.guardian_phone.replace(/\D/g, '').length < 10) bad('guardian_phone', 'Parent mobile number should have 10 digits');
    if (!data.consent) bad('consent', 'Please tick the consent box');
    return errs;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $$('.invalid', form).forEach((x) => x.classList.remove('invalid'));
    const data = Object.fromEntries(new FormData(form));
    data.consent = form.consent.checked;
    const alert = $('#reg-alert');
    const errs = check(data);
    if (errs.length) {
      alert.innerHTML = `<div class="alert alert-error"><b>Please complete:</b><ul>${errs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
      alert.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const result = await api('/api/register', { method: 'POST', body: data });
      if (result.group_link && /^https:\/\/chat\.whatsapp\.com\//.test(result.group_link)) {
        $('#reg-group-link').href = result.group_link;
        $('#reg-group').hidden = false;
      }
      const loc = locs.find((l) => String(l.id) === String(data.location_id));
      const row = (k, v) => (v ? `<div><span>${k}</span><b>${esc(v)}</b></div>` : '');
      $('#reg-summary').innerHTML =
        row('Player', `${data.first_name} ${data.last_name}`) + row('Birth date', fmtDate(data.dob)) +
        row('Age', `${age()} years (${ageGroup(age())})`) + row('Standard', data.standard) +
        row('Blood group', BLOOD_LABELS[data.blood_group] || data.blood_group) + row('Position', POSITION_LABELS[data.position] || data.position) +
        row('Centre', loc?.name) + row('Parent', data.guardian_name) + row('Mobile', data.guardian_phone || data.phone);
      form.hidden = true; $('#reg-success').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      alert.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      alert.scrollIntoView({ block: 'start' });
    } finally { btn.disabled = false; btn.textContent = 'Submit registration'; }
  });
})();
