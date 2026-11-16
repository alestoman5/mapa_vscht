/* Mapa VŠCHT – Driver mode: parodie na autonavigaci. Po chodbách se autem nejezdí. */
(function () {
  'use strict';
  const A = window.APP, N = A.N, $ = s => document.querySelector(s);
  const LIMIT = 20;            // km/h, „obytná zóna chodba“
  const VMAX = 12.5;           // m/s
  const REPORTS = [
    { k: 'police', ic: '👮', col: '#4dabf7', t: 'Policie', s: 'vrátný na obchůzce', say: 'Pozor, před vámi hlášena policie.' },
    { k: 'crash', ic: '💥', col: '#ff8787', t: 'Nehoda', s: 'srážka dvou prváků', say: 'Pozor, před vámi nehoda.' },
    { k: 'jam', ic: '🚗', col: '#ffa94d', t: 'Zácpa', s: 'fronta na kávu', say: 'Před vámi kolona. Fronta na kávu.' },
    { k: 'hazard', ic: '🧪', col: '#ffd43b', t: 'Nebezpečí', s: 'rozlitá chemikálie', say: 'Pozor, nebezpečí na vozovce. Rozlitá chemikálie.' },
    { k: 'radar', ic: '📸', col: '#b197fc', t: 'Radar', s: 'zkoušející na chodbě', say: 'Pozor, měřený úsek. Zkoušející na chodbě.' },
    { k: 'closed', ic: '🧹', col: '#63e6be', t: 'Uzavírka', s: 'mokrá podlaha', say: 'Před vámi uzavírka. Mokrá podlaha.' },
    { k: 'smell', ic: '🤢', col: '#c0eb75', t: 'Zápach', s: 'organika zase vaří', say: 'Pozor, zhoršená viditelnost a zápach z laboratoře.' },
    { k: 'lift', ic: '🛗', col: '#dee2e6', t: 'Výtah', s: 'mimo provoz', say: 'Hlášen výtah mimo provoz.' }
  ];
  const RBY = Object.fromEntries(REPORTS.map(r => [r.k, r]));
  RBY.cat = { k: 'cat', ic: '🐈', col: '#fab005', t: 'Schrödingerova kočka', s: 'na vozovce, živá i mrtvá', say: 'Pozor, na vozovce Schrödingerova kočka. Je živá i mrtvá.' };

  /* ---------- hlášení (ukládají se v prohlížeči) ---------- */
  let reports = [];
  try { reports = JSON.parse(localStorage.getItem('vscht-reports') || '[]').filter(r => RBY[r.k]); } catch (e) { }
  let points = 0; try { points = +localStorage.getItem('vscht-points') || 0; } catch (e) { }
  const save = () => { try { localStorage.setItem('vscht-reports', JSON.stringify(reports.filter(r => r.mine).slice(-60))); localStorage.setItem('vscht-points', points); } catch (e) { } };
  reports.forEach(r => { r.mine = true; });
  if (A.EGG) { const d = A.EGG.doors[0]; const o = d ? d.sides.find(s => s.r !== A.EGG.i) : null; reports.push({ k: 'cat', x: o ? o.x : A.EGG.lx, y: o ? o.y : A.EGG.ly, fl: A.EGG.fl, perm: true }); }

  /* ---------- zvuk ---------- */
  let muted = false, ac = null;
  function beep(f, ms, type, vol) {
    if (muted) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'sine'; o.frequency.value = f; g.gain.value = vol || 0.08;
      o.connect(g); g.connect(ac.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000); o.stop(ac.currentTime + ms / 1000);
    } catch (e) { }
  }
  function say(t) {
    if (muted || !window.speechSynthesis) return;
    try { const u = new SpeechSynthesisUtterance(t); u.lang = 'cs-CZ'; u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { }
  }

  /* ---------- stav jízdy ---------- */
  let D = null; // {legs:[{fl,pts,cum,len,man,endsWith}], li, s, v, heading, ...}
  const keys = { gas: false, brake: false };
  function prep(route) {
    return route.legs.map(l => {
      const cum = [0]; for (let i = 1; i < l.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(l.pts[i].x - l.pts[i - 1].x, l.pts[i].y - l.pts[i - 1].y));
      return { fl: l.fl, pts: l.pts, cum, len: cum[cum.length - 1], man: N.maneuvers(l), endsWith: l.endsWith };
    });
  }
  function posAt(leg, s) {
    const c = leg.cum; let i = 1; while (i < c.length - 1 && c[i] < s) i++;
    if (leg.pts.length < 2) return { x: leg.pts[0].x, y: leg.pts[0].y, h: null };
    const a = leg.pts[i - 1], b = leg.pts[i], t = Math.max(0, Math.min(1, (s - c[i - 1]) / Math.max(1e-6, c[i] - c[i - 1])));
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  function seedReports(legs) { // „komunita“ už něco nahlásila
    let seed = Math.round(legs.reduce((s, l) => s + l.len, 0) * 7) + 13; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const kinds = ['police', 'jam', 'hazard', 'radar', 'closed', 'smell', 'crash'];
    legs.forEach(l => { for (let s = 28 + rnd() * 25; s < l.len - 14; s += 45 + rnd() * 60) { const p = posAt(l, s); reports.push({ k: kinds[Math.floor(rnd() * kinds.length)], x: p.x, y: p.y, fl: l.fl, seeded: true }); } });
  }

  function start() {
    const rt = A.st.route; if (!rt) return;
    const legs = prep(rt).filter((l, i, a) => l.len > 0.5 || l.endsWith || i === a.length - 1);
    reports = reports.filter(r => !r.seeded); reports.forEach(r => { r.alerted = false; });
    seedReports(legs);
    D = { legs, li: 0, s: 0, v: 0, heading: null, cruise: false, said: {}, pause: 0, done: false, t: performance.now(), fined: 0, overT: 0, total: legs.reduce((s, l) => s + l.len, 0) };
    document.body.classList.add('driving'); A.resize(); $('#drv').hidden = false; $('#drv-alert').hidden = true; $('#rep-modal').hidden = true;
    $('#cruise').classList.remove('on'); $('#drv-gps').classList.remove('on'); $('#gas').classList.add('hint'); $('#pts').textContent = points;
    A.view.ax = 0.5; A.view.ay = 0.72; A.view.s = 26; A.setFloor(legs[0].fl);
    const p = posAt(legs[0], 0); D.heading = p.h == null ? 0 : p.h; A.view.x = p.x; A.view.y = p.y; A.view.rot = -D.heading - Math.PI / 2;
    const dest = A.epLabel(A.st.to).split(' · ')[0];
    say('Vítejte. Jedeme do cíle ' + dest + '. Připoutejte se.'); A.toast('Podrž PLYN, nebo zapni tempomat. Šipky ↑ ↓ fungují taky.', 4200);
    hud(); A.requestDraw();
  }
  function stop() {
    if (!D) return; D = null; keys.gas = keys.brake = false;
    document.body.classList.remove('driving'); A.resize(); $('#drv').hidden = true; if (window.speechSynthesis) speechSynthesis.cancel();
    reports = reports.filter(r => !r.seeded);
    A.view.ax = 0.5; A.view.ay = 0.5; A.renderSheet(); if (A.st.route) A.showLeg(0); else A.fitAll();
    A.requestDraw();
  }

  /* ---------- smyčka ---------- */
  function tick(now) {
    if (!D) return;
    const dt = Math.min(0.05, (now - D.t) / 1000); D.t = now;
    const leg = D.legs[D.li];
    if (D.pause > 0) {
      D.pause -= dt; D.v = 0;
      if (D.pause <= 0 && D.next != null) { D.li = D.next; D.s = 0; D.next = null; D.said = {}; A.setFloor(D.legs[D.li].fl); const p = posAt(D.legs[D.li], 0); if (p.h != null) D.heading = p.h; beep(880, 160); }
    } else if (!D.done) {
      if (D.gps && A.gps.pos) { // jízda podle skutečné polohy: promítnutí GPS na trasu
        const g = A.gps.pos; let bs = D.s, bd = 1e9;
        for (let i = 1; i < leg.pts.length; i++) {
          if (leg.cum[i] < D.s - 6 || leg.cum[i - 1] > D.s + 45) continue;
          const a = leg.pts[i - 1], b = leg.pts[i], L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1e-9, t = Math.max(0, Math.min(1, ((g.x - a.x) * (b.x - a.x) + (g.y - a.y) * (b.y - a.y)) / L2));
          const dd = Math.hypot(a.x + (b.x - a.x) * t - g.x, a.y + (b.y - a.y) * t - g.y);
          if (dd < bd) { bd = dd; bs = leg.cum[i - 1] + t * (leg.cum[i] - leg.cum[i - 1]); }
        }
        if (leg.len - bs < Math.max(6, Math.min(g.acc, 12))) bs = leg.len;
        D.v = Math.max(0, Math.min(VMAX, (bs - D.s) * 0.9)); D.s = Math.min(leg.len, D.s + D.v * dt);
        if (leg.len - D.s < 0.05) endOfLeg(leg);
      } else {
      // pedály
      const remain = leg.len - D.s, vBrake = Math.sqrt(2 * 5 * Math.max(0, remain)) + 0.4;
      let acc = -1.2;
      if (keys.brake) acc = -9; else if (keys.gas) acc = 3.4; else if (D.cruise) acc = D.v < 4.6 ? 2.5 : D.v > 5 ? -2 : 0;
      D.v = Math.max(0, Math.min(VMAX, D.v + acc * dt)); if (D.v > vBrake) D.v = vBrake;
      D.s = Math.min(leg.len, D.s + D.v * dt);
      if (leg.len - D.s < 0.05) endOfLeg(leg);
      }
    }
    const cl = D.legs[D.li], p = posAt(cl, D.s);
    if (p.h != null) { let d = p.h - D.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; D.heading += d * Math.min(1, dt * 5); }
    D.x = p.x; D.y = p.y;
    A.view.x = p.x; A.view.y = p.y; A.view.rot = -D.heading - Math.PI / 2; A.view.s = 26 - Math.min(8, D.v * 0.7);
    guidance(cl); alerts(cl); speeding(dt, cl); hud(); A.requestDraw();
  }
  function endOfLeg(leg) {
    if (D.li < D.legs.length - 1) {
      const e = leg.endsWith || { kind: 'stairs', to: D.legs[D.li + 1].fl, from: leg.fl };
      D.next = D.li + 1; D.pause = e.kind === 'lift' ? 2.6 : 2.2;
      const up = e.to > e.from;
      const msg = e.kind === 'lift' ? `🛗 Auto se do výtahu skoro vešlo. Jedeme: ${N.floorName(e.to)}.` : `🪜 Řadím jedničku a ${up ? 'stoupám' : 'sjíždím'} po schodech: ${N.floorName(e.to)}.`;
      A.toast(msg, 2300); say(e.kind === 'lift' ? 'Najeďte do výtahu.' : 'Pokračujte po schodech ' + (up ? 'nahoru.' : 'dolů.')); beep(440, 220, 'triangle');
    } else arrive();
  }
  function arrive() {
    D.done = true; D.v = 0;
    const r = A.epRoom(A.st.to), egg = r && A.isEgg(r), name = A.epLabel(A.st.to).split(' · ')[0];
    beep(660, 150); setTimeout(() => beep(880, 150), 160); setTimeout(() => beep(1320, 300), 320);
    A.confetti(egg ? A.PSI : ['🏁', '🎉', '🚗', '⭐', '🧪'], 40);
    say(egg ? 'Dorazili jste do superpozice. Profesor je i není přítomen.' : 'Jste v cíli. ' + name + '.');
    const el = $('#drv-alert'); el.hidden = false; clearTimeout(alertT);
    el.innerHTML = `<div class="arrive"><div class="big">${egg ? '⚛️' : '🏁'}</div><b>${egg ? 'Dorazili jste do superpozice' : 'Jste v cíli: ' + name}</b>
      <small>${egg ? 'Kancelář: Piotr Slawiczek. Zaklepáním provedete měření – následky nese pozorovatel.' : 'Zaparkujte ohleduplně. Ne na únikové cestě a ne před digestoří.'}</small></div>
      <div class="a-b"><button id="arr-end">Ukončit jízdu</button></div>`;
    $('#arr-end').onclick = stop;
    points += 10; $('#pts').textContent = points; save();
  }

  /* ---------- pokyny ---------- */
  const fmtD = d => d < 10 ? Math.max(1, Math.round(d)) + ' m' : Math.round(d / 5) * 5 + ' m';
  function guidance(leg) {
    if (D.done || D.pause > 0) return;
    const next = leg.man.find(m => m.at > D.s + 0.5);
    let arrow, dist, text, id;
    if (next) {
      dist = next.at - D.s; id = 'm' + next.at.toFixed(0);
      arrow = next.dir === 'L' ? (next.sharp ? '↶' : '↰') : (next.sharp ? '↷' : '↱');
      text = (next.slight ? 'Držte se ' : next.sharp ? 'Ostře ' : 'Odbočte ') + (next.dir === 'L' ? 'vlevo' : 'vpravo');
    } else {
      dist = leg.len - D.s; id = 'end';
      if (D.li < D.legs.length - 1) { const e = leg.endsWith || {}; arrow = e.kind === 'lift' ? '🛗' : '🪜'; text = (e.kind === 'lift' ? 'Výtahem' : 'Po schodech') + ': ' + N.floorName(D.legs[D.li + 1].fl); }
      else { arrow = '🏁'; text = 'Cíl: ' + A.epLabel(A.st.to).split(' · ')[0]; }
    }
    $('#drv-arrow').textContent = arrow; $('#drv-dist').textContent = fmtD(dist); $('#drv-instr').textContent = text;
    const sp = text.replace(':', ' –');
    if (dist < 32 && dist > 14 && !D.said[id + 'a']) { D.said[id + 'a'] = 1; say('Za ' + Math.round(dist / 5) * 5 + ' metrů ' + sp.charAt(0).toLowerCase() + sp.slice(1) + '.'); }
    if (dist < 7 && !D.said[id + 'b']) { D.said[id + 'b'] = 1; if (id !== 'end') { say(sp + '.'); beep(990, 90); } }
  }
  let alertT = 0;
  function alerts(leg) {
    if (D.done) return;
    for (const r of reports) {
      if (r.fl !== leg.fl || r.alerted) continue;
      const d = Math.hypot(r.x - D.x, r.y - D.y);
      if (d < 24 && !(r.mine && d < 3 && performance.now() - (r.ts || 0) < 15000)) {
        r.alerted = true; if (r.mine && performance.now() - (r.ts || 0) < 15000) continue;
        const t = RBY[r.k]; beep(740, 130); setTimeout(() => beep(740, 130), 190); say(t.say);
        const el = $('#drv-alert'); el.hidden = false;
        el.innerHTML = `<div class="a-h"><span class="a-ic">${t.ic}</span><div>${t.t} hlášena před vámi<small>${t.s} · ${fmtD(d)}${r.mine ? ' · nahlásil(a) jsi ty' : r.perm ? ' · trvalý stav' : ' · před 3 min'}</small></div></div>
          <div class="a-b"><button data-v="1">👍 Stále tam</button><button data-v="0">👎 Už ne</button></div>`;
        el.onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.v === '0' && !r.perm) { reports = reports.filter(x => x !== r); save(); } points += 1; $('#pts').textContent = points; save(); el.hidden = true; A.toast(b.dataset.v === '1' ? 'Díky za potvrzení! +1 bod' : r.perm ? 'Kočka tam je i není. Nelze odstranit. +1 bod' : 'Díky, hlášení odstraněno. +1 bod', 1800); };
        clearTimeout(alertT); alertT = setTimeout(() => { el.hidden = true; }, 6500);
        break;
      }
    }
  }
  function speeding(dt, leg) {
    const kmh = D.v * 3.6, over = kmh > LIMIT + 2;
    $('#speedo').classList.toggle('over', over);
    if (over) { D.overT += dt; if (D.overT > 1.4) { D.overT = 0; beep(1200, 80, 'square', 0.05); } } else D.overT = 0;
    if (over && performance.now() - D.fined > 9000) {
      for (const r of reports) if (r.fl === leg.fl && (r.k === 'police' || r.k === 'radar') && Math.hypot(r.x - D.x, r.y - D.y) < 5) {
        D.fined = performance.now(); points = Math.max(0, points - 3); $('#pts').textContent = points; save(); beep(200, 500, 'sawtooth', 0.07);
        A.toast(r.k === 'radar' ? `📸 Změřeno ${Math.round(kmh)} km/h. Zkoušející si vás zapsal. −3 body a jeden kredit.` : `👮 Vrátný naměřil ${Math.round(kmh)} km/h v zóně ${LIMIT}. −3 body a zákaz vjezdu do menzy.`, 4200);
        say('Byli jste změřeni. Zpomalte.'); break;
      }
    }
  }
  function hud() {
    $('#kmh').textContent = Math.round(D.v * 3.6);
    let rem = D.legs[D.li].len - D.s; for (let i = D.li + 1; i < D.legs.length; i++) rem += D.legs[i].len;
    const fl = D.legs.length - 1 - D.li, secs = rem / 5 + fl * 3, eta = new Date(Date.now() + secs * 1000);
    $('#eta-t').textContent = D.done ? 'V cíli' : eta.getHours() + ':' + String(eta.getMinutes()).padStart(2, '0');
    $('#eta-s').textContent = D.done ? 'vypněte motor' : `${secs < 60 ? Math.ceil(secs) + ' s' : Math.round(secs / 60) + ' min'} · ${Math.round(rem)} m · ${N.floorName(D.legs[D.li].fl)}`;
  }

  /* ---------- vykreslení auta a hlášení ---------- */
  A.overlays.push((ctx, now, space) => {
    const fl = A.st.floor;
    if (space === 'world') {
      if (!D) return;
      ctx.save(); ctx.translate(D.x, D.y); ctx.rotate(D.heading);
      const L = 1.9, Wd = 1.0;
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0.08, 0.1, L * 0.62, Wd * 0.7, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#12b3d6'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.09;
      ctx.beginPath(); ctx.roundRect(-L / 2, -Wd / 2, L, Wd, 0.32); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#0b3a52'; ctx.beginPath(); ctx.roundRect(-0.45, -Wd / 2 + 0.13, 0.85, Wd - 0.26, 0.14); ctx.fill();
      ctx.fillStyle = '#fff3bf'; ctx.fillRect(L / 2 - 0.12, -Wd / 2 + 0.1, 0.1, 0.2); ctx.fillRect(L / 2 - 0.12, Wd / 2 - 0.3, 0.1, 0.2);
      ctx.fillStyle = keys.brake || D.pause > 0 || D.done ? '#ff3b3b' : '#a61e1e'; ctx.fillRect(-L / 2 + 0.02, -Wd / 2 + 0.1, 0.1, 0.2); ctx.fillRect(-L / 2 + 0.02, Wd / 2 - 0.3, 0.1, 0.2);
      ctx.restore(); return;
    }
    for (const r of reports) {
      if (r.fl !== fl || (r.seeded && !D)) continue;
      if (!D && A.view.s < 4) continue;
      const p = A.toScreen(r.x, r.y), t = RBY[r.k], R = D ? 19 : 13, bob = D ? Math.sin(now / 300 + r.x) * 2 : 0;
      if (p.x < -30 || p.x > A.W + 30 || p.y < -30 || p.y > A.H + 30) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y - R - 4 + bob, R, 0, 7); ctx.fillStyle = t.col; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x - 5, p.y - 8 + bob); ctx.lineTo(p.x, p.y); ctx.lineTo(p.x + 5, p.y - 8 + bob); ctx.fillStyle = t.col; ctx.fill();
      ctx.font = `${R * 1.05}px system-ui,sans-serif`; ctx.fillStyle = '#000'; ctx.fillText(t.ic, p.x, p.y - R - 3 + bob);
    }
  });
  A.tickers.push(tick);

  /* ---------- ovládání ---------- */
  function hold(el, key) {
    const on = e => { e.preventDefault(); keys[key] = true; el.classList.add('down'); if (key === 'gas') $('#gas').classList.remove('hint'); if (key === 'brake' && D && D.cruise) setCruise(false); };
    const off = () => { keys[key] = false; el.classList.remove('down'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  hold($('#gas'), 'gas'); hold($('#brake'), 'brake');
  function setCruise(v) { if (!D) return; D.cruise = v; $('#cruise').classList.toggle('on', v); $('#cruise').textContent = v ? 'Tempomat ✓' : 'Tempomat'; if (v) $('#gas').classList.remove('hint'); }
  $('#cruise').onclick = () => setCruise(!D.cruise);
  window.addEventListener('keydown', e => { if (!D) return; if (e.key === 'ArrowUp' || e.key === 'w') { keys.gas = true; $('#gas').classList.remove('hint'); } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === ' ') keys.brake = true; else if (e.key === 'Escape') stop(); else if (e.key === 'c') setCruise(!D.cruise); else return; e.preventDefault(); });
  window.addEventListener('keyup', e => { if (e.key === 'ArrowUp' || e.key === 'w') keys.gas = false; else if (e.key === 'ArrowDown' || e.key === 's' || e.key === ' ') keys.brake = false; });
  $('#drv-gps').onclick = () => {
    if (!D) return;
    if (D.gps) { D.gps = false; $('#drv-gps').classList.remove('on'); A.toast('Jízda podle GPS vypnuta, zpět na pedály.', 1800); return; }
    A.gps.pending = null; $('#drv-gps').classList.add('on'); D.gps = true; $('#gas').classList.remove('hint');
    A.toast('📡 Jedu podle tvé skutečné polohy. Běž po trase – auto pojede s tebou.', 3500);
    if (!A.gps.on) $('#locate').click();
  };
  $('#drv-exit').onclick = stop;
  $('#drv-mute').onclick = () => { muted = !muted; $('#drv-mute').textContent = muted ? '🔇' : '🔊'; if (muted && window.speechSynthesis) speechSynthesis.cancel(); };
  $('#horn').onclick = () => { beep(392, 420, 'sawtooth', 0.09); beep(494, 420, 'sawtooth', 0.09); A.toast(['📯 Tůůt! Chodci na chodbě nadskočili.', '📯 Tůůt! Dveře laborky se uraženě zavřely.', '📯 Tůůt! Někdo upustil kádinku.'][Math.floor(Math.random() * 3)], 1600); };
  // nahlášení
  $('#rep-grid').innerHTML = REPORTS.map(r => `<button data-k="${r.k}"><i style="background:${r.col}">${r.ic}</i>${r.t}<small>${r.s}</small></button>`).join('');
  $('#report').onclick = () => { $('#rep-modal').hidden = false; };
  $('#rep-cancel').onclick = () => { $('#rep-modal').hidden = true; };
  $('#rep-modal').addEventListener('click', e => { if (e.target.id === 'rep-modal') $('#rep-modal').hidden = true; });
  $('#rep-grid').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !D) return;
    const t = RBY[b.dataset.k];
    reports.push({ k: t.k, x: D.x, y: D.y, fl: D.legs[D.li].fl, mine: true, ts: performance.now(), alerted: true });
    points += 5; $('#pts').textContent = points; save(); $('#rep-modal').hidden = true; beep(880, 100); setTimeout(() => beep(1175, 160), 110);
    A.toast(`${t.ic} ${t.t} nahlášena (${t.s}). Ostatní řidiči na chodbě díky! +5 bodů`, 2600); A.requestDraw();
  });

  A.startDrive = start; A.stopDrive = stop;
})();
