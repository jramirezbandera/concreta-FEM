// Experimento RES-E2: envolventes con concomitantes por superposición.
//  A) coste (tiempo, memoria) de la envolvente con índice de combinación gobernante
//     para 2000 barras × 11 estaciones × 6 esfuerzos, 8 casos → 60 combinaciones
//     (y 11 casos → 138 combinaciones ELU del prototipo combos3d.ts).
//  B) ¿basta la «envolvente con concomitantes» (6 combinaciones extremas de N, My, Mz)
//     para gobernar la comprobación de pilares? Se compara con iterar TODAS las
//     combinaciones llamando al motor real calcRCColumn del repo (sólo lectura).
import { calcRCColumn } from 'D:/PROGRAMACION/Concreta EST/wt/feat-fem3d/src/lib/calculations/rcColumns.ts';
import { rcColumnDefaults } from 'D:/PROGRAMACION/Concreta EST/wt/feat-fem3d/src/data/defaults.ts';
import { buildCombos, defaultCases } from './combos3d.ts';

// PRNG determinista (mulberry32)
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MB = (b: number) => (b / 1048576).toFixed(1) + ' MB';

// ───────────────────────── A) coste de la envolvente ─────────────────────────
function benchEnvelope(nBars: number, nSt: number, nCases: number, nCombos: number) {
  const NC = 6;
  const M = nBars * nSt * NC;
  const r = rng(42);
  const base = new Float64Array(nCases * M);
  for (let i = 0; i < base.length; i++) base[i] = (r() - 0.5) * 200;
  const F = new Float64Array(nCombos * nCases);
  for (let i = 0; i < F.length; i++) F[i] = [0, 0.8, 1, 1.35, 1.5, 0.9, 0.3][Math.floor(r() * 7)];

  // Envolvente: max/min por esfuerzo y estación + índice de la combinación (Uint16)
  const vmax = new Float64Array(M).fill(-Infinity), vmin = new Float64Array(M).fill(Infinity);
  const imax = new Uint16Array(M), imin = new Uint16Array(M);
  const tmp = new Float64Array(M);
  const t0 = performance.now();
  for (let j = 0; j < nCombos; j++) {
    tmp.fill(0);
    for (let c = 0; c < nCases; c++) {
      const f = F[j * nCases + c];
      if (f === 0) continue;
      const off = c * M;
      for (let k = 0; k < M; k++) tmp[k] += f * base[off + k];
    }
    for (let k = 0; k < M; k++) {
      const v = tmp[k];
      if (v > vmax[k]) { vmax[k] = v; imax[k] = j; }
      if (v < vmin[k]) { vmin[k] = v; imin[k] = j; }
    }
  }
  const tEnv = performance.now() - t0;

  // Recuperación perezosa del vector concomitante [N,Vy,Vz,T,My,Mz] de un extremo
  const conc = new Float64Array(NC);
  const concomitant = (bar: number, st: number, comp: number, which: 'max' | 'min') => {
    const k0 = (bar * nSt + st) * NC;
    const j = which === 'max' ? imax[k0 + comp] : imin[k0 + comp];
    conc.fill(0);
    for (let c = 0; c < nCases; c++) {
      const f = F[j * nCases + c];
      if (f === 0) continue;
      const off = c * M + k0;
      for (let q = 0; q < NC; q++) conc[q] += f * base[off + q];
    }
    return conc;
  };
  const nQ = 200_000;
  const t1 = performance.now();
  let chk = 0;
  for (let i = 0; i < nQ; i++) {
    const v = concomitant(Math.floor(r() * nBars), Math.floor(r() * nSt), Math.floor(r() * NC), r() < 0.5 ? 'max' : 'min');
    chk += v[0];
  }
  const tLazy = performance.now() - t1;
  // verificación: el concomitante del propio esfuerzo coincide con el extremo almacenado
  let maxErr = 0;
  for (let i = 0; i < 1000; i++) {
    const b = Math.floor(r() * nBars), s = Math.floor(r() * nSt), q = Math.floor(r() * NC);
    const v = concomitant(b, s, q, 'max')[q];
    maxErr = Math.max(maxErr, Math.abs(v - vmax[(b * nSt + s) * NC + q]));
  }
  console.log(`\n[A] ${nBars} barras × ${nSt} est. × ${NC} esf.; ${nCases} casos → ${nCombos} comb.`);
  console.log(`   resultados base (Float64)                 : ${MB(base.byteLength)}`);
  console.log(`   todas las combinaciones materializadas     : ${MB(nCombos * M * 8)}  (no se guardan)`);
  console.log(`   envolvente max/min + índice Uint16         : ${MB(vmax.byteLength * 2 + imax.byteLength * 2)}`);
  console.log(`   envolvente + vector concomitante completo  : ${MB(M * 2 * (8 + 2 + NC * 8))}  (alternativa precalculada)`);
  console.log(`   tiempo envolvente (todas las combinaciones): ${tEnv.toFixed(0)} ms`);
  console.log(`   ${nQ} consultas de concomitantes perezosas : ${tLazy.toFixed(0)} ms  (${(tLazy / nQ * 1000).toFixed(2)} µs/consulta)  chk=${chk.toFixed(0)}`);
  console.log(`   error máx. concomitante vs extremo         : ${maxErr.toExponential(2)}`);
}

