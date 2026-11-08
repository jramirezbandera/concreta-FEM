/**
 * VS3 en las consultas (`docs/fem3d/viento-sismo.md` §5): el sismo del programa, de extremo a extremo.
 * - Los casos `EX+e`, `EX-e`, `EY+e` y `EY-e` son casos lógicos al final de los del modelo, con su
 *   familia, y entran en las combinaciones de la situación sísmica.
 * - Criterio 6: ninguna consulta mezcla un caso de un modo con los factores de una combinación. Cada
 *   una (pilares, vanos y diagramas de vigas, reacciones, desplomes, flechas, mapas, franjas) se
 *   compara con la regla aplicada aquí, a mano, sobre los valores de cada caso base.
 * - Criterio 4: el cortante en la base de `EX+e` es el combinado de los modos, y el par de su
 *   excentricidad, el de las fuerzas de planta por el 5 % de la dimensión de la planta.
 * - Sin `ab` (sólo masas y modos), todo como sin el sismo, con los mismos bits.
 * - Los modos, como casos, se guardan con los resultados; y la CLI de verdad.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { compilar, type ResultadoCompilacion } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { AccionCaso, ModeloFisico, SismoEdificio } from "../compilador/fisico.ts";
import { CASOS_SISMO } from "../compilador/sismo.ts";
import { woodArmer, woodArmerPesimo } from "../dimensionado/woodArmer.ts";
import { calcular } from "../motor/calcular.ts";
import { GRAVEDAD, type ResultadoCalculo } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { conjuntoCombinaciones, seleccionPorDefecto, type ConjuntoCombinaciones } from "./combinaciones.ts";
import { deriva, envolventes, esfuerzosPesimosViga, flechas, pieza, reacciones, sismo } from "./consultas.ts";
import { VERSION_ESQUEMA } from "./proyecto.ts";
import { envolventeCampo, ResultadosRender, valoresCampo } from "./render/resultados.ts";
import { esfuerzosPartidos, recorrerDiagrama } from "../motor/diagramaCompuesto.ts";
import { desempaquetarResultados, empaquetarResultados } from "./resultados.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
let dir = "";

const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
const SISMO: SismoEdificio = { ab: 0.16, K: 1.0, terreno: "III", mu: 2 };
/** Un pilar de esquina del edificio (12 pilares, `P<x>-<y>`). */
const PILAR = "P0-0";

/** El edificio de losas con la acción de cada caso y el sismo en las acciones. */
function edificio(plantas: number, sismoE: SismoEdificio | null = SISMO): ModeloFisico {
  const f = edificioObjetivoLosas(plantas, 3, 2);
  return { ...f, casos: f.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })), ...(sismoE ? { acciones: { sismo: sismoE } } : {}) };
}

type Compilado = Extract<ResultadoCompilacion, { valido: true }>;
type Calculado = Extract<ResultadoCalculo, { valido: true }>;

function calculado(f: ModeloFisico): { c: Compilado; r: Calculado; q: Consultas } {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return { c, r, q: new Consultas(f, c, r.casos, {}, r.modal) };
}

const rel = (a: number, b: number, suelo = 1e-9) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), suelo);

let f: ModeloFisico;
let c: Compilado;
let r: Calculado;
let q: Consultas;
/** G + 0,3·Q + (EX+e) − 0,3·(EY−e): una de las combinaciones de la situación sísmica. */
const F = [1, 0.3, 0, 0, 1, 0, 0, -0.3];
let una: ConjuntoCombinaciones;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fem-vs3-"));
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  f = edificio(3);
  ({ c, r, q } = calculado(f));
  const cj = conjuntoCombinaciones(q, { tipo: "expresiones", expresiones: ["G + 0.3*Q + EX+e - 0.3*EY-e"] });
  if (!cj.valido) throw new Error(cj.diagnosticos[0]!.mensaje);
  una = cj.valor;
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * La regla, a mano (art. 3.6.2.4 y su comentario): el valor de una variable en una combinación, con
 * sus valores en los casos base. Los casos estáticos, por su factor; cada caso del sismo, la regla de
 * su espectro sobre las respuestas de los modos —la cuadrática completa de C.3.6.2.4 (por defecto,
 * VS-f), con πᵢₖ escrita aquí, o la raíz de la suma de los cuadrados con los pares de periodos a
 * menos del 10 % en valor absoluto—, con el signo del modo de más masa en su dirección, más el torsor
 * de su excentricidad; y por μ si es un desplazamiento. `x`, el edificio (por defecto, el de 3 plantas).
 */
function aMano(factores: readonly number[], base: (k: number) => number, desplazamiento = false, x: { c: Compilado; r: Calculado; q: Consultas } = { c, r, q }): number {
  const ns = x.c.modelo.casos.length;
  const md = x.r.modal!;
  const sc = x.q.sismoCalculado!;
  const cqc = sc.espectro.regla === "cqc";
  const z = sc.espectro.omega / 100;
  let s = 0;
  for (let k = 0; k < ns; k++) if (factores[k]) s += factores[k]! * base(k);
  CASOS_SISMO.forEach((caso, j) => {
    const fj = factores[ns + j]!;
    if (!fj) return;
    const resp = sc.respuestas[caso.eje];
    const y = md.modos.map((_, i) => resp.coeficientes[i]! * base(ns + i));
    let s2 = 0;
    for (let i = 0; i < y.length; i++) {
      s2 += y[i]! ** 2;
      for (let k = i + 1; k < y.length; k++) {
        const [Ti, Tk] = [md.modos[i]!.periodo, md.modos[k]!.periodo];
        if (cqc) {
          const g = Ti / Tk;
          const pi = (8 * z * z * (1 + g) * g ** 1.5) / ((1 - g * g) ** 2 + 4 * z * z * g * (1 + g) ** 2);
          s2 += 2 * pi * y[i]! * y[k]!;
        } else if (Math.min(Ti, Tk) > 0.9 * Math.max(Ti, Tk)) s2 += 2 * Math.abs(y[i]! * y[k]!);
      }
    }
    let dominante = 0;
    md.modos.forEach((m, i) => {
      if (m.participacion[caso.eje] ** 2 > md.modos[dominante]!.participacion[caso.eje] ** 2) dominante = i;
    });
    let v = (y[dominante]! < 0 ? -1 : 1) * Math.sqrt(s2);
    // +e: la recta de acción, hacia +Y con el sismo según X (par −F·e) y hacia +X según Y (par +F·e)
    const signo = (caso.eje === 0 ? -1 : 1) * caso.exc;
    md.modos.forEach((_, i) => (v += signo * (resp.torsor?.[i] ?? 0) * base(ns + i)));
    s += fj * (desplazamiento ? sc.espectro.mu[caso.eje] * v : v);
  });
  return s;
}

/**
 * VS-o, a mano: la combinación partida en su parte estática (los casos del cálculo, por su factor) y
 * la amplitud del sismo: Σ |factor·valor| de cada caso del sismo, con `aMano` para su valor.
 */
function partesAMano(factores: readonly number[], base: (k: number) => number): { S: number; A: number } {
  const ns = c.modelo.casos.length;
  let S = 0;
  for (let k = 0; k < ns; k++) if (factores[k]) S += factores[k]! * base(k);
  let A = 0;
  CASOS_SISMO.forEach((_, j) => {
    const fj = factores[ns + j]!;
    if (!fj) return;
    const solo = factores.map((_, k) => (k === ns + j ? 1 : 0));
    A += Math.abs(fj * aMano(solo, base));
  });
  return { S, A };
}

