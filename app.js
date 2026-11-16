/* Mapa VŠCHT – vykreslení mapy, hledání a panel trasy. */
(function () {
  'use strict';
  const N = window.NAV, $ = s => document.querySelector(s);
  const cv = $('#map'), ctx = cv.getContext('2d');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- stav ---------- */
  const view = { x: 0, y: -20, s: 3, rot: 0, ax: 0.5, ay: 0.5 };
  const st = { floor: 0, sel: null, from: null, to: null, route: null, picking: null, noStairs: false, hl: null, driveAfter: false, steps: false };
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  const PAL = {
    light: { bg: '#f4f1ea', wall: '#5b6470', label: '#262b33', sub: '#5b6470', door: '#a47148', t: ['#e6e3f4', '#ffd8a8', '#d0ebff', '#d3f9d8', '#e3e5e8', '#f3d0fb', '#fff3bf', '#ffffff', '#e6e3f4', '#e6e3f4'] },
    dark: { bg: '#14171c', wall: '#8b95a3', label: '#eef0f3', sub: '#aab2be', door: '#d9a066', t: ['#383450', '#70501f', '#234566', '#1f5230', '#30353d', '#5b3366', '#5f561c', '#252a32', '#383450', '#383450'] }
  };
  const pal = () => (document.body.classList.contains('driving') || mqDark.matches) ? PAL.dark : PAL.light;
  const ICON = r => r.lift ? '🛗' : r.stairs ? '🪜' : ['📍', '🎓', '💼', '🧪', '🔧', '🚻', '☕', '🚶', '📍', '📍'][r.type];

  /* ---------- příprava dat ---------- */
  const byFloor = {}, doorsByFloor = {};
  for (const f of N.FLOORS) { byFloor[f] = []; doorsByFloor[f] = []; }
  for (const r of N.rooms) {
    const p = new Path2D();
    for (const R of r.rings) { p.moveTo(R[0].x, R[0].y); for (let i = 1; i < R.length; i++) p.lineTo(R[i].x, R[i].y); p.closePath(); }
    r.path = p; byFloor[r.fl].push(r);
    // popisek: u poslucháren je hlavní alias (AI, B11…)
    if (r.lift) r.lab = ['výtah', ''];
    else if (r.stairs) r.lab = ['schody', ''];
    else if (r.type === 7) r.lab = null;
    else if (r.alias && r.type === 1 && r.alias.length <= 5) r.lab = [r.alias, r.code];
    else r.lab = [r.code, r.alias && r.alias.length <= 12 ? r.alias : ''];
  }
  for (const f of N.FLOORS) byFloor[f].sort((a, b) => b.area - a.area);
  for (const d of N.doors) doorsByFloor[d.fl].push(d);
  const EGG = N.rooms.find(r => r.b === 'A' && r.name === '136' && r.fl === 1) || null;
  const isEgg = r => !!EGG && r === EGG;

  /* ---------- transformace ---------- */
  let W = 0, H = 0, dpr = 1, dirty = true;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5) * (document.body.classList.contains('driving') ? 1.5 : 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); dirty = true;
  }
  function toScreen(x, y) {
    const c = Math.cos(view.rot), s = Math.sin(view.rot), dx = x - view.x, dy = y - view.y;
    return { x: view.ax * W + (dx * c - dy * s) * view.s, y: view.ay * H + (dx * s + dy * c) * view.s };
  }
  function toWorld(sx, sy) {
    const c = Math.cos(view.rot), s = Math.sin(view.rot), dx = (sx - view.ax * W) / view.s, dy = (sy - view.ay * H) / view.s;
    return { x: view.x + dx * c + dy * s, y: view.y - dx * s + dy * c };
  }
  function pinWorldToScreen(w, sx, sy) { // posuň střed tak, aby bod světa w ležel na obrazovce v (sx, sy)
    const c = Math.cos(view.rot), s = Math.sin(view.rot), dx = (sx - view.ax * W) / view.s, dy = (sy - view.ay * H) / view.s;
    view.x = w.x - (dx * c + dy * s); view.y = w.y - (-dx * s + dy * c);
  }
  const requestDraw = () => { dirty = true; };
  // výřez volný od ovládacích prvků
  function freeRect() {
    const sh = $('#sheet'), bottom = sh.hidden || W >= 720 ? 16 : Math.min(sh.offsetHeight, H * 0.5) + 10;
    return { l: 14, t: 120, r: W - 62, b: H - bottom };
  }
  let anim = null;
  function animTo(t, ms) {
    const s0 = { x: view.x, y: view.y, s: view.s, rot: view.rot }, t0 = performance.now();
    let dr = (t.rot != null ? t.rot : s0.rot) - s0.rot; while (dr > Math.PI) dr -= 2 * Math.PI; while (dr < -Math.PI) dr += 2 * Math.PI;
    anim = now => {
      let k = Math.min(1, (now - t0) / (ms || 380)); k = 1 - Math.pow(1 - k, 3);
      view.x = s0.x + ((t.x != null ? t.x : s0.x) - s0.x) * k; view.y = s0.y + ((t.y != null ? t.y : s0.y) - s0.y) * k;
      view.s = s0.s * Math.pow((t.s != null ? t.s : s0.s) / s0.s, k); view.rot = s0.rot + dr * k;
      dirty = true; if (k >= 1) anim = null;
    };
  }
  function fitPts(pts, opt) {
    opt = opt || {};
    const rot = opt.rot != null ? opt.rot : view.rot, c = Math.cos(rot), s = Math.sin(rot), fr = freeRect();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of pts) { const X = p.x * c - p.y * s, Y = p.x * s + p.y * c; if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
    const sc = Math.max(1.5, Math.min((fr.r - fr.l - 30) / Math.max(1, x1 - x0), (fr.b - fr.t - 30) / Math.max(1, y1 - y0), opt.max || 22));
    // střed bbox -> střed volného výřezu
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, ox = ((fr.l + fr.r) / 2 - W / 2) / sc, oy = ((fr.t + fr.b) / 2 - H / 2) / sc;
    const X = mx - ox, Y = my - oy;
    const t = { x: X * c + Y * s, y: -X * s + Y * c, s: sc, rot };
    if (opt.instant) { Object.assign(view, t); dirty = true; } else animTo(t, opt.ms);
  }
  const HOME_ROT = () => (W < H ? 47 : -43) * Math.PI / 180;
  function fitAll(instant) {
    const pts = []; for (const r of byFloor[0]) pts.push({ x: r.bb[0], y: r.bb[1] }, { x: r.bb[2], y: r.bb[3] }, { x: r.bb[0], y: r.bb[3] }, { x: r.bb[2], y: r.bb[1] });
    fitPts(pts, { rot: HOME_ROT(), instant, max: 8 });
  }

  /* ---------- vykreslení ---------- */
  const overlays = []; // doplňuje driver.js
  function draw(now) {
    const P = pal(), c = Math.cos(view.rot), s = Math.sin(view.rot), S = view.s * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = P.bg; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(S * c, S * s, -S * s, S * c, (view.ax * W) * dpr - S * (c * view.x - s * view.y), (view.ay * H) * dpr - S * (s * view.x + c * view.y));
    // ořez na viditelnou oblast
    const cs = [toWorld(0, 0), toWorld(W, 0), toWorld(0, H), toWorld(W, H)], m = document.body.classList.contains('driving') ? 60 : 2;
    const vx0 = Math.min(...cs.map(p => p.x)) - m, vx1 = Math.max(...cs.map(p => p.x)) + m, vy0 = Math.min(...cs.map(p => p.y)) - m, vy1 = Math.max(...cs.map(p => p.y)) + m;
    const vis = byFloor[st.floor].filter(r => r.bb[2] > vx0 && r.bb[0] < vx1 && r.bb[3] > vy0 && r.bb[1] < vy1);
    for (const r of vis) { ctx.fillStyle = P.t[r.type]; ctx.fill(r.path, 'evenodd'); }
    ctx.lineJoin = 'round'; ctx.strokeStyle = P.wall; ctx.lineWidth = Math.max(0.13, 0.9 / view.s);
    for (const r of vis) ctx.stroke(r.path);
    if (view.s > 3.5) {
      ctx.lineCap = 'butt'; ctx.lineWidth = Math.max(0.3, 1.6 / view.s);
      ctx.beginPath(); ctx.strokeStyle = P.door;
      for (const d of doorsByFloor[st.floor]) if (d.ax && d.kind !== 3 && d.x > vx0 && d.x < vx1 && d.y > vy0 && d.y < vy1) { ctx.moveTo(d.ax[0].x, d.ax[0].y); ctx.lineTo(d.ax[1].x, d.ax[1].y); }
      ctx.stroke();
      ctx.beginPath(); ctx.strokeStyle = '#2f9e44'; ctx.lineWidth *= 1.6;
      for (const d of doorsByFloor[st.floor]) if (d.ax && d.kind === 3) { ctx.moveTo(d.ax[0].x, d.ax[0].y); ctx.lineTo(d.ax[1].x, d.ax[1].y); }
      ctx.stroke();
    }
    // zvýraznění kategorie
    if (st.hl) {
      const k = 0.35 + 0.25 * Math.sin(now / 260);
      ctx.fillStyle = st.hl === 'wc' ? `rgba(174,62,201,${k})` : `rgba(18,179,214,${k})`;
      ctx.strokeStyle = st.hl === 'wc' ? '#ae3ec9' : '#0c8599'; ctx.lineWidth = Math.max(0.3, 2 / view.s);
      for (const r of vis) if (st.hl === 'wc' ? r.type === 5 : r.lift) { ctx.fill(r.path, 'evenodd'); ctx.stroke(r.path); }
    }
    if (EGG && st.floor === EGG.fl) { // nenápadná kvantová záře
      ctx.fillStyle = `rgba(250,176,5,${0.22 + 0.16 * Math.sin(now / 500)})`; ctx.fill(EGG.path, 'evenodd');
    }
    if (st.sel && st.sel.fl === st.floor) {
      ctx.fillStyle = 'rgba(59,91,219,.28)'; ctx.fill(st.sel.path, 'evenodd');
      ctx.strokeStyle = '#3b5bdb'; ctx.lineWidth = Math.max(0.3, 2.5 / view.s); ctx.stroke(st.sel.path);
    }
    // trasa
    const rt = st.route;
    if (rt) {
      ctx.lineCap = 'round';
      for (const l of rt.legs) {
        if (l.fl !== st.floor || l.pts.length < 2) continue;
        const path = new Path2D(); path.moveTo(l.pts[0].x, l.pts[0].y); for (let i = 1; i < l.pts.length; i++) path.lineTo(l.pts[i].x, l.pts[i].y);
        ctx.setLineDash([]); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(0.75, 8 / view.s); ctx.stroke(path);
        ctx.strokeStyle = '#2f7df6'; ctx.lineWidth = Math.max(0.5, 5 / view.s); ctx.stroke(path);
        const u = Math.max(0.5, 5 / view.s); ctx.setLineDash([u * 0.2, u * 2.6]); ctx.lineDashOffset = -(now / 55) * u * 0.12;
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = u * 0.42; ctx.stroke(path); ctx.setLineDash([]);
      }
    }
    for (const f of overlays) f(ctx, now, 'world');

    /* --- popisky a značky v souřadnicích obrazovky --- */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const driving = document.body.classList.contains('driving');
    for (const r of vis) {
      if (!r.lab) continue;
      const sr = r.ir * view.s; if (sr < 8.5) continue;
      const fs = Math.max(9.5, Math.min(sr * 0.62, r.type === 1 ? 17 : 13.5));
      if (r.lab[0].length * fs * 0.56 > sr * 2.9 && r !== st.sel) continue;
      const p = toScreen(r.lx, r.ly);
      if (p.x < -40 || p.x > W + 40 || p.y < -20 || p.y > H + 20) continue;
      const two = r.lab[1] && sr > 24 && !driving;
      ctx.font = `${r.type === 1 || r === st.sel ? 700 : 500} ${fs}px system-ui,sans-serif`; ctx.fillStyle = (r.lift || r.stairs) ? P.sub : P.label;
      ctx.fillText(r.lab[0], p.x, p.y - (two ? fs * 0.45 : 0));
      if (two) { ctx.font = `400 ${Math.max(9, fs * 0.72)}px system-ui,sans-serif`; ctx.fillStyle = P.sub; ctx.fillText(r.lab[1], p.x, p.y + fs * 0.62); }
    }
    if (EGG && st.floor === EGG.fl && view.s > 5) {
      const p = toScreen(EGG.lx, EGG.ly), o = Math.max(10, EGG.ir * view.s * 0.9);
      ctx.font = `italic 700 ${14 + 2 * Math.sin(now / 400)}px Georgia,serif`; ctx.fillStyle = '#e67700'; ctx.fillText('ψ', p.x + o, p.y - o);
    }
    markers.length = 0;
    if (rt) {
      rt.legs.forEach((l, i) => {
        if (l.fl !== st.floor) return;
        const a = l.pts[0], b = l.pts[l.pts.length - 1];
        if (i === 0) dot(toScreen(a.x, a.y), '#3b5bdb');
        else badge(toScreen(a.x, a.y), 'z ' + N.floorShort(rt.legs[i - 1].fl), '#495057', i - 1);
        if (i === rt.legs.length - 1) pin(toScreen(b.x, b.y));
        else if (l.endsWith) badge(toScreen(b.x, b.y), (l.endsWith.to > l.endsWith.from ? '▲ ' : '▼ ') + N.floorShort(l.endsWith.to), '#2f7df6', i + 1, true);
      });
    } else {
      for (const ep of [st.from, st.to]) if (ep) { const p = epPoint(ep); if (p.fl === st.floor) (ep === st.to ? pin : q => dot(q, '#3b5bdb'))(toScreen(p.x, p.y)); }
    }
    if (!rt && st.floor === 0 && view.s > 2.2 && !driving) for (const e of N.entrances) entMark(toScreen(e.x, e.y), e.b);
    if (gps.pos && !driving) {
      const p = toScreen(gps.pos.x, gps.pos.y), ra = Math.min(gps.pos.acc * view.s, 2000);
      if (p.x > -ra && p.x < W + ra && p.y > -ra && p.y < H + ra) {
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(ra, 12), 0, 7); ctx.fillStyle = 'rgba(28,126,214,.14)'; ctx.fill(); ctx.strokeStyle = 'rgba(28,126,214,.45)'; ctx.lineWidth = 1; ctx.stroke();
        if (gps.pos.head != null) { const h = gps.pos.head * Math.PI / 180 + view.rot - Math.PI / 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, 30, h - 0.5, h + 0.5); ctx.closePath(); ctx.fillStyle = 'rgba(28,126,214,.35)'; ctx.fill(); }
        ctx.beginPath(); ctx.arc(p.x, p.y, 10 + Math.sin(now / 400), 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.fillStyle = '#1c7ed6'; ctx.fill();
      }
    }
    for (const f of overlays) f(ctx, now, 'screen');
  }
  const markers = []; // klikací značky přestupu
  function dot(p, col) { ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fillStyle = col; ctx.fill(); }
  function pin(p) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-14, -16, -11, -32, 0, -32); ctx.bezierCurveTo(11, -32, 14, -16, 0, 0);
    ctx.fillStyle = '#e03131'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -21, 4, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
  }
  function badge(p, text, col, leg, pulse) {
    ctx.font = '700 13px system-ui,sans-serif'; const w = ctx.measureText(text).width + 18, h = 26, y = p.y - 24;
    if (pulse) { ctx.beginPath(); ctx.arc(p.x, p.y, 9 + 3 * Math.sin(performance.now() / 250), 0, 7); ctx.fillStyle = 'rgba(47,125,246,.3)'; ctx.fill(); }
    dot(p, col); ctx.beginPath(); ctx.roundRect(p.x - w / 2, y - h / 2, w, h, 13); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillText(text, p.x, y + 0.5);
    markers.push({ x: p.x, y: y, leg });
  }
  function entMark(p, b) {
    ctx.font = '700 11px system-ui,sans-serif'; const t = 'vchod ' + b, w = ctx.measureText(t).width + 14;
    ctx.beginPath(); ctx.roundRect(p.x - w / 2, p.y - 10, w, 20, 10); ctx.fillStyle = '#2f9e44'; ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(t, p.x, p.y + 0.5);
  }
  function frame(now) {
    if (anim) anim(now);
    for (const f of tickers) f(now);
    if (dirty || st.route || st.hl || gps.pos || (EGG && st.floor === EGG.fl)) { dirty = false; draw(now); }
    requestAnimationFrame(frame);
  }
  const tickers = [];

  /* ---------- gesta ---------- */
  const ptrs = new Map(); let tap = null, g2 = null;
  cv.addEventListener('pointerdown', e => {
    if (document.body.classList.contains('driving')) return;
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); anim = null;
    tap = ptrs.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; g2 = null;
    $('#q').blur();
  });
  cv.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (ptrs.size === 1) {
      const c = Math.cos(view.rot), s = Math.sin(view.rot), dx = (e.clientX - p.x) / view.s, dy = (e.clientY - p.y) / view.s;
      view.x -= dx * c + dy * s; view.y -= -dx * s + dy * c;
      p.x = e.clientX; p.y = e.clientY;
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 9) tap = null;
    } else if (ptrs.size === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...ptrs.values()], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (g2) {
        const w = toWorld(g2.mid.x, g2.mid.y);
        view.s = Math.max(1.2, Math.min(90, view.s * d / g2.d)); view.rot += ang - g2.ang;
        pinWorldToScreen(w, mid.x, mid.y);
      }
      g2 = { mid, d, ang }; tap = null;
    }
    dirty = true; updCompass();
  });
  const up = e => {
    if (!ptrs.delete(e.pointerId)) return; g2 = null;
    if (tap && performance.now() - tap.t < 450) onTap(tap.x, tap.y);
    tap = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); g2 = null; tap = null; });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); if (document.body.classList.contains('driving')) return;
    const w = toWorld(e.clientX, e.clientY); view.s = Math.max(1.2, Math.min(90, view.s * Math.exp(-e.deltaY * 0.0016)));
    pinWorldToScreen(w, e.clientX, e.clientY); dirty = true;
  }, { passive: false });
  function zoomBy(k) { animTo({ s: Math.max(1.2, Math.min(90, view.s * k)) }, 200); }
  $('#zin').onclick = () => zoomBy(1.6); $('#zout').onclick = () => zoomBy(1 / 1.6);
  function updCompass() { $('#compass svg').style.transform = `rotate(${view.rot}rad)`; }
  $('#compass').onclick = () => { const home = HOME_ROT(); animTo({ rot: Math.abs(view.rot % (2 * Math.PI)) < 0.02 ? home : 0 }, 350); setTimeout(updCompass, 400); };

  function onTap(x, y) {
    for (const m of markers) if (Math.hypot(m.x - x, m.y - y) < 26) { showLeg(m.leg); return; }
    const w = toWorld(x, y);
    for (const e of N.entrances) if (st.floor === 0 && Math.hypot(e.x - w.x, e.y - w.y) * view.s < 22) { choose({ ent: N.entrances.indexOf(e) }); return; }
    const r = N.roomAt(w.x, w.y, st.floor);
    if (!r || (r.type === 7 && !r.vk)) { if (!st.picking) { st.sel = null; if (!st.route && !st.from && !st.to) hideSheet(); else renderSheet(); dirty = true; } return; }
    choose({ room: r.i });
  }

  /* ---------- koncové body ---------- */
  const epRoom = ep => ep.room != null ? N.rooms[ep.room] : null;
  const epLabel = ep => ep.ent != null ? N.entrances[ep.ent].label : (epRoom(ep).lab && epRoom(ep).type === 1 && epRoom(ep).alias ? epRoom(ep).alias + ' (' + epRoom(ep).code + ')' : epRoom(ep).title) + ' · ' + N.floorName(epRoom(ep).fl);
  const epNav = ep => { if (ep.ent != null) { const e = N.entrances[ep.ent]; return e.door != null ? { door: e.door } : { room: e.room }; } return { room: ep.room }; };
  const epPoint = ep => { if (ep.ent != null) { const e = N.entrances[ep.ent]; return { x: e.x, y: e.y, fl: 0 }; } const r = epRoom(ep); return { x: r.lx, y: r.ly, fl: r.fl }; };
  const same = (a, b) => a && b && a.room === b.room && a.ent === b.ent;

  // výběr místnosti/vchodu (z mapy nebo z hledání)
  function choose(ep) {
    closeResults();
    if (st.picking) { st[st.picking] = ep; st.picking = null; st.sel = epRoom(ep); afterEndpoints(); return; }
    const r = epRoom(ep);
    st.sel = r; st.selEp = ep;
    const p = epPoint(ep); setFloor(p.fl);
    renderSheet();
    if (r) fitPts(r.rings[0], { max: Math.max(view.s, 9), ms: 420 }); else animTo({ x: p.x, y: p.y, s: Math.max(view.s, 6) });
    if (r && isEgg(r)) eggHello();
  }
  function afterEndpoints() {
    st.route = null;
    if (st.from && st.to && same(st.from, st.to)) { toast('Start a cíl jsou stejné – to je i na VŠCHT moc krátká trasa.'); }
    else if (st.from && st.to) {
      st.route = N.route(epNav(st.from), epNav(st.to), { noStairs: st.noStairs });
      if (!st.route) toast(st.noStairs ? 'Bez schodů se tam podle dat nedá dostat. Zkus povolit schody.' : 'Trasu se nepodařilo najít – tahle místnost není v datech napojená na chodby.');
    }
    renderSheet(); updFloors();
    if (st.route) { showLeg(0); if (st.driveAfter) { st.driveAfter = false; setTimeout(() => APP.startDrive && APP.startDrive(), 350); } }
    else { const ep = st.to || st.from; if (ep) { const p = epPoint(ep); setFloor(p.fl); animTo({ x: p.x, y: p.y, s: Math.max(view.s, 6) }); } }
    dirty = true;
  }
  function navigateTo(ep) {
    st.to = ep;
    if (!st.from || same(st.from, ep)) { const b = ep.ent != null ? (ep.ent ? 'A' : 'B') : epRoom(ep).b; st.from = { ent: Math.max(0, N.entrances.findIndex(e => e.b === b)) }; }
    afterEndpoints();
  }
  function showLeg(i) {
    const l = st.route.legs[i]; if (!l) return;
    st.leg = i; setFloor(l.fl);
    fitPts(l.pts.length > 1 ? l.pts : [{ x: l.pts[0].x - 8, y: l.pts[0].y - 8 }, { x: l.pts[0].x + 8, y: l.pts[0].y + 8 }], { max: 14 });
    renderSheet();
  }
  function clearRoute() { st.route = null; st.from = st.to = null; st.picking = null; st.steps = false; st.driveAfter = false; updFloors(); if (st.sel) renderSheet(); else hideSheet(); dirty = true; }

  /* ---------- patra ---------- */
  const flBox = $('#floors');
  for (const f of N.FLOORS.slice().reverse()) { const b = document.createElement('button'); b.textContent = N.floorShort(f); b.dataset.f = f; b.setAttribute('aria-label', N.floorName(f)); b.onclick = () => setFloor(f, true); flBox.appendChild(b); }
  function updFloors() { for (const b of flBox.children) { const f = +b.dataset.f; b.classList.toggle('on', f === st.floor); b.classList.toggle('rt', !!st.route && st.route.legs.some(l => l.fl === f)); } }
  function setFloor(f, user) { if (st.floor !== f) { st.floor = f; dirty = true; if (user) toast(N.floorName(f)[0].toUpperCase() + N.floorName(f).slice(1), 900); } updFloors(); }

  /* ---------- spodní panel ---------- */
  const sheet = $('#sheet');
  function hideSheet() { sheet.hidden = true; }
  const X = '<button class="x" data-act="close" aria-label="Zavřít"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  function fmtTime(s) { return s < 50 ? 'do 1 min' : Math.round(s / 60) + ' min'; }
  function renderSheet() {
    let h = '<div class="grab"></div>';
    if (st.from || st.to) {
      const rt = st.route;
      h += `<div class="rt-box">
        <i class="pin"></i><button class="rt-row ${st.from ? '' : 'ph'} ${st.picking === 'from' ? 'act' : ''}" data-act="pick-from">${st.from ? esc(epLabel(st.from)) : 'Odkud? Vyber start'}</button>
        <i class="gap"></i><span></span>
        <i class="pin to"></i><button class="rt-row ${st.to ? '' : 'ph'} ${st.picking === 'to' ? 'act' : ''}" data-act="pick-to">${st.to ? esc(epLabel(st.to)) : 'Kam? Vyber cíl'}</button>
        <button class="x" id="swap" data-act="swap" aria-label="Prohodit"><svg viewBox="0 0 24 24"><path d="M8 4v15M8 4L4.500 7.500M8 4l3.500 3.500M16 20V5M16 20l-3.500-3.500M16 20l3.500-3.500"/></svg></button>
      </div>`;
      if (st.picking) h += `<p class="hint">Ťukni na místnost v mapě, nebo ji najdi nahoře ve vyhledávání.</p>`;
      if (rt) {
        const fls = [...new Set(rt.legs.map(l => l.fl))];
        h += `<div class="sum"><b>${fmtTime(rt.time)}</b><span>${Math.round(rt.length)} m pěšky${fls.length > 1 ? ' · ' + fls.length + ' patra' : ''}</span></div>`;
      }
      h += `<label class="opt"><input type="checkbox" data-act="nostairs" ${st.noStairs ? 'checked' : ''}> Bez schodů (jen výtahy) ♿</label>`;
      h += `<div class="btns">${rt ? '<button class="btn drive" data-act="drive">🚗 Driver mode</button><button class="btn" data-act="steps">' + (st.steps ? 'Skrýt kroky' : 'Kroky') + '</button>' : ''}<button class="btn" style="flex:.6" data-act="clear">Zrušit</button></div>`;
      if (rt && st.steps) {
        h += '<ul class="steps">' + `<li><span class="ic">🔵</span><div>${esc(epLabel(st.from))}</div></li>`;
        rt.legs.forEach((l, i) => {
          if (l.len > 1) { const m = N.maneuvers(l).length; h += `<li class="go ${st.leg === i ? 'cur' : ''}" data-act="leg" data-i="${i}"><span class="ic">🚶</span><div>Jdi ${Math.round(l.len)} m<small>${N.floorName(l.fl)}${m ? ' · ' + m + (m === 1 ? ' odbočka' : m < 5 ? ' odbočky' : ' odboček') : ''}</small></div></li>`; }
          if (l.endsWith) { const e = l.endsWith; h += `<li class="go" data-act="leg" data-i="${i + 1}"><span class="ic">${e.kind === 'lift' ? '🛗' : '🪜'}</span><div>${e.kind === 'lift' ? 'Výtahem ' + esc(e.name) : 'Po schodech'} ${e.to > e.from ? 'nahoru' : 'dolů'}<small>do: ${N.floorName(e.to)}</small></div></li>`; }
        });
        h += `<li><span class="ic">📍</span><div>${esc(epLabel(st.to))}</div></li></ul>`;
      }
    } else if (st.selEp) {
      const ep = st.selEp, r = epRoom(ep);
      if (r) {
        const P = PAL.light;
        h += `<div class="sh-head"><h2>${esc(r.lab && r.type === 1 && r.alias ? r.alias : r.title)}${r.alias ? `<small>${esc(r.type === 1 ? r.code : r.alias)}</small>` : ''}</h2>${X}</div>
        <p class="sub">Budova ${r.b} · ${N.floorName(r.fl)}${r.area > 3 ? ' · ' + r.area + ' m²' : ''}</p>
        <span class="tag" style="background:${P.t[r.type]}">${ICON(r)} ${r.lift ? 'Výtah' : r.stairs ? 'Schodiště' : N.TYPE[r.type]}</span>${r.reach ? '' : '<span class="tag" style="background:#ffe3e3">bez napojení v datech</span>'}`;
        if (isEgg(r)) h += eggCard();
      } else h += `<div class="sh-head"><h2>${esc(N.entrances[ep.ent].label)}</h2>${X}</div><p class="sub">Přízemí · vstup z ulice Technická</p>`;
      h += `<div class="btns"><button class="btn pri" data-act="to">Navigovat sem</button><button class="btn" data-act="from">Odtud</button></div>`;
    } else { hideSheet(); return; }
    sheet.innerHTML = h; sheet.hidden = false;
  }
  sheet.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'close') { st.sel = st.selEp = null; hideSheet(); dirty = true; }
    else if (a === 'to') navigateTo(st.selEp);
    else if (a === 'from') { st.from = st.selEp; if (!st.to) { st.picking = 'to'; renderSheet(); openPicker(); } else afterEndpoints(); }
    else if (a === 'pick-from' || a === 'pick-to') { st.picking = a.slice(5); renderSheet(); openPicker(); }
    else if (a === 'swap') { [st.from, st.to] = [st.to, st.from]; afterEndpoints(); }
    else if (a === 'clear') clearRoute();
    else if (a === 'steps') { st.steps = !st.steps; renderSheet(); }
    else if (a === 'leg') showLeg(Math.min(+b.dataset.i, st.route.legs.length - 1));
    else if (a === 'drive') APP.startDrive();
    else if (a === 'psi') eggCollapse();
  });
  sheet.addEventListener('change', e => { if (e.target.dataset.act === 'nostairs') { st.noStairs = e.target.checked; afterEndpoints(); } });

  /* ---------- hledání ---------- */
  const q = $('#q'), results = $('#results');
  const EGG_RE = /slaw|slav|piotr|photox|kvant|schr[oö]d|psi|ψ/i;
  function resHTML(r) {
    return `<button class="res" data-room="${r.i}"><span class="dot" style="background:${PAL.light.t[r.type]}">${ICON(r)}</span><span><b>${esc(r.lab && r.type === 1 && r.alias ? r.alias : r.title)}</b>${r.alias ? `<span class="al">${esc(r.type === 1 ? r.code : r.alias)}</span>` : ''}<small>Budova ${r.b} · ${N.floorName(r.fl)} · ${r.lift ? 'výtah' : r.stairs ? 'schodiště' : N.TYPE[r.type].toLowerCase()}</small></span></button>`;
  }
  const entHTML = () => (st.picking ? `<button class="res" data-gps="1"><span class="dot" style="background:#d0ebff">📍</span><span><b>Moje poloha</b><small>podle GPS, na patře ${N.floorShort(st.floor)} (právě zobrazené)</small></span></button>` : '') + '<div class="res-h">Vchody</div>' + N.entrances.map((e, i) => `<button class="res" data-ent="${i}"><span class="dot" style="background:#d3f9d8">🚪</span><span><b>${esc(e.label)}</b><small>Přízemí</small></span></button>`).join('');
  function runSearch() {
    const v = q.value.trim(); $('#clear').hidden = !q.value; let h = '';
    if (!v) { h = st.picking ? entHTML() : ''; }
    else {
      if (EGG && EGG_RE.test(v)) h += `<button class="res" data-room="${EGG.i}"><span class="dot" style="background:linear-gradient(135deg,#2b1055,#12b3d6);color:#fff;font:italic 700 20px Georgia,serif">ψ</span><span><b>Piotr Slawiczek</b><span class="al">A136</span><small>Kancelář · poloha určena s přesností Δx·Δp ≥ ħ/2</small></span></button>`;
      const rs = N.search(v, 40); h += rs.map(resHTML).join('');
      if (!h) h = '<div class="empty">Nic jsem nenašel. Zkus třeba „A136“, „BI“ nebo „B1-410“.</div>';
    }
    results.innerHTML = h; results.hidden = !h; $('#chips').hidden = !!h;
  }
  function closeResults() { results.hidden = true; $('#chips').hidden = false; q.value = ''; $('#clear').hidden = true; q.blur(); q.placeholder = 'Hledat místnost – A136, BI, AS12…'; }
  function closeResultsKeep() { results.hidden = true; $('#chips').hidden = false; q.value = ''; $('#clear').hidden = true; q.blur(); }
  function openPicker() { q.placeholder = st.picking === 'from' ? 'Odkud vyrážíš?' : 'Kam to bude?'; q.value = ''; runSearch(); q.focus(); }
  q.addEventListener('input', runSearch); q.addEventListener('focus', runSearch);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = results.querySelector('.res'); if (f) f.click(); } else if (e.key === 'Escape') closeResults(); });
  $('#clear').onclick = () => { q.value = ''; runSearch(); q.focus(); };
  results.addEventListener('click', e => { const b = e.target.closest('.res'); if (!b) return; if (b.dataset.gps) { closeResultsKeep(); fromGps(); return; } choose(b.dataset.ent != null ? { ent: +b.dataset.ent } : { room: +b.dataset.room }); });
  $('#chips').addEventListener('click', e => {
    const c = e.target.closest('button'); if (!c) return; const k = c.dataset.chip;
    if (k === 'lecture') {
      const rs = N.rooms.filter(r => r.type === 1 && r.alias).sort((a, b) => a.alias.localeCompare(b.alias, 'cs', { numeric: true }));
      results.innerHTML = '<div class="res-h">Posluchárny a učebny</div>' + rs.map(resHTML).join(''); results.hidden = false; $('#chips').hidden = true; $('#clear').hidden = false;
    } else if (k === 'ent') { results.innerHTML = entHTML(); results.hidden = false; $('#chips').hidden = true; $('#clear').hidden = false; }
    else if (k === 'wc' || k === 'lift') {
      st.hl = st.hl === k ? null : k; dirty = true;
      if (st.hl) { const n = byFloor[st.floor].filter(r => k === 'wc' ? r.type === 5 : r.lift).length; toast(n ? (k === 'wc' ? 'Sociální zařízení' : 'Výtahy') + ' na tomto patře svítí. Ťukni znovu pro vypnutí.' : 'Na tomto patře nic takového v datech není.'); }
    } else if (k === 'drive') {
      if (st.route) APP.startDrive();
      else { st.driveAfter = true; st.picking = 'to'; if (!st.from) st.from = { ent: 0 }; renderSheet(); openPicker(); toast('🚗 Kam pojedeme? Vyber cíl.'); }
    }
  });
  $('#clear').addEventListener('click', () => { if (!q.value) closeResults(); });

  /* ---------- GPS poloha ---------- */
  const gps = { on: false, pos: null, watch: null, pending: null, told: false };
  const locBtn = $('#locate');
  function gpsStart(cb) {
    if (!navigator.geolocation) { toast('Tenhle prohlížeč polohu neumí.'); return; }
    if (cb) gps.pending = cb;
    if (gps.on) { if (gps.pos && gps.pending) { const f = gps.pending; gps.pending = null; f(gps.pos); } return; }
    gps.on = true; locBtn.classList.add('wait');
    gps.watch = navigator.geolocation.watchPosition(p => {
      const w = N.wgsToLocal(p.coords.latitude, p.coords.longitude), first = !gps.pos;
      gps.pos = { x: w.x, y: w.y, acc: p.coords.accuracy || 30, head: p.coords.heading != null && !isNaN(p.coords.heading) && p.coords.speed > 0.4 ? p.coords.heading : null, t: performance.now() };
      locBtn.classList.remove('wait'); locBtn.classList.add('on'); dirty = true;
      const far = Math.hypot(w.x, w.y);
      if (first) {
        if (far > 350) toast(`Jsi asi ${far > 1500 ? (far / 1000).toFixed(1) + ' km' : Math.round(far / 10) * 10 + ' m'} od budov A a B – na mapě tě neuvidíš.`, 4500);
        else { if (!gps.pending) gpsCenter(); toast(`Poloha nalezena (±${Math.round(gps.pos.acc)} m). GPS nepozná patro a uvnitř budovy bývá nepřesná.`, 4500); }
      }
      if (gps.pending) { const f = gps.pending; gps.pending = null; f(gps.pos); }
    }, e => {
      if (e.code !== 1 && gps.pos) return; // přechodný výpadek signálu: sledování běží dál
      gpsStop(); toast(e.code === 1 ? 'Přístup k poloze je zakázaný. Povol ho v nastavení prohlížeče.' : location.protocol !== 'https:' && location.hostname !== 'localhost' ? 'Poloha funguje jen přes HTTPS.' : 'Polohu se nepodařilo zjistit.', 4500);
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function gpsStop() { if (gps.watch != null) navigator.geolocation.clearWatch(gps.watch); gps.on = false; gps.pos = null; gps.watch = null; gps.pending = null; locBtn.classList.remove('on', 'wait'); dirty = true; }
  function gpsCenter() { animTo({ x: gps.pos.x, y: gps.pos.y, s: Math.max(view.s, 7) }, 450); }
  locBtn.onclick = () => {
    if (!gps.on) { gpsStart(); return; }
    if (!gps.pos) return;
    const p = toScreen(gps.pos.x, gps.pos.y);
    if (Math.hypot(p.x - W / 2, p.y - H / 2) < 30) { gpsStop(); toast('Sledování polohy vypnuto.', 1500); } else gpsCenter();
  };
  // start trasy z aktuální polohy (patro = to, které je právě zobrazené)
  function fromGps() {
    toast('Zjišťuji polohu…', 1500);
    gpsStart(pos => {
      const r = N.nearestRoom(pos.x, pos.y, st.floor, 45);
      if (!r) { toast('Podle GPS nejsi v budově A ani B (nebo je poloha moc nepřesná). Vyber start ručně.', 4500); return; }
      toast(`Start: ${r.title}, ${N.floorName(r.fl)}. Jsi na jiném patře? Přepni ho a zvol polohu znovu.`, 4500);
      choose({ room: r.i });
    });
  }

  /* ---------- drobnosti ---------- */
  let toastT = 0;
  function toast(t, ms) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, ms || 3200); }
  function confetti(chars, n) {
    const fx = $('#fx');
    for (let i = 0; i < (n || 36); i++) {
      const s = document.createElement('span'); s.textContent = chars[i % chars.length];
      s.style.left = Math.random() * 100 + 'vw'; s.style.fontSize = 16 + Math.random() * 26 + 'px'; s.style.animationDuration = 2.2 + Math.random() * 2.6 + 's'; s.style.animationDelay = Math.random() * 0.9 + 's';
      s.style.font = (chars[i % chars.length].length === 1 ? 'italic 700 ' : '') + s.style.fontSize + ' Georgia,serif'; s.style.color = ['#fab005', '#12b3d6', '#3b5bdb', '#e64980', '#2f9e44'][i % 5];
      fx.appendChild(s); setTimeout(() => s.remove(), 6500);
    }
  }
  /* --- easter egg: kancelář Piotra Slawiczka --- */
  const PSI = ['ψ', 'ħ', '⟨ψ|', 'Ĥ', '🐈', '|ψ⟩', 'hν', '⚛️', 'e⁻'];
  let eggSeen = false;
  function eggHello() { if (!eggSeen) { eggSeen = true; confetti(PSI, 44); toast('⚛️ Objevil jsi kvantovou kancelář!', 2600); } }
  function eggCard() {
    return `<div class="psi"><h3>⚛️ Kancelář: Piotr Slawiczek</h3>
      <p>Teoretická fotodynamika, Ústav fyzikální chemie. Poloha profesora je popsána vlnovou funkcí – dokud neotevřeš dveře, je současně v kanceláři, na přednášce i na konferenci.</p>
      <button data-act="psi">Zkolabovat vlnovou funkci</button><div class="out" id="psi-out"></div></div>`;
  }
  const OUT = ['✅ Naměřeno: je v kanceláři. Měření bohužel ovlivnilo jeho náladu.', '✈️ Naměřeno: konference. Pravděpodobnost návratu roste s časem.', '🎓 Naměřeno: přednáší. Excitovaný stav potrvá 90 minut.',
    '☕ Tuneloval skrz zeď do kuchyňky. Bariéra byla tenká.', '🐈 V kanceláři je jen kočka. Je živá. I mrtvá.', '📝 Opravuje písemky. Tvoje vlnová funkce právě zkolabovala na „F“… ne, dělám si legraci.',
    '💻 Počítá. Výpočet doběhne za 3 dny, na jeho vlastním clusteru.', '❓ Znáš přesně jeho hybnost, takže poloha je neurčitá. Zkus to znovu.'];
  function eggCollapse() { const o = $('#psi-out'); if (!o) return; o.textContent = '… měřím …'; confetti(PSI, 18); setTimeout(() => { const el = $('#psi-out'); if (el) el.textContent = OUT[Math.floor(Math.random() * OUT.length)]; }, 650); }

  $('#info').onclick = () => {
    let d = $('#about');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'about'; const P = pal();
      d.innerHTML = `<h3>Mapa VŠCHT – budovy A a B</h3><p>Neoficiální studentská mapa s navigací. Ťukni na místnost, nebo ji najdi hledáním. Dvěma prsty mapu otáčíš a zoomuješ.</p>
        <div class="legend">${[[1, 'Učebny, posluchárny'], [2, 'Kanceláře'], [3, 'Laboratoře'], [5, 'Sociální zařízení'], [4, 'Technické, sklady'], [6, 'Zázemí'], [7, 'Chodby, schodiště'], [8, 'Ostatní']].map(([t, n]) => `<span><i style="background:${P.t[t]}"></i>${n}</span>`).join('')}</div>
        <p>Typy místností jsou odhadnuté z dat a nemusí sedět. Část místností nemá v podkladech dveře – trasa k nim vede k nejbližší stěně u chodby. Časy počítají s chůzí 4,5 km/h.</p>
        <p>🚗 <b>Driver mode</b> je parodie. Po chodbách prosím nejezděte autem.</p><div class="btns"><button class="btn pri" id="about-ok">Rozumím</button></div>`;
      document.body.appendChild(d); d.querySelector('#about-ok').onclick = () => d.close();
      d.addEventListener('click', e => { if (e.target === d) d.close(); });
    }
    d.showModal();
  };

  /* ---------- start ---------- */
  window.APP = { gps, N, st, view, pal, overlays, tickers, requestDraw, toScreen, toWorld, setFloor, toast, confetti, isEgg, epLabel, epRoom, PSI, EGG, renderSheet, showLeg, fitAll, resize, get W() { return W; }, get H() { return H; } };
  window.addEventListener('resize', () => { resize(); });
  mqDark.addEventListener('change', requestDraw);
  resize(); fitAll(true); updFloors(); updCompass();
  requestAnimationFrame(frame);
  if (location.hash.length > 1) { const r = N.search(decodeURIComponent(location.hash.slice(1)), 1)[0]; if (r) setTimeout(() => choose({ room: r.i }), 200); }
})();
