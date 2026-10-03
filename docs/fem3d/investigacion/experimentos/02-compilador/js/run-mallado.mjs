// Experimento E2: triangulación con restricciones de una losa con hueco, viga
// embebida y pilares como puntos obligatorios. Bibliotecas de licencia permisiva.
// Uso: node run-mallado.mjs > salida-mallado.json
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import Delaunator from 'delaunator';
import Constrainautor from '@kninnug/constrainautor';
import earcut from 'earcut';
import { CDT } from 'cdt-js';
import {
  caso, pslg, steiner, keepTri, triMetrics, preserva, huella, huellaCruda, barajar,
  triAQuads, quadMetrics, rejilla,
} from './geom.mjs';

const require = createRequire(import.meta.url);
const cdt2d = require('cdt2d');
const p2t = require('poly2tri');

const N_RUNS = 20;
const mediana = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(3); };

function entrada(variante, orden = null) {
  const c = caso(variante);
  const P = pslg(c);
  const S = steiner(c, P);
  let pts = [...P.pts, ...S];
  let edges = P.segs.map((s) => [s.i, s.j]);
  if (orden) {
    const perm = barajar(pts.length, orden); // perm[k] = índice viejo en la posición k
    const inv = new Array(pts.length);
    perm.forEach((old, k) => { inv[old] = k; });
    pts = perm.map((old) => pts[old]);
    edges = edges.map(([a, b]) => [inv[a], inv[b]]);
  }
  return { c, P, S, pts, edges };
}

// ── adaptadores por biblioteca: devuelven { pts, tris } ya filtrados ─────────
const libs = {
  'cdt2d (exterior:false)': ({ pts, edges }) => ({ pts, tris: cdt2d(pts, edges, { exterior: false }) }),
  'cdt2d + clasificación propia': ({ c, pts, edges }) => ({ pts, tris: cdt2d(pts, edges, { exterior: true }).filter((t) => keepTri(c, pts, t)) }),
  'cdt-js (eraseOuterTrianglesAndHoles)': ({ pts, edges }) => {
    const T = new CDT.Triangulation();
    T.insertVertices(pts.map(([x, y]) => ({ x, y })));
    T.insertEdges(edges.map(([from, to]) => ({ from, to })));
    T.eraseOuterTrianglesAndHoles();
    const V = T.getVertices().map((p) => [p.x, p.y]);
    const tris = T.getTriangles().map((t) => [...t.vertices]);
    T.delete?.();
    return { pts: V, tris };
  },
  'cdt-js + clasificación propia': ({ c, pts, edges }) => {
    const T = new CDT.Triangulation();
    T.insertVertices(pts.map(([x, y]) => ({ x, y })));
    T.insertEdges(edges.map(([from, to]) => ({ from, to })));
    T.eraseSuperTriangle();
    const V = T.getVertices().map((p) => [p.x, p.y]);
    const tris = T.getTriangles().map((t) => [...t.vertices]).filter((t) => keepTri(c, V, t));
    T.delete?.();
    return { pts: V, tris };
  },
  'delaunator + constrainautor': ({ c, pts, edges }) => {
    const del = Delaunator.from(pts);
    const con = new Constrainautor(del);
    con.constrainAll(edges);
    const tris = [];
    for (let i = 0; i < del.triangles.length; i += 3) tris.push([del.triangles[i], del.triangles[i + 1], del.triangles[i + 2]]);
    return { pts, tris: tris.filter((t) => keepTri(c, pts, t)) };
  },
  'poly2tri (viga como Steiner)': ({ c, P, S }) => {
    // contorno y hueco: puntos del PSLG en orden de recorrido; viga y pilares como Steiner
    const loopPts = (tag) => {
      const segs = P.segs.filter((s) => s.tag === tag);
      return segs.map((s) => P.pts[s.i]);
    };
    const mk = (p) => new p2t.Point(p[0], p[1]);
    const contour = loopPts('borde').map(mk);
    const hole = loopPts('hueco').map(mk);
    const enBorde = new Set([...contour, ...hole].map((p) => `${p.x},${p.y}`));
    const st = [];
    const vistos = new Set();
    for (const s of P.segs.filter((s) => s.tag === 'viga')) for (const i of [s.i, s.j]) {
      const k = `${P.pts[i][0]},${P.pts[i][1]}`;
      if (!enBorde.has(k) && !vistos.has(k)) { vistos.add(k); st.push(mk(P.pts[i])); }
    }
    for (const i of P.colIdx) {
      const k = `${P.pts[i][0]},${P.pts[i][1]}`;
      if (!enBorde.has(k) && !vistos.has(k)) { vistos.add(k); st.push(mk(P.pts[i])); }
    }
    for (const p of S) st.push(mk(p));
    const ctx = new p2t.SweepContext(contour);
    ctx.addHole(hole);
    ctx.addPoints(st);
    ctx.triangulate();
    const V = [], idx = new Map();
    const id = (p) => { const k = `${p.x},${p.y}`; if (!idx.has(k)) { idx.set(k, V.length); V.push([p.x, p.y]); } return idx.get(k); };
    const tris = ctx.getTriangles().map((t) => [id(t.getPoint(0)), id(t.getPoint(1)), id(t.getPoint(2))]);
    return { pts: V, tris };
  },
  'earcut (sin Steiner ni líneas internas)': ({ c }) => {
    const flat = [...c.boundary.flat(), ...c.hole.flat()];
    const t = earcut(flat, [c.boundary.length]);
    const pts = [...c.boundary, ...c.hole];
    const tris = [];
    for (let i = 0; i < t.length; i += 3) tris.push([t[i], t[i + 1], t[i + 2]]);
    return { pts, tris };
  },
};