describe("VS3: los casos del sismo del programa", () => {
  it("son los cuatro últimos casos lógicos, con su familia; los modos van detrás de los casos base", () => {
    const ns = c.modelo.casos.length;
    const nm = r.modal!.modos.length;
    expect(ns).toBe(4);
    expect(nm).toBe(9);
    expect(q.fisico.casos.map((x) => x.id)).toEqual(["G", "Q", "Vx", "Vy", "EX+e", "EX-e", "EY+e", "EY-e"]);
    expect(q.fisico.casos.slice(4).map((x) => x.accion)).toEqual([
      { tipo: "E", direccion: "X", familia: "EX" },
      { tipo: "E", direccion: "X", familia: "EX" },
      { tipo: "E", direccion: "Y", familia: "EY" },
      { tipo: "E", direccion: "Y", familia: "EY" },
    ]);
    expect(q.nl).toBe(8);
    expect(q.nb).toBe(ns + nm);
    expect(q.casos.slice(ns).map((x) => x.id)).toEqual(Array.from({ length: nm }, (_, i) => `modo-${i + 1}`));
    expect(q.modelo.casos.length).toBe(q.nb);
    // el modelo compilado y sus resultados no cambian: los casos del sismo no son casos del cálculo
    expect(q.compilado).toBe(c.modelo);
    expect(c.modelo.casos.map((x) => x.id)).toEqual(["G", "Q", "Vx", "Vy"]);
    expect(c.hipotesis.some((h) => h.includes("espectros de respuesta") && h.includes("EX+e"))).toBe(true);
  });

  it("entran en las combinaciones de la situación sísmica: ± la dirección principal, el 30 % de la otra y una excentricidad de cada familia", () => {
    // Las del generador (de primer orden): las que usan las consultas llevan además el γz del segundo orden (SO) en los casos del sismo
    const sis = q.combinacionesGeneradas({ situaciones: ["ELU-SIS"] });
    const amplificadas = q.combinaciones({ situaciones: ["ELU-SIS"] });
    if (!sis.valido || !amplificadas.valido) throw new Error("sin combinaciones");
    // 2 direcciones × 2 excentricidades × 2 signos × (2 excentricidades × 2 signos de la otra) × Q presente o no
    expect(sis.valor.length).toBe(64);
    expect(amplificadas.valor.length).toBe(64);
    amplificadas.valor.forEach((a, i) => {
      const g = sis.valor[i]!;
      expect(a.amplificacion?.length).toBe(2);
      g.factores.forEach((f, k) => {
        const x = a.amplificacion!.find((y) => y.caso === q.fisico.casos[k]!.id);
        if (x) {
          expect(x.coeficiente).toBeGreaterThan(1);
          expect(Math.abs(a.factores[k]! - f * x.coeficiente)).toBeLessThan(1e-12);
        } else expect(a.factores[k]).toBe(f);
      });
    });
    for (const comb of sis.valor) {
      const e = Array.from(comb.factores.subarray(4));
      expect(comb.factores.length).toBe(8);
      // de cada familia, un caso: uno con ±1 y el de la otra con ±0,3
      expect(e.slice(0, 2).filter((v) => v !== 0).length).toBe(1);
      expect(e.slice(2, 4).filter((v) => v !== 0).length).toBe(1);
      expect(e.map(Math.abs).filter((v) => v !== 0).sort()).toEqual([0.3, 1]);
      expect(comb.factores[0]).toBe(1);
      expect([0, 0.3]).toContain(comb.factores[1]);
      // el viento no acompaña al sismo (ψ₂ = 0)
      expect(comb.factores[2]).toBe(0);
      expect(comb.factores[3]).toBe(0);
    }
    // y las consultas las buscan por defecto: con casos de sismo, la ELU incluye la sísmica
    expect(seleccionPorDefecto(q.fisico.casos, "esfuerzos")).toEqual({ tipo: "situaciones", situaciones: ["ELU-PT", "ELU-SIS"] });
    // una combinación con los factores de los casos del cálculo (4) ya no vale: son 8
    expect(q.diagrama(PILAR, [1, 1, 0, 0]).valido).toBe(false);
    expect(q.desplomes("N3", [1, 1, 0, 0]).valido).toBe(false);
  });

  it("la consulta «sismo»: el espectro, el cortante en la base, las plantas, θ y el método simplificado", () => {
    const s = sismo(q);
    if (!s.valido) throw new Error(s.diagnosticos[0]!.mensaje);
    const v = s.valor;
    // Cap. 2: C = 1,6; ρ·ab = 0,16 → S = 1,28 + 3,33·0,06·(1 − 1,28); ac = S·ab; TA = 0,16 y TB = 0,64
    const S = 1.28 + 3.33 * 0.06 * (1 - 1.28);
    expect(v.emplazamiento.C).toBe(1.6);
    expect(v.emplazamiento.S).toBeCloseTo(S, 14);
    expect(v.emplazamiento.ac).toBeCloseTo(S * 0.16, 14);
    expect(v.emplazamiento.TA).toBeCloseTo(0.16, 14);
    expect(v.emplazamiento.TB).toBeCloseTo(0.64, 14);
    expect(v.casos).toEqual(["EX+e", "EX-e", "EY+e", "EY-e"]);
    expect(v.omega).toBe(5);
    expect(v.nu).toBe(1);
    expect(v.regla).toBe("cqc");
    expect(v.excentricidad).toBe(0.05);
    expect(rel(v.peso, r.modal!.masas.diafragmas * GRAVEDAD)).toBeLessThan(1e-14);
    v.direcciones.forEach((d, eje) => {
      expect(d.eje).toBe(eje === 0 ? "X" : "Y");
      expect(d.mu).toBe(2);
      expect(d.beta).toBe(0.5);
      expect(d.plantas.map((p) => p.plantas)).toEqual([["N3"], ["N2"], ["N1"]]);
      // el cortante crece hacia abajo y el de la base es el de la última planta; las fuerzas equivalentes, combinadas
      // planta a planta (VS3-d, como CYPECAD), suman más que él, y la de arriba es su cortante
      expect(d.plantas[2]!.cortante).toBe(d.cortanteBasal);
      expect(d.plantas[0]!.cortante).toBeLessThan(d.plantas[1]!.cortante);
      expect(d.plantas.reduce((t, p) => t + p.fuerza, 0)).toBeGreaterThan(d.cortanteBasal);
      expect(rel(d.plantas[0]!.fuerza, d.plantas[0]!.cortante)).toBeLessThan(1e-12);
      // un edificio de tres plantas con T ≈ 0,3–0,5 s en la meseta: el cortante, del orden de 2,5·β·ac·peso (entre el 60 y el 100 %)
      const meseta = 2.5 * 0.5 * v.emplazamiento.ac * v.peso;
      expect(d.cortanteBasal / meseta).toBeGreaterThan(0.6);
      expect(d.cortanteBasal / meseta).toBeLessThan(1.0001);
      expect(d.coeficienteSismico).toBeCloseTo(d.cortanteBasal / v.peso, 14);
      // la excentricidad, el 5 % de la dimensión perpendicular (18 × 10 m): 0,5 m con el sismo según X y 0,9 según Y
      for (const p of d.plantas) {
        expect(p.excentricidad).toBeCloseTo(eje === 0 ? 0.5 : 0.9, 12);
        expect(p.par).toBeCloseTo(p.fuerza * p.excentricidad, 9);
        // N3 y N2, a 3 m de la de debajo; N1, a 1,5 m de la planta más baja (el sótano del modelo)
        expect(p.altura).toBeCloseTo(p.plantas[0] === "N1" ? 1.5 : 3, 12);
        // θ = P·d/(V·h), con P el peso de la planta y de las de encima
        const P = d.plantas.filter((x) => x.cota >= p.cota).reduce((t, x) => t + x.masa, 0) * GRAVEDAD;
        expect(p.theta).toBeCloseTo((P * p.deriva) / (p.cortante * p.altura), 12);
      }
      expect(d.thetaMaxima).toBe(Math.max(...d.plantas.map((p) => p.theta)));
      // el método simplificado con el periodo del modo dominante: del mismo orden (no más de un 25 % de diferencia)
      const simp = d.simplificado.find((x) => x.periodo === "el del modo dominante")!;
      expect(simp.TF).toBe(d.dominante.T);
      expect(Math.abs(simp.frente - 1)).toBeLessThan(0.25);
      expect(simp.frente).toBeCloseTo(d.cortanteBasal / simp.cortanteBasal, 12);
      // los modos, por su cortante en la base; entre todos, toda la masa
      expect(d.modos[0]!.modo).toBe(d.dominante.modo);
    });
    const todos = sismo(q, { todos: true });
    if (!todos.valido) throw new Error("sin sismo");
    for (const d of todos.valor.direcciones) expect(d.modos.reduce((t, m) => t + m.masaEfectiva, 0)).toBeCloseTo(1, 10);
  });

  it("sin el espectro o sin los modos, la consulta lo dice", () => {
    const sin = calculado(edificio(2, {})).q;
    expect(sin.sismo().valido).toBe(false);
    const d = sin.sismo().diagnosticos[0]!;
    expect(d.codigo).toBe("consulta/sin-sismo");
    expect(d.mensaje).toContain("ab");
    const nada = calculado(edificio(2, null)).q;
    expect(nada.sismo().diagnosticos[0]!.mensaje).toContain("no tiene el sismo");
  });
});

