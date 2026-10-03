// Geometría de ensayo y utilidades comunes (PSLG, métricas, huellas).
// Losa 12 x 9 m, hueco 2,0 x 2,5 m, viga embebida en x = 4,0 de borde a borde,
// 4 pilares como puntos obligatorios (uno sobre la línea de la viga).
// Variante B: añade un pilar a 3 cm del eje de la viga (caso real de desalineación).
import { createHash } from 'node:crypto';

export const TOL = 1e-6; // m, coincidencia topológica (la del §5.3)

export function caso(variante = 'A', h = 0.5) {
  const boundary = [[0, 0], [12, 0], [12, 9], [0, 9]];
  const hole = [[7.2, 3.5], [9.2, 3.5], [9.2, 6.0], [7.2, 6.0]];
  const beams = [[[4.0, 0], [4.0, 9]]];
  const columns = [[4.0, 6.5], [8.0, 2.0], [10.5, 7.5], [2.0, 7.0]];
  if (variante === 'B') columns.push([4.03, 3.0]);
  // C: viga oblicua de esquina a esquina de un paño (no ortogonal) y Steiner más pegados
  if (variante === 'C') { beams.length = 0; beams.push([[0, 0], [6.0, 9.0]]); columns.length = 0; columns.push([2.0, 3.0], [8.0, 2.0], [10.5, 7.5]); }
  // S: como A pero con Steiner en retícula CUADRADA (puntos cocirculares)
  return { boundary, hole, beams, columns, h, variante };
}

const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

function distPointSeg(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const L2 = vx * vx + vy * vy;
  let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + t * vx, a[1] + t * vy];
  return { d: Math.sqrt(d2(p, q)), t };
}

/** Construye el PSLG: puntos únicos (tolerancia TOL), segmentos troceados en
 *  cada punto que cae sobre ellos y subdivididos a <= h. */
export function pslg(c) {
  const pts = [];
  const key = new Map();
  const add = (p) => {
    const k = `${Math.round(p[0] / TOL)},${Math.round(p[1] / TOL)}`;
    if (key.has(k)) return key.get(k);
    key.set(k, pts.length);
    pts.push([p[0], p[1]]);
    return pts.length - 1;
  };
  const rawSegs = [];
  const loop = (poly, tag) => poly.forEach((p, i) => rawSegs.push({ a: p, b: poly[(i + 1) % poly.length], tag }));
  loop(c.boundary, 'borde');
  loop(c.hole, 'hueco');
  for (const b of c.beams) rawSegs.push({ a: b[0], b: b[1], tag: 'viga' });
  // vértices "duros": extremos de segmentos + pilares
  const hard = [];
  for (const s of rawSegs) hard.push(s.a, s.b);
  hard.push(...c.columns);
  const segs = [];
  for (const s of rawSegs) {
    // puntos duros sobre el segmento (incluidos extremos)
    const onSeg = [];
    for (const p of hard) {
      const { d, t } = distPointSeg(p, s.a, s.b);
      if (d <= TOL) onSeg.push(t);
    }
    // extremos de OTROS segmentos que caen dentro (T-junction)
    const ts = [...new Set(onSeg.map((t) => Math.round(t / 1e-12) * 1e-12))].sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < 1e-12) continue;
      const A = [s.a[0] + (s.b[0] - s.a[0]) * t0, s.a[1] + (s.b[1] - s.a[1]) * t0];
      const B = [s.a[0] + (s.b[0] - s.a[0]) * t1, s.a[1] + (s.b[1] - s.a[1]) * t1];
      const L = Math.sqrt(d2(A, B));
      const n = Math.max(1, Math.ceil(L / c.h - 1e-9));
      let prev = add(A);
      for (let j = 1; j <= n; j++) {
        const P = j === n ? B : [A[0] + ((B[0] - A[0]) * j) / n, A[1] + ((B[1] - A[1]) * j) / n];
        const cur = add(P);
        segs.push({ i: prev, j: cur, tag: s.tag });
        prev = cur;
      }
    }
  }
  const colIdx = c.columns.map(add);
  return { pts, segs, colIdx };
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Puntos de Steiner en retícula triangular de paso h, dentro de la losa, fuera
 *  del hueco y a >= f*h de cualquier segmento o vértice del PSLG. */
