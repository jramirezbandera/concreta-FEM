// =============================================================================
// GOLDEN NUMERICO END-TO-END del motor real (feature-6, T1.2 — Capa B).
//
// Corre cada obra canonica por el PIPELINE COMPLETO (obra -> discretizar ->
// Pyodide/PyNite -> ResultadosCalculo) y compara esfuerzos/reacciones/deformada
// contra los valores ANALITICOS DE LIBRO con las tolerancias del arnes. Es la red
// de seguridad del producto (CLAUDE.md §13): si un numero falla por encima de
// tolerancia, el bug esta en el DISCRETIZADOR o en UNIDADES, nunca en la formula.
//
// UN UNICO FICHERO con motor (arnes/motor.ts cachea la promesa de arranque A
// NIVEL DE MODULO, y Vitest aisla por fichero): todos los golden de motor van
// aqui para pagar el arranque de Pyodide UNA sola vez (beforeAll).
//
// QUE SE VERIFICA AQUI (numeros del motor), separado de T1.1 (estructura de la
// Capa 2 del discretizador):
//  - Biapoyada UDL: |M|=qL²/8 (en min_moment_z, signo negativo), V=qL/2, R=qL/2,
//    flecha centro 5qL⁴/384EIz. ASSERT EXPLICITO de la convencion de signo.
//  - Voladizo P: |M|_empotr=PL (en max_moment_z), V=P, R_vert=P, R_mom=PL. La
//    flecha del extremo NO es la del voladizo puro: el empotramiento lo da un
//    PILAR flexible (no un apoyo rigido), que introduce desplome -> se trata como
//    REGRESION, no validacion analitica (documentado en el caso).
//  - Biapoyada P centrada: |M|=PL/4 (en min_moment_z), R=P/2, flecha centro
//    PL³/48EIz leida en el nudo central (apoyos sin desplome por simetria -> limpia).
//  - Portico simple: hiperestatico sin forma cerrada -> GOLDEN DE REGRESION
//    (fija contra el propio motor) + equilibrio (check_statics) + simetria + R=qB/2.
//  - check_statics: equilibrio_ok===true en los casos correctos, y un caso con
//    CARGA LOCAL TRANSVERSAL (Fy) que ejercita/blinda el fix de pynite_glue.py.
//
// CONVENCION DE EJES (confirmada empiricamente, ver feature-5 memoria + dump T1.2):
//  La planta (x,y) -> global (X,Z); la cota -> Y vertical. Una viga corre en global
//  X a altura Y=cota. La carga gravitatoria es FY global NEGATIVA. Para un miembro
//  horizontal en X, PyNite pone el eje local y = Y global (vertical): la flexion
//  vertical usa Iz (eje local z) y la flecha es dy local. Por eso la INERCIA QUE
//  GOBIERNA la flecha de estas vigas es Iz (IPE300: 6038 cm⁴), NO Iy.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import {
  obtenerMotor,
  TIMEOUT_ARRANQUE,
  discretizarOExplotar,
  fixtureBiapoyadaUDL,
  fixtureVoladizoPuntual,
  fixtureBiapoyadaPuntualCentro,
  fixturePorticoSimple,
  compararEsfuerzo,
  compararReaccion,
  compararFlecha,
  type ArranqueMotor,
  type ResultadoComparacion,
} from "./_arnes";
import type { Modelo } from "../../src/dominio";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";
import type { ResultadosCalculo } from "../../src/solver/resultados";

// --- Constantes de material/seccion del fixture (S275 + IPE300) --------------
// Se necesitan para calcular las flechas teoricas. Valores INTERNOS (kN-m), los
// mismos que el discretizador inyecta en la Capa 2 (verificado en el dump T1.2):
//   E (S275) = 210000 MPa = 2.1e8 kN/m²   (aceros.ts)
//   Iz (IPE300, eje debil = flexion vertical de estas vigas) = 6038 cm⁴ = 6.038e-5 m⁴
const E_ACERO = 2.1e8; // kN/m²
const IZ_IPE300 = 6.038e-5; // m⁴ (eje que gobierna la flexion vertical, ver cabecera)

// Helper de assert: usa el detalle de la comparacion para un mensaje "real vs
// teorico" claro. NO afloja la tolerancia: si falla, el bug es del pipeline.
function assertOk(c: ResultadoComparacion, etiqueta: string): void {
  const msg =
    `${etiqueta}: real=${c.real} teorico=${c.teorico} ` +
    `errAbs=${c.errAbs.toExponential(3)} errRel=${(c.errRel * 100).toFixed(4)}%`;
  expect(c.ok, msg).toBe(true);
}

// Identifica el NOMBRE FEM de la barra horizontal (viga/dintel) por GEOMETRIA, no
// por magnitud de flector. En el mapeo de ejes del discretizador (cabecera) la cota
// es Y (vertical): los PILARES son verticales (Yi != Yj) y la VIGA/DINTEL es
// HORIZONTAL (Yi == Yj a la cota de la planta). Esto es determinista y estable —
// no depende de que el flector de la viga supere al del pilar (en voladizo/portico
// ambos alcanzan |M|=PL y la heuristica de magnitud podia empatar y elegir el pilar).
// Se lee de la Capa 2 (ModeloFEM discretizado), que SI tiene la geometria.
function nombreVigaHorizontal(modeloFEM: ModeloFEM): string {
  const coordY = new Map(modeloFEM.nodes.map((n) => [n.name, n.y] as const));
  const horizontales = modeloFEM.members.filter((mb) => {
    const yi = coordY.get(mb.i);
    const yj = coordY.get(mb.j);
    return yi !== undefined && yj !== undefined && yi === yj;
  });
  if (horizontales.length === 0) {
    throw new Error("No hay barra horizontal (viga/dintel) en el ModeloFEM");
  }
  // En los fixtures isostaticos hay UNA sola viga horizontal cargada; si hubiera
  // varias (p. ej. biapoyada-P con dos vanos) cualquiera vale para el pico, pero
  // estos casos no usan este selector. Devolvemos la primera por orden FEM (M..).
  return horizontales[0].name;
}