describe("VS3, criterio 4: el cortante en la base y el par de la excentricidad, en las reacciones", () => {
  it("la reacción horizontal de EX+e es el cortante combinado; la diferencia con EX−e, el par de las fuerzas de planta por su excentricidad", () => {
    const casos = conjuntoCombinaciones(q, { tipo: "casos" });
    if (!casos.valido) throw new Error("sin casos");
    const re = reacciones(q, casos.valor, { todos: true });
    if (!re.valido) throw new Error("sin reacciones");
    const total = (id: string) => re.valor.totales[casos.valor.nombres.indexOf(id)]!;
    const s = q.sismo();
    if (!s.valido) throw new Error("sin sismo");
    s.valor.direcciones.forEach((d, eje) => {
      const [mas, menos] = [total(`E${d.eje}+e`), total(`E${d.eje}-e`)];
      // el torsor no tiene resultante: los dos casos, el mismo cortante, el combinado de los modos
      expect(rel(Math.abs(mas.F[eje]!), d.basal)).toBeLessThan(1e-9);
      expect(rel(Math.abs(menos.F[eje]!), d.basal)).toBeLessThan(1e-9);
      // (EX+e − EX−e)/2 es el torsor: su par respecto al eje vertical, el de las fuerzas equivalentes por su excentricidad.
      // +e desplaza la recta hacia +Y (según X) o +X (según Y): la carga da −F·e (X) o +F·e (Y), y las reacciones, lo contrario
      const par = d.niveles.reduce((t, n) => t + n.par, 0);
      const Mz = (mas.M[2]! - menos.M[2]!) / 2;
      expect(rel(Mz, (eje === 0 ? 1 : -1) * par)).toBeLessThan(1e-8);
      expect(Math.abs(mas.F[2]!) / d.basal).toBeLessThan(1e-9);
    });
  });
});

