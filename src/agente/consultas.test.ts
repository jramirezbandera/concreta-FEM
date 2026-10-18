/**
 * Criterios 1 y 3 de A1:
 * - 1: cada consulta da lo mismo que `EsfuerzosPiezas`, `Consultas` (C5) y los resultados del
 *   motor llamados a mano;
 * - 3: las envolventes no pierden el máximo: sobre la batería al azar de C1–C4, el extremo de la
 *   consulta es el de todas las piezas, estaciones y combinaciones, y ningún punto de un muestreo
 *   denso lo supera.
 * El tamaño (criterio 2) lo mide `validacion/a1/tamano.ts` en el edificio objetivo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { conAcciones, conPropuesta } from "../../validacion/c5/modelos.ts";
import { DiagramaBarra } from "../elementos/cargasBarra.ts";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../compilador/fisico.ts";
import { EsfuerzosPiezas } from "../compilador/resultados.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../pruebas/forjadosAleatorios.ts";
import { conLosasAleatorias } from "../pruebas/losasAleatorias.ts";
import { conMurosAleatorios } from "../pruebas/murosAleatorios.ts";
import { conjuntoCombinaciones, factoresExpresion, seleccionPorDefecto, type ConjuntoCombinaciones } from "./combinaciones.ts";
import { banda, consultar, deriva, envolventes, EXTREMOS, flechas, pieza, reacciones, resumen, type FlechasLosa, type GrupoEnvolvente, type Reacciones } from "./consultas.ts";
import { VERSION_ESQUEMA } from "./proyecto.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function preparar(f: ModeloFisico, o: OpcionesCompilacion = {}) {
  const c = compilar(f, o);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(calcular(c.modelo));
  return { c, casos, q: new Consultas(f, c, casos, o) };
}
const conjunto = (q: Consultas, p: "esfuerzos" | "desplazamientos" | "lineal"): ConjuntoCombinaciones => {
  const r = conjuntoCombinaciones(q, seleccionPorDefecto(q.fisico.casos, p));
  if (!r.valido) throw new Error(r.diagnosticos[0]!.mensaje);
  return r.valor;
};
const valor = <T>(r: { valido: boolean; valor?: T; diagnosticos: { mensaje: string }[] }): T => {
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("; "));
  return r.valor as T;
};
const COMP = ["N", "Vy", "Vz", "T", "My", "Mz"];

/** Extremos de un grupo a fuerza bruta: todas las barras, combinaciones, estaciones y lados, con el diagrama combinado. */
function extremosABruto(q: Consultas, cj: ConjuntoCombinaciones, tipo: "pilar" | "viga" | "vigueta", planta: string, sinAxil: (pieza: string) => boolean) {
  const ep = new EsfuerzosPiezas(q.modelo, q.mapeo, q.casos);
  const max: Record<string, number> = {};
  const min: Record<string, number> = {};
  let denso = { max: {} as Record<string, number>, min: {} as Record<string, number> };
  for (const [p, barras] of Object.entries(q.mapeo.piezas))
    for (const b of barras) {
      const m = q.mapeo.barras[b]!;
      if (m.tipo !== tipo) continue;
      const pl = m.tipo === "pilar" ? q.fisico.plantas[m.tramo]!.id : q.mapeo.nudos[q.modelo.barras![b]!.nudos[0]]!.planta;
      if (pl !== planta) continue;
      for (const f of cj.factores) {
        const ks = [...f.keys()].filter((k) => f[k]);
        const D = ks.length ? DiagramaBarra.combinar(ks.map((k) => ep.diagrama(b, k)), ks.map((k) => f[k]!)) : DiagramaBarra.combinar([ep.diagrama(b, 0)], [0]);
        const xs = D.estaciones();
        const densos = Array.from({ length: 65 }, (_, i) => (D.L * i) / 64);
        for (const [x, lado, esDenso] of [...xs.flatMap((x) => [[x, -1, false], [x, 1, false]] as const), ...densos.map((x) => [x, 1, true] as const)]) {
          const e = D.esfuerzosEn(x, lado);
          for (let c = 0; c < 6; c++) {
            if (sinAxil(p) && c === 0) continue;
            const dst = esDenso ? denso : { max, min };
            dst.max[COMP[c]!] = Math.max(dst.max[COMP[c]!] ?? -Infinity, e[c]!);
            dst.min[COMP[c]!] = Math.min(dst.min[COMP[c]!] ?? Infinity, e[c]!);
          }
        }
      }
    }
  return { max, min, denso };
}

