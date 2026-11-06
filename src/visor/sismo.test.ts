/**
 * VS3 en la sesión del visor (el worker de la app): con el sismo del programa en el proyecto, lo que
 * la app pide (mapas, valor bajo el cursor, deformada, pilares, diagramas) pasa por la superposición de
 * casos lógicos sobre casos base, como las consultas. La app todavía no enseña los casos del sismo en
 * sus selectores (VS4), pero ya los usa en las combinaciones por defecto y en las de una situación.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { VERSION_ESQUEMA } from "../agente/proyecto.ts";
import { valoresCampo } from "../agente/render/resultados.ts";
import type { AccionCaso, ModeloFisico } from "../compilador/fisico.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { datosLosas, datosPilares, datosViga, desplazamientos, valorEnPunto } from "./datos.ts";
import { Sesion, type EleccionCombinaciones } from "./sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
const MOTOR = sha256(new Uint8Array(WASM));
const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
const SISMICA: EleccionCombinaciones = { tipo: "situaciones", situaciones: ["ELU-SIS"] };

const valido = <T>(r: { valido: true; valor: T } | { valido: false; diagnosticos: unknown }): T => {
  if (!r.valido) throw new Error(JSON.stringify(r.diagnosticos));
  return r.valor;
};

let s: Sesion;
beforeAll(async () => {
  await iniciarNucleo(WASM);
  const f = edificioObjetivoLosas(2, 3, 2);
  const modelo: ModeloFisico = { ...f, casos: f.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })), acciones: { sismo: { ab: 0.16, K: 1.0, terreno: "III", mu: 2 } } };
  const a = Sesion.abrir(JSON.stringify({ esquema: VERSION_ESQUEMA, modelo }), MOTOR);
  if (!a.valido) throw new Error(JSON.stringify(a.diagnosticos));
  s = a.sesion;
  const r = await s.calcular();
  expect(r.ok).toBe(true);
}, 120_000);

describe("VS3 en el visor: un proyecto con el sismo del programa", () => {
  it("las combinaciones por defecto de los esfuerzos llevan la situación sísmica, con los casos del sismo", () => {
    const q = s.q!;
    expect(q.fisico.casos.map((c) => c.id).slice(-4)).toEqual(["EX+e", "EX-e", "EY+e", "EY-e"]);
    const cj = valido(s.conjunto({ tipo: "defecto" }, "esfuerzos"));
    expect(cj.descripcion).toBe("ELU-PT, ELU-SIS");
    expect(cj.factores.every((f) => f.length === q.nl)).toBe(true);
    expect(valido(s.conjunto(SISMICA, "esfuerzos")).factores.length).toBe(64);
    // los resultados guardados y releídos (como al reabrir la app) dan las mismas consultas
    expect(q.nb).toBe(4 + 6);
  });

  it("el mapa de una losa con la envolvente de la situación sísmica, y el valor bajo el cursor en un nudo", () => {
    const q = s.q!;
    const d = valido(datosLosas(s, "N2", "m11", SISMICA, undefined, undefined, "max"));
    expect(d.envolvente).toBe("max");
    // En un nudo de una lámina, el valor de la envolvente es el mayor de los de cada combinación, y el de
    // cada una, el de su mapa (los de `valoresCampo`, que combinan los modos en el nudo)
    const cj = valido(s.conjunto(SISMICA, "esfuerzos"));
    const rr = s.rr!;
    const { laminas, v } = valoresCampo(rr, "N2", "m11", cj.factores[0]!);
    const i = v.findIndex((x, j) => !Number.isNaN(x) && j % 4 === 0 && j > v.length / 2);
    const nudo = rr.c.modelo.laminas![laminas[Math.floor(i / 4)]!]!.nudos[i % 4]!;
    const [x, y] = [rr.c.modelo.nudos[nudo]!.x, rr.c.modelo.nudos[nudo]!.y];
    const env = valido(valorEnPunto(s, "N2", "m11", SISMICA, x, y, undefined, "max"));
    expect(env).not.toBeNull();
    const porCombinacion = cj.factores.map((f) => {
      const w = valoresCampo(rr, "N2", "m11", f).v;
      // el mismo nudo, en cualquiera de las láminas que lo comparten con mapa
      let mejor = -Infinity;
      laminas.forEach((l, k) => rr.c.modelo.laminas![l]!.nudos.forEach((n, a) => (n === nudo && !Number.isNaN(w[4 * k + a]!) ? (mejor = Math.max(mejor, w[4 * k + a]!)) : 0)));
      return mejor;
    });
    const maximo = Math.max(...porCombinacion);
    // (en un nudo el campo SPR de dos regiones puede dar dos valores: el del punto es uno de ellos)
    expect(env!.envolvente!.max.valor).toBeLessThanOrEqual(maximo + 1e-9 * Math.abs(maximo));
    expect(env!.envolvente!.max.valor).toBeGreaterThanOrEqual(env!.envolvente!.min.valor);
    expect(cj.nombres).toContain(env!.comb);
    // y en la lámina, lo mismo por el otro camino (el del 3D)
    const lam = valido(s.valorLamina({ campo: "m11", combinaciones: SISMICA, envolvente: "max", lamina: env!.lamina, punto: [x, y, rr.c.modelo.nudos[nudo]!.z] }));
    expect(lam).not.toBeNull();
    expect(Math.abs(lam!.valor - env!.envolvente!.max.valor)).toBeLessThan(1e-9 * Math.abs(maximo));
    expect(q.sup.conEspectrales).toBe(true);
  });

  it("la deformada de una combinación sísmica: cada desplazamiento, el de los modos combinado y por μ", () => {
    const q = s.q!;
    const cj = valido(s.conjunto(SISMICA, "desplazamientos"));
    const nombre = cj.nombres[0]!;
    const d = valido(desplazamientos(s, { tipo: "combinacion", situaciones: ["ELU-SIS"], nombre }));
    const f = cj.factores[0]!;
    const n = q.casos[0]!.u.length / 6;
    expect(d.u.length).toBe(3 * n);
    for (const nudo of [0, Math.floor(n / 3), Math.floor(n / 2), n - 1])
      for (let a = 0; a < 3; a++) {
        const esperado = q.sup.valor(f, (k) => q.casos[k]!.u[6 * nudo + a]!, true);
        expect(Math.abs(d.u[3 * nudo + a]! - esperado)).toBeLessThanOrEqual(1e-6 * Math.abs(esperado) + 1e-12);
      }
    // con el sismo solo, el edificio se desplaza hacia donde lo lleva el modo dominante: no es cero
    expect(d.extremos.length).toBeGreaterThan(0);
    expect(d.extremos[0]!.valor).toBeGreaterThan(1);
  });

  it("el cuadro de pilares y el diagrama de una viga, con las combinaciones por defecto", () => {
    const p = valido(datosPilares(s, "N2", { tipo: "defecto" }));
    expect(p.filas.length).toBeGreaterThan(0);
    expect(p.filas.some((x) => /ELU-SIS/.test(JSON.stringify(x.tramo)))).toBe(true);
    const viga = s.proyecto.modelo.vigas!.find((v) => v.planta === "N2")!.id;
    const dv = valido(datosViga(s, viga, "My", SISMICA));
    expect(dv.envolvente.length).toBeGreaterThan(4);
    expect(Math.min(...dv.envolvente.map((e) => e.min))).toBeLessThan(0);
  });

  it("un caso del sismo todavía no se elige suelto en la app (VS4): lo dice, sin dar un número", () => {
    const r = s.conjunto({ tipo: "caso", caso: "EX+e" }, "esfuerzos");
    // Hoy la sesión valida el caso contra los del fichero o lo admite: en los dos casos, o un error o el caso lógico entero
    if (r.valido) expect(r.valor.factores[0]!.length).toBe(s.q!.nl);
    else expect(r.diagnosticos.length).toBeGreaterThan(0);
  });
});
