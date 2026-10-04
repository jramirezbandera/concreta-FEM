/**
 * Criterio 1 de C3: los muros del ejemplo 15 de ETABS (E6, `validacion/e6/etabs15.ts`) descritos
 * como modelo físico y mallados por el compilador.
 *
 * - 15a: un muro de L de largo y 1, 3 o 6 plantas.
 * - 15b: dos muros de 40 in y t = 20 (los «pilares») en la planta 1 y un muro de 280 in encima.
 * - 15c: un muro de 360 + Lb in con un hueco por planta de Lb × 80 in desde el forjado (el dintel es
 *   lo que queda encima, 40 in).
 * - 15d: el núcleo en C como un solo muro (polilínea de 6 puntos).
 * - 15e: tres muros colineales (los extremos de 30 × 18 y el alma de t = 8).
 * - 15f: el alma de −120 a 120 y tres alas que acaban en ella (dos en sus extremos y una en T).
 *
 * Plantas de 120 in, base empotrada en N0 (sin diafragma, C1-d) y diafragma rígido en las demás
 * (sin losas: todos los nudos de la cota, también los de lo alto de los dinteles, C1-e y C3-d), como
 * el modelo de E6 con la geometría del PDF. Carga de 100 k en la cabeza, en el punto de la carga.
 */
