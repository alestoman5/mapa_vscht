/* Mapa VŠCHT – model dat a hledání trasy (běží v prohlížeči i v Node). */
(function (root) {
  'use strict';
  const RAW = root.VSCHT_DATA;
  const FLOORS = [-2, -1, 0, 1, 2, 3, 4];
  const TYPE = {
    0: 'Ostatní', 1: 'Učebna / posluchárna', 2: 'Kancelář', 3: 'Laboratoř', 4: 'Technická místnost / sklad',
    5: 'Sociální zařízení', 6: 'Zázemí', 7: 'Chodba / schodiště', 8: 'Místnost', 9: 'Místnost'
  };

  function ringFromFlat(f) {
    const pts = [];
    for (let i = 0; i < f.length; i += 2) pts.push({ x: f[i] / 100, y: f[i + 1] / 100 });
    return pts;
  }
  function floorName(fl) {
    return fl === 0 ? 'přízemí' : fl < 0 ? Math.abs(fl) + '. suterén' : fl + '. patro';
  }
  function floorShort(fl) { return fl === 0 ? '0' : fl < 0 ? 'S' + Math.abs(fl) : String(fl); }

  const rooms = RAW.rooms.map((a, i) => {
    const r = {
      i, fl: a[0], name: a[1], alias: a[2], type: a[3], b: a[4], lx: a[5] / 100, ly: a[6] / 100, ir: a[7] / 100,
      reach: !!a[8], vk: a[9], rings: a[10].map(ringFromFlat), area: a[11], doors: []
    };
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of r.rings[0]) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    r.bb = [x0, y0, x1, y1];
    const lift = /^[A-Z]\d[PN]-/.test(r.name);
    r.lift = lift;
    r.stairs = !!r.vk && !lift;
    // zobrazované označení: A136, B11 ...
    r.code = /^\d/.test(r.name) ? r.b + r.name : r.name;
    r.title = lift ? 'Výtah ' + r.name.slice(0, 3) : r.stairs && r.type === 7 ? 'Schodiště' : (r.type === 7 ? 'Chodba ' : '') + r.code;
    return r;
  });

  const doors = RAW.doors.map((a, id) => {
    const d = {
      id, fl: a[0], kind: a[1], x: a[2] / 100, y: a[3] / 100,
      sides: [{ r: a[4], x: a[5] / 100, y: a[6] / 100 }]
    };
    if (a[7] >= 0) d.sides.push({ r: a[7], x: a[8] / 100, y: a[9] / 100 });
    if (a.length > 10) d.ax = [{ x: a[10] / 100, y: a[11] / 100 }, { x: a[12] / 100, y: a[13] / 100 }];
    for (const s of d.sides) rooms[s.r].doors.push(d);
    return d;
  });

  // svislé vazby (schodiště, výtahy)
  const vgroups = {};
  for (const r of rooms) if (r.vk) (vgroups[r.vk] = vgroups[r.vk] || []).push(r);

  /* ---------- geometrie ---------- */
  function orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
  function inRing(p, R) {
    let c = false;
    for (let i = 0, j = R.length - 1; i < R.length; j = i++) {
      const a = R[i], b = R[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  }
  function inRoom(p, r) {
    if (p.x < r.bb[0] || p.x > r.bb[2] || p.y < r.bb[1] || p.y > r.bb[3]) return false;
    if (!inRing(p, r.rings[0])) return false;
    for (let k = 1; k < r.rings.length; k++) if (inRing(p, r.rings[k])) return false;
    return true;
  }
  function roomAt(x, y, fl) {
    let best = null;
    for (const r of rooms) if (r.fl === fl && inRoom({ x, y }, r) && (!best || r.area < best.area)) best = r;
    return best;
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /* ---------- graf uvnitř místnosti (lazy) ---------- */
  function roomGraph(r) {
    if (r.g) return r.g;
    const pts = [], edges = [];
    for (let k = 0; k < r.rings.length; k++) {
      const R = r.rings[k], n = R.length;
      let area = 0;
      for (let i = 0; i < n; i++) { const a = R[i], b = R[(i + 1) % n]; area += a.x * b.y - b.x * a.y; edges.push(a.x, a.y, b.x, b.y); }
      const sgn = (area > 0 ? 1 : -1) * (k === 0 ? 1 : -1);
      for (let i = 0; i < n; i++) {
        const p = R[(i + n - 1) % n], v = R[i], q = R[(i + 1) % n];
        const cr = orient(p, v, q), l1 = dist(p, v), l2 = dist(v, q);
        if (l1 < 1e-6 || l2 < 1e-6) continue;
        const reflex = k === 0 ? cr * sgn < 0 : cr * sgn < 0;
        if (!reflex || Math.abs(cr) / (l1 * l2) < 0.06) continue;
        let dx = (v.x - p.x) / l1 + (v.x - q.x) / l2, dy = (v.y - p.y) / l1 + (v.y - q.y) / l2;
        const l = Math.hypot(dx, dy); if (l < 1e-6) continue; dx /= l; dy /= l;
        for (const t of [0.35, 0.18, 0.06]) {
          const c = { x: v.x + dx * t, y: v.y + dy * t };
          if (inRoom(c, r)) { pts.push(c); break; }
        }
      }
    }
    const g = { pts, edges: new Float64Array(edges), nReflex: pts.length, term: new Map(), adj: [], sp: new Map(), convex: pts.length === 0 && r.rings.length === 1 };
    for (const d of r.doors) {
      const s = d.sides[0].r === r.i ? d.sides[0] : d.sides[1];
      g.term.set(d.id, pts.length); pts.push({ x: s.x, y: s.y });
    }
    g.lp = pts.length; pts.push({ x: r.lx, y: r.ly });
    r.g = g; return g;
  }
  function visible(r, g, a, b) {
    if (g.convex) return true;
    const E = g.edges, ax = a.x, ay = a.y, bx = b.x, by = b.y;
    const dx = bx - ax, dy = by - ay;
    for (let i = 0; i < E.length; i += 4) {
      const cx = E[i], cy = E[i + 1], ex = E[i + 2], ey = E[i + 3];
      const o1 = dx * (cy - ay) - dy * (cx - ax), o2 = dx * (ey - ay) - dy * (ex - ax);
      if ((o1 > 0) === (o2 > 0)) continue;
      const fx = ex - cx, fy = ey - cy;
      const o3 = fx * (ay - cy) - fy * (ax - cx), o4 = fx * (by - cy) - fy * (bx - cx);
      if ((o3 > 0) !== (o4 > 0)) return false;
    }
    return inRoom({ x: (ax + bx) / 2, y: (ay + by) / 2 }, r);
  }
  function adjOf(r, g, i) {
    let a = g.adj[i];
    if (a) return a;
    a = [];
    const p = g.pts[i];
    for (let j = 0; j < g.pts.length; j++) if (j !== i && visible(r, g, p, g.pts[j])) a.push(j);
    g.adj[i] = a; return a;
  }
  // nejkratší cesty uvnitř místnosti ze zdroje s
  function roomSP(r, s) {
    const g = roomGraph(r);
    let sp = g.sp.get(s);
    if (sp) return sp;
    const n = g.pts.length, d = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    d[s] = 0;
    for (; ;) {
      let u = -1, bd = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && d[i] < bd) { bd = d[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      // z terminálů (dveří) se dál nepokračuje, pokud nejsou zdrojem – stačí přes reflexní body
      if (u !== s && u >= g.nReflex) continue;
      const pu = g.pts[u];
      for (const v of adjOf(r, g, u)) {
        if (done[v]) continue;
        const nd = bd + dist(pu, g.pts[v]);
        if (nd < d[v]) { d[v] = nd; prev[v] = u; }
      }
    }
    // nedosažitelné body (nepřesná geometrie) – nouzově přímo
    for (let i = 0; i < n; i++) if (d[i] === Infinity) { d[i] = dist(g.pts[s], g.pts[i]) * 1.5 + 2; prev[i] = s; }
    sp = { d, prev }; g.sp.set(s, sp); return sp;
  }
  function roomPath(r, s, t) {
    const g = roomGraph(r), sp = roomSP(r, s), out = [];
    for (let u = t, guard = 0; u !== -1 && guard < 5000; u = sp.prev[u], guard++) { out.push(g.pts[u]); if (u === s) break; }
    return out.reverse();
  }

  /* ---------- binární halda ---------- */
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (k, v) {
    const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  };
  Heap.prototype.pop = function () {
    const K = this.k, V = this.v, top = [K[0], V[0]], k = K.pop(), v = V.pop(), n = K.length;
    if (n) {
      let i = 0;
      for (; ;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= k) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = k; V[i] = v;
    }
    return top;
  };

  /* ---------- hledání trasy ----------
     uzly: dveře (0..ND-1), střed místnosti (ND + index místnosti)
     from/to: {room: index} nebo {door: id} */
  const ND = doors.length;
  const STAIR_COST = 16, LIFT_BASE = 30, LIFT_PER = 4, THROUGH = 30;
  function route(from, to, opts) {
    opts = opts || {};
    const noStairs = !!opts.noStairs;
    const src = from.door != null ? from.door : ND + from.room;
    const dst = to.door != null ? to.door : ND + to.room;
    const srcRoom = from.door != null ? -1 : from.room, dstRoom = to.door != null ? -1 : to.room;
    if (src === dst) return null;
    const N = ND + rooms.length;
    const D = new Float64Array(N).fill(Infinity), P = new Int32Array(N).fill(-1), PR = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const h = new Heap(); D[src] = 0; h.push(0, src);
    const relax = (u, v, w, viaRoom) => { const nd = D[u] + w; if (nd < D[v]) { D[v] = nd; P[v] = u; PR[v] = viaRoom; h.push(nd, v); } };
    while (h.k.length) {
      const [du, u] = h.pop();
      if (done[u]) continue; done[u] = 1;
      if (u === dst) break;
      if (u < ND) {
        const d = doors[u];
        for (const s of d.sides) {
          const r = rooms[s.r]; if (!r.reach) continue;
          const g = roomGraph(r), sp = roomSP(r, g.term.get(u));
          const pen = (r.type !== 7 && !r.vk && r.i !== srcRoom && r.i !== dstRoom) ? THROUGH : 0;
          for (const e of r.doors) {
            if (e.id === u || done[e.id]) continue;
            relax(u, e.id, sp.d[g.term.get(e.id)] + 0.8 + (e.kind === 2 ? 4 : 0) + pen, r.i);
          }
          if (r.vk || r.i === dstRoom) relax(u, ND + r.i, sp.d[g.lp], r.i);
        }
      } else {
        const r = rooms[u - ND], g = roomGraph(r), sp = roomSP(r, g.lp);
        for (const e of r.doors) if (!done[e.id]) relax(u, e.id, sp.d[g.term.get(e.id)] + 0.8 + (e.kind === 2 ? 4 : 0), r.i);
        if (r.vk && !(noStairs && !r.lift)) {
          const grp = vgroups[r.vk];
          const fls = [...new Set(grp.map(x => x.fl))].sort((a, b) => a - b), k = fls.indexOf(r.fl);
          for (const o of grp) {
            if (o === r) continue;
            if (r.lift) relax(u, ND + o.i, LIFT_BASE + LIFT_PER * Math.abs(o.fl - r.fl), -2);
            else if (o.fl === r.fl) relax(u, ND + o.i, dist({ x: r.lx, y: r.ly }, { x: o.lx, y: o.ly }), -2);
            else if (o.fl === fls[k - 1] || o.fl === fls[k + 1]) relax(u, ND + o.i, STAIR_COST * Math.abs(o.fl - r.fl), -2);
          }
        }
      }
    }
    if (D[dst] === Infinity) return null;
    // rekonstrukce
    const seq = []; for (let u = dst; u !== -1; u = P[u]) seq.push(u); seq.reverse();
    const nodePt = u => u < ND ? { x: doors[u].x, y: doors[u].y, fl: doors[u].fl } : { x: rooms[u - ND].lx, y: rooms[u - ND].ly, fl: rooms[u - ND].fl };
    const legs = []; let cur = null;
    const add = (p, fl) => {
      if (!cur || cur.fl !== fl) { cur = { fl, pts: [], len: 0 }; legs.push(cur); }
      const q = cur.pts[cur.pts.length - 1];
      if (q && Math.hypot(q.x - p.x, q.y - p.y) < 0.02) return;
      if (q) cur.len += Math.hypot(q.x - p.x, q.y - p.y);
      cur.pts.push({ x: p.x, y: p.y });
    };
    const trans = [];
    add(nodePt(seq[0]), nodePt(seq[0]).fl);
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], b = seq[i], via = PR[b];
      if (via === -2) {
        const ra = rooms[a - ND], rb = rooms[b - ND];
        if (ra.fl !== rb.fl) { cur.endsWith = { kind: ra.lift ? 'lift' : 'stairs', from: ra.fl, to: rb.fl, name: ra.lift ? ra.name.slice(0, 3) : '' }; trans.push(cur.endsWith); }
        add(nodePt(b), rb.fl); continue;
      }
      const r = rooms[via], g = roomGraph(r);
      const s = a < ND ? g.term.get(a) : g.lp, t = b < ND ? g.term.get(b) : g.lp;
      for (const p of roomPath(r, s, t)) add(p, r.fl);
      add(nodePt(b), r.fl);
    }
    // sloučit po sobě jdoucí přestupy (schody přes více pater)
    const merged = [];
    for (const l of legs) {
      const m = merged[merged.length - 1];
      if (m && l.pts.length <= 1 && l.endsWith && m.endsWith && m.endsWith.kind === l.endsWith.kind) { m.endsWith.to = l.endsWith.to; continue; }
      merged.push(l);
    }
    let length = 0; for (const l of merged) length += l.len;
    const floorsMoved = merged.reduce((s, l) => s + (l.endsWith ? Math.abs(l.endsWith.to - l.endsWith.from) : 0), 0);
    const lifts = merged.filter(l => l.endsWith && l.endsWith.kind === 'lift').length;
    return { legs: merged, length, time: length / 1.25 + floorsMoved * 14 + lifts * 25, cost: D[dst] };
  }

  /* ---------- manévry (odbočky) na úseku ---------- */
  function simplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let m = -1, md = eps;
      const A = pts[a], B = pts[b], L = Math.hypot(B.x - A.x, B.y - A.y) || 1e-9;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((B.x - A.x) * (pts[i].y - A.y) - (B.y - A.y) * (pts[i].x - A.x)) / L; if (d > md) { md = d; m = i; } }
      if (m > 0) { keep[m] = 1; st.push([a, m], [m, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function maneuvers(leg) {
    const p = simplify(leg.pts, 0.7), out = []; let acc = 0, pos = 0;
    for (let i = 1; i < p.length - 1; i++) {
      const l = Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); acc += l; pos += l;
      const a1 = Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x), a2 = Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x);
      let da = (a2 - a1) * 180 / Math.PI; while (da > 180) da -= 360; while (da < -180) da += 360;
      if (Math.abs(da) < 28) continue;
      // y roste dolů => kladný úhel = doprava
      out.push({ at: pos, after: acc, dir: da > 0 ? 'R' : 'L', sharp: Math.abs(da) > 110, slight: Math.abs(da) < 50, x: p[i].x, y: p[i].y });
      acc = 0;
    }
    return out;
  }

  /* ---------- hledání místností ---------- */
  function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s.\-_]/g, ''); }
  for (const r of rooms) {
    r.keys = [norm(r.code), norm(r.name)];
    if (r.alias) r.keys.push(norm(r.alias));
  }
  function search(q, limit) {
    const n = norm(q); if (!n) return [];
    const res = [];
    for (const r of rooms) {
      if (r.type === 7 && !r.vk) continue;
      let sc = 0;
      for (const k of r.keys) {
        if (k === n) sc = Math.max(sc, 100); else if (k.startsWith(n)) sc = Math.max(sc, 60 - (k.length - n.length)); else if (n.length > 1 && k.includes(n)) sc = Math.max(sc, 20);
      }
      if (sc) { if (r.alias && norm(r.alias) === n) sc += 5; if (r.type === 1) sc += 3; if (!r.reach) sc -= 2; res.push([sc, r]); }
    }
    res.sort((a, b) => b[0] - a[0] || a[1].code.length - b[1].code.length || a[1].code.localeCompare(b[1].code));
    return res.slice(0, limit || 30).map(x => x[1]);
  }

  // hlavní vchody: nejbližší venkovní dveře k hlavnímu schodišti
  const entrances = [];
  for (const [vk, label] of [['S:HlavniA', 'Hlavní vchod A (Technická 5)'], ['S:HlavniB', 'Hlavní vchod B (Technická 3)']]) {
    const hall = (vgroups[vk] || []).find(r => r.fl === 0); if (!hall) continue;
    let best = null, bd = 60;
    for (const d of doors) if (d.kind === 3 && d.fl === 0) { const dd = dist(d, { x: hall.lx, y: hall.ly }); if (dd < bd) { bd = dd; best = d; } }
    entrances.push({ label, b: vk.slice(-1), door: best ? best.id : null, room: hall.i, x: best ? best.x : hall.lx, y: best ? best.y : hall.ly });
  }

  const api = { FLOORS, TYPE, rooms, doors, vgroups, route, maneuvers, simplify, search, norm, roomAt, inRoom, floorName, floorShort, entrances, dist };
  root.NAV = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