describe("VS3, criterio 6: cada consulta combina los modos en su variable", () => {
  it("un pilar: los esfuerzos de su base y de su cabeza, y lo que da «pieza»", () => {
    const t = q.pilar(PILAR);
    if (!t.valido) throw new Error("sin pilar");
    const p = pieza(q, una, PILAR);
    if (!p.valido) throw new Error("sin pieza");
    type Terna = { esfuerzos: number[]; pesimos?: true };
    const tramos = (p.valor as { tramos: { base: Record<string, Terna>; cabeza: Record<string, Terna> }[] }).tramos;
    t.valor.forEach((tramo, i) => {
      for (const donde of ["base", "cabeza"] as const) {
        const e = tramo[donde].esfuerzos;
        const comb = q.combinar(e, 6, F);
        const ternas = tramos[i]![donde];
        for (let cmp = 0; cmp < 6; cmp++) {
          const mano = aMano(F, (k) => e[6 * k + cmp]!);
          expect(rel(comb[cmp]!, mano)).toBeLessThan(1e-12);
          // VS-o: «pieza» da las ternas de los signos pésimos: N con la parte del sismo de los dos signos
          // (N+ y N−) y los demás esfuerzos con el que aumenta su valor absoluto
          const { S, A } = partesAMano(F, (k) => e[6 * k + cmp]!);
          for (const [nombre, sN] of [["N+", 1], ["N-", -1]] as const) {
            const esperado = cmp === 0 ? S + sN * A : S >= 0 ? S + A : S - A;
            expect(rel(ternas[nombre]!.esfuerzos[cmp]!, esperado, 1e-6)).toBeLessThan(1e-12);
            expect(ternas[nombre]!.pesimos).toBe(true);
          }
          // nunca menos que la combinación con el signo del modo dominante
          if (cmp > 0) expect(Math.abs(ternas["N+"]!.esfuerzos[cmp]!)).toBeGreaterThanOrEqual(Math.abs(mano) * (1 - 1e-12));
        }
      }
    });
    // y con el sismo no es la suma de los modos con el factor del caso: el axil del sismo no es nulo ni lineal
    const e = t.valor[0]!.base.esfuerzos;
    const soloSismo = q.combinar(e, 6, [0, 0, 0, 0, 1, 0, 0, 0]);
    expect(Math.abs(soloSismo[2]!)).toBeGreaterThan(1);
    expect(q.combinar(e, 6, [0, 0, 0, 0, -1, 0, 0, 0])[2]).toBe(-soloSismo[2]!);
  });

  it("una viga: el diagrama en cada estación, y los extremos de sus vanos", () => {
    const viga = f.vigas!.find((v) => v.planta === "N2")!.id;
    const ep = q.esfuerzosPiezas;
    const d = q.diagrama(viga, F);
    if (!d.valido) throw new Error("sin diagrama");
    const ns = c.modelo.casos.length;
    let [comparados, saltados] = [0, 0];
    const estaciones: number[] = [];
    for (const t of ep.tramos(viga)) {
      const D = q.diagramaBarra(t.barra, F);
      for (const x of D.estaciones()) {
        estaciones.push(t.s0 + x);
        for (const lado of [-1, 1] as const) {
          const e = D.esfuerzosEn(x, lado);
          for (let cmp = 0; cmp < 6; cmp++) {
            const base = (k: number) => ep.diagrama(t.barra, k).esfuerzosEn(x, lado)[cmp]!;
            // Donde el modo dominante de alguna dirección pasa por cero, el caso salta de un signo al otro
            // (el diagrama lo mira un poco al lado del punto): ahí no se compara
            const juntoACero = CASOS_SISMO.some((caso, j) => {
              if (!F[ns + j]) return false;
              const resp = q.sismoCalculado!.respuestas[caso.eje];
              const xs = r.modal!.modos.map((_, i) => Math.abs(resp.coeficientes[i]! * base(ns + i)));
              return xs[resp.dominante]! < 1e-6 * Math.max(...xs, 1e-12);
            });
            if (juntoACero) {
              saltados++;
              continue;
            }
            expect(rel(e[cmp]!, aMano(F, base), 1e-3), `barra ${t.barra}, x = ${x}, lado ${lado}, componente ${cmp}`).toBeLessThan(1e-9);
            comparados++;
          }
        }
      }
    }
    expect(comparados).toBeGreaterThan(200);
    expect(saltados).toBeLessThan(comparados / 2);
    // «diagrama» de la pieza da esas estaciones, en orden
    expect(d.valor.map((e) => e.s)).toEqual(estaciones);
    const t0 = ep.tramos(viga)[0]!;
    // Los extremos de los vanos son valores del diagrama de la combinación, y con el sismo el momento
    // negativo del apoyo crece: G + 0,3·Q + E da más (en valor absoluto) que G + 0,3·Q
    const sin = [1, 0.3, 0, 0, 0, 0, 0, 0];
    const v = q.viga(viga);
    if (!v.valido) throw new Error("sin viga");
    v.valor.vanos.forEach((_, i) => {
      const [con, est] = [q.vano(viga, i, F), q.vano(viga, i, sin)];
      if (!con.valido || !est.valido) throw new Error("sin vano");
      expect(con.valor.minMy.valor).toBeLessThanOrEqual(est.valor.minMy.valor + 1e-9);
      expect(con.valor.maxMy.valor).toBeGreaterThanOrEqual(Math.max(con.valor.inicio.esfuerzos[4]!, con.valor.fin.esfuerzos[4]!) - 1e-9);
    });
    // y con los signos del sismo cambiados (−EX+e, +0,3·EY−e), la parte del sismo, al revés
    const otra = [1, 0.3, 0, 0, -1, 0, 0, 0.3];
    const b = t0.barra;
    for (const cmp of [2, 4]) {
      const [a, o, s0] = [F, otra, sin].map((x) => q.diagramaBarra(b, x).esfuerzosEn(0, 1)[cmp]!);
      expect(rel(a! - s0!, s0! - o!, 1e-6)).toBeLessThan(1e-9);
    }
    // las envolventes de la planta, con la combinación sísmica, llegan al menos a esos valores
    const env = envolventes(q, una, { planta: "N2", tipo: "viga" });
    if (!env.valido) throw new Error("sin envolventes");
    expect(env.valor.grupos[0]!.extremos["My-"]!.v).toBeLessThan(0);
  });

  it("una viga: los esfuerzos partidos y los pares de signos pésimos de cortante con torsión y de flexión con cortante (VS-o)", () => {
    const viga = f.vigas!.find((v) => v.planta === "N2")!.id;
    const ep = q.esfuerzosPiezas;
    const ns = c.modelo.casos.length;
    // 1. La combinación partida en cada estación del diagrama: la parte estática y la amplitud del sismo de
    //    cada esfuerzo, frente a la regla a mano y frente a `Superposicion.partir` con los esfuerzos de cada caso base
    let [comparados, peores] = [0, 0];
    for (const t of ep.tramos(viga)) {
      const D = q.diagramaBarra(t.barra, F);
      for (const x of D.estaciones())
        for (const lado of [-1, 1] as const) {
          const base = (k: number, cmp: number) => ep.diagrama(t.barra, k).esfuerzosEn(x, lado)[cmp]!;
          // Con la excentricidad, la amplitud depende del signo del modo dominante (como el valor): donde pasa por cero, no se compara
          const juntoACero = (cmp: number) =>
            CASOS_SISMO.some((caso, j) => {
              if (!F[ns + j]) return false;
              const resp = q.sismoCalculado!.respuestas[caso.eje];
              const xs = r.modal!.modos.map((_, i) => Math.abs(resp.coeficientes[i]! * base(ns + i, cmp)));
              return xs[resp.dominante]! < 1e-6 * Math.max(...xs, 1e-12);
            });
          // Vz, T y My, los que juntan las comprobaciones (N y lo del plano del diafragma son ruido)
          if ([2, 3, 4].some(juntoACero)) continue;
          const p = esfuerzosPartidos(D, x, lado);
          const porBase = Float64Array.from({ length: 6 * q.nb }, (_, i) => base(Math.floor(i / 6), i % 6));
          const sup = q.sup.partir(porBase, 6, F);
          const e = D.esfuerzosEn(x, lado);
          const pes = esfuerzosPesimosViga(p, 0);
          for (let cmp = 0; cmp < 6; cmp++) {
            if (juntoACero(cmp)) continue;
            const { S, A } = partesAMano(F, (k) => base(k, cmp));
            const donde = `barra ${t.barra}, x = ${x}, lado ${lado}, componente ${cmp}`;
            expect(rel(p.estatica[cmp]!, S, 1e-3), donde).toBeLessThan(1e-9);
            expect(rel(p.sismo[cmp]!, A, 1e-3), donde).toBeLessThan(1e-9);
            expect(rel(p.sismo[cmp]!, sup.sismo[cmp]!, 1e-3), donde).toBeLessThan(1e-9);
            // la combinación con el signo del modo dominante es uno de los estados que cubre: S ± A
            expect(Math.abs(e[cmp]! - p.estatica[cmp]!)).toBeLessThanOrEqual(p.sismo[cmp]! * (1 + 1e-12) + 1e-12);
            // y el pésimo nunca da menos (N, la menor compresión)
            if (cmp === 0) expect(pes[0]!).toBeGreaterThanOrEqual(e[0]! - 1e-9);
            else expect(Math.abs(pes[cmp]!)).toBeGreaterThanOrEqual(Math.abs(e[cmp]!) * (1 - 1e-12) - 1e-12);
          }
          // donde el estado del signo dominante no junta |Vz| y |T| máximos, el par pésimo es otro
          if (Math.abs(e[2]!) + Math.abs(e[3]!) < Math.abs(pes[2]!) + Math.abs(pes[3]!) - 1e-6) peores++;
          comparados++;
        }
    }
    expect(comparados).toBeGreaterThan(50);
    expect(peores).toBeGreaterThan(0);

    // 2. «pieza», con la situación sísmica entera (todos los signos de cada caso del sismo): cada extremo
    //    de vano con los esfuerzos de sus signos pésimos, en su punto, y el suyo es el del extremo
    const sis = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: ["ELU-SIS"] });
    if (!sis.valido) throw new Error(sis.diagnosticos[0]!.mensaje);
    const p = pieza(q, sis.valor, viga);
    if (!p.valido) throw new Error("sin pieza");
    type Ext = { v: number; s: number; comb: string; esfuerzos: number[]; pesimos?: true };
    const vanos = (p.valor as { vanos: { extremos: Record<string, Ext> }[] }).vanos;
    const propio = { "My+": [4, 1], "My-": [4, -1], Vz: [2, 0], T: [3, 0] } as const;
    for (const [i, va] of vanos.entries())
      for (const [nombre, [cmp, my]] of Object.entries(propio)) {
        const x = va.extremos[nombre]!;
        expect(x.pesimos, `${nombre} del vano ${i}`).toBe(true);
        expect(rel(x.esfuerzos[cmp]!, x.v, 1e-6), `${nombre} del vano ${i}`).toBeLessThan(1e-12);
        // la regla, escrita aquí: Vy, Vz, T y Mz aumentan su valor absoluto, My va con el extremo y N, con la menor compresión
        const fx = sis.valor.factores[sis.valor.nombres.indexOf(x.comb)]!;
        const e = q.vano(viga, i, fx);
        if (!e.valido) throw new Error("sin vano");
        const d = { "My+": e.valor.maxMy, "My-": e.valor.minMy, Vz: Math.abs(e.valor.maxVz.valor) >= Math.abs(e.valor.minVz.valor) ? e.valor.maxVz : e.valor.minVz, T: Math.abs(e.valor.maxT.valor) >= Math.abs(e.valor.minT.valor) ? e.valor.maxT : e.valor.minT }[nombre as keyof typeof propio];
        expect(d.s).toBe(x.s);
        const { estatica: S, sismo: A } = d.partes;
        x.esfuerzos.forEach((v, k) => expect(v).toBe(k === 0 ? S[0]! + A[0]! : k === 4 && my ? S[4]! + my * A[4]! : S[k]! >= 0 ? S[k]! + A[k]! : S[k]! - A[k]!));
      }

    // 3. Sin el sismo, los esfuerzos concomitantes de la combinación, y el del extremo, bit a bit
    const pt = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: ["ELU-PT"] });
    if (!pt.valido) throw new Error(pt.diagnosticos[0]!.mensaje);
    const sin = pieza(q, pt.valor, viga);
    if (!sin.valido) throw new Error("sin pieza");
    for (const va of (sin.valor as { vanos: { extremos: Record<string, Ext> }[] }).vanos)
      for (const [nombre, [cmp]] of Object.entries(propio)) {
        const x = va.extremos[nombre]!;
        expect(x.pesimos).toBeUndefined();
        expect(x.esfuerzos[cmp]).toBe(x.v);
      }
  });

  it("una barra: sus extremos con los esfuerzos de los signos pésimos (VS-o), y los mismos valores que antes", () => {
    // El edificio con una diagonal de acero en la fachada y = 0, de la base de P0-0 a la cabeza de P6-0 en N1
    const g: ModeloFisico = {
      ...f,
      materiales: [...f.materiales, { id: "S", tipo: "acero" }],
      secciones: [...f.secciones, { id: "t", material: "S", forma: "general", A: 1.2e-3, Iy: 1.5e-6, Iz: 1.5e-6, J: 3e-6 }],
      barras: [{ id: "D1", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "N1", x: 6, y: 0 }, seccion: "t" }],
    };
    const x = calculado(g);
    const ep = x.q.esfuerzosPiezas;
    const comp = ["N", "Vy", "Vz", "T", "My", "Mz"];
    for (const situaciones of [["ELU-SIS"], ["ELU-PT"]] as const) {
      const cj = conjuntoCombinaciones(x.q, { tipo: "situaciones", situaciones: [...situaciones] });
      if (!cj.valido) throw new Error(cj.diagnosticos[0]!.mensaje);
      const p = pieza(x.q, cj.valor, "D1");
      if (!p.valido) throw new Error("sin pieza");
      type Ext = { v: number; s: number; comb: string; esfuerzos: number[]; pesimos?: true };
      const extremos = (p.valor as { extremos: Record<string, Ext> }).extremos;
      const sismo = situaciones[0] === "ELU-SIS";
      for (const [nombre, e] of Object.entries(extremos)) {
        const cmp = comp.indexOf(nombre.replace(/[+-]$/, ""));
        const kc = cj.valor.nombres.indexOf(e.comb);
        // el valor, la estación y la combinación, los de antes: los extremos de «diagrama» de la pieza
        let viejo: { v: number; s: number; kc: number } | null = null;
        cj.valor.factores.forEach((fc, k) => {
          const d = x.q.diagrama("D1", fc);
          if (!d.valido) throw new Error("sin diagrama");
          for (const es of d.valor)
            for (const lado of [es.izquierda, es.derecha]) {
              const v = lado[cmp]!;
              const mejor = !viejo || (nombre.endsWith("+") ? v > viejo.v : nombre.endsWith("-") ? v < viejo.v : Math.abs(v) > Math.abs(viejo.v));
              if (mejor) viejo = { v, s: es.s, kc: k };
            }
        });
        expect([e.v, e.s, kc]).toEqual([viejo!.v, viejo!.s, viejo!.kc]);
        // los esfuerzos: en el punto del extremo (su tramo y su lado), la parte estática y la amplitud del sismo
        const fx = cj.valor.factores[kc]!;
        const puntos: { S: Float64Array; A: Float64Array; e: number[] }[] = [];
        for (const t of ep.tramos("D1")) {
          const D = x.q.diagramaBarra(t.barra, fx);
          recorrerDiagrama(D, (xx, lado, es) => {
            if (t.s0 + xx === e.s && es[cmp] === e.v) {
              const pt = esfuerzosPartidos(D, xx, lado);
              puntos.push({ S: pt.estatica, A: pt.sismo, e: Array.from(es) });
            }
          });
        }
        expect(puntos.length).toBeGreaterThan(0);
        const { S, A, e: conc } = puntos[0]!;
        if (!sismo) {
          expect(e.pesimos).toBeUndefined();
          expect(e.esfuerzos).toEqual(conc);
          continue;
        }
        expect(e.pesimos).toBe(true);
        // la regla, escrita aquí: N+ y N−, con el suyo; lo demás (N incluido en los otros extremos), aumentando su valor absoluto
        const signoN = nombre === "N+" ? 1 : nombre === "N-" ? -1 : 0;
        e.esfuerzos.forEach((v, k) => {
          const esperado = !A[k] ? S[k]! : k === 0 && signoN ? S[0]! + signoN * A[0]! : S[k]! >= 0 ? S[k]! + A[k]! : S[k]! - A[k]!;
          expect(v, `${nombre}, ${comp[k]}`).toBe(esperado);
          expect(Math.abs(v)).toBeGreaterThanOrEqual(k === 0 && signoN ? 0 : Math.abs(conc[k]!) * (1 - 1e-12) - 1e-12);
        });
        // con todos los signos del sismo en el conjunto, el suyo es el del extremo
        expect(rel(e.esfuerzos[cmp]!, e.v, 1e-6), nombre).toBeLessThan(1e-12);
      }
    }
  });

  it("los casos de los modos son ligeros: sus esfuerzos de extremo salen de sus resultados y son los de su diagrama", () => {
    const ep = q.esfuerzosPiezas;
    expect(ep.ligeros).toBe(c.modelo.casos.length);
    let [comparadas, conPares] = [0, 0];
    for (let b = 0; b < c.modelo.barras!.length; b += 7) {
      for (const k of [4, 8, 12]) {
        const e = ep.extremos(b, k);
        const d = ep.diagrama(b, k);
        const esperado = [...d.esfuerzosEn(0, 1), ...d.esfuerzosEn(d.L, -1)];
        const escala = Math.max(1e-9, ...esperado.map(Math.abs));
        esperado.forEach((v, i) => expect(Math.abs(e[i]! - v) / escala, `barra ${b}, modo ${k - 3}, componente ${i}`).toBeLessThan(1e-9));
        if (ep.saltosLosa(b)?.[k]?.some((x) => x !== 0)) conPares++;
        comparadas++;
      }
      // y los de un caso del cálculo, los de su diagrama tal cual
      const d0 = ep.diagrama(b, 0);
      expect(Array.from(ep.extremos(b, 0))).toEqual([...d0.esfuerzosEn(0, 1), ...d0.esfuerzosEn(d0.L, -1)]);
    }
    expect(comparadas).toBeGreaterThan(100);
    // entre ellas hay vigas con los pares de la losa repartidos
    expect(conPares).toBeGreaterThan(10);
  });

  it("las reacciones de un pilar", () => {
    const x = q.reacciones(PILAR);
    if (!x.valido) throw new Error("sin reacciones");
    const R = x.valor.resultante;
    const comb = q.combinar(R, 6, F);
    for (let cmp = 0; cmp < 6; cmp++) expect(rel(comb[cmp]!, aMano(F, (k) => R[6 * k + cmp]!), 1e-6)).toBeLessThan(1e-12);
    const re = reacciones(q, una, { objeto: PILAR });
    if (!re.valido) throw new Error("sin reacciones");
    expect(re.valor.objetos[0]!.R[0]).toEqual(Array.from(comb));
  });

  it("los desplomes: la diferencia de desplazamientos de cada modo, combinada y por μ", () => {
    const d = q.desplomes("N3", F);
    if (!d.valido) throw new Error("sin desplomes");
    const u = q.casos.map((x) => x.u);
    for (const p of d.valor.pilares.slice(0, 6)) {
      const [a, b] = [c.mapeo.nudosPilar[`${p.pilar}@N3`]!, c.mapeo.nudosPilar[`${p.pilar}@N2`]!];
      for (const [g, v] of [[0, p.dx], [1, p.dy]] as const) expect(rel(v, aMano(F, (k) => u[k]![6 * a + g]! - u[k]![6 * b + g]!, true), 1e-9)).toBeLessThan(1e-10);
    }
    // el maestro de la planta, en «deriva»
    const dv = deriva(q, una, { planta: "N3" });
    if (!dv.valido) throw new Error("sin deriva");
    const m = c.modelo.nudos.findIndex((n) => n.id === "N3:maestro");
    expect(rel(dv.valor[0]!.maestro!.ux.v, aMano(F, (k) => u[k]![6 * m]!, true), 1e-9)).toBeLessThan(1e-10);
    // con el sismo solo, μ veces lo del espectro reducido
    const solo = [0, 0, 0, 0, 1, 0, 0, 0];
    const sinMu = aMano(solo, (k) => u[k]![6 * m]!);
    expect(rel(q.combinar(q.planta("N3").valido ? (q.planta("N3") as { valor: { maestro: { u: Float64Array } } }).valor.maestro.u : [], 3, solo, true)[0]!, 2 * sinMu)).toBeLessThan(1e-12);
  });

  it("las flechas de una losa: la absoluta y la relativa a las esquinas de su recuadro", () => {
    const fl = q.flechas("L-N2", F);
    if (!fl.valido) throw new Error("sin flechas");
    const u = q.casos.map((x) => x.u);
    const n = fl.valor.maxima.nudo;
    expect(rel(fl.valor.maxima.flecha, -aMano(F, (k) => u[k]![6 * n + 2]!, true))).toBeLessThan(1e-10);
    // ningún otro nudo de la losa baja más
    const nudos = [...new Set((c.mapeo.losas?.["L-N2"] ?? []).flatMap((i) => [...c.modelo.laminas![i]!.nudos]))];
    for (const v of nudos.filter((_, i) => i % 7 === 0)) expect(-aMano(F, (k) => u[k]![6 * v + 2]!, true)).toBeLessThanOrEqual(fl.valor.maxima.flecha + 1e-12);
    expect(fl.valor.recuadros.length).toBeGreaterThan(0);
    const a = flechas(q, una, { losa: "L-N2" });
    if (!a.valido) throw new Error("sin flechas");
    expect(a.valor[0]!.maxima.v).toBe(fl.valor.maxima.flecha);
  });

  it("los mapas: cada campo, en cada nudo de cada lámina", () => {
    const rr = new ResultadosRender(q, c);
    for (const campo of ["m11", "m12", "v13", "uz"] as const) {
      const { laminas, v } = valoresCampo(rr, "N2", campo, F);
      const porBase = q.casos.map((_, base) => valoresCampo(rr, "N2", campo, { base }).v);
      expect(laminas.length).toBeGreaterThan(100);
      let [comparados, peor] = [0, 0];
      const escala = Math.max(...Array.from(v).filter((x) => !Number.isNaN(x)).map(Math.abs));
      for (let j = 0; j < v.length; j += 3) {
        if (Number.isNaN(v[j]!)) continue;
        peor = Math.max(peor, Math.abs(v[j]! - aMano(F, (k) => porBase[k]![j]!, campo === "uz")) / escala);
        comparados++;
      }
      expect(comparados, campo).toBeGreaterThan(100);
      expect(peor, campo).toBeLessThan(1e-10);
    }
  });

  it("las franjas de armado: los momentos medios combinados y, con ellos, Wood–Armer con los signos pésimos del sismo (VS-o)", () => {
    const fs = q.franjas("L-N2");
    if (!fs.valido) throw new Error("sin franjas");
    let [comparadas, mas] = [0, 0];
    for (const fr of fs.valor.filter((_, i) => i % 5 === 0)) {
      const est = q.franja(fr.id);
      const arm = q.armadoFranja(fr.id, [F]);
      if (!est.valido || !arm.valido) throw new Error("sin franja");
      est.valor.estaciones.forEach((e, i) => {
        if (!e.valido) return;
        // mx, la variable sola (con el signo del modo dominante)
        const [mx, my, mxy] = [0, 1, 2].map((cmp) => aMano(F, (k) => e.medios[3 * k + cmp]!)) as [number, number, number];
        const a = arm.valor[i]!;
        expect(rel(a.mxMax, mx, 1e-6)).toBeLessThan(1e-10);
        expect(rel(a.mxMin, mx, 1e-6)).toBeLessThan(1e-10);
        // Wood–Armer: el peor de los 8 signos de la parte del sismo de mx, my y mxy
        const p = [0, 1, 2].map((cmp) => partesAMano(F, (k) => e.medios[3 * k + cmp]!));
        let [inf, sup] = [0, 0];
        for (const sx of [1, -1])
          for (const sy of [1, -1])
            for (const sxy of [1, -1]) {
              const w = woodArmer(p[0]!.S + sx * p[0]!.A, p[1]!.S + sy * p[1]!.A, p[2]!.S + sxy * p[2]!.A);
              inf = Math.max(inf, w.inferiorX);
              sup = Math.max(sup, w.superiorX);
            }
        expect(rel(a.inferior, inf, 1e-6)).toBeLessThan(1e-10);
        expect(rel(a.superior, sup, 1e-6)).toBeLessThan(1e-10);
        // nunca menos que con los momentos del signo del modo dominante
        const w = woodArmer(mx, my, mxy);
        expect(a.inferior).toBeGreaterThanOrEqual(w.inferiorX * (1 - 1e-12));
        expect(a.superior).toBeGreaterThanOrEqual(w.superiorX * (1 - 1e-12));
        if (a.inferior > w.inferiorX * (1 + 1e-6) || a.superior > w.superiorX * (1 + 1e-6)) mas++;
        comparadas++;
      });
    }
    expect(comparadas).toBeGreaterThan(50);
    // y en alguna estación da más (si no, la prueba no prueba nada)
    expect(mas).toBeGreaterThan(0);
  });
});

