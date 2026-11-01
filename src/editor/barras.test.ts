/**
 * Fase BN2 (`docs/fem3d/barras.md` §5): las barras entre dos niveles en el editor.
 * - La tabla Barras y la carga «barra»: ida y vuelta, y el `dz` (fuera de la tabla) se conserva.
 * - Transformar: mover y volver, girar cuatro veces 90° y dos simetrías dejan los bytes; el modelo
 *   girado o reflejado da los desplazamientos girados o reflejados (el giro de las barras verticales
 *   y de las inclinadas con la simetría).
 * - Estirar (CT2): los extremos y las estaciones de una carga de barra que cruza el corte.
 * - Mover un pilar (CT3): lo siguen las barras con un extremo en su punto fijo.
 * - Renumerar: B1…Bn, con las cargas detrás.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";
import { compilar } from "../compilador/compilar.ts";
import type { Barra, CargaFisica, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { porticoAcero, porticoArriostrado } from "../pruebas/barras.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { estirar, moverPilar } from "./estirar.ts";
import { aplicar, type Operacion } from "./operaciones.ts";
import { lista } from "./referencias.ts";
import { renumerar } from "./renumerar.ts";
import { serializar } from "./serializar.ts";
import { contexto, DEF_TABLAS } from "./tablas.ts";
import { transformar, type Transformacion } from "./transformar.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(__dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const proyecto = (modelo: ModeloFisico): Proyecto => ({ esquema: VERSION_ESQUEMA, modelo });
function aplicado(m: ModeloFisico, o: Operacion): ModeloFisico {
  const a = aplicar(proyecto(m), o);
  if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" | "));
  return a.proyecto.modelo;
}
function transformado(m: ModeloFisico, ids: readonly string[], t: Transformacion): ModeloFisico {
  const r = transformar(m, ids, t);
  if (!r.ok) throw new Error(r.mensaje);
  return aplicado(m, r.operacion);
}
const todo = (m: ModeloFisico) => ["pilares", "vigas", "barras", "losas", "cargas", "apoyos"].flatMap((c) => lista(m, c as "pilares").map((o) => o.id));

describe("BN2: la tabla Barras y la carga en barra", () => {
  const m = porticoArriostrado();
  const ctx = contexto(m);
  it("ida y vuelta de cada barra y de cada carga", () => {
    for (const b of m.barras!) {
      const f = DEF_TABLAS.barras.fila(b as never, ctx);
      const r = DEF_TABLAS.barras.objeto(f, ctx, b as never);
      expect(r.ok && r.objeto).toStrictEqual(b);
    }
    for (const c of m.cargas!) {
      const f = DEF_TABLAS.cargas.fila(c as never, ctx);
      const r = DEF_TABLAS.cargas.objeto(f, ctx, c as never);
      expect(r.ok && JSON.parse(JSON.stringify(r.objeto))).toStrictEqual(c);
    }
  });
  it("una fila nueva, sin el giro ni las liberaciones", () => {
    const r = DEF_TABLAS.barras.objeto({ id: "B9", plantaInicio: "C", xInicio: "0", yInicio: "0", plantaFin: "P1", xFin: "2,5", yFin: "0", seccion: "t" }, ctx);
    expect(r.ok && JSON.parse(JSON.stringify(r.objeto))).toStrictEqual({ id: "B9", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 2.5, y: 0 }, seccion: "t" });
    expect(DEF_TABLAS.barras.objeto({ id: "B9", plantaInicio: "C", xInicio: "0", yInicio: "0", plantaFin: "P1", xFin: "", yFin: "0", seccion: "t" }, ctx).ok).toBe(false);
  });
  it("el dz, que la tabla no edita, se conserva", () => {
    const b: Barra = { ...m.barras![0]!, fin: { ...m.barras![0]!.fin, dz: 1.2 } };
    const r = DEF_TABLAS.barras.objeto(DEF_TABLAS.barras.fila(b as never, ctx), ctx, b as never);
    expect(r.ok && r.objeto).toStrictEqual(b);
  });
  it("se ve en las plantas de sus dos extremos", () => {
    expect(DEF_TABLAS.barras.plantas(m.barras![0] as never, ctx)).toEqual(["C", "P1"]);
  });
});

describe("BN2: transformar", () => {
  const m = porticoArriostrado();
  const bytes = serializar(proyecto(m));
  it("mover y volver, girar cuatro veces 90° y dos simetrías dejan los bytes", () => {
    const ids = todo(m);
    const ida = transformado(m, ids, { tipo: "mover", de: [0, 0], a: [3.25, -1.5] });
    expect(serializar(proyecto(transformado(ida, ids, { tipo: "mover", de: [3.25, -1.5], a: [0, 0] })))).toBe(bytes);
    let g = m;
    for (let k = 0; k < 4; k++) g = transformado(g, ids, { tipo: "girar", centro: [1, 2], angulo: 90 });
    expect(serializar(proyecto(g))).toBe(bytes);
    const s = transformado(transformado(m, ids, { tipo: "simetria", a: [2.5, 0], b: [2.5, 1] }), ids, { tipo: "simetria", a: [2.5, 0], b: [2.5, 1] });
    expect(serializar(proyecto(s))).toBe(bytes);
  });

  // El pórtico de acero (sin losas: la misma estructura, sin una malla que dependa del giro)
  const resolver = (f: ModeloFisico) => {
    const r = compilar(f);
    if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
    return { modelo: r.modelo, casos: casosValidos(calcular(r.modelo, { solver: "perfil" })) };
  };
  /** Peor error de los desplazamientos de B frente a los de A transformados (traslaciones con M, giros con det(M)·M). */
  const error = (a: ReturnType<typeof resolver>, b: ReturnType<typeof resolver>, M: [number, number, number, number], p: (q: Vec2) => Vec2) => {
    const clave = (m: ModeloAnalitico, i: number) => `${m.nudos[i]!.x.toFixed(6)},${m.nudos[i]!.y.toFixed(6)},${m.nudos[i]!.z.toFixed(6)}`;
    const idxB = new Map(b.modelo.nudos.map((_, i) => [clave(b.modelo, i), i]));
    const det = M[0] * M[3] - M[1] * M[2];
    let [dif, esc] = [0, 0];
    a.casos.forEach((ca, c) => {
      a.modelo.nudos.forEach((n, i) => {
        if (!(a.modelo.barras ?? []).some((x) => x.nudos.includes(i))) return;
        const [x, y] = p([n.x, n.y]);
        const j = idxB.get(`${x.toFixed(6)},${y.toFixed(6)},${n.z.toFixed(6)}`);
        if (j === undefined) throw new Error(`sin pareja: ${clave(a.modelo, i)}`);
        for (const [g, s] of [[0, 1], [3, det]] as const) {
          const [ux, uy, uz] = [ca.u[6 * i + g]!, ca.u[6 * i + g + 1]!, ca.u[6 * i + g + 2]!];
          const t = [s * (M[0] * ux + M[1] * uy), s * (M[2] * ux + M[3] * uy), s * uz];
          for (let k = 0; k < 3; k++) {
            dif = Math.max(dif, Math.abs(t[k]! - b.casos[c]!.u[6 * j + g + k]!));
            esc = Math.max(esc, Math.abs(b.casos[c]!.u[6 * j + g + k]!));
          }
        }
      });
    });
    return dif / esc;
  };
  const f = porticoAcero();
  const a = resolver(f);
  it("girado 37°, los desplazamientos girados (barras verticales e inclinadas con giro)", () => {
    const t = (37 * Math.PI) / 180;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const g = transformado(f, todo(f), { tipo: "girar", centro: [0, 0], angulo: 37 });
    expect(error(a, resolver(g), [c, -s, s, c], (q) => [c * q[0] - s * q[1], s * q[0] + c * q[1]])).toBeLessThan(1e-9);
  });
  it("reflejado, los desplazamientos reflejados", () => {
    const g = transformado(f, todo(f), { tipo: "simetria", a: [3, 0], b: [3, 1] });
    expect(error(a, resolver(g), [-1, 0, 0, 1], (q) => [6 - q[0], q[1]])).toBeLessThan(1e-9);
    const h = transformado(f, todo(f), { tipo: "simetria", a: [0, 0], b: [1, 1] });
    expect(error(a, resolver(h), [0, 1, 1, 0], (q) => [q[1], q[0]])).toBeLessThan(1e-9);
  });
});

