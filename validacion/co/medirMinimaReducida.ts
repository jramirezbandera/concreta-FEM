/**
 * CO3-k (docs/fem3d/comprobaciones.md §8.15): la armadura mínima reducida de las losas de cimentación
 * (`obra.armado.minimaReducidaCimentacion`). Lo que propone `proponerLosa` en una losa de cimentación
 * de 60 cm bajo una losa plana de 3 × 3 pilares, con la opción y sin ella: la base, los refuerzos, el
 * acero y lo que manda.
 *
 *   bun validacion/co/medirMinimaReducida.ts > validacion/co/out_medirMinimaReducida.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { ARMADURAS_FORJADO, areaBarrasForjado, textoBarrasForjado, type ArmadoForjado, type DatosArmado } from "../../src/comprobaciones/armado.ts";
import { proponerLosa } from "../../src/comprobaciones/armar/losas.ts";
import { demandasLosa } from "../../src/comprobaciones/demandas/losas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { losaPlana } from "./modelosLosas.ts";

const RAIZ = join(import.meta.dirname, "..", "..");

/** La losa plana de las pruebas de CO3 (3 × 3 pilares) sobre una losa de cimentación `LC` de canto `canto` (m). */
export function conLosaCimentacion(o: { luz?: number; cm?: number; q?: number; canto?: number; balasto?: number } = {}): ModeloFisico {
  const f = losaPlana({ luz: o.luz ?? 6, cm: o.cm ?? 2, q: o.q ?? 3 });
  const arriba = f.losas!.find((l) => l.id === "L")!;
  return { ...f, losas: [...f.losas!, { id: "LC", planta: "CIM", contorno: arriba.contorno, espesor: o.canto ?? 0.6, material: arriba.material, cimentacion: { balasto: o.balasto ?? 40000 } }] };
}

/** kg de acero de un armado de losa maciza: la base en su área y cada refuerzo en su rectángulo (sin solapes ni patillas). */
export function aceroLosa(a: ArmadoForjado, area: number): { base: number; refuerzos: number } {
  const kg = (mm2PorM: number, m2: number) => (mm2PorM / 1e6) * m2 * 7850;
  const base = ARMADURAS_FORJADO.reduce((t, k) => t + kg(areaBarrasForjado(a.base[k]), area), 0);
  const refuerzos = (a.refuerzos ?? []).reduce((t, r) => t + kg(areaBarrasForjado(r.barras), (r.s[1] - r.s[0]) * (r.t[1] - r.t[0])), 0);
  return { base, refuerzos };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  for (const [nombre, o] of [
    ["una planta, cargas de vivienda (CM 2, Q 3 kN/m²)", {}],
    ["una planta muy cargada (CM 12, Q 20 kN/m²)", { cm: 12, q: 20 }],
    ["lo mismo, con la losa de 80 cm", { cm: 12, q: 20, canto: 0.8 }],
  ] as const) {
    const f = conLosaCimentacion(o);
    const c = compilar(f);
    if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
    const r = calcular(c.modelo);
    if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
    const q = new Consultas(f, c, r.casos, {}, r.modal);
    const d = demandasLosa(q, "LC");
    if (!d.valido) throw new Error(d.diagnosticos.map((x) => x.mensaje).join("\n"));
    const lc = f.losas!.find((l) => l.id === "LC")!;
    const xs = lc.contorno.map((p) => p[0]);
    const ys = lc.contorno.map((p) => p[1]);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    console.log(`== ${nombre}: losa de cimentación de ${lc.espesor * 100} cm, ${area.toFixed(1)} m²`);
    for (const [caso, datos] of [["sin la opción (la mínima de la ec. 9.1)", undefined], ["con la mínima reducida", { minimaReducidaCimentacion: true }]] as [string, DatosArmado | undefined][]) {
      const t0 = performance.now();
      const p = proponerLosa(d.valor, datos);
      const ms = performance.now() - t0;
      if (!p.armado || !p.comprobacion) {
        console.log(`  ${caso}: sin propuesta (${p.motivo})`);
        continue;
      }
      const a = p.armado;
      const kg = aceroLosa(a, area);
      const manda = [...p.comprobacion.filas].filter((x) => Number.isFinite(x.aprovechamiento)).sort((x, y) => y.aprovechamiento - x.aprovechamiento)[0];
      const minimas = p.comprobacion.filas.filter((x) => /as-min/.test(x.id));
      console.log(`  ${caso}:`);
      console.log(`    base ${ARMADURAS_FORJADO.map((k) => `${k} ${textoBarrasForjado(a.base[k])}`).join(" · ")}`);
      console.log(`    refuerzos ${a.refuerzos?.length ?? 0}${a.refuerzos?.length ? ` (${a.refuerzos.map((x) => `${x.armadura} ${textoBarrasForjado(x.barras)} ${(x.s[1] - x.s[0]).toFixed(2)}×${(x.t[1] - x.t[0]).toFixed(2)}`).join("; ")})` : ""}`);
      console.log(`    acero ${(kg.base + kg.refuerzos).toFixed(0)} kg (base ${kg.base.toFixed(0)}, refuerzos ${kg.refuerzos.toFixed(0)}); cumple ${p.comprobacion.cumple}; sin refuerzo ${p.sinRefuerzo.length}; manda ${manda?.id} ${manda?.aprovechamiento.toFixed(3)}`);
      console.log(`    filas de la mínima: ${[...new Set(minimas.map((x) => `${x.id} ${x.estado}`))].join(", ")}; la mayor ${Math.max(0, ...minimas.map((x) => x.aprovechamiento)).toFixed(3)}; ${p.probados} armados probados en ${(ms / 1000).toFixed(1)} s`);
    }
    console.log("");
  }
}