describe("VS3: sin el espectro, como sin el sismo", () => {
  it("con sólo las masas y los modos, las consultas dan lo mismo que sin el sismo en las acciones, bit a bit", () => {
    const sin = calculado(edificio(2, null));
    const con = calculado(edificio(2, {}));
    expect(con.q.sup.conEspectrales).toBe(false);
    expect(con.q.fisico.casos.map((x) => x.id)).toEqual(["G", "Q", "Vx", "Vy"]);
    expect(con.q.nb).toBe(4);
    expect(con.q.modelo).toBe(con.c.modelo);
    for (const proposito of ["esfuerzos", "desplazamientos"] as const) {
      const cj = (x: Consultas) => {
        const y = conjuntoCombinaciones(x, seleccionPorDefecto(x.fisico.casos, proposito));
        if (!y.valido) throw new Error("sin combinaciones");
        return y.valor;
      };
      expect(cj(con.q).nombres).toEqual(cj(sin.q).nombres);
      expect(JSON.stringify(envolventes(con.q, cj(con.q)))).toBe(JSON.stringify(envolventes(sin.q, cj(sin.q))));
      expect(JSON.stringify(flechas(con.q, cj(con.q)))).toBe(JSON.stringify(flechas(sin.q, cj(sin.q))));
      expect(JSON.stringify(deriva(con.q, cj(con.q)))).toBe(JSON.stringify(deriva(sin.q, cj(sin.q))));
    }
  });

  it("los datos del espectro que no valen, o a medias, son errores de la validación", () => {
    const codigos = (s: SismoEdificio, extra: Partial<ModeloFisico> = {}) => {
      const x = compilar({ ...edificio(2, s), ...extra });
      return x.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo);
    };
    // con ab hacen falta K, el terreno y la ductilidad: ninguno se toma por defecto
    expect(codigos({ ab: 0.16 })).toEqual(["sismo/dato-no-valido", "sismo/dato-no-valido", "sismo/dato-no-valido"]);
    expect(codigos({ ab: 0.16, K: 1, terreno: "II" })).toEqual(["sismo/dato-no-valido"]);
    // ab va en g
    expect(codigos({ ...SISMO, ab: 1.57 })).toEqual(["sismo/dato-no-valido"]);
    expect(codigos({ ...SISMO, K: 0.9 })).toEqual(["sismo/dato-no-valido"]);
    expect(codigos({ ...SISMO, mu: 5 })).toEqual(["sismo/dato-no-valido"]);
    expect(codigos({ ...SISMO, mu: { x: 2, y: 0.5 } })).toEqual(["sismo/dato-no-valido"]);
    expect(codigos({ ...SISMO, terreno: 2.4 })).toEqual(["sismo/dato-no-valido"]);
    expect(codigos({ ...SISMO, terreno: [{ tipo: "II", C: 1.3, espesor: 10 }] })).toEqual(["sismo/dato-no-valido"]);
    expect(codigos({ ...SISMO, omega: 0 })).toEqual(["sismo/dato-no-valido"]);
    expect(codigos({ ...SISMO, excentricidad: 0.7 })).toEqual(["sismo/dato-no-valido"]);
    // los datos del espectro sin ab no hacen nada: se dice
    expect(codigos({ K: 1, mu: 2 })).toEqual(["sismo/sin-ab"]);
    // los casos del programa no se escriben
    const casos = [...edificio(2).casos, { id: "EX+e", accion: { tipo: "E" as const, direccion: "X" as const } }];
    expect(codigos(SISMO, { casos })).toContain("sismo/caso-existente");
    // lo que vale: los estratos, μ por dirección, la regla y la importancia
    const bien: SismoEdificio = { ab: 0.07, K: 1.1, importancia: "especial", terreno: [{ tipo: "II", espesor: 8 }, { C: 1.7, espesor: 30 }], mu: { x: 2, y: 3 }, omega: 4, regla: "srss", excentricidad: 0, sistema: "porticos-ha" };
    expect(codigos(bien)).toEqual([]);
    // y un caso de sismo escrito a mano además del del programa, un aviso
    const aMano2 = compilar({ ...edificio(2), casos: [...edificio(2).casos, { id: "Sx", accion: { tipo: "E", direccion: "X" } }] });
    expect(aMano2.valido).toBe(true);
    expect(aMano2.diagnosticos.map((d) => d.codigo)).toContain("sismo/casos-a-mano");
  });

  it("μ por dirección, la regla del articulado y sin excentricidad", () => {
    const x = calculado(edificio(2, { ab: 0.07, K: 1.1, importancia: "especial", terreno: [{ tipo: "II", espesor: 8 }, { C: 1.7, espesor: 30 }], mu: { x: 2, y: 3 }, omega: 4, regla: "srss", excentricidad: 0, sistema: "porticos-ha" }));
    const s = sismo(x.q);
    if (!s.valido) throw new Error(s.diagnosticos[0]!.mensaje);
    // C = (1,3·8 + 1,7·22)/30; ρ = 1,3; ν = (5/4)^0,4
    expect(s.valor.emplazamiento.C).toBeCloseTo((1.3 * 8 + 1.7 * 22) / 30, 14);
    expect(s.valor.emplazamiento.rho).toBe(1.3);
    expect(s.valor.nu).toBeCloseTo(1.25 ** 0.4, 14);
    expect(s.valor.direcciones.map((d) => d.mu)).toEqual([2, 3]);
    expect(s.valor.direcciones[1]!.beta).toBeCloseTo(1.25 ** 0.4 / 3, 14);
    expect(s.valor.regla).toBe("srss");
    for (const d of s.valor.direcciones) {
      for (const p of d.plantas) expect(p.par).toBe(0);
      // con el sistema estructural, también el periodo aproximado: 0,09·n
      const formula = d.simplificado.find((y) => y.periodo === "el aproximado del art. 3.7.2.2")!;
      expect(formula.TF).toBeCloseTo(0.18, 14);
    }
    // sin excentricidad, EX+e y EX−e son el mismo caso
    const t = x.q.pilar(PILAR);
    if (!t.valido) throw new Error("sin pilar");
    const e = t.valor[0]!.base.esfuerzos;
    expect(Array.from(x.q.combinar(e, 6, [0, 0, 0, 0, 1, 0, 0, 0]))).toEqual(Array.from(x.q.combinar(e, 6, [0, 0, 0, 0, 0, 1, 0, 0])));
    // la regla del articulado, a mano, en los esfuerzos de la base del pilar
    const comb = x.q.combinar(e, 6, F);
    for (let cmp = 0; cmp < 6; cmp++) expect(rel(comb[cmp]!, aMano(F, (k) => e[6 * k + cmp]!, false, x), 1e-6), `componente ${cmp}`).toBeLessThan(1e-12);
  });
});