describe("BN2: estirar, mover un pilar y renumerar", () => {
  const base = (): ModeloFisico => ({
    plantas: [
      { id: "P1", altura: null },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "S", tipo: "acero" }],
    secciones: [{ id: "t", material: "S", forma: "general", A: 1e-3, Iy: 1e-6, Iz: 1e-6, J: 2e-6 }],
    pilares: [
      { id: "PA", x: 0, y: 0, desde: "C", hasta: "P1", seccion: "t" },
      { id: "PB", x: 6, y: 0, desde: "C", hasta: "P1", seccion: "t" },
    ],
    barras: [{ id: "D", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 6, y: 0 }, seccion: "t" }],
    casos: [{ id: "Q" }],
    cargas: [{ tipo: "barra", id: "q", caso: "Q", barra: "D", ejes: "global", q: [0, 0, -1], desde: 1, hasta: 4 }],
  });
  it("estirar: el fin se mueve y las estaciones se vuelven a medir en la barra nueva", () => {
    const m = base();
    const r = estirar(m, { n: [1, 0], fijo: 0, movil: 6 }, 8);
    if (!r.ok) throw new Error(r.mensaje);
    const g = aplicado(m, r.operacion);
    expect(g.barras![0]!.fin).toEqual({ planta: "P1", x: 8, y: 0 });
    expect(r.afectados.alargan).toContain("D");
    // Los dos puntos de la carga están antes del corte (en planta, a 6·s/√45 ≤ 5,5 m): se quedan donde estaban
    const c = g.cargas![0]! as Extract<CargaFisica, { tipo: "barra" }>;
    const enPlanta = (s: number, L: number, l: number) => (s / L) * l;
    expect(enPlanta(c.desde!, Math.sqrt(73), 8)).toBeCloseTo(enPlanta(1, Math.sqrt(45), 6), 9);
    expect(enPlanta(c.hasta!, Math.sqrt(73), 8)).toBeCloseTo(enPlanta(4, Math.sqrt(45), 6), 9);
  });
  it("mover un pilar: lo siguen las barras que acaban en su punto fijo; con Ctrl, no", () => {
    const m = base();
    const r = moverPilar(m, "PA", [0.5, 0.2]);
    if (!r.ok) throw new Error(r.mensaje);
    expect(aplicado(m, r.operacion).barras![0]!.inicio).toEqual({ planta: "C", x: 0.5, y: 0.2 });
    expect(r.vigas).toEqual(["D"]);
    const s = moverPilar(m, "PA", [0.5, 0.2], false);
    if (!s.ok) throw new Error(s.mensaje);
    expect(aplicado(m, s.operacion).barras![0]!.inicio).toEqual({ planta: "C", x: 0, y: 0 });
    expect(s.avisos).toEqual(["La barra D acaba en PA y se queda donde estaba."]);
  });
  it("renumerar: B1…, con las cargas detrás", () => {
    const m = porticoArriostrado();
    const r = renumerar(m);
    const ids = r.modelo.barras!.map((b) => b.id);
    expect([...ids].sort()).toEqual(["B1", "B2", "B3", "B4"]);
    for (const c of r.modelo.cargas!) if (c.tipo === "barra") expect(ids).toContain(c.barra);
    expect(r.mapa.get("T1")).toBeDefined();
  });
});