export function steiner(c, P, f = c.variante === 'C' ? 0.2 : 0.45) {
  const out = [];
  if (c.variante === 'S' || c.variante === 'D') {
    const segs = P.segs.map((s) => [P.pts[s.i], P.pts[s.j]]);
    for (let y = c.h; y < 9 - 1e-9; y += c.h) for (let x = c.h; x < 12 - 1e-9; x += c.h) {
      const p = [x, y];
      if (!pointInPoly(p, c.boundary) || pointInPoly(p, c.hole)) continue;
      let ok = true;
      for (const [a, b] of segs) if (distPointSeg(p, a, b).d < 1e-6) { ok = false; break; }
      // S: se descartan también los que coinciden con un vértice del PSLG (pilares);
      // D: NO se descartan -> puntos duplicados exactos en la entrada
      if (ok && c.variante === 'S') for (const q of P.pts) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6) { ok = false; break; }
      if (ok) out.push(p);
    }
    return out;
  }
  const dy = (c.h * Math.sqrt(3)) / 2;
  const segs = P.segs.map((s) => [P.pts[s.i], P.pts[s.j]]);
  for (let r = 0, y = dy / 2; y < 9; r++, y += dy) {
    for (let x = (r % 2 ? c.h / 2 : 0) + c.h / 4; x < 12; x += c.h) {
      const p = [x, y];
      if (!pointInPoly(p, c.boundary) || pointInPoly(p, c.hole)) continue;
      let ok = true;
      for (const [a, b] of segs) if (distPointSeg(p, a, b).d < f * c.h) { ok = false; break; }
      if (ok) for (const q of P.pts) if (Math.sqrt(d2(p, q)) < f * c.h) { ok = false; break; }
      if (ok) out.push(p);
    }
  }
  return out;
}

export function keepTri(c, pts, t) {
  const g = [(pts[t[0]][0] + pts[t[1]][0] + pts[t[2]][0]) / 3, (pts[t[0]][1] + pts[t[1]][1] + pts[t[2]][1]) / 3];
  return pointInPoly(g, c.boundary) && !pointInPoly(g, c.hole);
}

const ang = (a, b, c) => {
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - a[0], vy = c[1] - a[1];
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / Math.hypot(ux, uy) / Math.hypot(vx, vy)))) * 180) / Math.PI;
};

export function triMetrics(pts, tris) {
  let minA = 180, maxA = 0, maxAR = 0, area = 0, inverted = 0, bad20 = 0;
  for (const t of tris) {
    const [a, b, c] = t.map((i) => pts[i]);
    const A = 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
    if (A <= 0) inverted++;
    area += Math.abs(A);
    const angs = [ang(a, b, c), ang(b, c, a), ang(c, a, b)];
    const mn = Math.min(...angs);
    minA = Math.min(minA, mn);
    maxA = Math.max(maxA, ...angs);
    if (mn < 20) bad20++;
    const la = Math.sqrt(d2(b, c)), lb = Math.sqrt(d2(a, c)), lc = Math.sqrt(d2(a, b));
    const s = (la + lb + lc) / 2;
    const rin = Math.abs(A) / s;
    const ar = Math.max(la, lb, lc) / (2 * Math.sqrt(3) * rin); // 1 = equilátero
    maxAR = Math.max(maxAR, ar);
  }
  return { nTri: tris.length, minAngle: +minA.toFixed(2), maxAngle: +maxA.toFixed(2), maxAspect: +maxAR.toFixed(2), triMin20: bad20, area: +area.toFixed(6), inverted };
}

/** ¿Están todos los subsegmentos del PSLG como aristas de la malla? ¿Y los pilares como vértices? */
export function preserva(P, ptsOut, tris) {
  const idx = new Map(ptsOut.map((p, i) => [`${Math.round(p[0] / TOL)},${Math.round(p[1] / TOL)}`, i]));
  const look = (p) => idx.get(`${Math.round(p[0] / TOL)},${Math.round(p[1] / TOL)}`);
  const E = new Set();
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const a = t[k], b = t[(k + 1) % 3];
    E.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  }
  let segOk = 0, vigaOk = 0, vigaTot = 0;
  for (const s of P.segs) {
    const a = look(P.pts[s.i]), b = look(P.pts[s.j]);
    const ok = a !== undefined && b !== undefined && E.has(a < b ? `${a}-${b}` : `${b}-${a}`);
    if (ok) segOk++;
    if (s.tag === 'viga') { vigaTot++; if (ok) vigaOk++; }
  }
  const usados = new Set(tris.flat());
  const colOk = P.colIdx.filter((i) => { const j = look(P.pts[i]); return j !== undefined && usados.has(j); }).length;
  return { segPreservados: `${segOk}/${P.segs.length}`, vigaPreservada: `${vigaOk}/${vigaTot}`, pilaresComoVertice: `${colOk}/${P.colIdx.length}` };
}