describe("VS3: los modos, como casos, con los resultados guardados; y la CLI", () => {
  it("se guardan los cuatro vectores de cada modo y se releen con los mismos bits: las consultas, las mismas", () => {
    const { cabecera, bytes } = empaquetarResultados(c.huella, c.modelo, r.casos, r.estadisticas, [], r.modal);
    const d = desempaquetarResultados(JSON.parse(JSON.stringify(cabecera)), bytes, c.modelo);
    if ("motivo" in d) throw new Error(d.motivo);
    r.modal!.modos.forEach((m, i) => {
      const o = d.modal!.modos[i]!;
      for (const campo of ["u", "reacciones", "esfuerzosBarras", "esfuerzosLaminas", "forma", "fuerzas"] as const) expect(Buffer.from(o[campo].buffer, o[campo].byteOffset, o[campo].byteLength).equals(Buffer.from(m[campo].buffer, m[campo].byteOffset, m[campo].byteLength)), `${campo} del modo ${i + 1}`).toBe(true);
    });
    const otra = new Consultas(f, c, d.casos, {}, d.modal);
    expect(JSON.stringify(sismo(otra))).toBe(JSON.stringify(sismo(q)));
    expect(JSON.stringify(pieza(otra, una, PILAR))).toBe(JSON.stringify(pieza(q, una, PILAR)));
    // unos resultados con los modos de antes (sin los vectores de su caso) no valen
    const vieja = JSON.parse(JSON.stringify(cabecera)) as typeof cabecera;
    delete (vieja.modal as { vectores?: string }).vectores;
    const mal = desempaquetarResultados(vieja, bytes, c.modelo);
    expect("motivo" in mal && mal.motivo).toContain("análisis modal");
  });

  it("la CLI: `fem consultar sismo`, las combinaciones sísmicas por defecto y un caso del sismo suelto", () => {
    const fem = (args: string[]) => {
      const x = spawnSync("node", [join(RAIZ, "cli", "fem.ts"), ...args], { encoding: "utf8", cwd: dir, maxBuffer: 1 << 26 });
      const lineas = x.stdout.trim().split("\n");
      expect(lineas.length, x.stderr).toBe(1);
      return { codigo: x.status ?? -1, json: JSON.parse(lineas[0]!) as Record<string, any> };
    };
    mkdirSync(join(dir, "con"), { recursive: true });
    const ruta = join(dir, "con", "proyecto.json");
    const f2 = edificio(2);
    writeFileSync(ruta, JSON.stringify({ esquema: VERSION_ESQUEMA, modelo: f2 }, null, 2));
    // el proyecto con el espectro cumple el esquema
    const val = fem(["validar", ruta]);
    expect(val.codigo, JSON.stringify(val.json.diagnosticos)).toBe(0);
    const s = fem(["consultar", ruta, "sismo", "--exacto"]);
    expect(s.codigo, JSON.stringify(s.json)).toBe(0);
    const aqui = calculado(f2);
    const esperado = sismo(aqui.q);
    if (!esperado.valido) throw new Error("sin sismo");
    expect(s.json.valor.direcciones.map((d: { cortanteBasal: number }) => d.cortanteBasal)).toEqual(esperado.valor.direcciones.map((d) => d.cortanteBasal));
    expect(s.json.valor.casos).toEqual(["EX+e", "EX-e", "EY+e", "EY-e"]);
    // por defecto, los esfuerzos se buscan también en la situación sísmica
    const p = fem(["consultar", ruta, "pieza", PILAR, "--exacto"]);
    expect(p.codigo).toBe(0);
    expect(p.json.valor.combinaciones).toBe("ELU-PT, ELU-SIS");
    // un caso del sismo suelto, y una combinación escrita con él
    const caso = fem(["consultar", ruta, "pieza", PILAR, "--caso", "EX+e", "--exacto"]);
    expect(caso.codigo, JSON.stringify(caso.json)).toBe(0);
    const t = aqui.q.pilar(PILAR);
    if (!t.valido) throw new Error("sin pilar");
    const base = aqui.q.combinar(t.valor[0]!.base.esfuerzos, 6, [0, 0, 0, 0, 1, 0, 0, 0]);
    expect(caso.json.valor.tramos[0].base["N+"].esfuerzos).toEqual(Array.from(base));
    const comb = fem(["consultar", ruta, "reacciones", "--combinacion", "G+0.3*Q+EX+e-0.3*EY-e", "--objeto", PILAR, "--exacto"]);
    expect(comb.codigo, JSON.stringify(comb.json)).toBe(0);
    // el render de un mapa con la situación sísmica
    const render = fem(["render", ruta, "--vista", "m11", "--planta", "N2", "--situacion", "ELU-SIS", "--envolvente", "max"]);
    expect(render.codigo, JSON.stringify(render.json)).toBe(0);
    // la revisión, con las combinaciones sísmicas en sus comprobaciones
    const rev = fem(["revisar", ruta]);
    expect(rev.codigo, JSON.stringify(rev.json).slice(0, 2000)).toBe(0);
    // y el cálculo dice el cortante en la base
    const calc = fem(["calcular", ruta]);
    expect(calc.json.reutilizados).toBe(true);
    // (la salida va redondeada a 6 cifras)
    esperado.valor.direcciones.forEach((d, i) => expect(rel(calc.json.sismo.cortanteBasal[i], d.cortanteBasal)).toBeLessThan(1e-5));
    expect(calc.json.sismo.casos).toEqual(["EX+e", "EX-e", "EY+e", "EY-e"]);
  });
});

