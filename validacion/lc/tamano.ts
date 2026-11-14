/**
 * Fase LC, criterio 7 y LC-i (`docs/fem3d/losa-cimentacion.md`): las ecuaciones de los edificios
 * objetivo de 7 plantas (con vigas, reticular con vigas y losa plana) con una losa de cimentación de
 * 0,8 m sobre k = 40 000 kN/m³ (l = 2,24 m: malla de 0,56 m) en su planta más baja, de la caja de los
 * pilares más 0,6 m, con los pilares apoyados en ella (sin base escrita), frente a los mismos sin ella.
 *
 *   bun validacion/lc/tamano.ts > validacion/lc/out_tamano.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") });

/** La losa de cimentación bajo el edificio, en su planta más baja. */
function conCimentacion(f: ModeloFisico): ModeloFisico {
  const baja = f.plantas[f.plantas.length - 1]!.id;
  const xs = f.pilares!.map((p) => p.x);
  const ys = f.pilares!.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs) - 0.6, Math.max(...xs) + 0.6, Math.min(...ys) - 0.6, Math.max(...ys) + 0.6];
  const material = f.materiales.find((m) => m.tipo === "hormigon")!.id;
  return {
    ...f,
    pilares: f.pilares!.map((p) => {
      if (p.desde !== baja) return p;
      const { base: _b, ...q } = p;
      return q;
    }),
    losas: [...(f.losas ?? []), { id: "LCIM", planta: baja, contorno: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], espesor: 0.8, material, cimentacion: { balasto: 40000 } }],
  };
}

const MODELOS: [string, ModeloFisico][] = [
  ["edificio objetivo con vigas", conAcciones(edificioObjetivoLosas())],
  ["edificio reticular objetivo", conAcciones(edificioReticular())],
  ["edificio objetivo con losa plana", sinVigas(edificioObjetivoLosas())],
];
console.log("| Modelo | Ecuaciones sin la losa | Con la losa de cimentación | Cambio | Nudos de la losa | Perfil móvil (200 000) |");
console.log("|---|---|---|---|---|---|");
const ecuaciones = (f: ModeloFisico) => {
  const r = compilar(f);
  if (!r.valido) throw new Error(r.diagnosticos.filter((d) => d.severidad === "error").map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  const c = calcular(r.modelo);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  return { ecs: c.estadisticas.ecuaciones, losa: r.mapeo.cimentacion?.LCIM?.nudos.length ?? 0 };
};
for (const [nombre, f] of MODELOS) {
  process.stderr.write(`${nombre}\n`);
  const a = ecuaciones(f);
  const b = ecuaciones(conCimentacion(f));
  console.log(`| ${nombre} | ${a.ecs} | ${b.ecs} | +${((100 * (b.ecs - a.ecs)) / a.ecs).toFixed(1)} % | ${b.losa} | ${b.ecs <= 200000 ? "cabe" : "no cabe"} |`);
}
