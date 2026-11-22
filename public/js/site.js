(async function () {
  // stats
  api('/api/stats').then((s) => {
    $('#st-players').textContent = s.players;
    $('#st-locations').textContent = s.locations;
    $('#st-teams').textContent = s.teams;
    $('#st-wins').textContent = s.wins;
  }).catch(() => {});

  // news
  let news = [];
  try { news = await api('/api/news?limit=5'); } catch {}
  const grid = $('#news-grid');
  grid.classList.toggle('few', news.length < 3);
  grid.innerHTML = news.length ? news.map((n, i) => `
    <button class="news-card ${i === 0 ? 'featured' : ''}" data-id="${n.id}">
      <div class="thumb ${n.image_url ? '' : 'placeholder'}" ${n.image_url ? `style="background-image:url('${esc(n.image_url)}')"` : ''}></div>
      <div class="body">
        <time>${fmtDate(n.published_at)}</time>
        <h3>${esc(n.title)}</h3>
        <p>${esc(n.summary || '')}</p>
      </div>
    </button>`).join('') : '<div class="empty">No news yet.</div>';
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.news-card'); if (!card) return;
    const n = news.find((x) => String(x.id) === card.dataset.id);
    $('#nm-title').textContent = n.title;
    $('#nm-date').textContent = fmtDate(n.published_at);
    $('#nm-body').innerHTML = (n.image_url ? `<img src="${esc(n.image_url)}" alt="" style="border-radius:10px;margin:12px 0">` : '') +
      esc(n.body || n.summary || '').split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    $('#news-modal').showModal();
  });

  // fixtures
  let fixtures = [];
  try { fixtures = await api('/api/fixtures'); } catch {}
  const now = Date.now();
  const played = (f) => f.score_us != null && f.score_them != null;
  const upcoming = fixtures.filter((f) => !played(f) && new Date(f.match_date) >= now - 3 * 3600e3);
  const results = fixtures.filter(played).reverse();
  function renderFixtures(list, isResult) {
    $('#fixtures-list').innerHTML = list.length ? list.slice(0, 9).map((f) => {
      const home = f.home_away !== 'Away';
      const us = `Dreamers FA <small style="display:block;font-size:13px;color:#9fb4e0">${esc(f.team)}</small>`;
      const them = esc(f.opponent);
      const mid = isResult
        ? `<div class="score">${home ? f.score_us : f.score_them} – ${home ? f.score_them : f.score_us}</div>`
        : '<div class="vs">VS</div>';
      let tag = '';
      if (isResult) tag = f.score_us > f.score_them ? 'Win' : f.score_us < f.score_them ? 'Loss' : 'Draw';
      return `<div class="fixture">
        <div class="meta"><span>${esc(f.competition || 'Friendly')}</span><span>${tag || esc(f.home_away)}</span></div>
        <div class="teams"><div class="team">${home ? us : them}</div>${mid}<div class="team">${home ? them : us}</div></div>
        <div class="when">${fmtDateTime(f.match_date)}${f.venue ? ' · ' + esc(f.venue) : ''}</div>
      </div>`;
    }).join('') : `<div class="empty">${isResult ? 'No results yet.' : 'No upcoming fixtures.'}</div>`;
  }
  renderFixtures(upcoming, false);
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    b.dataset.tab === 'results' ? renderFixtures(results, true) : renderFixtures(upcoming, false);
  }));

  // locations
  let locs = [];
  try { locs = await api('/api/locations'); } catch {}
  $('#loc-grid').innerHTML = locs.length ? locs.map((l) => `
    <div class="loc">
      <h3>${esc(l.name)}</h3>
      ${l.address ? `<div class="row">📍 <span>${esc(l.address)}</span></div>` : ''}
      <a class="map-link" href="${esc(mapLink(l))}" target="_blank" rel="noopener">🗺️ Get directions on Google Maps ↗</a>
      <div class="timings">
        <div class="timings-head">🕒 Training timings</div>
        ${l.schedule?.length ? `<ul>${l.schedule.map((s) => `<li><b>${esc(fmtDays(s.days))}</b><span>${esc(fmtTimeRange(s.start, s.end))}</span><em>${esc(s.group)}${s.note ? ' · ' + esc(s.note) : ''}</em></li>`).join('')}</ul>`
          : '<p class="muted">To be announced</p>'}
      </div>
      <a class="btn btn-primary btn-sm" style="margin-top:8px" href="/register?location=${l.id}">Register at this centre</a>
    </div>`).join('') : '<div class="empty">Centres will be announced soon.</div>';
})();
