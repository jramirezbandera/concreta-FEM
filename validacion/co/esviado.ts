/**
 * CO1-a (docs/fem3d/comprobaciones.md §8.4): ¿cuánto pesa sumar los dos cortantes de un pilar
 * (VEdy/VRdy + VEdz/VRdz ≤ 1) frente a tomar el peor de los dos? Y lo que tarda `fem armar`.
 *
 *   bun validacion/co/esviado.ts [--plantas N]     escribe validacion/co/out_esviado.txt
 *
 * El edificio objetivo de losas con viento y el sismo del programa (el de `medir.ts`). En cada tramo
 * se propone el armado de la tabla (sin las reglas de obra, que lo mezclarían) y se mira:
 *  - si el anterior de la tabla falla sólo por la fila «cortante-esviado»: la suma ha subido las barras;
 *  - si el propuesto, con los cercos de la tabla, falla sólo por ella: la suma ha subido los cercos.
 * En los demás, la suma no cambia nada.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { AccionCaso, ModeloFisico } from "../../src/compilador/fisico.ts";
import { armadoPilar } from "../../src/comprobaciones/armado.ts";
import { proponerTramo, tablaPilares, cercosDe } from "../../src/comprobaciones/armar/pilares.ts";
import { comprobarTramo } from "../../src/comprobaciones/comprobar/pilares.ts";
import { geometriaPilar } from "../../src/comprobaciones/comprobar/entradaPilar.ts";
import { demandasPilar } from "../../src/comprobaciones/demandas/pilares.ts";
import { comprobarPilares } from "../../src/comprobaciones/pilares.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : undefined);
const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
const plantas = Number(arg("--plantas") ?? 7);
const base = plantas === 7 ? edificioObjetivoLosas(7) : edificioObjetivoLosas(plantas, 3, 2);
const f: ModeloFisico = { ...base, casos: base.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })), acciones: { sismo: { ab: 0.16, K: 1.0, terreno: "III", mu: 2, sistema: "porticos-ha" } } };
const c = compilar(f);
if (!c.valido) throw new Error("no compila");
const r = calcular(c.modelo);
if (!r.valido) throw new Error("no calcula");
const q = new Consultas(f, c, r.casos, {}, r.modal);

const lineas: string[] = [];
const di = (s: string) => {
  lineas.push(s);
  console.log(s);
};
di(`CO1-a: el cortante esviado como suma, en el edificio objetivo de losas (${plantas} plantas), viento y sismo del programa`);

// Lo que tarda «fem armar» (sin IO): proponer todos los tramos, con y sin las reglas de obra
for (const reglasObra of [false, true]) {
  const t0 = performance.now();
  const p = comprobarPilares(q, undefined, undefined, { proponer: true, reglasObra });
  if (!p.valido) throw new Error("no comprueba");
  const ajustes = p.valor.pilares.flatMap((x) => x.tramos).filter((t) => t.ajuste).length;
  di(`proponer ${reglasObra ? "con" : "sin"} las reglas de obra: ${((performance.now() - t0) / 1e3).toFixed(1)} s, ${p.valor.resumen.tramos} tramos, ${p.valor.resumen.cumplen} cumplen, ${p.valor.resumen.sinArmado} sin propuesta, ${p.valor.resumen.llamadas} llamadas${reglasObra ? `, ${ajustes} subidos` : ""}`);
}

let tramos = 0;
let conEsviado = 0;
let barras = 0;
let cercos = 0;
const ejemplos: string[] = [];
const soloEsviado = (x: ReturnType<typeof comprobarTramo>) => {
  const fallan = x.filas.filter((y) => y.estado === "fail");
  return fallan.length > 0 && fallan.every((y) => y.id === "cortante-esviado");
};
for (const p of f.pilares ?? []) {
  const d = demandasPilar(q, p.id);
  if (!d.valido) throw new Error(p.id);
  for (const t of d.valor.tramos) {
    const geo = geometriaPilar(t);
    if ("motivo" in geo) continue;
    const pr = proponerTramo(t, undefined, d.valor.betaUno);
    if (!pr.armado || !pr.comprobacion) continue;
    tramos++;
    if (pr.comprobacion.filas.some((x) => x.id === "cortante-esviado")) conEsviado++;
    const tabla = tablaPilares(geo.sectionType, geo.b, geo.h);
    if (pr.posicion > 0 && soloEsviado(comprobarTramo(t, armadoPilar(tabla[pr.posicion - 1]!), d.valor.betaUno))) {
      barras++;
      if (ejemplos.length < 10) ejemplos.push(`  ${p.id} en ${t.planta}: barras subidas por la suma`);
    }
    const tablaCercos = cercosDe(pr.armado.esquinas ?? pr.armado.anillo?.diametro ?? 12, Math.min(geo.b, geo.h));
    if ((pr.armado.cercos.diametro !== tablaCercos.diametro || pr.armado.cercos.separacion !== tablaCercos.separacion) && soloEsviado(comprobarTramo(t, armadoPilar({ ...pr.armado, cercos: tablaCercos }), d.valor.betaUno))) {
      cercos++;
      if (ejemplos.length < 10) ejemplos.push(`  ${p.id} en ${t.planta}: cercos subidos por la suma (${tablaCercos.diametro}/${tablaCercos.separacion} → ${pr.armado.cercos.diametro}/${pr.armado.cercos.separacion})`);
    }
  }
}
di(`tramos con propuesta: ${tramos}; con cortante en las dos direcciones a la vez (fila «cortante-esviado»): ${conEsviado}`);
di(`la suma sube las barras en ${barras} tramos y los cercos en ${cercos} (${(((barras + cercos) / Math.max(1, tramos)) * 100).toFixed(1)} %)`);
for (const e of ejemplos) di(e);
writeFileSync(join(import.meta.dirname, "out_esviado.txt"), lineas.join("\n") + "\n");