// Nombres FEM de TODAS las barras horizontales (vigas/dintel) del modelo.
function nombresVigasHorizontales(modeloFEM: ModeloFEM): string[] {
  const coordY = new Map(modeloFEM.nodes.map((n) => [n.name, n.y] as const));
  return modeloFEM.members
    .filter((mb) => {
      const yi = coordY.get(mb.i);
      const yj = coordY.get(mb.j);
      return yi !== undefined && yj !== undefined && yi === yj;
    })
    .map((mb) => mb.name);
}

// Resultados (min/max flector, cortante) de la barra horizontal de la obra, leidos
// por su NOMBRE FEM (identificado por geometria, no por magnitud). Requiere el
// ModeloFEM discretizado del MISMO fixture (mapeo determinista nombre<->geometria).
function barraViga(
  res: ResultadosCalculo,
  modeloFEM: ModeloFEM,
  combo: string,
): { name: string; min_moment_z: number; max_moment_z: number; max_shear_y: number } {
  const name = nombreVigaHorizontal(modeloFEM);
  const v = res.barras[name]?.[combo];
  if (!v) throw new Error(`Barra viga ${name} sin resultado en combo ${combo}`);
  return {
    name,
    min_moment_z: v.min_moment_z,
    max_moment_z: v.max_moment_z,
    max_shear_y: v.max_shear_y,
  };
}

// Como barraViga pero cuando hay VARIAS vigas horizontales (p. ej. biapoyada-P en
// dos vanos): elige, ENTRE LAS HORIZONTALES (nunca un pilar), la de mayor |flector|.
// El criterio de magnitud queda acotado al subconjunto correcto por geometria.
function barraVigaMasFlectada(
  res: ResultadosCalculo,
  modeloFEM: ModeloFEM,
  combo: string,
): { name: string; min_moment_z: number; max_moment_z: number; max_shear_y: number } {
  let mejor: { name: string; min_moment_z: number; max_moment_z: number; max_shear_y: number } | null =
    null;
  for (const name of nombresVigasHorizontales(modeloFEM)) {
    const v = res.barras[name]?.[combo];
    if (!v) continue;
    const pico = Math.max(Math.abs(v.min_moment_z), Math.abs(v.max_moment_z));
    const picoMejor = mejor ? Math.max(Math.abs(mejor.min_moment_z), Math.abs(mejor.max_moment_z)) : -1;
    if (mejor === null || pico > picoMejor) {
      mejor = { name, min_moment_z: v.min_moment_z, max_moment_z: v.max_moment_z, max_shear_y: v.max_shear_y };
    }
  }
  if (mejor === null) throw new Error(`Sin viga horizontal con flector en combo ${combo}`);
  return mejor;
}

// Flecha vertical extrema (mas negativa = descenso por gravedad) entre TODOS los
// puntos de los diagramas defl_y de TODAS las barras de un combo. Util cuando la
// viga es una sola barra y el centro no cae en un nudo (no hay DY nodal exacto).
function flechaMaxDescenso(res: ResultadosCalculo, combo: string): number {
  let dmin = 0;
  for (const porCombo of Object.values(res.barras)) {
    const v = porCombo[combo];
    if (!v) continue;
    for (const d of v.defl_y[1]) if (d < dmin) dmin = d;
  }
  return dmin;
}

// Mayor cortante (en magnitud) entre TODAS las barras de un combo. En estos
// modelos el cortante maximo lo lleva la viga/dintel cargado (los pilares de
// apoyo de la biapoyada llevan cortante ~0). Independiente de como se localice la
// viga: barre todas las barras y se queda con el pico de |max_shear_y|.
function maxCortanteAbs(res: ResultadosCalculo, combo: string): number {
  let v = 0;
  for (const porCombo of Object.values(res.barras)) {
    const b = porCombo[combo];
    if (b && Math.abs(b.max_shear_y) > v) v = Math.abs(b.max_shear_y);
  }
  return v;
}

// Nudos extremo (i, j) de una barra leidos de la Capa 2 (ModeloFEM). Necesarios
// para el invariante de continuidad de la deformada global (estacion 0 == disp del
// nudo i; estacion n-1 == disp del nudo j).
function nodosBarra(modeloFEM: ModeloFEM, member: string): { i: string; j: string } {
  const mb = modeloFEM.members.find((x) => x.name === member);
  if (!mb) throw new Error(`Barra ${member} no esta en el ModeloFEM`);
  return { i: mb.i, j: mb.j };
}

// Reaccion vertical FY (kN, positiva hacia arriba) de un nudo apoyado.
function fyReaccion(res: ResultadosCalculo, nodo: string, combo: string): number {
  const n = res.nodos[nodo]?.[combo];
  if (!n) throw new Error(`Nudo ${nodo} sin resultado en combo ${combo}`);
  return n.rxn[1]; // rxn = [FX,FY,FZ,MX,MY,MZ]
}

// Suma de reacciones verticales de TODOS los nudos (debe igualar la carga total).
function sumaReaccionVertical(res: ResultadosCalculo, combo: string): number {
  let s = 0;
  for (const porCombo of Object.values(res.nodos)) {
    const n = porCombo[combo];
    if (n) s += n.rxn[1];
  }
  return s;
}