import type { ModeloFisico, Muro, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { calcular, type OpcionesCalculo } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { IN, KIP } from "../e6/csi.ts";
import type { MuroEtabs } from "../e6/etabs15.ts";

const E = (3000 * KIP) / IN ** 2;
const NU = 0.2;
const PLANTA = 120;
const P = 100 * KIP;

const pt = (x: number, y: number) => [x * IN, y * IN] as const;

/** El muro del ejemplo 15 como modelo físico. */
export function fisicoEtabs(m: MuroEtabs): ModeloFisico {
  const n = m.plantas;
  const plantas = Array.from({ length: n + 1 }, (_, i) => ({ id: `N${n - i}`, altura: i === 0 ? null : PLANTA * IN }));
  const muro = (id: string, puntos: (readonly [number, number])[], t: number, desde = 0, hasta = n, huecos?: Muro["huecos"]): Muro => ({
    id,
    puntos: puntos.map(([x, y]) => pt(x, y)),
    desde: `N${desde}`,
    hasta: `N${hasta}`,
    espesor: t * IN,
    material: "H",
    ...(huecos ? { huecos } : {}),
  });
  const familia = m.id.slice(0, 3);
  let muros: Muro[];
  if (familia === "15a") muros = [muro("M", [m.panos[0]!.p0, m.panos[0]!.p1], 12)];
  else if (familia === "15b") muros = [muro("P1", [[-20, 0], [20, 0]], 20, 0, 1), muro("P2", [[220, 0], [260, 0]], 20, 0, 1), { ...muro("M", [[-20, 0], [260, 0]], 12, 1, 3), base: "ninguno" }];
  else if (familia === "15c") {
    const Lb = m.dinteles![1] - m.dinteles![0];
    const huecos = Array.from({ length: n }, (_, k) => ({ desde: 240 * IN, hasta: (240 + Lb) * IN, z0: PLANTA * k * IN, z1: (PLANTA * k + 80) * IN }));
    muros = [muro("M", [[0, 0], [360 + Lb, 0]], 12, 0, n, huecos)];
  } else if (familia === "15d")
    muros = [
      muro(
        "C",
        [m.panos[0]!.p0, ...m.panos.map((p) => p.p1)].map((p) => [p[0], p[1]] as const),
        6,
      ),
    ];
  else if (familia === "15e") muros = [muro("E1", [[-15, 0], [15, 0]], 18), muro("E2", [[15, 0], [195, 0]], 8), muro("E3", [[195, 0], [225, 0]], 18)];
  else
    muros = [
      muro("ALMA", [[-120, 0], [120, 0]], 6),
      muro("A1", [[-120, 0], [-120, -120]], 6),
      muro("A2", [[0, 0], [0, -120]], 6),
      muro("A3", [[120, 0], [120, -120]], 6),
    ];
  return {
    plantas,
    materiales: [{ id: "H", tipo: "general", E, G: E / (2 * (1 + NU)), peso: 0 }],
    secciones: [],
    muros,
    casos: m.direcciones.map((d) => ({ id: d })),
    cargas: m.direcciones.map((d) => ({ tipo: "puntual" as const, id: `F${d}`, caso: d, planta: `N${n}`, x: m.carga[0] * IN, y: m.carga[1] * IN, F: (d === "X" ? [P, 0, 0] : [0, P, 0]) as [number, number, number] })),
  };
}

/** Nudo del modelo analítico en (x, y, z) (in). */
export function nudoEn(modelo: ModeloAnalitico, x: number, y: number, z: number): number {
  const i = modelo.nudos.findIndex((v) => Math.abs(v.x - x * IN) < 1e-9 && Math.abs(v.y - y * IN) < 1e-9 && Math.abs(v.z - z * IN) < 1e-9);
  if (i < 0) throw new Error(`no hay nudo en (${x}, ${y}, ${z})`);
  return i;
}

/** Resultados del muro físico con elementos de ~h in, en in y rad, con las claves de `sap`. */
export function resultadosFisico(m: MuroEtabs, h: number, op: OpcionesCompilacion = {}, opciones: OpcionesCalculo = {}): Record<string, number> & { nudos: number; laminas: number } {
  const r = valido(compilar(fisicoEtabs(m), { tamanoMalla: h * IN, ...op }));
  const casos = casosValidos(calcular(r.modelo, opciones));
  const [x, y] = m.carga;
  const cabeza = nudoEn(r.modelo, x, y, PLANTA * m.plantas);
  const out: Record<string, number> = {};
  m.direcciones.forEach((d, k) => {
    const u = casos[k]!.u;
    if (d === "X") {
      out.X = u[6 * cabeza]! / IN;
      if (m.direcciones.length > 1) out.RZ = u[6 * cabeza + 5]!;
      if (m.id === "15b") {
        out.X2 = u[6 * nudoEn(r.modelo, x, y, 2 * PLANTA)]! / IN;
        out.X1 = u[6 * nudoEn(r.modelo, x, y, PLANTA)]! / IN;
      }
    } else out.Y = u[6 * cabeza + 1]! / IN;
  });
  return { ...out, nudos: r.modelo.nudos.length, laminas: r.modelo.laminas?.length ?? 0 };
}

if (import.meta.main) {
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { iniciarNucleo } = await import("../../src/nucleo/index.ts");
  const { murosEtabs15, resultadosMuro } = await import("../e6/etabs15.ts");
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const lineas = [
    `# validacion/c3/etabs15.ts — ${new Date().toLocaleDateString("sv-SE")}: los muros de ETABS 15 como modelo físico (C3), frente al modelo a mano de E6; desplazamientos en in, giros en rad`,
    "Malla del compilador con h = la intermedia de E6 (h(1)); «a mano h» es el modelo de E6 con ese h y «a mano fina», con su malla más fina (h(2)).",
    "",
    "| muro | magnitud | SAP2000 | físico | a mano h | físico − a mano h | a mano fina | físico − fina | físico − SAP | nudos físico / a mano | s |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  let peorMisma = 0;
  for (const m of murosEtabs15()) {
    const h = m.h(1);
    const t0 = performance.now();
    const f = resultadosFisico(m, h);
    const t = (performance.now() - t0) / 1000;
    const a = resultadosMuro(m, h);
    const fina = resultadosMuro(m, m.h(2));
    for (const k of Object.keys(m.sap)) {
      const d = f[k]! / a[k]! - 1;
      if (!m.id.startsWith("15d")) peorMisma = Math.max(peorMisma, Math.abs(d));
      lineas.push(
        `| ${m.id} | ${k} | ${m.sap[k]} | ${f[k]!.toPrecision(6)} | ${a[k]!.toPrecision(6)} (h = ${h}) | ${d.toExponential(2)} | ${fina[k]!.toPrecision(6)} (h = ${m.h(2)}) | ${(100 * (f[k]! / fina[k]! - 1)).toFixed(2)} % | ${(100 * (f[k]! / m.sap[k]! - 1)).toFixed(2)} % | ${f.nudos} / ${a.nudos} | ${t.toFixed(2)} |`,
      );
    }
  }
  lineas.push("", `Peor diferencia con el modelo a mano de la misma malla (todos menos 15d): ${peorMisma.toExponential(2)}`);
  const texto = lineas.join("\n");
  console.log(texto);
  writeFileSync(join(import.meta.dirname, "out_etabs15.txt"), texto + "\n");
}