console.log('(calentamiento del JIT: primera pasada descartada)');
benchEnvelope(2000, 11, 8, 60);
benchEnvelope(2000, 11, 8, 60);
benchEnvelope(2000, 11, 11, 138);
benchEnvelope(2000, 11, 11, 176);

// ─────────────── B) pilares: envolvente con concomitantes vs todas las combinaciones ───────────────
function runB(sits: string[]) {
  const cases = defaultCases();
  const combos = buildCombos(cases).filter((c) => sits.includes(c.situation));
  const nCases = cases.length, nCombos = combos.length;
  const r = rng(7);
  const U = (a: number, b: number) => a + (b - a) * r();
  const sgn = () => (r() < 0.5 ? -1 : 1);
  const nCol = 300;
  let nEval = 0, tEval = 0;
  let miss = 0, total = 0, worstRatio = 1, worstInfo = '';
  const ratios: number[] = [];
  let missBig = 0;
  let realTot = 0, realMiss = 0, realBig = 0;
  for (let col = 0; col < nCol; col++) {
    const b = [300, 350, 400, 450][Math.floor(r() * 4)];
    const sec = { ...rcColumnDefaults, b, h: b, cornerBarDiam: 16, nBarsX: 1, barDiamX: 16, nBarsY: 1, barDiamY: 16, L: 3.0, beta: 1.0 };
    for (let end = 0; end < 2; end++) {
      // efectos de cada caso base en el extremo del pilar: [N (compresión +), My, Mz] (kN, kN·m)
      const NG = U(300, 1400), MyG = U(-25, 25), MzG = U(-25, 25);
      const eff: number[][] = [];
      const wxN = U(-90, 90) , wyN = U(-90, 90), exN = U(-160, 160), eyN = U(-160, 160);
      const wxM = U(15, 60), wyM = U(15, 60), exM = U(40, 130), eyM = U(40, 130);
      for (const c of cases) {
        switch (c.id) {
          case 'G': eff.push([NG, MyG, MzG]); break;
          case 'Q': eff.push([0.3 * NG * U(0.7, 1.3), 0.4 * MyG * U(0.5, 1.5) + U(-6, 6), 0.4 * MzG * U(0.5, 1.5) + U(-6, 6)]); break;
          case 'S': eff.push([U(0, 40), U(-3, 3), U(-3, 3)]); break;
          case 'Wx+': eff.push([wxN, wxM, U(-6, 6)]); break;
          case 'Wx-': eff.push([-wxN * U(0.8, 1), -wxM * U(0.8, 1), U(-6, 6)]); break;
          case 'Wy+': eff.push([wyN, U(-6, 6), wyM]); break;
          case 'Wy-': eff.push([-wyN * U(0.8, 1), U(-6, 6), -wyM * U(0.8, 1)]); break;
          case 'EX+e': eff.push([exN, exM, U(-25, 25)]); break;
          case 'EX-e': eff.push([exN * U(0.9, 1.1), exM * U(0.85, 1.15), U(-25, 25)]); break;
          case 'EY+e': eff.push([eyN, U(-25, 25), eyM]); break;
          case 'EY-e': eff.push([eyN * U(0.9, 1.1), U(-25, 25), eyM * U(0.85, 1.15)]); break;
        }
      }
      const comb = combos.map((cb) => {
        const v = [0, 0, 0];
        for (let c = 0; c < nCases; c++) for (let q = 0; q < 3; q++) v[q] += cb.factors[c] * eff[c][q];
        return v;
      });
      const eta = (v: number[]) => {
        if (v[0] < 1) return -1; // tracción: otro camino (no lo compara este experimento)
        const t0 = performance.now();
        const res = calcRCColumn({ ...sec, Nd: v[0], MEdy: v[1], MEdz: v[2] });
        tEval += performance.now() - t0; nEval++;
        if (!res.valid) return -1;
        let e = 0;
        for (const row of res.checks) if (row.id === 'nm-y' || row.id === 'nm-z' || row.id === 'biaxial-check') e = Math.max(e, row.utilization);
        return e;
      };
      const etas = comb.map(eta);
      let etaAll = -1, jAll = -1;
      etas.forEach((e, j) => { if (e > etaAll) { etaAll = e; jAll = j; } });
      // «envolvente con concomitantes»: las combinaciones que dan max/min de N, My, Mz
      const ext = new Set<number>();
      for (let q = 0; q < 3; q++) {
        let jm = 0, jn = 0;
        comb.forEach((v, j) => { if (v[q] > comb[jm][q]) jm = j; if (v[q] < comb[jn][q]) jn = j; });
        ext.add(jm); ext.add(jn);
      }
      let etaExt = -1;
      for (const j of ext) etaExt = Math.max(etaExt, etas[j]);
      if (etaAll <= 0) continue;
      total++;
      const ratio = etaExt / etaAll;
      ratios.push(ratio);
      if (etaAll >= 0.3 && etaAll <= 1.5) { realTot++; if (ratio < 1 - 1e-9) realMiss++; if (ratio < 0.95) realBig++; }
      if (ratio < 1 - 1e-9) {
        miss++;
        if (ratio < 0.95) missBig++;
        if (ratio < worstRatio) { worstRatio = ratio; worstInfo = `pilar ${col} extremo ${end}: η_todas=${etaAll.toFixed(3)} (${combos[jAll].label}) η_extremos=${etaExt.toFixed(3)}`; }
      }
    }
  }
  ratios.sort((a, b) => a - b);
  console.log(`\n[B] ${nCol} pilares × 2 extremos, ${nCombos} combinaciones ELU (${sits.join(' + ')})`);
  console.log(`   llamadas a calcRCColumn: ${nEval} en ${tEval.toFixed(0)} ms → ${(tEval / nEval * 1000).toFixed(1)} µs/llamada`);
  console.log(`   extremos de pilar evaluados: ${total}`);
  console.log(`   la envolvente con concomitantes (6 comb.) NO contiene la pésima en ${miss} (${(100 * miss / total).toFixed(1)} %)`);
  console.log(`   ... y subestima η más de un 5 % en ${missBig} (${(100 * missBig / total).toFixed(1)} %)`);
  console.log(`   cociente η_extremos/η_todas: mín ${ratios[0].toFixed(3)}, p5 ${ratios[Math.floor(0.05 * ratios.length)].toFixed(3)}, mediana ${ratios[Math.floor(0.5 * ratios.length)].toFixed(3)}`);
  console.log(`   peor caso: ${worstInfo}`);
  console.log(`   sólo pilares con 0,3 ≤ η ≤ 1,5 (${realTot}): no contiene la pésima en ${(100 * realMiss / realTot).toFixed(1)} %; subestima >5 % en ${(100 * realBig / realTot).toFixed(1)} %`);
}
runB(['ELU-P']);
runB(['ELU-P', 'ELU-S']);
