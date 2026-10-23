/**
 * Criterios 2 y 6 de la fase AB (`docs/fem3d/armado.md` §4), en la sesión del visor: el valor de un
 * punto (`valor-armado`) es el de su estación en «fem consultar franja» bit a bit, y el 3D
 * (`armado3d`) tiene el área de los tramos, la cota de sus losas y, con una planta, los límites y los
 * colores de la planta. Sobre el reticular de H25 con acciones, con la sesión de verdad.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { conAcciones, reticularH25 } from "../../validacion/c5/modelos.ts";
import { ARMADURAS, type ArmadoProyecto, type Armadura } from "../agente/armaduraBase.ts";
import { franja as consultaFranja } from "../agente/consultas.ts";
import { DELTA_MUESTRAS } from "../compilador/esfuerzosFranjas.ts";
import { VERSION_ESQUEMA } from "../agente/proyecto.ts";
import { sha256 } from "../compilador/huella.ts";
import { serializar } from "../editor/serializar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { tramosPlanta, type Armado3D, type ValorArmado } from "./armado.ts";
import { Atendedor } from "./atender.ts";
import type { EscenaPreparada } from "./escena.ts";
import type { DatosArmado } from "./franjas.ts";
import type { Pedido } from "./protocolo.ts";
import type { Sesion } from "./sesion.ts";

const MODELO = conAcciones(reticularH25());
const planta = MODELO.losas![0]!.planta;
let at: Atendedor;

beforeAll(async () => {
  const wasm = readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  at = new Atendedor(sha256(new Uint8Array(wasm)));
  expect((await at.atender({ tipo: "abrir", texto: serializar({ esquema: VERSION_ESQUEMA, modelo: MODELO }) })).ok).toBe(true);
  expect((await at.atender({ tipo: "calcular" })).ok).toBe(true);
}, 120_000);

const pedir = async <T>(p: Pedido): Promise<T> => {
  const r = await at.atender(p);
  if (!r.ok) throw new Error(r.diagnosticos.map((d) => d.mensaje).join(" "));
  return r.valor as T;
};
const sesion = () => (at as unknown as { sesion: Sesion }).sesion;
const conjunto = () => {
  const c = sesion().conjunto({ tipo: "defecto" }, "esfuerzos");
  if (!c.valido) throw new Error();
  return c.valor;
};

describe("valor de un punto (criterio 2)", () => {
  for (const a of ARMADURAS)
    it(`${a}: el centro de cada tramo da su estación de «fem consultar franja»`, async () => {
      const q = sesion().q!;
      const fs = tramosPlanta(q, planta, a, conjunto());
      if (!fs.valido) throw new Error();
      const cara = a.endsWith("inf") ? "inferior" : "superior";
      let n = 0;
      for (const { franja: f, tramos } of fs.valor) {
        const c = consultaFranja(q, conjunto(), f.id);
        if (!c.valido) throw new Error();
        // Uno de cada 7 tramos (todos tarda): el centro de su rectángulo
        for (const t of tramos.filter((_, i) => i % 7 === 0)) {
          const x = (t.rectangulo[0]![0] + t.rectangulo[2]![0]) / 2;
          const y = (t.rectangulo[0]![1] + t.rectangulo[2]![1]) / 2;
          const v = await pedir<ValorArmado | null>({ tipo: "valor-armado", planta, armadura: a, combinaciones: { tipo: "defecto" }, x, y });
          const e = c.valor.estaciones[t.estacion]!;
          expect(v?.franja).toBe(f.id);
          expect(v!.estacion).toEqual(e);
          expect([v!.valor, v!.comb]).toEqual(e[cara]);
          expect(v!.base).toBeNull();
          n++;
        }
      }
      expect(n).toBeGreaterThan(50);
      // Fuera de la losa, nada
      expect(await pedir({ tipo: "valor-armado", planta, armadura: a, combinaciones: { tipo: "defecto" }, x: -100, y: -100 })).toBeNull();
    }, 60_000);

  it("con base, la de su losa y el exceso", async () => {
    const armado: ArmadoProyecto = { base: { "x-sup": 10 } };
    const fs = tramosPlanta(sesion().q!, planta, "x-sup", conjunto());
    if (!fs.valido) throw new Error();
    const t = fs.valor[3]!.tramos[5]!;
    const v = (await pedir<ValorArmado | null>({ tipo: "valor-armado", planta, armadura: "x-sup", combinaciones: { tipo: "defecto" }, x: (t.rectangulo[0]![0] + t.rectangulo[2]![0]) / 2, y: (t.rectangulo[0]![1] + t.rectangulo[2]![1]) / 2, armado }))!;
    expect(v.base).toBe(10);
    expect(v.exceso).toBe(v.valor - 10);
  });
});

describe("distanciaMuestras en «fem consultar franja» (LV2-h)", () => {
  it("en las caras y los apoyos, la de la estación si no es δ; en las de paso, nunca", () => {
    const q = sesion().q!;
    let n = 0;
    for (const l of MODELO.losas!) {
      const fs = q.franjas(l.id);
      if (!fs.valido) throw new Error();
      for (const f of fs.valor) {
        const g = q.franja(f.id);
        const c = consultaFranja(q, conjunto(), f.id);
        if (!g.valido || !c.valido) throw new Error();
        g.valor.estaciones.forEach((e, i) => {
          const d = c.valor.estaciones[i]!.distanciaMuestras;
          if (e.tipo === "paso" || e.distanciaMuestras <= DELTA_MUESTRAS) expect(d).toBeUndefined();
          else {
            expect(d).toBe(e.distanciaMuestras);
            n++;
          }
        });
      }
    }
    // Las caras de los pilares tienen la huella detrás: un canto
    expect(n).toBeGreaterThan(0);
  }, 60_000);
});

describe("armado en 3D (criterio 6)", () => {
  const area = (tri: Float32Array) => {
    let s = 0;
    for (let i = 0; i < tri.length; i += 9) {
      const [ax, ay, cx, cy] = [tri[i + 3]! - tri[i]!, tri[i + 4]! - tri[i + 1]!, tri[i + 6]! - tri[i]!, tri[i + 7]! - tri[i + 1]!];
      s += Math.abs(ax * cy - ay * cx) / 2;
    }
    return s;
  };

  const BASE: ArmadoProyecto = { base: { "x-inf": 8, "x-sup": 15, "y-inf": 8, "y-sup": 15 } };
  for (const [nombre, op] of [
    ["sin base", {}],
    ["con base", { armado: BASE }],
    ["con base, sólo lo que no cubre", { armado: BASE, soloExceso: true }],
    ["con filtro", { filtro: { min: 5, max: 20 } }],
  ] as [string, { armado?: ArmadoProyecto; soloExceso?: boolean; filtro?: { min?: number; max?: number } }][])
    it(`${nombre}: el área de los tramos, la cota de las losas y los colores de la planta`, async () => {
      const armado = op.armado;
      for (const a of ["x-inf", "y-sup"] as Armadura[]) {
        const d = await pedir<Armado3D>({ tipo: "armado3d", armadura: a, combinaciones: { tipo: "defecto" }, planta, ...op });
        const fs = tramosPlanta(sesion().q!, planta, a, conjunto());
        if (!fs.valido) throw new Error();
        const ts = fs.valor.flatMap((f) => f.tramos);
        const aT = (t: (typeof ts)[number]) => (t.b - t.a) * (t.t1 - t.t0);
        const total = ts.reduce((s, t) => s + aT(t), 0);
        // En gris, lo cubierto por la base (con «sólo lo que no cubre») y lo de fuera del filtro
        const gris = (t: (typeof ts)[number]) => (op.soloExceso === true && !(t.v > armado!.base![a]!)) || (op.filtro?.min !== undefined && t.v < op.filtro.min) || (op.filtro?.max !== undefined && t.v > op.filtro.max);
        const enGris = ts.filter(gris).reduce((s, t) => s + aT(t), 0);
        // Los búferes son Float32 (respecto al origen): el área, a su precisión
        expect(Math.abs(area(d.triangulos) + area(d.sinMapa) - total) / total).toBeLessThan(1e-6);
        expect(Math.abs(area(d.sinMapa) - enGris) / total).toBeLessThan(1e-6);
        if (op.soloExceso || op.filtro) expect(enGris).toBeGreaterThan(0);
        expect(d.isolineas.length > 0).toBe(!!armado);
        expect(d.plantas).toEqual([planta]);
        expect(d.tituloLeyenda).toContain("kN·m/m");
        // Todos a la cota de las láminas de la losa
        const s = sesion();
        const c = s.compilado!;
        const z = c.modelo.nudos[c.modelo.laminas![(c.mapeo.laminas ?? []).findIndex((m) => m.losa === MODELO.losas![0]!.id)]!.nudos[0]!]!.z - d.origen[2];
        for (let i = 2; i < d.triangulos.length; i += 3) expect(d.triangulos[i]).toBe(Math.fround(z));
        // Con una planta, la leyenda y la escala de su vista en planta
        const e = await pedir<DatosArmado>({ tipo: "armado", planta, combinaciones: { tipo: "defecto" }, armadura: a, ...op });
        const esc: EscenaPreparada = e.escena;
        expect(d.leyenda).toEqual(esc.leyenda);
        expect(d.mapa).toEqual(esc.mapa);
        expect(d.tituloLeyenda).toBe(esc.tituloLeyenda);
        // Con base, las zonas de la tabla son las del 3D
        if (armado) expect(d.zonas).toBe(e.zonas.length);
      }
    }, 60_000);

  it("todas las plantas: una escala común y cada triángulo con su planta", async () => {
    const d = await pedir<Armado3D>({ tipo: "armado3d", armadura: "x-sup", combinaciones: { tipo: "defecto" }, planta: null });
    expect(d.plantas.length).toBeGreaterThan(0);
    expect(d.lamina.length).toBe(d.triangulos.length / 9);
    for (const i of d.lamina) expect(d.plantas[i]).toBeDefined();
  });
});