describe("VS4: las envolventes de la situación sísmica no rehacen en cada combinación lo que comparten", () => {
  /** El conjunto entero de la situación sísmica con la persistente: 16 + 64 combinaciones. */
  const todas = () => {
    const x = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: ["ELU-PT", "ELU-SIS"] });
    if (!x.valido) throw new Error("sin combinaciones");
    return x.valor;
  };

  it("recorrer un diagrama compuesto da, en el mismo orden, las estaciones y los esfuerzos de leerlo combinación a combinación", () => {
    const conjunto = todas();
    expect(conjunto.factores.length).toBe(80);
    let barras = 0;
    for (const b of [...(q.mapeo.piezas[PILAR] ?? []), ...(q.mapeo.piezas[f.vigas![0]!.id] ?? [])]) {
      barras++;
      for (const fa of conjunto.factores) {
        const D = q.diagramaBarra(b, fa);
        const esperado: [number, number, number[]][] = [];
        for (const x of D.estaciones())
          for (const lado of [-1, 1] as const) {
            if ((x === 0 && lado < 0) || (x === D.L && lado > 0)) continue;
            esperado.push([x, lado, D.esfuerzosEn(x, lado)]);
          }
        const leido: [number, number, number[]][] = [];
        // (unas Consultas nuevas: nada guardado de la lectura de arriba)
        const q2 = new Consultas(f, c, r.casos, {}, r.modal);
        recorrerDiagrama(q2.diagramaBarra(b, fa), (x, lado, e) => leido.push([x, lado, Array.from(e)]));
        expect(leido).toEqual(esperado);
      }
    }
    expect(barras).toBeGreaterThan(2);
  });

  it("el mapa de la envolvente de un campo es, nudo a nudo, el de recorrer `valoresCampo` en cada combinación", () => {
    const conjunto = todas();
    const rr = new ResultadosRender(q, c);
    const planta = f.plantas[0]!.id;
    for (const [campo, cual] of [
      ["m11", "max"],
      ["uz", "min"],
      ["f22", "max"],
    ] as const) {
      const env = envolventeCampo(rr, planta, campo, conjunto, cual);
      const porComb = conjunto.factores.map((fa) => valoresCampo(rr, planta, campo, fa).v);
      env.v.forEach((v, j) => {
        let mejor = porComb[0]![j]!;
        let comb = 0;
        porComb.forEach((x, k) => {
          if (cual === "max" ? x[j]! > mejor : x[j]! < mejor) [mejor, comb] = [x[j]!, k];
        });
        if (Number.isNaN(mejor)) expect(v).toBeNaN();
        else expect(v).toBe(mejor);
        expect(env.comb[j]).toBe(comb);
      });
    }
  });

  it("las franjas: la envolvente en dos pasos (los casos del sismo combinados una vez por estación) es la de combinar cada combinación", () => {
    const conjunto = todas();
    const fr = q.franjas(f.losas![0]!.id);
    if (!fr.valido) throw new Error("sin franjas");
    const id = fr.valor[Math.floor(fr.valor.length / 2)]!.id;
    const a = q.armadoFranja(id, conjunto.factores);
    const e = q.franja(id);
    if (!a.valido || !e.valido) throw new Error("sin estaciones");
    e.valor.estaciones.forEach((est, i) => {
      if (!est.valido) return;
      const w = a.valor[i]!;
      let [inf, sup, mxMax, mxMin] = [0, 0, -Infinity, Infinity];
      for (const fa of conjunto.factores) {
        const [mx] = q.combinar(est.medios, 3, fa);
        const { estatica: s, sismo: a } = q.sup.partir(est.medios, 3, fa);
        const wa = q.sup.esLineal(fa) ? woodArmer(...(Array.from(q.combinar(est.medios, 3, fa)) as [number, number, number])) : woodArmerPesimo(s[0]!, s[1]!, s[2]!, a[0]!, a[1]!, a[2]!);
        inf = Math.max(inf, wa.inferiorX);
        sup = Math.max(sup, wa.superiorX);
        mxMax = Math.max(mxMax, mx!);
        mxMin = Math.min(mxMin, mx!);
      }
      expect(w.inferior).toBe(inf);
      expect(w.superior).toBe(sup);
      expect(w.mxMax).toBe(mxMax);
      expect(w.mxMin).toBe(mxMin);
    });
  });
});

