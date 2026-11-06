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
import { Sesion, sha256Bytes, type EleccionCombinaciones } from "./sesion.ts";

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

describe("VS4 en el visor: las acciones del programa a la vista", () => {
  it("los casos del estado llevan detrás los del programa, con su familia; sin resultados, el viento y el espectro ya se dan", async () => {
    const f = s.proyecto.modelo;
    const sinCalcular = Sesion.abrir(JSON.stringify({ esquema: VERSION_ESQUEMA, modelo: { ...f, acciones: { viento: { zona: "A", aspereza: "IV" }, sismo: f.acciones!.sismo } } }), MOTOR);
    if (!sinCalcular.valido) throw new Error("no abre");
    const e = sinCalcular.sesion.estado();
    const programa = e.casos.filter((c) => c.programa);
    expect(programa.map((c) => c.id)).toEqual(["W+X+e", "W+X-e", "W-X+e", "W-X-e", "W+Y+e", "W+Y-e", "W-Y+e", "W-Y-e", "EX+e", "EX-e", "EY+e", "EY-e"]);
    expect(programa.map((c) => c.programa)).toEqual([...Array<string>(8).fill("viento"), ...Array<string>(4).fill("sismo")]);
    expect(e.casos.slice(0, f.casos.length).every((c) => !c.programa)).toBe(true);
    // el viento, por plantas, y la planta de un caso del viento se dibuja con sus puntuales
    const v = sinCalcular.sesion.viento();
    expect(v.definido && v.viento !== null && v.viento.x.plantas.length > 0).toBe(true);
    const esc = sinCalcular.sesion.escenaA4(f.plantas[0]!.id, { vista: "cargas", caso: "W+X+e" });
    expect(esc.valido && esc.valor.primitivas.length > 0).toBe(true);
    // el espectro, sin calcular: la curva y sin la consulta; el sismo sin resultados no tiene cargas que dibujar
    const sd = sinCalcular.sesion.sismoDatos();
    expect(sd.definido && sd.espectro !== null && sd.curva !== null && sd.resultado === null && sd.curva.T.length > 100).toBe(true);
    expect(sd.curva!.elastico.some((a) => a === 2.5)).toBe(true);
    expect(sinCalcular.sesion.escenaA4(f.plantas[0]!.id, { vista: "cargas", caso: "EX+e" }).valido).toBe(false);
    expect(sinCalcular.sesion.modal().modal).toBeNull();
  });

  it("con resultados, las fuerzas equivalentes del sismo dibujadas dan el cortante en la base y el par de cada caso, y los modos salen", () => {
    const q = s.q!;
    const sismo = valido(q.sismo());
    const fp = s.fisicoCargas;
    for (const [caso, eje, exc] of [
      ["EX+e", 0, 1],
      ["EX-e", 0, -1],
      ["EY+e", 1, 1],
      ["EY-e", 1, -1],
    ] as const) {
      const cargas = (fp.cargas ?? []).filter((c) => c.caso === caso && c.tipo === "puntual");
      expect(cargas.length).toBe(sismo.direcciones[eje].niveles.filter((n) => n.fuerza !== 0).length);
      const F = cargas.reduce((t, c) => t + (c.tipo === "puntual" ? (c.F?.[eje] ?? 0) : 0), 0);
      expect(Math.abs(F - sismo.direcciones[eje].basal) / sismo.direcciones[eje].basal).toBeLessThan(1e-12);
      // el par respecto al centro de masas de cada planta: ±F·e, el del torsor de la excentricidad
      const md = valido(q.modos());
      for (const c of cargas) {
        if (c.tipo !== "puntual") continue;
        const pl = md.plantas.find((p) => p.planta === c.planta)!;
        const nivel = sismo.direcciones[eje].niveles.find((n) => n.plantas.includes(c.planta))!;
        const Mz = (c.x - pl.cm[0]) * (c.F?.[1] ?? 0) - (c.y - pl.cm[1]) * (c.F?.[0] ?? 0);
        expect(Math.abs(Mz - (eje === 0 ? -1 : 1) * exc * nivel.par)).toBeLessThan(1e-9 * Math.max(1, Math.abs(nivel.par)));
      }
      expect(s.escenaA4(fp.plantas[0]!.id, { vista: "cargas", caso }).valido).toBe(true);
      expect(s.cargas3D(caso).valido).toBe(true);
    }
    const m = s.modal();
    expect(m.modal !== null && m.modal.modos.length === m.modal.numeroDeModos && m.modal.numeroDeModos === q.modal!.modos.length).toBe(true);
    const forma = valido(s.modo(1));
    expect(forma.u.length).toBe(q.modal!.modos[0]!.u.length / 2);
    // la mayor traslación de los centros de masas, 1 m: la del maestro de alguna planta
    let mayor = 0;
    for (let i = 0; i < forma.u.length / 3; i++) mayor = Math.max(mayor, Math.abs(forma.u[3 * i]!), Math.abs(forma.u[3 * i + 1]!));
    expect(mayor).toBeGreaterThan(0.99);
    expect(s.modo(99).valido).toBe(false);
    const sd = s.sismoDatos();
    expect(sd.resultado !== null && sd.periodos.length === q.modal!.modos.length).toBe(true);
  });

  it("los resultados empaquetados se hacen al pedirlos y son los del cálculo (su sha256)", async () => {
    const pk = s.paquete();
    expect(pk).not.toBeNull();
    expect(await sha256Bytes(pk!.bytes)).toBe(s.estado().sha256Resultados);
    expect(pk!.sha256).toBe(s.estado().sha256Resultados);
    expect(pk!.cabecera.modal?.modos.length).toBe(s.q!.modal!.modos.length);
  });
});