/** Huella geométrica canónica: triángulos por coordenadas redondeadas, ordenados. */
export function huella(pts, tris) {
  const k = (p) => `${p[0].toFixed(9)},${p[1].toFixed(9)}`;
  const T = tris.map((t) => t.map((i) => k(pts[i])).sort().join('|')).sort();
  return createHash('sha256').update(T.join('\n')).digest('hex').slice(0, 16);
}

/** Huella "cruda": índices tal cual salen (lo que vería un mapping por índice). */
export function huellaCruda(pts, tris) {
  return createHash('sha256').update(JSON.stringify([pts, tris])).digest('hex').slice(0, 16);
}

/** Barajado determinista (semilla) para probar dependencia del orden de entrada. */
export function barajar(n, seed = 12345) {
  const p = [...Array(n).keys()];
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p;
}

/** Tri -> 3 cuadriláteros (centroide + puntos medios), conforme y sin huecos. */
export function triAQuads(pts, tris) {
  const P = pts.map((p) => [p[0], p[1]]);
  const mid = new Map();
  const m = (a, b) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!mid.has(k)) { mid.set(k, P.length); P.push([(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2]); }
    return mid.get(k);
  };
  const Q = [];
  for (let t of tris) {
    const [a, b, c] = t;
    const A = (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[c][0] - P[a][0]) * (P[b][1] - P[a][1]);
    if (A < 0) t = [a, c, b];
    const [i, j, k] = t;
    const g = P.length; P.push([(P[i][0] + P[j][0] + P[k][0]) / 3, (P[i][1] + P[j][1] + P[k][1]) / 3]);
    const mij = m(i, j), mjk = m(j, k), mki = m(k, i);
    Q.push([i, mij, g, mki], [j, mjk, g, mij], [k, mki, g, mjk]);
  }
  return { pts: P, quads: Q };
}

export function quadMetrics(pts, quads) {
  let minA = 180, maxA = 0, maxAR = 0, minSJ = 1, area = 0;
  for (const q of quads) {
    const v = q.map((i) => pts[i]);
    const L = [0, 1, 2, 3].map((k) => Math.sqrt(d2(v[k], v[(k + 1) % 4])));
    maxAR = Math.max(maxAR, Math.max(...L) / Math.min(...L));
    for (let k = 0; k < 4; k++) {
      const a = v[k], n = v[(k + 1) % 4], p = v[(k + 3) % 4];
      const e1 = [n[0] - a[0], n[1] - a[1]], e2 = [p[0] - a[0], p[1] - a[1]];
      const cr = e1[0] * e2[1] - e1[1] * e2[0];
      const sj = cr / (Math.hypot(...e1) * Math.hypot(...e2)); // jacobiano escalado en la esquina
      minSJ = Math.min(minSJ, sj);
      const an = ang(a, n, p);
      minA = Math.min(minA, an); maxA = Math.max(maxA, an);
    }
    area += 0.5 * Math.abs((v[2][0] - v[0][0]) * (v[3][1] - v[1][1]) - (v[3][0] - v[1][0]) * (v[2][1] - v[0][1]));
  }
  return { nQuad: quads.length, nNodos: new Set(quads.flat()).size, minAngle: +minA.toFixed(2), maxAngle: +maxA.toFixed(2), maxLadoLargoCorto: +maxAR.toFixed(2), minJacobianoEscalado: +minSJ.toFixed(3), area: +area.toFixed(6) };
}

/** Malla estructurada por líneas de control (estilo RectangleMesh de PyNite). */
export function rejilla(c) {
  const xs = new Set([0, 12, ...c.hole.map((p) => p[0]), ...c.beams.flatMap((b) => b.map((p) => p[0])), ...c.columns.map((p) => p[0])]);
  const ys = new Set([0, 9, ...c.hole.map((p) => p[1]), ...c.columns.map((p) => p[1])]);
  const sub = (S) => {
    const v = [...S].sort((a, b) => a - b);
    const out = [v[0]];
    for (let i = 1; i < v.length; i++) {
      const n = Math.max(1, Math.ceil((v[i] - v[i - 1]) / c.h - 1e-9));
      for (let j = 1; j <= n; j++) out.push(v[i - 1] + ((v[i] - v[i - 1]) * j) / n);
    }
    return out;
  };
  const X = sub(xs), Y = sub(ys);
  const pts = [], quads = [];
  const id = (i, j) => j * X.length + i;
  for (const y of Y) for (const x of X) pts.push([x, y]);
  for (let j = 0; j < Y.length - 1; j++) for (let i = 0; i < X.length - 1; i++) {
    const g = [(X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2];
    if (pointInPoly(g, c.hole)) continue;
    quads.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
  }
  return { pts, quads, minDx: Math.min(...X.slice(1).map((x, i) => x - X[i])), minDy: Math.min(...Y.slice(1).map((y, i) => y - Y[i])) };
}