// =============================================================================
describe("golden pipeline E2E (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN][SKIP] ${arranque.motivo}\n`);
    } else {
      const v = arranque.motor.versiones;
      console.warn(
        `\n[GOLDEN][PAR REAL] python=${v.python} numpy=${v.numpy} scipy=${v.scipy} PyNiteFEA=${v.pynite}\n`,
      );
    }
  }, TIMEOUT_ARRANQUE);

  // Ejecuta el pipeline (obra -> discretizar -> motor) y devuelve la Capa 2
  // (ModeloFEM) discretizada del MISMO fixture junto a los resultados: la Capa 2 es
  // necesaria para localizar la barra viga/dintel por geometria (T3), sin adivinar
  // por magnitud de flector. Devuelve null si no hay motor (el test salta).
  function correrConFEM(
    modelo: Modelo,
  ): { res: ResultadosCalculo; fem: ModeloFEM } | null {
    if (!arranque || !arranque.ok) {
      console.warn(`[GOLDEN][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
      return null;
    }
    const fem = discretizarOExplotar(modelo);
    const res = arranque.motor.calcular(fem);
    return { res, fem };
  }

  // ---------------------------------------------------------------------------
  // 1) BIAPOYADA con carga uniforme (UDL).  |M|=qL²/8, V=qL/2, R=qL/2, δ=5qL⁴/384EIz.
  //    Combo ELS (factor 1.0 sobre la permanente G) -> carga sin mayorar = q.
  // ---------------------------------------------------------------------------
  it(
    "biapoyada UDL: |M|=qL²/8 (en min_moment_z), V=qL/2, R=qL/2, flecha 5qL⁴/384EIz",
    () => {
      const L = 6;
      const q = 10;
      const corrida = correrConFEM(fixtureBiapoyadaUDL({ L, q }));
      if (!corrida) return;
      const { res, fem } = corrida;

      const combo = "ELS";
      const Mteo = (q * L * L) / 8; // 45 kN·m (magnitud del pico)
      const Vteo = (q * L) / 2; // 30 kN
      const Rteo = (q * L) / 2; // 30 kN por apoyo
      const flechaTeo = (5 * q * L ** 4) / (384 * E_ACERO * IZ_IPE300); // m (descenso)

      const viga = barraViga(res, fem, combo);

      // CONVENCION DE SIGNO (ASSERT EXPLICITO, feature-5): UDL FY-global negativa
      // sobre barra en +X -> Mz NEGATIVO en toda la barra. El pico de magnitud
      // vive en min_moment_z (~ -qL²/8); max_moment_z ~ 0.
      expect(viga.min_moment_z, "min_moment_z debe ser NEGATIVO (convencion de signo)").toBeLessThan(0);
      assertOk(compararEsfuerzo(Math.abs(viga.min_moment_z), Mteo), "biapoyada |M|=qL²/8");
      assertOk(compararEsfuerzo(viga.max_moment_z, 0), "biapoyada max_moment_z~0");

      // Cortante maximo |V| = qL/2 (en los apoyos).
      assertOk(compararEsfuerzo(maxCortanteAbs(res, combo), Vteo), "biapoyada V=qL/2");

      // Reacciones: cada apoyo levanta qL/2; la suma iguala la carga total qL.
      assertOk(compararReaccion(sumaReaccionVertical(res, combo), q * L), "biapoyada sum(R)=qL");
      // Hay exactamente dos nudos con reaccion vertical no nula = qL/2 cada uno.
      const reacciones = Object.entries(res.nodos)
        .map(([n]) => fyReaccion(res, n, combo))
        .filter((r) => Math.abs(r) > 1e-6);
      expect(reacciones.length, "dos apoyos con reaccion vertical").toBe(2);
      for (const r of reacciones) assertOk(compararReaccion(r, Rteo), "biapoyada R=qL/2");

      // Flecha en el centro (descenso). La viga es UNA barra -> se lee del diagrama
      // defl_y (el centro no cae en un nudo); tolerancia de flecha 1%.
      const flechaReal = Math.abs(flechaMaxDescenso(res, combo));
      assertOk(compararFlecha(flechaReal, flechaTeo), "biapoyada flecha 5qL⁴/384EIz");

      // Equilibrio cerrado (el fixture pide check_statics).
      expect(res.check_statics?.equilibrio_ok, "biapoyada equilibrio_ok").toBe(true);

      // --- T1: COMBO ELU (factor 1.35 sobre la permanente G) ------------------
      // El discretizador genera ELU = 1.35·G (discretizar.ts paso 7). Como la
      // estructura es lineal e isostatica, TODOS los esfuerzos/reacciones de ELU
      // son 1.35 veces los de ELS: |M|_ELU=1.35·qL²/8, V_ELU=1.35·qL/2, R=1.35·qL/2.
      const G_ELU = 1.35;
      const vigaELU = barraViga(res, fem, "ELU");
      expect(vigaELU.min_moment_z, "ELU: min_moment_z NEGATIVO").toBeLessThan(0);
      assertOk(
        compararEsfuerzo(Math.abs(vigaELU.min_moment_z), G_ELU * Mteo),
        "biapoyada ELU |M|=1.35·qL²/8",
      );
      assertOk(compararEsfuerzo(maxCortanteAbs(res, "ELU"), G_ELU * Vteo), "biapoyada ELU V=1.35·qL/2");
      assertOk(
        compararReaccion(sumaReaccionVertical(res, "ELU"), G_ELU * q * L),
        "biapoyada ELU sum(R)=1.35·qL",
      );
      const reaccionesELU = Object.entries(res.nodos)
        .map(([n]) => fyReaccion(res, n, "ELU"))
        .filter((r) => Math.abs(r) > 1e-6);
      expect(reaccionesELU.length, "ELU: dos apoyos con reaccion vertical").toBe(2);
      for (const r of reaccionesELU) assertOk(compararReaccion(r, G_ELU * Rteo), "biapoyada ELU R=1.35·qL/2");
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // D1) DEFORMADA GLOBAL — CONTINUIDAD con los nudos (T-deformada-flecha, fase 1).
  //    El glue emite, por barra y combo, `deformada_global` (3, n_points) = DX/DY/DZ
  //    por estacion a lo largo de la barra, en el MISMO sistema global que
  //    nodos[].disp. INVARIANTE: la estacion 0 debe coincidir con el disp del nudo i
  //    y la estacion n-1 con el del nudo j (la deformada empalma con los nudos).
  //    Si fallara, la transformacion local->global o el uso de deflection() estarian
  //    mal. Tolerancia de FLECHA (1%). Reusa la biapoyada UDL (vano que flecta).
  // ---------------------------------------------------------------------------
  it(
    "deformada global: estacion 0/n-1 coinciden con disp de los nudos i/j (continuidad)",
    () => {
      const corrida = correrConFEM(fixtureBiapoyadaUDL({ L: 6, q: 10 }));
      if (!corrida) return;
      const { res, fem } = corrida;
      const combo = "ELS";

      // Verificamos la continuidad en TODAS las barras del modelo (vigas y pilares):
      // la deformada de cada barra debe empalmar con sus nudos extremos.
      for (const [name, porCombo] of Object.entries(res.barras)) {
        const v = porCombo[combo];
        if (!v) continue;
        const dg = v.deformada_global;
        // Forma (3, n): tres filas (DX, DY, DZ) de igual longitud >= 2.
        expect(dg.length, `${name}: deformada_global con 3 filas`).toBe(3);
        const n = dg[0].length;
        expect(n, `${name}: al menos 2 estaciones`).toBeGreaterThanOrEqual(2);
        expect(dg[1].length, `${name}: filas alineadas`).toBe(n);
        expect(dg[2].length, `${name}: filas alineadas`).toBe(n);

        const { i, j } = nodosBarra(fem, name);
        const dispI = res.nodos[i]?.[combo]?.disp;
        const dispJ = res.nodos[j]?.[combo]?.disp;
        expect(dispI, `${name}: disp del nudo ${i}`).toBeDefined();
        expect(dispJ, `${name}: disp del nudo ${j}`).toBeDefined();

        // Estacion 0 == disp[0:3] del nudo i ; estacion n-1 == disp[0:3] del nudo j.
        for (let comp = 0; comp < 3; comp++) {
          assertOk(
            compararFlecha(dg[comp][0], dispI![comp]),
            `${name}: deformada estacion 0 comp ${comp} == disp nudo i`,
          );
          assertOk(
            compararFlecha(dg[comp][n - 1], dispJ![comp]),
            `${name}: deformada estacion n-1 comp ${comp} == disp nudo j`,
          );
        }
      }
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // D2) DEFORMADA GLOBAL — FLECHA DEL VANO (biapoyada UDL).  La DY (fila 1) de la
  //    estacion CENTRAL de la viga debe ser claramente MAS NEGATIVA (mayor descenso)
  //    que la de los extremos: el vano flecta como una curva, no como una recta
  //    entre nudos (que es lo que daria una interpolacion lineal naive). Ademas el
  //    descenso central debe igualar 5qL⁴/384EIz (tolerancia de flecha 1%).
  // ---------------------------------------------------------------------------
  it(
    "deformada global: la DY central del vano (biapoyada UDL) flecta = 5qL⁴/384EIz",
    () => {
      const L = 6;
      const q = 10;
      const corrida = correrConFEM(fixtureBiapoyadaUDL({ L, q }));
      if (!corrida) return;
      const { res, fem } = corrida;
      const combo = "ELS";
      const flechaTeo = (5 * q * L ** 4) / (384 * E_ACERO * IZ_IPE300);

      // La viga horizontal (vano cargado), por geometria.
      const name = nombreVigaHorizontal(fem);
      const dg = res.barras[name]?.[combo]?.deformada_global;
      expect(dg, `deformada_global de la viga ${name}`).toBeDefined();
      const dy = dg![1]; // fila 1 = DY global (vertical, Y-up)
      const n = dy.length;
      const centro = dy[Math.floor((n - 1) / 2)];
      const extremoI = dy[0];
      const extremoJ = dy[n - 1];

      // El vano flecta: el centro desciende mucho mas que los extremos (apoyos ~0).
      expect(centro, "DY central debe ser negativa (descenso del vano)").toBeLessThan(0);
      expect(
        centro,
        "DY central claramente mas negativa que el extremo i (curva, no recta)",
      ).toBeLessThan(extremoI - flechaTeo / 2);
      expect(
        centro,
        "DY central claramente mas negativa que el extremo j (curva, no recta)",
      ).toBeLessThan(extremoJ - flechaTeo / 2);

      // El descenso central iguala la flecha teorica de libro (tolerancia 1%).
      assertOk(compararFlecha(Math.abs(centro), flechaTeo), "deformada DY centro = 5qL⁴/384EIz");
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // D3) DEFORMADA GLOBAL — VOLADIZO: el descenso |DY| crece MONOTONO hacia el
  //    extremo libre. La viga del voladizo tiene su extremo LIBRE en el nudo i
  //    (x=0) y el EMPOTRADO en el nudo j (x=L) — ver fixtureVoladizoPuntual. Por
  //    tanto |DY| es maximo en la estacion 0 y decrece hacia la n-1; recorremos las
  //    estaciones desde el extremo libre y exigimos descenso monotono no creciente.
  // ---------------------------------------------------------------------------
  it(
    "deformada global: voladizo, |DY| crece monotono hacia el extremo libre",
    () => {
      const corrida = correrConFEM(fixtureVoladizoPuntual({ L: 3, P: 20 }));
      if (!corrida) return;
      const { res, fem } = corrida;
      const combo = "ELS";

      const name = nombreVigaHorizontal(fem); // el dintel/voladizo (horizontal)
      const dg = res.barras[name]?.[combo]?.deformada_global;
      expect(dg, `deformada_global del voladizo ${name}`).toBeDefined();
      const dy = dg![1];
      const n = dy.length;

      // El nudo i es el extremo LIBRE (mayor |DY|); el j el empotrado (menor). El
      // descenso |DY| debe DECRECER monotono del extremo libre (estacion 0) al
      // empotrado (estacion n-1). Tolerancia: cada paso no debe AUMENTAR |DY|.
      const eps = 1e-12;
      for (let k = 1; k < n; k++) {
        expect(
          Math.abs(dy[k]),
          `|DY| no debe crecer del extremo libre al empotrado (estacion ${k})`,
        ).toBeLessThanOrEqual(Math.abs(dy[k - 1]) + eps);
      }
      // Y el extremo libre debe tener un descenso claramente mayor que el empotrado.
      expect(
        Math.abs(dy[0]),
        "extremo libre con descenso mucho mayor que el empotrado",
      ).toBeGreaterThan(Math.abs(dy[n - 1]) + 1e-4);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 2) VOLADIZO con carga puntual en el extremo.  |M|_empotr=PL, V=P, R_vert=P, R_mom=PL.
  //    La flecha del extremo NO es PL³/3EI: el empotramiento lo da un PILAR flexible
  //    (sufre desplome), no un apoyo rigido -> se valida como REGRESION + orden de
  //    magnitud, no contra la formula del voladizo puro.
  // ---------------------------------------------------------------------------
  it(
    "voladizo P: |M|_empotr=PL (en max_moment_z), V=P, R_vert=P, R_mom=PL; flecha=regresion",
    () => {
      const L = 3;
      const P = 20;
      const corrida = correrConFEM(fixtureVoladizoPuntual({ L, P }));
      if (!corrida) return;
      const { res, fem } = corrida;

      const combo = "ELS";
      const Mteo = P * L; // 60 kN·m
      const Vteo = P; // 20 kN
      const RmomTeo = P * L; // 60 kN·m (reaccion-momento en la base empotrada)

      // La barra del dintel-voladizo se identifica por GEOMETRIA (horizontal), no
      // por magnitud: en el voladizo el pilar de empotramiento alcanza el mismo
      // |M|=PL (continuidad rigida) y la heuristica de magnitud empataba con el.
      const viga = barraViga(res, fem, combo);

      // |M|_empotr = PL en el dintel. El pico de magnitud vive en max_moment_z.
      const Mpico = Math.max(Math.abs(viga.min_moment_z), Math.abs(viga.max_moment_z));
      assertOk(compararEsfuerzo(Mpico, Mteo), "voladizo |M|_empotr=PL");

      // SIGNO (ASSERT EXPLICITO): la VIGA en voladizo cargada hacia abajo en su
      // extremo i (x=0) da flector POSITIVO en max_moment_z (verificado en dump
      // T1.2: la barra del dintel tiene max_moment_z=+PL). Ahora se asevera DIRECTO
      // sobre la barra horizontal identificada (no por busqueda de empate de magnitud).
      assertOk(compararEsfuerzo(viga.max_moment_z, Mteo), "voladizo dintel max_moment_z=+PL");

      assertOk(compararEsfuerzo(maxCortanteAbs(res, combo), Vteo), "voladizo V=P");

      // Reacciones en la base empotrada: la suma vertical = P; la reaccion-momento
      // (MZ) de magnitud PL. Se localiza el nudo apoyado (reaccion no nula).
      assertOk(compararReaccion(sumaReaccionVertical(res, combo), P), "voladizo sum(R_vert)=P");
      let rmomMax = 0;
      for (const porCombo of Object.values(res.nodos)) {
        const n = porCombo[combo];
        if (n && Math.abs(n.rxn[5]) > Math.abs(rmomMax)) rmomMax = n.rxn[5]; // MZ
      }
      assertOk(compararReaccion(Math.abs(rmomMax), RmomTeo), "voladizo R_mom=PL");

      // FLECHA: regresion (afectada por la flexibilidad del pilar de empotramiento).
      // Se comprueba que es un descenso de orden de magnitud razonable (cm) y se
      // documenta que NO es la formula del voladizo puro PL³/3EI (~1.42 cm), sino
      // mayor por el desplome del pilar (~5.68 cm medido). No es validacion analitica.
      const flechaPuroTeo = (P * L ** 3) / (3 * E_ACERO * IZ_IPE300); // referencia (NO esperada)
      const flechaReal = Math.abs(flechaMaxDescenso(res, combo));
      expect(flechaReal, "voladizo: descenso > flecha de voladizo puro (pilar flexible)").toBeGreaterThan(
        flechaPuroTeo,
      );
      expect(flechaReal, "voladizo: descenso en rango sano (< 0.5 m)").toBeLessThan(0.5);
      console.warn(
        `[GOLDEN][voladizo flecha REGRESION] real=${flechaReal.toExponential(4)} m ` +
          `(voladizo puro PL³/3EI=${flechaPuroTeo.toExponential(4)} m, inflada por desplome del pilar)`,
      );

      expect(res.check_statics?.equilibrio_ok, "voladizo equilibrio_ok").toBe(true);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 3) BIAPOYADA con carga puntual CENTRADA.  |M|=PL/4, R=P/2, δ=PL³/48EIz (en el
  //    nudo central, apoyos sin desplome por simetria -> flecha limpia).
  // ---------------------------------------------------------------------------
  it(
    "biapoyada P centrada: |M|=PL/4 (en min_moment_z), R=P/2, flecha PL³/48EIz",
    () => {
      const L = 8;
      const P = 40;
      const corrida = correrConFEM(fixtureBiapoyadaPuntualCentro({ L, P }));
      if (!corrida) return;
      const { res, fem } = corrida;

      const combo = "ELS";
      const Mteo = (P * L) / 4; // 80 kN·m
      const Rteo = P / 2; // 20 kN por apoyo
      const flechaTeo = (P * L ** 3) / (48 * E_ACERO * IZ_IPE300); // m (descenso centro)

      // Dos vanos horizontales (vizq/vder); ambos alcanzan -PL/4 en el centro. Se
      // toma la viga horizontal mas flectada (nunca un pilar).
      const viga = barraVigaMasFlectada(res, fem, combo);

      // SIGNO: carga gravitatoria -> flector negativo; pico en min_moment_z (~ -PL/4).
      expect(viga.min_moment_z, "biapoyada-P: min_moment_z NEGATIVO").toBeLessThan(0);
      assertOk(compararEsfuerzo(Math.abs(viga.min_moment_z), Mteo), "biapoyada-P |M|=PL/4");

      // Reacciones: dos apoyos a P/2; la suma = P.
      assertOk(compararReaccion(sumaReaccionVertical(res, combo), P), "biapoyada-P sum(R)=P");
      const reacciones = Object.entries(res.nodos)
        .map(([n]) => fyReaccion(res, n, combo))
        .filter((r) => Math.abs(r) > 1e-6);
      expect(reacciones.length, "dos apoyos con reaccion vertical").toBe(2);
      for (const r of reacciones) assertOk(compararReaccion(r, Rteo), "biapoyada-P R=P/2");

      // Flecha en el CENTRO: el nudo central (donde se aplica P) tiene el mayor
      // descenso; se lee su DY nodal (exacto, no muestreado). Debe valer PL³/48EIz.
      let dyCentro = 0;
      for (const [n, porCombo] of Object.entries(res.nodos)) {
        const dy = porCombo[combo]?.disp[1] ?? 0;
        if (dy < dyCentro) dyCentro = dy;
        void n;
      }
      assertOk(compararFlecha(Math.abs(dyCentro), flechaTeo), "biapoyada-P flecha PL³/48EIz");

      expect(res.check_statics?.equilibrio_ok, "biapoyada-P equilibrio_ok").toBe(true);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 4) PORTICO SIMPLE (hiperestatico).  Sin forma cerrada limpia -> GOLDEN DE
  //    REGRESION: se fija contra el resultado del PROPIO motor (snapshot numerico)
  //    y se comprueban invariantes fisicos exactos: equilibrio (check_statics),
  //    reaccion vertical total = qB, simetria de reacciones, empuje horizontal
  //    igual y opuesto en las dos bases. NO es validacion analitica (documentado).
  // ---------------------------------------------------------------------------
  it(
    "portico simple: equilibrio + R_vert=qB + simetria; momentos = golden de REGRESION",
    () => {
      const B = 5;
      const H = 3;
      const q = 12;
      const corrida = correrConFEM(fixturePorticoSimple({ B, H, q }));
      if (!corrida) return;
      const { res, fem } = corrida;

      const combo = "ELS";

      // INVARIANTE FISICO EXACTO 1: reaccion vertical total = carga total qB.
      assertOk(compararReaccion(sumaReaccionVertical(res, combo), q * B), "portico sum(R_vert)=qB");

      // INVARIANTE EXACTO 2: dos bases, cada una con R_vert=qB/2 (simetria).
      const basesVert = Object.values(res.nodos)
        .map((pc) => pc[combo]?.rxn[1] ?? 0)
        .filter((r) => Math.abs(r) > 1e-6);
      expect(basesVert.length, "dos bases con reaccion vertical").toBe(2);
      for (const r of basesVert) assertOk(compararReaccion(r, (q * B) / 2), "portico R_vert=qB/2");

      // INVARIANTE EXACTO 3: empuje horizontal (FX) igual y opuesto en las bases
      // (la suma horizontal de reacciones es 0; no hay carga horizontal aplicada).
      const basesHoriz = Object.values(res.nodos)
        .map((pc) => pc[combo]?.rxn[0] ?? 0)
        .filter((r) => Math.abs(r) > 1e-6);
      expect(basesHoriz.length, "dos bases con empuje horizontal").toBe(2);
      assertOk(compararReaccion(basesHoriz[0] + basesHoriz[1], 0), "portico sum(FX)=0 (empuje opuesto)");

      // INVARIANTE EXACTO 4: equilibrio global cerrado.
      expect(res.check_statics?.equilibrio_ok, "portico equilibrio_ok").toBe(true);

      // GOLDEN DE REGRESION (NO analitico): momentos del dintel y empuje horizontal
      // capturados del propio motor (ELS, B=5/H=3/q=12). Si cambia el discretizador
      // o el solver y estos numeros se mueven > tolerancia, hay que revisar el cambio
      // (no aflojar el golden). Valores medidos en T1.2 con el par de versiones fijado.
      // El dintel se identifica por GEOMETRIA (la barra horizontal a la cota H),
      // no por magnitud: blinda contra empates con el flector de los pilares.
      const dintel = barraViga(res, fem, combo);
      assertOk(compararEsfuerzo(dintel.max_moment_z, 19.18949), "portico REG M+ dintel (centro)");
      assertOk(compararEsfuerzo(dintel.min_moment_z, -18.31051), "portico REG M- dintel (apoyos)");
      assertOk(compararReaccion(Math.abs(basesHoriz[0]), 9.56493), "portico REG empuje horizontal");
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 5) check_statics con CARGA LOCAL TRANSVERSAL (Fy).  Blinda el fix de
  //    pynite_glue.py: antes, el residuo de equilibrio para cargas en direccion
  //    LOCAL transversal (Fy/Fz) se aproximaba con el vector axil de la barra ->
  //    daba equilibrio_ok=FALSE espurio en una estructura que SI equilibra. El fix
  //    proyecta la carga local con la triada REAL de PyNite (Member3D.T()).
  //    El discretizador F1 emite direcciones GLOBALES (FY), asi que este caso se
  //    construye con un ModeloFEM CRUDO (Capa 2) que pone direction:"Fy" — valido
  //    por contrato (DireccionDistSchema admite Fx/Fy/Fz) pero que el discretizador
  //    no genera hoy. Sin el fix, equilibrio_ok seria false (regresion blindada).
  // ---------------------------------------------------------------------------
  it(
    "check_statics: carga LOCAL transversal (Fy) cierra equilibrio (blinda fix del glue)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      // Voladizo isostatico: barra horizontal en X, empotrada en N1, carga
      // distribuida LOCAL Fy (transversal, hacia abajo). Total = 5·4 = 20 kN; el
      // equilibrio DEBE cerrar (residuo ~0). El motor.calcular valida con safeParse.
      const modeloFEM = {
        units: "kN-m" as const,
        nodes: [
          { name: "N1", x: 0, y: 0, z: 0 },
          { name: "N2", x: 4, y: 0, z: 0 },
        ],
        materials: [{ name: "AC", E: E_ACERO, G: 8.077e7, nu: 0.3, rho: 78.5 }],
        sections: [{ name: "S", A: 5.3e-3, Iy: 8.36e-6, Iz: IZ_IPE300, J: 1e-7 }],
        members: [
          {
            name: "M1",
            i: "N1",
            j: "N2",
            material: "AC",
            section: "S",
            rotation: 0,
            tension_only: false,
            comp_only: false,
            releases: null,
          },
        ],
        supports: [{ node: "N1", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true }],
        node_loads: [],
        // Direccion LOCAL Fy (minuscula): transversal al eje de la barra.
        dist_loads: [
          { member: "M1", direction: "Fy" as const, w1: -5, w2: -5, x1: null, x2: null, case: "D" },
        ],
        pt_loads: [],
        combos: [{ name: "C", factors: { D: 1 } }],
        analysis: { type: "linear" as const, check_statics: true },
      };

      const res = arranque.motor.calcular(modeloFEM);
      expect(res.check_statics, "check_statics ejecutado").not.toBeNull();
      const cs = res.check_statics!;
      // El fix proyecta la local Fy a global con T() -> residuo ~0 y equilibrio_ok.
      expect(cs.equilibrio_ok, "equilibrio con carga local Fy debe cerrar (fix del glue)").toBe(true);
      // El residuo debe ser numericamente cero (no el falso 20 kN / 40 kN·m previo).
      const r = cs.residuos["C"];
      assertOk(compararReaccion(r.max_fuerza, 0), "residuo fuerza (local Fy) ~0");
      assertOk(compararReaccion(r.max_momento, 0), "residuo momento (local Fy) ~0");
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // A2) check_statics con barra VERTICAL (rotada respecto al caso 5) y carga LOCAL
  //    transversal (Fz).  El caso 5 ejercita la proyeccion T() solo en una barra
  //    HORIZONTAL sin rotar (orientacion trivial). Aqui la barra corre en global Y
  //    (vertical): su triada local esta GIRADA 90º respecto a globales, asi que la
  //    proyeccion local->global de Fz reparte la carga en un eje global distinto.
  //    Blinda que _ejes_locales_globales (Member3D.T()) se usa bien en orientaciones
  //    NO triviales — no solo en el caso horizontal. Cantilever isostatico (empotrado
  //    en la base): el equilibrio DEBE cerrar con residuo ~0.
  // ---------------------------------------------------------------------------
  it(
    "check_statics: barra VERTICAL con carga LOCAL Fz cierra equilibrio (triada rotada)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      // Barra vertical N1(base)->N2(cabeza) a lo largo de global Y. Empotrada en la
      // base. Carga distribuida LOCAL Fz (transversal al eje vertical). Total = 4·3
      // = 12 kN repartido en el/los eje(s) global(es) a los que proyecta Fz.
      const modeloFEM = {
        units: "kN-m" as const,
        nodes: [
          { name: "N1", x: 0, y: 0, z: 0 },
          { name: "N2", x: 0, y: 3, z: 0 },
        ],
        materials: [{ name: "AC", E: E_ACERO, G: 8.077e7, nu: 0.3, rho: 78.5 }],
        sections: [{ name: "S", A: 5.3e-3, Iy: 8.36e-6, Iz: IZ_IPE300, J: 1e-7 }],
        members: [
          {
            name: "M1",
            i: "N1",
            j: "N2",
            material: "AC",
            section: "S",
            rotation: 0,
            tension_only: false,
            comp_only: false,
            releases: null,
          },
        ],
        supports: [{ node: "N1", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true }],
        node_loads: [],
        dist_loads: [
          { member: "M1", direction: "Fz" as const, w1: -4, w2: -4, x1: null, x2: null, case: "D" },
        ],
        pt_loads: [],
        combos: [{ name: "C", factors: { D: 1 } }],
        analysis: { type: "linear" as const, check_statics: true },
      };

      const res = arranque.motor.calcular(modeloFEM);
      expect(res.check_statics, "check_statics ejecutado").not.toBeNull();
      const cs = res.check_statics!;
      // Proyeccion correcta de la triada rotada -> residuo ~0 y equilibrio_ok.
      expect(cs.equilibrio_ok, "equilibrio con barra vertical + Fz local debe cerrar").toBe(true);
      const r = cs.residuos["C"];
      assertOk(compararReaccion(r.max_fuerza, 0), "residuo fuerza (barra vertical, Fz) ~0");
      assertOk(compararReaccion(r.max_momento, 0), "residuo momento (barra vertical, Fz) ~0");
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // A1) check_statics con carga de MOMENTO en barra (MZ global).  Blinda el fix de
  //    _resultante_carga_barra: ANTES, una direccion de momento de barra (MX/MY/MZ,
  //    Mx/My/Mz) NO se ramificaba -> se contaba como fuerza 0 y CAIA del residuo;
  //    la reaccion-momento que la equilibra quedaba sin cancelar -> equilibrio_ok
  //    espurio (false). El fix trata el momento aplicado como PAR PURO (sin r x F)
  //    y lo suma a (mx,my,mz). Cantilever empotrado en N1 con un pt_load MZ sobre
  //    la barra: la reaccion-momento de la base lo equilibra; residuo ~0.
  // ---------------------------------------------------------------------------
  it(
    "check_statics: carga de MOMENTO en barra (MZ) cierra equilibrio (fix A1)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      // Barra horizontal en X, empotrada en N1. Momento puntual MZ (global) aplicado
      // a media barra. La reaccion en N1 incluye RxnMZ = -MZ -> residuo de momento ~0.
      const modeloFEM = {
        units: "kN-m" as const,
        nodes: [
          { name: "N1", x: 0, y: 0, z: 0 },
          { name: "N2", x: 4, y: 0, z: 0 },
        ],
        materials: [{ name: "AC", E: E_ACERO, G: 8.077e7, nu: 0.3, rho: 78.5 }],
        sections: [{ name: "S", A: 5.3e-3, Iy: 8.36e-6, Iz: IZ_IPE300, J: 1e-7 }],
        members: [
          {
            name: "M1",
            i: "N1",
            j: "N2",
            material: "AC",
            section: "S",
            rotation: 0,
            tension_only: false,
            comp_only: false,
            releases: null,
          },
        ],
        supports: [{ node: "N1", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true }],
        node_loads: [],
        dist_loads: [],
        // Momento puntual MZ (global) a x=2 sobre la barra. Sin componente de fuerza:
        // antes del fix caia del residuo y equilibrio_ok daba false espurio.
        pt_loads: [{ member: "M1", direction: "MZ" as const, P: 15, x: 2, case: "D" }],
        combos: [{ name: "C", factors: { D: 1 } }],
        analysis: { type: "linear" as const, check_statics: true },
      };

      const res = arranque.motor.calcular(modeloFEM);
      expect(res.check_statics, "check_statics ejecutado").not.toBeNull();
      const cs = res.check_statics!;
      // Con el fix, el par MZ entra en el residuo y cancela la reaccion-momento.
      expect(cs.equilibrio_ok, "equilibrio con carga de momento MZ debe cerrar (fix A1)").toBe(true);
      const r = cs.residuos["C"];
      assertOk(compararReaccion(r.max_fuerza, 0), "residuo fuerza (momento MZ) ~0");
      // El residuo de momento debe ser ~0; antes del fix valdria ~15 kN·m (la
      // reaccion MZ sin cancelar). Esta asercion es el corazon del blindaje A1.
      assertOk(compararReaccion(r.max_momento, 0), "residuo momento (momento MZ) ~0");
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // T2) ERROR-PATH del motor.  El closure `calcular` del arnes LANZA (throw) cuando
  //    el glue devuelve {ok:false} (motor.ts). Se verifica que el motor PROPAGA un
  //    error claro ante un payload INVALIDO, en lugar de devolver basura silenciosa.
  //    Dos sub-casos: (a) analysis modal -> ValueError del glue; (b) Capa 2 rota
  //    (barra que referencia un nodo inexistente -> KeyError/excepcion en build_model).
  // ---------------------------------------------------------------------------
  it(
    "error-path: payload invalido (modal y barra con nodo inexistente) hace lanzar a calcular",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const motor = arranque.motor;

      // Base valida minima (voladizo isostatico) que mutamos para cada sub-caso.
      const base = {
        units: "kN-m" as const,
        nodes: [
          { name: "N1", x: 0, y: 0, z: 0 },
          { name: "N2", x: 4, y: 0, z: 0 },
        ],
        materials: [{ name: "AC", E: E_ACERO, G: 8.077e7, nu: 0.3, rho: 78.5 }],
        sections: [{ name: "S", A: 5.3e-3, Iy: 8.36e-6, Iz: IZ_IPE300, J: 1e-7 }],
        members: [
          {
            name: "M1",
            i: "N1",
            j: "N2",
            material: "AC",
            section: "S",
            rotation: 0,
            tension_only: false,
            comp_only: false,
            releases: null,
          },
        ],
        supports: [{ node: "N1", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true }],
        node_loads: [],
        dist_loads: [
          { member: "M1", direction: "FY" as const, w1: -5, w2: -5, x1: null, x2: null, case: "D" },
        ],
        pt_loads: [],
        combos: [{ name: "C", factors: { D: 1 } }],
        analysis: { type: "linear" as const, check_statics: false },
      };

      // (a) ANALISIS MODAL -> run_analysis lanza ValueError ("modal ... F2") -> glue
      //     {ok:false} -> el closure calcular lanza. El mensaje debe mencionar modal.
      const modal = { ...base, analysis: { type: "modal" as const, check_statics: false } };
      expect(() => motor.calcular(modal), "modal debe propagar error del glue").toThrow(/modal/i);

      // (b) BARRA QUE REFERENCIA UN NODO INEXISTENTE -> build_model revienta al
      //     llamar add_member con un nodo que no existe -> glue {ok:false} -> throw.
      const nodoRoto = {
        ...base,
        members: [{ ...base.members[0], j: "NO_EXISTE" }],
      };
      expect(() => motor.calcular(nodoRoto), "nodo inexistente debe propagar error").toThrow();
    },
    TIMEOUT_ARRANQUE,
  );
});