describe("VS4: los campos de los modos se combinan por planta y se sueltan al cambiar de planta", () => {
  const SIS = () => {
    const x = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: ["ELU-SIS"] });
    if (!x.valido) throw new Error("sin combinaciones");
    return x.valor;
  };

  it("los casos efímeros son los de los modos, y los mapas y las franjas sólo guardan lo de la planta en la que se trabaja", () => {
    // (unas Consultas nuevas: nada guardado)
    const q2 = new Consultas(f, c, r.casos, {}, r.modal);
    const ns = c.modelo.casos.length;
    const ef = q2.efimeros!;
    expect(ef).not.toBeNull();
    expect(ef.cuales).toEqual(r.modal!.modos.map((_, i) => ns + i));
    expect(q2.sup.espectrales.length).toBe(4);
    const rr = new ResultadosRender(q2, c);
    const [arriba, abajo] = [f.plantas[0]!.id, f.plantas[1]!.id];
    const modos = r.modal!.modos.map((_, i) => q2.casos[ns + i]!.u);
    const estatico = q2.casos[0]!.u;
    // El mapa de una planta: los casos estáticos dejan su evaluador compartido; los modos, ninguno
    // (se evalúan por bloques y se sueltan con ellos)
    valoresCampo(rr, arriba, "m11", F);
    const evEstatico = q2.campos.evaluadorCompartido(estatico);
    expect(q2.campos.tieneEvaluador(estatico)).toBe(true);
    for (const u of modos) expect(q2.campos.tieneEvaluador(u)).toBe(false);
    expect(ef.soltados).toBe(0);
    // Otro mapa de la misma planta: guardado
    valoresCampo(rr, arriba, "v13", F);
    expect(ef.soltados).toBe(0);
    // Las franjas de la planta: los cortes comparten los evaluadores de los modos mientras barren la
    // losa, y los sueltan cada tantas rectas; al acabar quedan los del último tramo
    const losaArriba = f.losas!.find((l) => l.planta === arriba)!.id;
    const frArriba = q2.franjas(losaArriba);
    if (!frArriba.valido) throw new Error("sin franjas");
    q2.franja(frArriba.valor[0]!.id);
    const n1 = ef.soltados;
    expect(n1).toBeGreaterThanOrEqual(1);
    expect(q2.campos.tieneEvaluador(modos[0]!)).toBe(true);
    expect(q2.campos.evaluadorCompartido(estatico)).toBe(evEstatico);
    // Un mapa de otra planta: lo de los modos se suelta; los estáticos siguen
    valoresCampo(rr, abajo, "m11", F);
    expect(ef.soltados).toBe(n1 + 1);
    for (const u of modos) expect(q2.campos.tieneEvaluador(u)).toBe(false);
    expect(q2.campos.evaluadorCompartido(estatico)).toBe(evEstatico);
    // Las franjas de la planta de arriba en la otra dirección: se cambia de planta (y lo de los modos
    // se vuelve a evaluar: los mismos valores, abajo)
    const otra = frArriba.valor.find((x) => x.direccion !== frArriba.valor[0]!.direccion)!;
    q2.franja(otra.id);
    expect(ef.soltados).toBeGreaterThanOrEqual(n1 + 2);
  });

  it("lo que se vuelve a calcular tras soltar da los mismos bits: mapas, franjas y el valor de un modo suelto", () => {
    const [arriba, abajo] = [f.plantas[0]!.id, f.plantas[1]!.id];
    const losaArriba = f.losas!.find((l) => l.planta === arriba)!.id;
    const sis = SIS();
    // Referencia: unas Consultas que sólo trabajan en la planta de arriba
    const qa = new Consultas(f, c, r.casos, {}, r.modal);
    const rra = new ResultadosRender(qa, c);
    const mapaA = envolventeCampo(rra, arriba, "m11", sis, "max");
    const frA = qa.franjas(losaArriba);
    if (!frA.valido) throw new Error("sin franjas");
    const ids = [frA.valor[0]!.id, frA.valor.find((x) => x.direccion !== frA.valor[0]!.direccion)!.id];
    const estA = ids.map((id) => qa.franja(id));
    const modoA = valoresCampo(rra, arriba, "m22", { base: c.modelo.casos.length + 2 }).v;
    // Lo mismo, pasando por la planta de abajo entre medias (se suelta lo de los modos dos veces)
    const qb = new Consultas(f, c, r.casos, {}, r.modal);
    const rrb = new ResultadosRender(qb, c);
    qb.franja(ids[0]!);
    const n1 = qb.efimeros!.soltados;
    envolventeCampo(rrb, abajo, "m11", sis, "max");
    expect(qb.efimeros!.soltados).toBe(n1 + 1);
    const mapaB = envolventeCampo(rrb, arriba, "m11", sis, "max");
    expect(qb.efimeros!.soltados).toBe(n1 + 2);
    // (las franjas de la otra dirección cortan las mismas láminas: las fuerzas nodales de los modos, con huecos, se rellenan)
    const estB = ids.map((id) => qb.franja(id));
    const modoB = valoresCampo(rrb, arriba, "m22", { base: c.modelo.casos.length + 2 }).v;
    expect(mapaB.v).toEqual(mapaA.v);
    expect(mapaB.comb).toEqual(mapaA.comb);
    estA.forEach((ea, i) => {
      const eb = estB[i]!;
      if (!ea.valido || !eb.valido) throw new Error("sin estaciones");
      expect(eb.valor.estaciones.length).toBe(ea.valor.estaciones.length);
      eb.valor.estaciones.forEach((e, j) => expect(e.medios).toEqual(ea.valor.estaciones[j]!.medios));
    });
    expect(modoB).toEqual(modoA);
    // Y un mapa de un caso del sismo suelto es lo que suma a una combinación que sólo lo lleva
    const caso = qa.sup.logicos.find((l) => l.id === "EX+e")!.espectral!;
    const solo = new Float64Array(qa.nl);
    solo[qa.sup.logicos.findIndex((l) => l.id === "EX+e")] = 1;
    expect(valoresCampo(rra, arriba, "m11", { espectral: caso }).v).toEqual(valoresCampo(rra, arriba, "m11", solo).v);
  });
});
