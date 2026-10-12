/**
 * Sondeo: qué hace hoy el compilador con plantas no ortogonales (`src/pruebas/geometrias.ts`).
 * Cada familia, con la malla por defecto (rejilla, h = 0,75), con la triangulación sola (h = 0,75) y
 * con la referencia fina (triangulación, h = 0,3): validez, diagnósticos, nudos, cobertura de la
 * rejilla, plantillas, jacobiano, equilibrio, reacciones de los pilares (G + Q), flecha máxima por
 * planta (G + Q) y desplome medio de la planta de arriba (Vx).
 *
 * Uso: bun validacion/geom/sondeo.ts > validacion/geom/out_sondeo.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioGeometria, FAMILIAS, type OpcionesGeometria } from "../../src/pruebas/geometrias.ts";

interface Medida {
  valido: boolean;
  errores: string[];
  avisos: string[];
  nudos: number;
  cobertura: number;
  plantillas: number;
  jac: number;
  eq: number;
  reac: Map<string, number>;
  flecha: Map<string, number>;
  deriva: number;
}

function medir(f: ModeloFisico, op: OpcionesCompilacion): Medida {
  const r = compilar(f, op);
  const codigos = (sev: string) => [...new Set(r.diagnosticos.filter((d) => d.severidad === sev).map((d) => d.codigo))];
  const vacia: Medida = { valido: false, errores: codigos("error"), avisos: codigos("aviso"), nudos: 0, cobertura: 0, plantillas: 0, jac: 0, eq: NaN, reac: new Map(), flecha: new Map(), deriva: NaN };
  if (!r.valido) {
    vacia.errores.push(...r.diagnosticos.filter((d) => d.severidad === "error").slice(0, 3).map((d) => `  · ${d.mensaje}`));
    return vacia;
  }
  const m = r.modelo;
  const c = calcular(m);
  if (!c.valido) return { ...vacia, errores: c.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`) };
  const k = (id: string) => m.casos.findIndex((x) => x.id === id);
  const [G, Q, Vx] = [c.casos[k("G")]!, c.casos[k("Q")]!, c.casos[k("Vx")]!];
  const reac = new Map<string, number>();
  for (const [clave, n] of Object.entries(r.mapeo.nudosPilar)) if (clave.endsWith("@C")) reac.set(clave, G.reacciones[6 * n + 2]! + Q.reacciones[6 * n + 2]!);
  const cotas = new Map<number, number>();
  m.nudos.forEach((n, i) => cotas.set(n.z, Math.min(cotas.get(n.z) ?? 0, G.u[6 * i + 2]! + Q.u[6 * i + 2]!)));
  const flecha = new Map([...cotas].filter(([z]) => z > 0).map(([z, w]) => [z.toFixed(2), w]));
  const zmax = Math.max(...m.nudos.map((n) => n.z));
  const arriba = Object.entries(r.mapeo.nudosPilar).filter(([, n]) => m.nudos[n]!.z === zmax).map(([, n]) => n);
  const e = r.estadisticas;
  return {
    valido: true,
    errores: [],
    avisos: codigos("aviso"),
    nudos: e.nudos,
    cobertura: e.malla.laminasRejilla / Math.max(1, e.laminas - e.laminasMuros),
    plantillas: e.malla.plantillas,
    jac: e.malla.jacobianoMin,
    eq: Math.max(...c.casos.map((x) => Math.max(x.equilibrio.fuerzas, x.equilibrio.momentos))),
    reac,
    flecha,
    deriva: arriba.reduce((s, n) => s + Vx.u[6 * n]!, 0) / arriba.length,
  };
}

/** Peor diferencia de las reacciones, relativa a la reacción media, y de las flechas, relativa a cada una. */
function frente(a: Medida, ref: Medida) {
  const media = [...ref.reac.values()].reduce((s, x) => s + Math.abs(x), 0) / ref.reac.size;
  let dr = 0;
  for (const [id, x] of ref.reac) dr = Math.max(dr, Math.abs((a.reac.get(id) ?? NaN) - x) / media);
  let df = 0;
  for (const [z, w] of ref.flecha) df = Math.max(df, Math.abs((a.flecha.get(z) ?? NaN) / w - 1));
  return { dr, df, dd: a.deriva / ref.deriva - 1 };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const pc = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(2)} %` : "—");
  const variantes: [string, OpcionesGeometria][] = [
    ["", {}],
    ["con hueco", { hueco: true }],
    ["girada 23°", { giro: 23 }],
    ["pilares circulares", { circulares: true }],
  ];
  console.log(`# validacion/geom/sondeo.ts — ${new Date().toLocaleDateString("sv-SE")}: plantas no ortogonales, 2 plantas`);
  console.log("");
  console.log("| familia | variante | malla | válido | nudos | rejilla | plantillas | jac. mín. | equilibrio | reacciones | flechas | desplome | avisos |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const fallos: string[] = [];
  for (const fam of FAMILIAS)
    for (const [nv, ov] of variantes) {
      const f = edificioGeometria(fam, ov);
      const ref = medir(f, { tamanoMalla: 0.3, rejilla: false });
      for (const [nm, op] of [
        ["ref. triangulación 0,3", null],
        ["triangulación 0,75", { tamanoMalla: 0.75, rejilla: false }],
        ["rejilla 0,75", { tamanoMalla: 0.75 }],
      ] as const) {
        const x = op ? medir(f, op) : ref;
        if (!x.valido) fallos.push(`${fam} ${nv} ${nm}:\n${x.errores.join("\n")}`);
        const d = x.valido && ref.valido && op ? frente(x, ref) : null;
        console.log(
          `| ${fam} | ${nv} | ${nm} | ${x.valido ? "sí" : "**no**"} | ${x.nudos} | ${pc(x.cobertura)} | ${x.plantillas} | ${x.jac.toFixed(3)} | ${x.eq.toExponential(1)} | ${d ? pc(d.dr) : ""} | ${d ? pc(d.df) : ""} | ${d ? pc(d.dd) : ""} | ${[...x.avisos, ...x.errores.filter((e) => !e.startsWith(" "))].join(", ")} |`,
        );
      }
    }
  if (fallos.length) console.log(["", "## Fallos", "", ...fallos].join("\n"));
}
