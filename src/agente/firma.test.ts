/**
 * La firma del modelo analítico en los resultados guardados (`docs/fem3d/firma-resultados.md`): unos
 * resultados sólo se desempaquetan sobre el modelo que se calculó. Antes, con la misma huella y otra
 * malla (el compilador cambiaba su salida sin cambiar de versión), se leían sobre la malla nueva sin
 * aviso y las franjas salían 60 veces mayores.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { firmas } from "../../validacion/firma/firmas.ts";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { compilar } from "../compilador/compilar.ts";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { desempaquetarResultados, difiereFirma, empaquetarResultados, firmaModelo, type CabeceraResultados, type FirmaModelo } from "./resultados.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const bun = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const compilado = (tamanoMalla: number) => {
  const c = compilar(reticulaConNucleo(), { tamanoMalla });
  if (!c.valido) throw new Error("no compila");
  return c;
};

/** Una copia del modelo con cada número no índice multiplicado por (1 + ε·signo al azar). */
function conRuido(m: ModeloAnalitico, eps: number): ModeloAnalitico {
  let k = 0;
  const indices = new Set(["nudos", "nudo", "barra", "lamina", "maestro", "esclavos", "gdl"]);
  const ir = (v: unknown, indice: boolean): unknown => {
    if (typeof v === "number") return indice || v === 0 ? v : v * (1 + eps * (k++ % 2 ? 1 : -1));
    if (Array.isArray(v)) return v.map((x) => ir(x, indice));
    if (ArrayBuffer.isView(v)) return Float64Array.from(v as unknown as ArrayLike<number>, (x) => ir(x, indice) as number);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([c, x]) => [c, ir(x, indices.has(c))]));
    return v;
  };
  return ir(m, false) as ModeloAnalitico;
}

describe("firma del modelo analítico", () => {
  it("el mismo modelo, compilado otra vez, tiene la misma firma; con otra malla, no", () => {
    const [a, b] = [compilado(1), compilado(1)];
    expect(difiereFirma(firmaModelo(a.modelo), firmaModelo(b.modelo))).toBeNull();
    expect(difiereFirma(firmaModelo(a.modelo), firmaModelo(compilado(0.9).modelo))).toMatch(/malla|valores/);
  });

  it("acepta el ruido de 1e-12 de un motor a otro y no un nudo movido 0,1 mm", () => {
    const m = compilado(1).modelo;
    const f = firmaModelo(m);
    expect(difiereFirma(f, firmaModelo(conRuido(m, 1e-12)))).toBeNull();
    const i = m.nudos.findIndex((n) => Math.abs(n.x) > 1);
    const movido = { ...m, nudos: m.nudos.map((n, j) => (j === i ? { ...n, x: n.x + 1e-4 } : n)) };
    expect(difiereFirma(f, firmaModelo(movido))).toMatch(/«x»/);
    // Un caso de carga más, otra conectividad o una coacción cambian la estructura
    expect(difiereFirma(f, firmaModelo({ ...m, casos: [...m.casos, { id: "otro" }] }))).toMatch(/malla/);
    const ap = m.apoyos!;
    // Una carga más o una carga distinta: por la resultante del caso
    const c0 = m.casos[0]!;
    const masCarga = { ...m, casos: [{ ...c0, nodales: [...(c0.nodales ?? []), { nudo: i, f: [0, 0, -0.01, 0, 0, 0] as const }] }, ...m.casos.slice(1)] };
    expect(difiereFirma(f, firmaModelo(masCarga))).toMatch(/cargas del caso 1/);
    const laminas = c0.laminas ?? [];
    expect(laminas.length).toBeGreaterThan(0);
    const l0 = laminas[0]!;
    if (l0.tipo !== "superficie" || l0.q.length !== 3 || typeof l0.q[0] !== "number") throw new Error("se esperaba una carga de superficie uniforme");
    const q = l0.q as readonly [number, number, number];
    const otraQ = { ...m, casos: [{ ...c0, laminas: [{ ...l0, q: [q[0], q[1], q[2] * 1.001] as const }, ...laminas.slice(1)] }, ...m.casos.slice(1)] };
    expect(difiereFirma(f, firmaModelo(otraQ))).toMatch(/cargas del caso 1/);
    expect(difiereFirma(f, firmaModelo({ ...m, apoyos: [{ ...ap[0]!, coartados: ap[0]!.coartados.map((x, g) => (g === 5 ? !x : x)) as unknown as typeof ap[0]["coartados"] }, ...ap.slice(1)] }))).toMatch(/malla/);
  });

  it("los resultados de una malla no se desempaquetan sobre otra con la misma huella, ni los guardados sin firma", () => {
    const a = compilado(1);
    const r = calcular(a.modelo);
    if (!r.valido) throw new Error("no calcula");
    const { cabecera, bytes } = empaquetarResultados(a.huella, a.modelo, r.casos, r.estadisticas, []);
    // Por el texto, como los guarda la CLI
    const cab = JSON.parse(JSON.stringify(cabecera)) as CabeceraResultados;
    const bien = desempaquetarResultados(cab, bytes, compilado(1).modelo);
    expect("casos" in bien && bien.casos.length).toBe(r.casos.length);
    const otra = desempaquetarResultados(cab, bytes, compilado(0.9).modelo);
    expect("motivo" in otra && otra.motivo).toMatch(/otro modelo analítico/);
    const { modelo: _, ...sinFirma } = cab;
    const vieja = desempaquetarResultados(sinFirma as unknown as CabeceraResultados, bytes, a.modelo);
    expect("motivo" in vieja && vieja.motivo).toMatch(/versión anterior/);
  });

  it.skipIf(!bun)("Bun (JavaScriptCore) y Node (V8) firman igual el mismo modelo", () => {
    const enBun = JSON.parse(execFileSync("bun", [join(RAIZ, "validacion", "firma", "firmas.ts")], { encoding: "utf8", maxBuffer: 1 << 26 })) as { nombre: string; firma: FirmaModelo }[];
    const enNode = firmas();
    expect(enBun.map((x) => x.nombre)).toEqual(enNode.map((x) => x.nombre));
    enNode.forEach((a, i) => expect(difiereFirma(a.firma, enBun[i]!.firma), a.nombre).toBeNull());
  });
});
