// E4: malla estructurada por líneas de control en una planta realista 20 x 15 m
// con pilares desalineados (como en obra: ±0..30 cm respecto a la retícula de 5 m).
// Mide franjas estrechas y esbeltez de los quads con y sin "snapping" de líneas de
// control a ε (las coordenadas a menos de ε se funden en una, con diagnóstico).
const h = 0.5;
let s = 2024;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
function planta(jit) {
  const xs = [0, 20], ys = [0, 15];
  const cols = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 3; j++) cols.push([Math.min(20, Math.max(0, i * 5 + (i % 4 ? jit * rnd() : 0))), Math.min(15, Math.max(0, j * 5 + (j % 3 ? jit * rnd() : 0)))]);
  return { xs: [...xs, ...cols.map((c) => c[0])], ys: [...ys, ...cols.map((c) => c[1])], cols };
}
function funde(v, eps) {
  const a = [...new Set(v)].sort((p, q) => p - q);
  const out = [a[0]];
  let fusiones = 0, maxMov = 0;
  for (let i = 1; i < a.length; i++) {
    if (a[i] - out[out.length - 1] <= eps) { fusiones++; maxMov = Math.max(maxMov, a[i] - out[out.length - 1]); } else out.push(a[i]);
  }
  return { v: out, fusiones, maxMov };
}
function rejilla(xs, ys) {
  const sub = (v) => { const o = [v[0]]; for (let i = 1; i < v.length; i++) { const n = Math.max(1, Math.ceil((v[i] - v[i - 1]) / h - 1e-9)); for (let j = 1; j <= n; j++) o.push(v[i - 1] + ((v[i] - v[i - 1]) * j) / n); } return o; };
  const X = sub(xs), Y = sub(ys);
  const dx = X.slice(1).map((x, i) => x - X[i]), dy = Y.slice(1).map((y, i) => y - Y[i]);
  let maxAR = 0, n10 = 0, n5 = 0, n3 = 0;
  for (const a of dx) for (const b of dy) { const ar = Math.max(a, b) / Math.min(a, b); maxAR = Math.max(maxAR, ar); if (ar > 10) n10++; if (ar > 5) n5++; if (ar > 3) n3++; }
  return { quads: dx.length * dy.length, nodos: X.length * Y.length, franjaMin_cm: +(Math.min(...dx, ...dy) * 100).toFixed(2), maxAspecto: +maxAR.toFixed(1), quadsAR_gt3: n3, quadsAR_gt5: n5, quadsAR_gt10: n10 };
}
const out = {};
for (const jit of [0, 0.05, 0.3]) {
  s = 2024;
  const p = planta(jit);
  const r = { sinFusion: rejilla([...new Set(p.xs)].sort((a, b) => a - b), [...new Set(p.ys)].sort((a, b) => a - b)) };
  for (const eps of [0.02, 0.05, 0.10]) {
    const fx = funde(p.xs, eps), fy = funde(p.ys, eps);
    r[`fusion ε=${eps} m`] = { ...rejilla(fx.v, fy.v), lineasFundidas: fx.fusiones + fy.fusiones, desplazamientoMax_cm: +(Math.max(fx.maxMov, fy.maxMov) * 100).toFixed(1) };
  }
  out[`desalineación ±${jit} m`] = r;
}
console.log(JSON.stringify(out, null, 2));