/** Comprueba un grupo de la envolvente contra la fuerza bruta (criterios 1 y 3). */
function comprobarGrupo(q: Consultas, cj: ConjuntoCombinaciones, g: GrupoEnvolvente) {
  const sinAxil = (p: string) => {
    if (g.tipo !== "viga") return false;
    const v = q.viga(p);
    return v.valido && v.valor.axilSinValor;
  };
  const { max, min, denso } = extremosABruto(q, cj, g.tipo, g.planta, sinAxil);
  const ep = new EsfuerzosPiezas(q.modelo, q.mapeo, q.casos);
  for (const ex of EXTREMOS[g.tipo]) {
    const c = ex.replace(/[+-]$/, "");
    const e = g.extremos[ex];
    if (c === "N" && g.axilSinValor === g.piezas) {
      expect(e, `${g.tipo} ${g.planta} ${ex}`).toBeUndefined();
      continue;
    }
    expect(e, `${g.tipo} ${g.planta} ${ex}`).toBeDefined();
    const esperado = ex.endsWith("+") ? max[c]! : ex.endsWith("-") ? min[c]! : Math.abs(max[c]!) >= Math.abs(min[c]!) ? max[c]! : min[c]!;
    // Exacto: el mismo extremo que a fuerza bruta
    expect(e!.v, `${g.tipo} ${g.planta} ${ex}`).toBe(esperado);
    // Ningún punto del muestreo denso lo supera (criterio 3)
    if (ex.endsWith("+")) expect(denso.max[c]!).toBeLessThanOrEqual(e!.v + 1e-9 * Math.max(1, Math.abs(e!.v)));
    else if (ex.endsWith("-")) expect(denso.min[c]!).toBeGreaterThanOrEqual(e!.v - 1e-9 * Math.max(1, Math.abs(e!.v)));
    else expect(Math.max(Math.abs(denso.max[c]!), Math.abs(denso.min[c]!))).toBeLessThanOrEqual(Math.abs(e!.v) * (1 + 1e-9) + 1e-9);
    // Y lo reproduce EsfuerzosPiezas en esa pieza, estación y combinación, caso a caso
    const kc = cj.nombres.indexOf(e!.comb);
    const f = cj.factores[kc]!;
    const enLado = (lado: -1 | 1) => {
      let v = 0;
      for (let k = 0; k < f.length; k++) if (f[k]) v += f[k]! * ep.en(e!.pieza!, k, e!.s!, lado)![COMP.indexOf(c)]!;
      return v;
    };
    const escala = Math.max(1, Math.abs(e!.v));
    expect(Math.min(Math.abs(enLado(-1) - e!.v), Math.abs(enLado(1) - e!.v)) / escala, `${g.tipo} ${g.planta} ${ex} en ${e!.pieza}@${e!.s}`).toBeLessThan(1e-9);
  }
}

