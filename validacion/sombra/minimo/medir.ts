/**
 * Prueba en sombra, modelos mínimos (`modelos.py`): lo que se compara con las capturas de CYPE del
 * modelo A con sólo peso propio. La viga P3–P4 (en las caras y su máximo, en peso propio y como la
 * envolvente de CYPE: 1,35·PP con el 15 % de redistribución de negativos), la flecha de la losa en
 * el centro y junto a la viga, y los campos de la losa (m11 = Momento X, m22 = Momento Y) en el
 * centro y junto a las caras de las vigas, a mitad de vano.
 *
 *   bun validacion/sombra/minimo/medir.ts <carpeta de la variante>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../../src/compilador/compilar.ts";
import { Consultas } from "../../../src/compilador/consultas.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { calcular } from "../../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { casosValidos } from "../../../src/pruebas/comparar.ts";
import { valido } from "../../../src/pruebas/metamorficasFisicas.ts";
import { valorEnPunto } from "../../../src/visor/datos.ts";
import { Sesion } from "../../../src/visor/sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);
const dir = process.argv[2]!;
const texto = readFileSync(join(dir, "proyecto.json"), "utf8");
const p = JSON.parse(texto);
const r = valido(compilar(p.modelo, p.opciones ?? {}));
const casos = casosValidos(calcular(r.modelo));
const c = new Consultas(p.modelo, r, casos, p.opciones ?? {});
const f = (v: number) => v.toFixed(2);

for (const id of ["V-P3-P4", "V-P1-P2", "V-P1-P3"]) {
  const dg = c.diagrama(id, [1]);
  if (!dg.valido) throw new Error(JSON.stringify(dg.diagnosticos));
  const est = dg.valor;
  const L = est[est.length - 1]!.s;
  const en = (s: number) => {
    for (let i = 0; i + 1 < est.length; i++) {
      const [a, b] = [est[i]!, est[i + 1]!];
      if (s >= a.s - 1e-9 && s <= b.s + 1e-9 && b.s > a.s) {
        const w = (s - a.s) / (b.s - a.s);
        return a.derecha.map((v, k) => v * (1 - w) + b.derecha[k]! * w);
      }
    }
    return est[est.length - 1]!.izquierda;
  };
  const max = Math.max(...est.map((x) => Math.max(x.izquierda[4]!, x.derecha[4]!)));
  const [ci, cf] = [en(0.15), en(L - 0.15)];
  const neg = (Math.abs(ci[4]!) + Math.abs(cf[4]!)) / 2;
  const mt = Math.max(...est.map((x) => Math.max(Math.abs(x.izquierda[3]!), Math.abs(x.derecha[3]!))));
  console.log(`${id} PP: caras ${f(ci[4]!)} / ${f(cf[4]!)}, máximo ${f(max)}, V ${f(ci[2]!)} / ${f(cf[2]!)}, T máx ${f(mt)} kN·m`);
  console.log(`   como la envolvente de CYPE (1,35·PP, 15 %): caras −${f(1.35 * 0.85 * neg)}, máximo ${f(1.35 * (max + 0.15 * neg))}, V ${f(1.35 * Math.abs(ci[2]!))}, T ${f(1.35 * mt)}`);
}

// El pilar de esquina P3, en las caras de su tramo flexible: el pie (el arranque) y la cabeza (bajo el
// forjado; desde RV-b, en su cara inferior)
{
  const t = c.pilar("P3");
  if (!t.valido) throw new Error(JSON.stringify(t.diagnosticos));
  const e = (x: Float64Array) => `N ${f(-x[0]!)}, V ${f(Math.abs(x[1]!))} / ${f(Math.abs(x[2]!))}, M ${f(Math.abs(x[4]!))} / ${f(Math.abs(x[5]!))}`;
  for (const tr of t.valor) console.log(`P3 PP: pie (s = ${f(tr.base.s)}) ${e(tr.base.esfuerzos)}; cabeza (s = ${f(tr.cabeza.s)}) ${e(tr.cabeza.esfuerzos)}`);
}

const a = Sesion.abrir(texto, sha256(new Uint8Array(WASM)));
if (!a.valido) throw new Error(JSON.stringify(a.diagnosticos));
const s = a.sesion;
const k = await s.calcular();
if (!k.ok) throw new Error(JSON.stringify(k.diagnosticos));
const v = (campo: "uz" | "m11" | "m22" | "m12" | "v13" | "v23", x: number, y: number) => {
  const q = valorEnPunto(s, "F1", campo, { tipo: "caso", caso: "PP" }, x, y);
  return q.valido && q.valor ? q.valor.valor : NaN;
};
// Frente al listado de CYPE (`leer_listado.py`), nudo a nudo, en sus coordenadas
const cy = JSON.parse(readFileSync(join(import.meta.dirname, ".datos", "cype-a.json"), "utf8")) as { nudos: Record<string, number | null>[] };
const PARES: [string, "uz" | "m11" | "m22" | "m12" | "v13" | "v23"][] = [["uz", "uz"], ["mx", "m11"], ["my", "m22"], ["mxy", "m12"], ["qx", "v13"], ["qy", "v23"]];
const filas = cy.nudos.map((n) => ({ x: n.x!, y: n.y!, c: n, u: Object.fromEntries(PARES.map(([a, b]) => [a, v(b, n.x!, n.y!)])) }));
const en = (x: number, y: number) => filas.reduce((a, b) => ((b.x - x) ** 2 + (b.y - y) ** 2 < (a.x - x) ** 2 + (a.y - y) ** 2 ? b : a));
const med = (xs: number[]) => { const o = [...xs].sort((a, b) => a - b); return o.length ? o[Math.floor(o.length / 2)]! : NaN; };
console.log("campo   CYPE/nuestro en el centro (3; 3,08), junto a la viga de arriba (3; 5,85), de abajo (3; 0,30), de la izquierda (0,15; 3,08); mediana nuestro/CYPE de los grandes (> 40 % del máximo |CYPE|)");
for (const [a] of PARES) {
  const pts = [en(3, 3.075), en(3, 5.85), en(3, 0.3), en(0.15, 3.075)];
  const vmax = Math.max(...filas.map((r) => Math.abs((r.c[a] as number) ?? 0)));
  const grandes = filas.filter((r) => r.c[a] !== null && Math.abs(r.c[a] as number) > 0.4 * vmax && Number.isFinite(r.u[a]!));
  const pos = grandes.filter((r) => (r.c[a] as number) > 0), neg = grandes.filter((r) => (r.c[a] as number) < 0);
  console.log(`${a.padEnd(4)}  ${pts.map((r) => `${f(r.c[a] as number)}/${f(r.u[a]!)}`).join("   ")};  +: ${pos.length} nudos ${f(med(pos.map((r) => r.u[a]! / (r.c[a] as number))))}  −: ${neg.length} nudos ${f(med(neg.map((r) => r.u[a]! / (r.c[a] as number))))}  (máx |CYPE| ${f(vmax)})`);
}
