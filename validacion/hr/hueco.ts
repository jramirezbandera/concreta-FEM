/**
 * Fase HR, criterio 4 (`docs/fem3d/huella-rigida.md`): junto al hueco del edificio objetivo, donde
 * F2-9 pesaba más (P30-15 y P24-20 tenían 42 y 41 nudos rígidos fuera de su huella). El metro de cada
 * cara de pilar de la planta (losa plana, sin vigas), con h = 0,75 y 0,5, frente a la malla fina
 * (h = 0,15; con 0,1 no cabe), por grupos, y cada cara junto al hueco. Sustituye a `validacion/f3/f3d.ts`
 * (F3-d, que se fue con la fase HR): sus valores de antes están en `validacion/f3/out_f3d.txt`.
 *
 *   bun validacion/hr/hueco.ts > validacion/hr/out_hueco.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { contarRigidosFuera } from "../../src/pruebas/huellasRigidas.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const f0 = edificioObjetivoLosas(1);
const fisico: ModeloFisico = { ...f0, vigas: [], cargas: f0.cargas!.filter((c) => c.tipo !== "viga") };
const losa = fisico.losas![0]!;
const pilares = new Map(fisico.pilares!.map((p) => [p.id, p]));
const seccion = (id: string) => fisico.secciones.find((s) => s.id === id) as { b: number; h: number };

/** ¿Está la huella del pilar a menos de 1 m de un hueco de la losa? */
function juntoAHueco(id: string): boolean {
  const p = pilares.get(id)!;
  const s = seccion(p.seccion);
  return (losa.huecos ?? []).some((h) => {
    const xs = h.map((q) => q[0]);
    const ys = h.map((q) => q[1]);
    const dx = Math.max(Math.min(...xs) - (p.x + s.b / 2), 0, p.x - s.b / 2 - Math.max(...xs));
    const dy = Math.max(Math.min(...ys) - (p.y + s.h / 2), 0, p.y - s.h / 2 - Math.max(...ys));
    return Math.hypot(dx, dy) < 1;
  });
}

interface Medida {
  /** Por clave «pilar|dirección|lado»: mx medio (suma de los casos, kN·m/m). */
  caras: Map<string, { m: number; s: number }>;
  nudos: number;
  fuera: number;
  avisos: string[];
}
function medir(op: OpcionesCompilacion): Medida {
  const r = compilar(fisico, op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(r.modelo));
  const ctx = validar(fisico, resolverOpciones(op), new Diagnosticos())!;
  const ef = new EsfuerzosFranjas(ctx, r, casos, { cortes: new Cortes(r.modelo) });
  const caras = new Map<string, { m: number; s: number }>();
  for (const fr of ef.franjas()) {
    for (const e of ef.estaciones(fr.id)!.estaciones) {
      if (e.tipo !== "cara" || !e.ventana || !e.valido) continue;
      // La franja que más ocupa la ventana del pilar: la primera que la da (las dos que tocan el pilar dan lo mismo, F-h)
      const pid = e.piezas.find((id) => pilares.has(id) && Math.abs((e.ventana![0] + e.ventana![1]) / 2 - (fr.direccion === 1 ? pilares.get(id)!.y : pilares.get(id)!.x)) < 1e-6);
      if (!pid) continue;
      const k = `${pid}|${fr.direccion === 1 ? "X" : "Y"}|${e.lado > 0 ? "+" : "−"}`;
      if (!caras.has(k)) caras.set(k, { m: casos.reduce((a, _, q) => a + e.medios[3 * q]!, 0), s: e.s });
    }
  }
  return { caras, nudos: r.modelo.nudos.length, fuera: contarRigidosFuera(fisico, op).total, avisos: [...new Set(r.diagnosticos.filter((d) => d.codigo.startsWith("malla/")).map((d) => d.codigo))] };
}

const pc = (x: number) => `${(100 * x).toFixed(2)} %`;
console.log("# Fase HR, criterio 4: el edificio objetivo de una planta (losa plana, sin vigas) junto al hueco\n");
console.log("El metro de cada cara de pilar (mx medio, suma de los casos, kN·m/m) con h = 0,75 y 0,5 frente a h = 0,15, con la huella rígida de todos los pilares (sin nudos rígidos fuera de la huella en ninguna malla). «Con demanda»: |m| ≥ 20 % de la mayor de la referencia. Antes de la fase, con F3-d (`validacion/f3/out_f3d.txt`): junto al hueco, 5,68 / 26,68 % con h = 0,75, y −43 % sin F3-d.\n");
process.stderr.write("h = 0,15\n");
const ref = medir({ tamanoMalla: 0.15 });
const mayor = Math.max(...[...ref.caras.values()].map((c) => Math.abs(c.m)));
console.log(`Referencia h = 0,15: ${ref.nudos} nudos, ${ref.caras.size} caras, ${ref.fuera} esclavos fuera de la huella, avisos: ${ref.avisos.join(", ") || "—"}.\n`);
console.log("| Malla | Nudos | Esclavos fuera | Grupo | Caras | Media | Máx. | Peor |");
console.log("|---|---|---|---|---|---|---|---|");
const mallas: [string, OpcionesCompilacion][] = [
  ["h = 0,75", { tamanoMalla: 0.75 }],
  ["h = 0,5", { tamanoMalla: 0.5 }],
];
const detalle: string[] = [];
for (const [nombre, op] of mallas) {
  process.stderr.write(`${nombre}\n`);
  const m = medir(op);
  const grupos = new Map<string, number[]>();
  for (const [k, c] of m.caras) {
    const v = ref.caras.get(k);
    if (!v || Math.abs(v.m) < 0.2 * mayor) continue;
    const g = juntoAHueco(k.split("|")[0]!) ? "junto a un hueco" : "las demás";
    grupos.set(g, [...(grupos.get(g) ?? []), c.m / v.m - 1]);
    if (g === "junto a un hueco") detalle.push(`| ${k.replace(/\|/g, ", ")} (s = ${c.s.toFixed(2)}) | ${v.m.toFixed(2)} | ${nombre}: ${c.m.toFixed(2)} (${pc(c.m / v.m - 1)}) |`);
  }
  for (const g of ["junto a un hueco", "las demás"]) {
    const e = grupos.get(g);
    if (!e) continue;
    const abs = e.map(Math.abs);
    const max = Math.max(...abs);
    console.log(`| ${nombre} | ${m.nudos} | ${m.fuera} | ${g} | ${e.length} | ${pc(abs.reduce((a, x) => a + x, 0) / abs.length)} | ${pc(max)} | ${pc(e[abs.indexOf(max)]!)} |`);
  }
}
console.log("\n## Las caras junto al hueco (referencia h = 0,15 y cada malla)\n");
console.log("| Cara (pilar, dirección, lado) | h = 0,15 | Malla |");
console.log("|---|---|---|");
for (const l of detalle.sort()) console.log(l);