describe("criterio 1 de A1: cada consulta da lo mismo que las llamadas a mano", () => {
  let M: ReturnType<typeof preparar>;
  let U: ReturnType<typeof preparar>;
  beforeAll(() => {
    M = preparar(conAcciones(conPropuesta(edificioObjetivoLosas(2, 3, 2))));
    U = preparar(conForjadosAleatorios(fisicoAleatorio(4), 4, { tipo: "unidireccional" }));
  });

  it("envolventes: exactas, con su pieza, estación y combinación (ELU del generador)", () => {
    const cj = conjunto(M.q, "esfuerzos");
    expect(cj.descripcion).toBe("ELU-PT");
    const r = valor(envolventes(M.q, cj));
    expect(r.grupos.map((g) => `${g.tipo}@${g.planta}`)).toEqual(["pilar@N2", "viga@N2", "pilar@N1", "viga@N1"]);
    for (const g of r.grupos) comprobarGrupo(M.q, cj, g);
    // Las vigas en el diafragma rígido no dan axil
    expect(r.grupos.find((g) => g.tipo === "viga")!.axilSinValor).toBe(13);
    // Unos 40 s solo; con la batería entera en paralelo (los tests del visor, V1) pasaba de 60
  }, 360_000);

  it("envolventes: viguetas, por caso, y los filtros por tipo y planta", () => {
    const cj = conjunto(U.q, "esfuerzos");
    expect(cj.descripcion).toBe("casos");
    const r = valor(envolventes(U.q, cj, { tipo: "vigueta" }));
    expect(r.grupos.length).toBeGreaterThan(0);
    expect(r.grupos.every((g) => g.tipo === "vigueta")).toBe(true);
    for (const g of r.grupos) comprobarGrupo(U.q, cj, g);
    const planta = r.grupos[0]!.planta;
    expect(valor(envolventes(U.q, cj, { tipo: "vigueta", planta })).grupos).toEqual([r.grupos[0]]);
    expect(envolventes(U.q, cj, { tipo: "muro" }).valido).toBe(false);
    expect(envolventes(U.q, cj, { planta: "nada" }).valido).toBe(false);
  });

  it("flechas de las losas: la de Consultas.flechas en cada combinación, y la mayor uz nudo a nudo", () => {
    const cj = conjunto(M.q, "desplazamientos");
    expect(cj.descripcion).toBe("ELS-C");
    const r = valor(flechas(M.q, cj)) as FlechasLosa[];
    expect(r.map((x) => x.id)).toEqual(["L-N1", "L-N2"]);
    for (const fl of r) {
      let mejor = -Infinity;
      let mejorRel = -Infinity;
      cj.factores.forEach((f) => {
        const x = valor(M.q.flechas(fl.id, f));
        mejor = Math.max(mejor, x.maxima.flecha);
        for (const rc of x.recuadros) if (rc.maxima) mejorRel = Math.max(mejorRel, rc.maxima.flecha);
      });
      expect(fl.maxima.v).toBe(mejor);
      expect(fl.relativa!.v).toBe(mejorRel);
      // A mano: −uz combinada en todos los nudos de las láminas de la losa
      const nudos = new Set(M.c.mapeo.losas![fl.id]!.flatMap((l) => [...M.c.modelo.laminas![l]!.nudos]));
      const f = cj.factores[cj.nombres.indexOf(fl.maxima.comb)]!;
      let aMano = -Infinity;
      for (const n of nudos) {
        let uz = 0;
        for (let k = 0; k < f.length; k++) if (f[k]) uz += f[k]! * M.casos[k]!.u[6 * n + 2]!;
        aMano = Math.max(aMano, -uz);
      }
      expect(Math.abs(aMano - fl.maxima.v)).toBeLessThan(1e-15);
    }
  });

  it("flechas de los paños: el extremo de la deformada de sus viguetas, que un muestreo denso no supera", () => {
    const cj = conjunto(U.q, "desplazamientos");
    const r = valor(flechas(U.q, cj)) as FlechasLosa[];
    const panos = r.filter((x) => x.tipo === "pano");
    expect(panos.length).toBe(U.q.fisico.panos!.length);
    const ep = new EsfuerzosPiezas(U.q.modelo, U.q.mapeo, U.q.casos);
    for (const p of panos) {
      let denso = -Infinity;
      let densoRel = -Infinity;
      for (const vig of U.q.mapeo.panos![p.id]!)
        for (const b of U.q.mapeo.piezas[vig]!)
          for (const f of cj.factores) {
            const ks = [...f.keys()].filter((k) => f[k]);
            const D = DiagramaBarra.combinar(ks.map((k) => ep.diagrama(b, k)), ks.map((k) => f[k]!));
            const [u0, uL] = [D.desplazamientosEn(0)[2]!, D.desplazamientosEn(D.L)[2]!];
            for (let i = 0; i <= 400; i++) {
              const x = (D.L * i) / 400;
              const u = D.desplazamientosEn(x)[2]!;
              denso = Math.max(denso, -u);
              densoRel = Math.max(densoRel, u0 + ((uL - u0) * x) / D.L - u);
            }
          }
      const tol = 1e-12 * Math.max(1e-3, Math.abs(p.maxima.v));
      expect(p.maxima.v).toBeGreaterThanOrEqual(denso - tol);
      expect(p.relativa!.v).toBeGreaterThanOrEqual(densoRel - tol);
      // Y no se pasa: a lo sumo lo que da la curvatura entre dos muestras
      expect(p.maxima.v - denso).toBeLessThan(1e-4 * Math.abs(p.maxima.v) + 1e-12);
      // La deformada en el punto dado reproduce el valor
      const b = U.q.mapeo.piezas[p.maxima.pieza!]!.find((bb) => {
        const s = U.q.mapeo.barras[bb]!.s;
        return p.maxima.s! >= s[1] - 1e-12 && p.maxima.s! <= s[2] + 1e-12;
      })!;
      const f = cj.factores[cj.nombres.indexOf(p.maxima.comb)]!;
      const ks = [...f.keys()].filter((k) => f[k]);
      const D = DiagramaBarra.combinar(ks.map((k) => ep.diagrama(b, k)), ks.map((k) => f[k]!));
      expect(-D.desplazamientosEn(p.maxima.s! - U.q.mapeo.barras[b]!.s[1])[2]!).toBeCloseTo(p.maxima.v, 15);
    }
  });

  it("deriva: los desplomes y el maestro de Consultas en cada combinación", () => {
    const cj = conjunto(M.q, "desplazamientos");
    const r = valor(deriva(M.q, cj));
    expect(r.map((x) => x.planta)).toEqual(["N2", "N1"]);
    for (const d of r) {
      let mejor = -Infinity;
      cj.factores.forEach((f) => {
        const x = valor(M.q.desplomes(d.planta, f));
        if (x.maximo) mejor = Math.max(mejor, x.maximo.relativo);
      });
      expect(d.desplome!.v).toBe(mejor);
      const m = valor(M.q.planta(d.planta)).maestro!;
      let ux = 0;
      cj.factores.forEach((f) => {
        let v = 0;
        for (let k = 0; k < f.length; k++) if (f[k]) v += f[k]! * m.u[3 * k]!;
        if (Math.abs(v) > Math.abs(ux)) ux = v;
      });
      expect(d.maestro!.ux.v).toBe(ux);
    }
  });

  it("reacciones: los totales equilibran las cargas y cada objeto es el de Consultas.reacciones", () => {
    const cj = conjunto(M.q, "lineal");
    expect(cj.descripcion).toBe("casos");
    const r = valor(reacciones(M.q, cj, { todos: true })) as Reacciones;
    const res = valor(resumen({ esquema: VERSION_ESQUEMA, modelo: M.q.fisico }, M.c));
    r.totales.forEach((t, k) => {
      const F = res.casos[k]!.F;
      for (let i = 0; i < 3; i++) expect(Math.abs(t.F[i]! + F[i]!)).toBeLessThan(1e-9 * Math.max(1, Math.abs(F[2]!), Math.abs(F[0]!), Math.abs(F[1]!)));
    });
    expect(r.objetos.length).toBe(12);
    expect(r.omitidos).toBe(0);
    for (const o of r.objetos) {
      const x = valor(M.q.reacciones(o.id));
      o.R.forEach((v, k) => expect(v).toEqual(Array.from(x.resultante.slice(6 * k, 6 * k + 6))));
    }
    // La suma de las bases de los pilares es el total (no hay otros apoyos)
    for (let k = 0; k < r.totales.length; k++) {
      const fz = r.objetos.reduce((s, o) => s + o.R[k]![2]!, 0);
      expect(Math.abs(fz - r.totales[k]!.F[2]!)).toBeLessThan(1e-9 * Math.max(1, Math.abs(fz)));
    }
    const top = valor(reacciones(M.q, cj, { top: 3 })) as Reacciones;
    expect(top.objetos.map((o) => o.id)).toEqual(r.objetos.slice(0, 3).map((o) => o.id));
    expect(top.omitidos).toBe(9);
  });

  it("pieza: los vanos de una viga y los tramos de un pilar, como Consultas.vano y Consultas.pilar", () => {
    const cj = conjunto(M.q, "esfuerzos");
    const v = valor(pieza(M.q, cj, "X5-N1")) as { vanos: { extremos: Record<string, { v: number; comb: string }> }[] };
    const vanos = valor(M.q.viga("X5-N1")).vanos;
    expect(v.vanos.length).toBe(vanos.length);
    v.vanos.forEach((va, i) => {
      let maxMy = -Infinity;
      let minMy = Infinity;
      cj.factores.forEach((f) => {
        const e = valor(M.q.vano("X5-N1", i, f));
        maxMy = Math.max(maxMy, e.maxMy.valor);
        minMy = Math.min(minMy, e.minMy.valor);
      });
      expect(va.extremos["My+"]!.v).toBe(maxMy);
      expect(va.extremos["My-"]!.v).toBe(minMy);
    });
    const p = valor(pieza(M.q, cj, "P6-5")) as { tramos: { base: Record<string, { comb: string; esfuerzos: number[] }> }[] };
    const tramos = valor(M.q.pilar("P6-5"));
    p.tramos.forEach((t, i) => {
      const nMin = t.base["N-"]!;
      const f = cj.factores[cj.nombres.indexOf(nMin.comb)]!;
      const a = [0, 0, 0, 0, 0, 0];
      for (let k = 0; k < f.length; k++) if (f[k]) for (let c = 0; c < 6; c++) a[c]! += f[k]! * tramos[i]!.base.esfuerzos[6 * k + c]!;
      expect(nMin.esfuerzos).toEqual(a);
      // Es la mínima de todas las combinaciones
      for (const g of cj.factores) {
        let n = 0;
        for (let k = 0; k < g.length; k++) if (g[k]) n += g[k]! * tramos[i]!.base.esfuerzos[6 * k]!;
        expect(n).toBeGreaterThanOrEqual(nMin.esfuerzos[0]!);
      }
    });
    // Con una combinación y --estaciones: el diagrama de Consultas.diagrama
    const una = valor(conjuntoCombinaciones(M.q, { tipo: "expresiones", expresiones: ["1.35*G+1.5*Q"] }));
    const d = valor(pieza(M.q, una, "X5-N1", { estaciones: true })) as { estaciones: { s: number; izquierda: Float64Array }[] };
    const ref = valor(M.q.diagrama("X5-N1", una.factores[0]!));
    expect(d.estaciones.map((e) => e.s)).toEqual(ref.map((e) => e.s));
    expect(pieza(M.q, cj, "X5-N1", { estaciones: true }).valido).toBe(false);
    expect(pieza(M.q, cj, "nada").valido).toBe(false);
  });

  it("banda: My de Consultas.banda combinado en cada estación", () => {
    const cj = conjunto(M.q, "esfuerzos");
    const id = M.q.fisico.bandas![0]!.id;
    const r = valor(banda(M.q, cj, id));
    const ref = valor(M.q.banda(id));
    expect(r.estaciones.length).toBe(ref.length);
    r.estaciones.forEach((e, i) => {
      let max = -Infinity;
      let min = Infinity;
      for (const f of cj.factores) {
        let v = 0;
        for (let k = 0; k < f.length; k++) if (f[k]) v += f[k]! * ref[i]!.esfuerzos[6 * k + 4]!;
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
      expect(e.max[0]).toBe(max);
      expect(e.min[0]).toBe(min);
    });
  });

  it("resumen: piezas y cargas por planta; la suma de las plantas es el total de cada caso", () => {
    const r = valor(resumen({ esquema: VERSION_ESQUEMA, nombre: "x", modelo: M.q.fisico }, M.c));
    expect(r.plantas.map((p) => p.id)).toEqual(["N2", "N1", "C"]);
    expect(r.plantas[0]!.pilares).toEqual({ p3050: 8, p40: 4 });
    expect(r.plantas[0]!.losas![0]!.m2).toBeCloseTo(18 * 10 - 4.8 * 4.2, 9);
    r.casos.forEach((c) => {
      const suma = r.plantas.reduce((s, p) => s + (p.cargas[c.id] ?? 0), 0);
      expect(Math.abs(suma + c.F[2]!)).toBeLessThan(1e-9 * Math.max(1, Math.abs(c.F[2]!)));
    });
  });

  it("combinaciones: expresiones, casos y errores", () => {
    const ids = ["G", "Q", "Q-uso", "W"];
    expect(Array.from((factoresExpresion("1.35*G + 1.5 * Q-uso - 0.9W", ids) as { factores: Float64Array }).factores)).toEqual([1.35, 0, 1.5, -0.9]);
    expect(Array.from((factoresExpresion("G+Q+G", ids) as { factores: Float64Array }).factores)).toEqual([2, 1, 0, 0]);
    expect("error" in factoresExpresion("1.35*X", ids)).toBe(true);
    expect("error" in factoresExpresion("G Q", ids)).toBe(true);
    expect("error" in factoresExpresion("", ids)).toBe(true);
    const r = consultar(M.q, "combinaciones", { combinaciones: () => conjuntoCombinaciones(M.q, { tipo: "situaciones", situaciones: ["ELS-C"] }) });
    expect((valor(r) as { combinaciones: unknown[] }).combinaciones.length).toBe(13);
  });
});

describe("criterio 3 de A1: las envolventes no pierden el máximo (batería al azar de C1–C4)", () => {
  const MODELOS: [string, () => ModeloFisico, OpcionesCompilacion?][] = [
    ...[1, 2, 3].map((s) => [`C1 al azar ${s}`, () => fisicoAleatorio(s)] as [string, () => ModeloFisico]),
    ...[5, 8].map((s) => [`C2 al azar ${s}`, () => conLosasAleatorias(fisicoAleatorio(s), s), { tamanoMalla: 1 }] as [string, () => ModeloFisico, OpcionesCompilacion]),
    ...[6].map((s) => [`C3 al azar ${s}`, () => conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(s), s), s), { tamanoMalla: 1 }] as [string, () => ModeloFisico, OpcionesCompilacion]),
    ...[7, 9].map((s) => [`C4 al azar ${s}`, () => conForjadosAleatorios(fisicoAleatorio(s), s)] as [string, () => ModeloFisico]),
    ["C3 retícula con núcleo", reticulaConNucleo, { tamanoMalla: 1 }],
  ];
  for (const [nombre, f, o] of MODELOS)
    it(nombre, () => {
      const { q } = preparar(f(), o);
      // Las combinaciones: cada caso suelto y dos combinaciones con signos mezclados
      const ids = q.fisico.casos.map((c) => c.id);
      const expresiones = [...ids, ids.map((id, k) => `${k % 2 ? "-" : "+"}${1 + 0.25 * k}*${id}`).join(""), ids.map((id, k) => `${k % 2 ? "+" : "-"}${0.5 + k}*${id}`).join("")];
      const cj = valor(conjuntoCombinaciones(q, { tipo: "expresiones", expresiones }));
      const r = valor(envolventes(q, cj));
      expect(r.grupos.length).toBeGreaterThan(0);
      for (const g of r.grupos) comprobarGrupo(q, cj, g);
    });
});
