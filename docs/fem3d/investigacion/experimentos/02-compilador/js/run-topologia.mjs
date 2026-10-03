// E3: topología en planta.
//  (a) Predicados: un punto calculado sobre una viga oblicua (p = a + t·(b−a)) casi
//      nunca está EXACTAMENTE sobre la recta en coma flotante. orient2d exacto lo
//      dice con signo; el producto vectorial ingenuo da ruido. Ninguno de los dos
//      expresa la INTENCIÓN (está sobre la viga) -> hace falta snapping con tolerancia.
//  (b) Detección de cruces viga-viga en una planta realista: fuerza bruta O(n²) vs
//      rejilla hash, mismo resultado, tiempos.
import { orient2d } from 'robust-predicates';
import { performance } from 'node:perf_hooks';

const out = {};

// (a) ───────────────────────────────────────────────────────────────────────
{
  const a = [0.1, 0.2], b = [6.37, 9.13];
  let exactCero = 0, ingenuoCero = 0, discrepanSigno = 0, dmax = 0;
  const N = 1000;
  for (let k = 1; k < N; k++) {
    const t = k / N;
    const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const naive = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const exact = orient2d(a[0], a[1], b[0], b[1], p[0], p[1]);
    if (exact === 0) exactCero++;
    if (naive === 0) ingenuoCero++;
    if (Math.sign(naive) !== Math.sign(-exact) && Math.sign(naive) !== Math.sign(exact)) discrepanSigno++;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    dmax = Math.max(dmax, Math.abs(naive) / L);
  }
  out.predicados = {
    puntos: N - 1, exactamenteColinealesSegunOrient2dExacto: exactCero, colinealesSegunIngenuo: ingenuoCero,
    distanciaMaximaAlEje_m: dmax, nota: 'orient2d de robust-predicates devuelve ccw>0 con signo opuesto al producto vectorial (convención)',
  };
}

// (b) ───────────────────────────────────────────────────────────────────────
function planta(nx, ny, sx = 5.0, sy = 4.5, ruido = 0) {
  // retícula de vigas en X y en Y, con pequeñas desalineaciones (ruido en m)
  const segs = [];
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * ruido;
  for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) segs.push([[i * sx, j * sy + rnd()], [(i + 1) * sx, j * sy + rnd()]]);
  for (let i = 0; i <= nx; i++) for (let j = 0; j < ny; j++) segs.push([[i * sx + rnd(), j * sy], [i * sx + rnd(), (j + 1) * sy]]);
  return segs;
}
const EPS_SNAP = 0.05; // m, tolerancia de modelado (no la 1e-6 de coincidencia numérica)
function dPS(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
}
function cruza(s1, s2) {
  const [a, b] = s1, [c, d] = s2;
  // descarte por caja ampliada EPS_SNAP
  if (Math.max(a[0], b[0]) + EPS_SNAP < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) + EPS_SNAP < Math.min(a[0], b[0]) ||
      Math.max(a[1], b[1]) + EPS_SNAP < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) + EPS_SNAP < Math.min(a[1], b[1])) return null;
  const o1 = orient2d(a[0], a[1], b[0], b[1], c[0], c[1]);
  const o2 = orient2d(a[0], a[1], b[0], b[1], d[0], d[1]);
  const o3 = orient2d(c[0], c[1], d[0], d[1], a[0], a[1]);
  const o4 = orient2d(c[0], c[1], d[0], d[1], b[0], b[1]);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 'cruza';
  const dmin = Math.min(dPS(a, c, d), dPS(b, c, d), dPS(c, a, b), dPS(d, a, b));
  if (dmin === 0) return 'toca';
  if (dmin <= EPS_SNAP) return 'casi';
  return null;
}
function bruta(segs) {
  const r = [];
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) { const c = cruza(segs[i], segs[j]); if (c) r.push(`${i}-${j}-${c}`); }
  return r;
}
function rejilla(segs, cell) {
  const g = new Map();
  segs.forEach((s, i) => {
    const x0 = Math.floor((Math.min(s[0][0], s[1][0]) - EPS_SNAP) / cell), x1 = Math.floor((Math.max(s[0][0], s[1][0]) + EPS_SNAP) / cell);
    const y0 = Math.floor((Math.min(s[0][1], s[1][1]) - EPS_SNAP) / cell), y1 = Math.floor((Math.max(s[0][1], s[1][1]) + EPS_SNAP) / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = `${x},${y}`; if (!g.has(k)) g.set(k, []); g.get(k).push(i); }
  });
  const vistos = new Set(), r = [];
  for (const lista of g.values()) for (let p = 0; p < lista.length; p++) for (let q = p + 1; q < lista.length; q++) {
    const i = Math.min(lista[p], lista[q]), j = Math.max(lista[p], lista[q]);
    const k = `${i}-${j}`; if (vistos.has(k)) continue; vistos.add(k);
    const c = cruza(segs[i], segs[j]); if (c) r.push(`${i}-${j}-${c}`);
  }
  return r.sort();
}
out.cruces = {};
for (const [nx, ny, ruido] of [[10, 8, 0], [10, 8, 0.02], [40, 30, 0.02]]) {
  const segs = planta(nx, ny, 5.0, 4.5, ruido);
  let t = performance.now(); const rb = bruta(segs).sort(); const tb = performance.now() - t;
  t = performance.now(); const rg = rejilla(segs, 5.0); const tg = performance.now() - t;
  const cnt = (k) => rb.filter((x) => x.endsWith(k)).length;
  out.cruces[`${nx}x${ny} vanos, ruido ${ruido} m`] = {
    vigas: segs.length, paresBruta: segs.length * (segs.length - 1) / 2, cruzan: cnt('cruza'), tocanExacto: cnt('toca'), casiSinTocar_le5cm: cnt('casi'),
    ms_bruta: +tb.toFixed(1), ms_rejilla: +tg.toFixed(1), mismoResultado: JSON.stringify(rb) === JSON.stringify(rg),
  };
}
console.log(JSON.stringify(out, null, 2));