const out = { nodo: process.version, variantes: {} };
for (const variante of (process.argv[2] ? process.argv[2].split(',') : ['A', 'B', 'C', 'S'])) {
  const base = entrada(variante);
  const res = { entrada: { ptsPSLG: base.P.pts.length, segPSLG: base.P.segs.length, steiner: base.S.length, areaEsperada: 12 * 9 - 2.0 * 2.5 } };
  for (const [nombre, fn] of Object.entries(libs)) {
    const r = {};
    try {
      const t0 = performance.now();
      const m1 = fn(entrada(variante));
      const t1 = performance.now();
      const m2 = fn(entrada(variante));
      const times = [t1 - t0];
      for (let k = 0; k < N_RUNS; k++) { const a = performance.now(); fn(base); times.push(performance.now() - a); }
      r.ms_mediana = mediana(times);
      Object.assign(r, triMetrics(m1.pts, m1.tris));
      Object.assign(r, preserva(base.P, m1.pts, m1.tris));
      r.mismaSalidaDosVeces = huellaCruda(m1.pts, m1.tris) === huellaCruda(m2.pts, m2.tris);
      const h0 = huella(m1.pts, m1.tris);
      const hs = [101, 202, 303].map((seed) => { try { const m = fn(entrada(variante, seed)); return huella(m.pts, m.tris); } catch (e) { return 'ERR:' + e.message; } });
      r.mismaGeometriaConEntradaBarajada = hs.map((h) => h === h0);
      r.huella = h0;
    } catch (e) {
      r.error = String(e.message || e).slice(0, 200);
    }
    res[nombre] = r;
  }
  // tri -> quad sobre la salida de delaunator+constrainautor
  try {
    const m = libs['delaunator + constrainautor'](entrada(variante));
    const q = triAQuads(m.pts, m.tris);
    res['tri->3 quads (sobre constrainautor)'] = quadMetrics(q.pts, q.quads);
  } catch (e) { res['tri->3 quads'] = { error: e.message }; }
  // malla estructurada por líneas de control
  const g = rejilla(base.c);
  res['rejilla estructurada (líneas de control)'] = { ...quadMetrics(g.pts, g.quads), franjaMinX_m: +g.minDx.toFixed(4), franjaMinY_m: +g.minDy.toFixed(4) };
  out.variantes[variante] = res;
}
console.log(JSON.stringify(out, null, 2));
