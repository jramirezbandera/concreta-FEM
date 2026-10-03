// Solver de perfil en TS (vía «TS puro») sobre una K .kcsc, para compararlo con faer-WASM.
//   node spike/e0/solver/bench-perfil.ts spike/e0/datos/V3.kcsc
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { FactorPerfil, ordenRcm } from "../../../src/solver/perfil.ts";

const ruta = process.argv[2]!;
const buf = readFileSync(ruta);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const cab = new DataView(ab, 0, 16);
const n = cab.getUint32(8, true);
const nnz = cab.getUint32(12, true);
const valores = new Float64Array(ab, 16, nnz);
const patron = { n, colPtr: new Uint32Array(ab, 16 + 8 * nnz, n + 1), rowIdx: new Uint32Array(ab, 16 + 8 * nnz + 4 * (n + 1), nnz) };
let t = performance.now();
const perm = ordenRcm(patron);
const tRcm = (performance.now() - t) / 1000;
t = performance.now();
const f = new FactorPerfil(patron, valores, perm);
const tFac = (performance.now() - t) / 1000;
const b = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + 0.1);
t = performance.now();
f.resolver(b);
const tSol = (performance.now() - t) / 1000;
const motor = typeof (globalThis as { Bun?: { version: string } }).Bun !== "undefined" ? "bun" : `node ${process.version}`;
console.log(JSON.stringify({ k: basename(ruta), plataforma: `TS perfil (${motor})`, n, perfil_MB: Math.round((f.tamano * 8) / 1048576), t_rcm_s: +tRcm.toFixed(3), t_factor_s: +tFac.toFixed(3), t_resolver_1rhs_s: +tSol.toFixed(3) }));
