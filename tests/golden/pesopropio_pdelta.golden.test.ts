// =============================================================================
// GOLDEN de Capa B (motor real PyNite) para F2a — PESO PROPIO + P-Δ (F3.1).
//
// Es la red de seguridad del NUCLEO de F2a: el peso propio automatico (w=A·rho, FY
// global negativa) y el analisis P-Δ de balanceo, verificados extremo a extremo
// (obra -> discretizar -> Pyodide/PyNite -> ResultadosCalculo) contra formula
// cerrada / amplificacion conocida (CLAUDE.md §13, I+D #9). Si un numero falla por
// encima de tolerancia, el bug esta en el DISCRETIZADOR o en UNIDADES, NUNCA en la
// formula cerrada (esta verificada con 0 errores de coeficiente) -> no se afloja la
// tolerancia ni se ajusta la formula (antipatron explicito del proyecto).
//
// UN UNICO FICHERO con motor: arnes/motor.ts cachea la promesa de arranque a nivel
// de modulo y Vitest aisla por fichero, asi que el arranque de Pyodide (~7 s) se
// paga UNA sola vez (beforeAll). Misma politica de SKIP que pipeline.golden: si el
// motor no arranca (sin red/instalacion) se SALTA con motivo, nunca rojo.
//
// CASOS (los 5 golden de Capa B del plan F3.1):
//  1) Peso propio VIGA biapoyada: |M| = w·L²/8 con w=A·rho. Con carga g: (g+w)L²/8.
//  2) Peso propio PILAR: axil base = A·rho·L y REACCION VERTICAL (FY) = peso. ⚠ Caza
//     la direccion equivocada (FY-): si estuviera mal, saldria FLEXION en vez de axil.
//  3) Toggle ON/OFF: el mismo modelo con incluirPesoPropio=false NO añade el esfuerzo
//     de peso propio (diferencia esperada vs ON; sin combo fantasma, E4).
//  4) P-Δ amplificacion (CV2): columna esbelta con CARGA LATERAL EXPLICITA; el
//     momento en base CRECE de `general` a `pDelta` (amplificacion real ~1.54).
//  5) P-Δ inestable -> ErrorMotor legible: inestabilidad LOCAL de nudo (el disparador
//     fiable bajo sparse, F2.2) -> "La estructura es inestable bajo P-Δ…".
//
// CONVENCION DE EJES (ver cabecera de pipeline.golden.test.ts): planta (x,y) ->
// global (X,Z); cota -> Y vertical. Gravedad = FY global NEGATIVA. La flexion
// vertical de una viga horizontal la gobierna Iz (eje local z); un pilar vertical
// con carga global FY recibe AXIL (la carga se proyecta sobre su eje).
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import {
  obtenerMotor,
  TIMEOUT_ARRANQUE,
  discretizarOExplotar,
  fixturePesoPropioVigaBiapoyada,
  fixturePesoPropioPilar,
  conPesoPropioOff,
  RHO_ACERO,
  compararEsfuerzo,
  compararReaccion,
  type ArranqueMotor,
  type ResultadoComparacion,
} from "./_arnes";
import type { Modelo } from "../../src/dominio";
import type { ModeloFEM } from "../../src/discretizador/contratoFEM";
import type { ResultadosCalculo } from "../../src/solver/resultados";

// Helper de assert (identico patron a pipeline.golden): mensaje "real vs teorico"
// claro; NO afloja la tolerancia (si falla, el bug es del pipeline).
function assertOk(c: ResultadoComparacion, etiqueta: string): void {
  const msg =
    `${etiqueta}: real=${c.real} teorico=${c.teorico} ` +
    `errAbs=${c.errAbs.toExponential(3)} errRel=${(c.errRel * 100).toFixed(4)}%`;
  expect(c.ok, msg).toBe(true);
}

// --- Selectores por GEOMETRIA (de la Capa 2), no por magnitud ----------------
// La barra HORIZONTAL (viga) tiene Yi==Yj; la VERTICAL (pilar) tiene Yi!=Yj.
function coordY(fem: ModeloFEM): Map<string, number> {
  return new Map(fem.nodes.map((n) => [n.name, n.y] as const));
}
function nombreBarraHorizontal(fem: ModeloFEM): string {
  const y = coordY(fem);
  const h = fem.members.find((mb) => y.get(mb.i) === y.get(mb.j));
  if (!h) throw new Error("No hay barra horizontal (viga) en el ModeloFEM");
  return h.name;
}
function nombreBarraVertical(fem: ModeloFEM): string {
  const y = coordY(fem);
  const v = fem.members.find((mb) => y.get(mb.i) !== y.get(mb.j));
  if (!v) throw new Error("No hay barra vertical (pilar) en el ModeloFEM");
  return v.name;
}

// Pico de |flector| (Mz) de una barra en un combo.
function picoFlector(res: ResultadosCalculo, member: string, combo: string): number {
  const v = res.barras[member]?.[combo];
  if (!v) throw new Error(`Barra ${member} sin resultado en combo ${combo}`);
  return Math.max(Math.abs(v.min_moment_z), Math.abs(v.max_moment_z));
}

// Pico de |axil| (N) de una barra en un combo (de su diagrama axial (2,n)).
function picoAxil(res: ResultadosCalculo, member: string, combo: string): number {
  const v = res.barras[member]?.[combo];
  if (!v) throw new Error(`Barra ${member} sin resultado en combo ${combo}`);
  let pico = 0;
  for (const a of v.axial[1]) if (Math.abs(a) > pico) pico = Math.abs(a);
  return pico;
}

// Suma de reacciones verticales (FY) de todos los nudos en un combo (= carga total).
function sumaReaccionVertical(res: ResultadosCalculo, combo: string): number {
  let s = 0;
  for (const porCombo of Object.values(res.nodos)) {
    const n = porCombo[combo];
    if (n) s += n.rxn[1]; // rxn = [FX,FY,FZ,MX,MY,MZ]
  }
  return s;
}

// Mayor reaccion HORIZONTAL en magnitud (FX o FZ) entre todos los nudos (debe ser ~0
// para una columna con solo peso propio vertical: la ⚠ de la direccion).
function maxReaccionHorizontal(res: ResultadosCalculo, combo: string): number {
  let m = 0;
  for (const porCombo of Object.values(res.nodos)) {
    const n = porCombo[combo];
    if (!n) continue;
    m = Math.max(m, Math.abs(n.rxn[0]), Math.abs(n.rxn[2])); // FX, FZ
  }
  return m;
}

// Mayor reaccion-MOMENTO en magnitud (MX/MY/MZ) entre todos los nudos.
function maxReaccionMomento(res: ResultadosCalculo, combo: string): number {
  let m = 0;
  for (const porCombo of Object.values(res.nodos)) {
    const n = porCombo[combo];
    if (!n) continue;
    m = Math.max(m, Math.abs(n.rxn[3]), Math.abs(n.rxn[4]), Math.abs(n.rxn[5]));
  }
  return m;
}

// =============================================================================
describe("golden Capa B — peso propio + P-Δ (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) {
      console.warn(`\n[GOLDEN PP/P-Δ][SKIP] ${arranque.motivo}\n`);
    } else {
      const v = arranque.motor.versiones;
      console.warn(
        `\n[GOLDEN PP/P-Δ][PAR REAL] python=${v.python} numpy=${v.numpy} scipy=${v.scipy} PyNiteFEA=${v.pynite}\n`,
      );
    }
  }, TIMEOUT_ARRANQUE);

  // Pipeline obra -> discretizar -> motor, devolviendo tambien la Capa 2 (para
  // localizar barras por geometria). null si no hay motor (el test salta).
  function correrConFEM(modelo: Modelo): { res: ResultadosCalculo; fem: ModeloFEM } | null {
    if (!arranque || !arranque.ok) {
      console.warn(`[GOLDEN PP/P-Δ][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
      return null;
    }
    const fem = discretizarOExplotar(modelo);
    const res = arranque.motor.calcular(fem);
    return { res, fem };
  }

  // ---------------------------------------------------------------------------
  // 1) PESO PROPIO de VIGA biapoyada.  |M| = w·L²/8 con w = A·rho (combo ELS,
  //    factor 1.0 sobre la permanente automatica). Con carga g: (g+w)·L²/8.
  // ---------------------------------------------------------------------------
  it(
    "peso propio VIGA biapoyada: |M| = (A·rho)·L²/8 (combo ELS, sin cargas de usuario)",
    () => {
      const L = 6;
      const A = 0.02; // m²
      const w = A * RHO_ACERO; // kN/m = 0.02·78.5 = 1.57
      const corrida = correrConFEM(fixturePesoPropioVigaBiapoyada({ L, A }));
      if (!corrida) return;
      const { res, fem } = corrida;

      const combo = "ELS"; // factor 1.0 sobre hip-peso-propio (permanente) -> w sin mayorar
      const Mteo = (w * L * L) / 8; // 1.57·36/8 = 7.065 kN·m
      const viga = nombreBarraHorizontal(fem);

      // SIGNO: w en FY- sobre barra horizontal en +X -> Mz NEGATIVO en toda la barra;
      // el pico vive en min_moment_z (~ -w·L²/8). Es la convencion de #3 (gravedad).
      const vbar = res.barras[viga]![combo]!;
      expect(vbar.min_moment_z, "peso propio viga: min_moment_z NEGATIVO (FY-)").toBeLessThan(0);
      assertOk(compararEsfuerzo(Math.abs(vbar.min_moment_z), Mteo), "peso propio viga |M|=(A·rho)L²/8");

      // La reaccion vertical total iguala el peso de la viga + el de los dos pilares
      // de apoyo (que tambien reciben su peso propio). El pico de flexion ya verifica
      // el peso propio de la VIGA en aislamiento; aqui basta exigir que el equilibrio
      // cierre (suma reacciones > 0 y check_statics ok).
      expect(sumaReaccionVertical(res, combo), "reaccion vertical total > 0 (gravedad)").toBeGreaterThan(0);
      expect(res.check_statics?.equilibrio_ok, "peso propio viga equilibrio_ok").toBe(true);

      // Combo ELU: factor 1.35 sobre la permanente automatica -> |M| = 1.35·w·L²/8.
      const vELU = res.barras[viga]!["ELU"]!;
      assertOk(
        compararEsfuerzo(Math.abs(vELU.min_moment_z), 1.35 * Mteo),
        "peso propio viga ELU |M|=1.35·(A·rho)L²/8",
      );
    },
    TIMEOUT_ARRANQUE,
  );

  it(
    "peso propio + carga g sobre la viga: |M| = (g + A·rho)·L²/8 (superposicion lineal)",
    () => {
      const L = 6;
      const A = 0.02;
      const w = A * RHO_ACERO; // 1.57 kN/m
      const g = 8; // kN/m de usuario (hipotesis permanente G)
      const corrida = correrConFEM(fixturePesoPropioVigaBiapoyada({ L, A, q: g }));
      if (!corrida) return;
      const { res, fem } = corrida;

      // ELS = 1.0·G + 1.0·hip-peso-propio -> en la viga, (g + w) repartido. Como la
      // estructura es lineal, el flector pico es (g + w)·L²/8.
      const combo = "ELS";
      const Mteo = ((g + w) * L * L) / 8; // (8+1.57)·36/8 = 43.065 kN·m
      const viga = nombreBarraHorizontal(fem);
      const vbar = res.barras[viga]![combo]!;
      expect(vbar.min_moment_z, "g+pp viga: min_moment_z NEGATIVO").toBeLessThan(0);
      assertOk(compararEsfuerzo(Math.abs(vbar.min_moment_z), Mteo), "g+pp viga |M|=(g+A·rho)L²/8");
      expect(res.check_statics?.equilibrio_ok, "g+pp viga equilibrio_ok").toBe(true);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 2) PESO PROPIO de PILAR (columna vertical, base empotrada).  axil base = A·rho·H
  //    y REACCION VERTICAL (FY) = peso = A·rho·H. ⚠ DIRECCION: el peso propio debe ir
  //    en FY global NEGATIVA. Si estuviera mal (otra direccion), una barra VERTICAL
  //    recibiria FLEXION en vez de axil -> este test FALLA: exige que la reaccion sea
  //    VERTICAL (FY = peso), que el flector del pilar sea ~0 y que NO haya reaccion
  //    horizontal ni reaccion-momento (que apareceria con flexion espuria).
  // ---------------------------------------------------------------------------
  it(
    "peso propio PILAR: axil base = A·rho·H y reaccion VERTICAL (⚠ caza la direccion FY-)",
    () => {
      const H = 4; // m (altura de la columna)
      const A = 0.03; // m²
      const peso = A * RHO_ACERO * H; // kN = 0.03·78.5·4 = 9.42
      const corrida = correrConFEM(fixturePesoPropioPilar({ H, A }));
      if (!corrida) return;
      const { res, fem } = corrida;

      const combo = "ELS"; // 1.0 sobre la permanente automatica -> peso sin mayorar
      const pilar = nombreBarraVertical(fem);

      // (a) AXIL: el pico de |N| del pilar = peso total A·rho·H (compresion en la base).
      assertOk(compararEsfuerzo(picoAxil(res, pilar, combo), peso), "peso propio pilar axil=A·rho·H");

      // (b) FLECTOR ~0: una barra vertical con carga GLOBAL FY no flecta (la carga es
      //     axil). ⚠ Si la direccion del peso propio estuviera mal, aqui habria flexion.
      assertOk(compararEsfuerzo(picoFlector(res, pilar, combo), 0), "peso propio pilar flector~0 (sin flexion espuria)");

      // (c) REACCION VERTICAL = peso (hacia arriba, FY positiva). ⚠ El nucleo de la
      //     deteccion de direccion: la reaccion que equilibra el peso es VERTICAL.
      assertOk(compararReaccion(sumaReaccionVertical(res, combo), peso), "peso propio pilar R_vert=A·rho·H");

      // (d) SIN reaccion horizontal ni reaccion-momento: confirman que NO hay flexion
      //     (que es lo que produciria una direccion de peso propio equivocada).
      assertOk(compararReaccion(maxReaccionHorizontal(res, combo), 0), "peso propio pilar R_horiz~0");
      assertOk(compararReaccion(maxReaccionMomento(res, combo), 0), "peso propio pilar R_mom~0");

      // Combo ELU: 1.35·peso (permanente automatica desfavorable).
      assertOk(compararReaccion(sumaReaccionVertical(res, "ELU"), 1.35 * peso), "peso propio pilar ELU R_vert=1.35·peso");

      expect(res.check_statics?.equilibrio_ok, "peso propio pilar equilibrio_ok").toBe(true);
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 3) TOGGLE ON/OFF.  El mismo modelo con incluirPesoPropio=false NO añade el
  //    esfuerzo de peso propio: el axil/reaccion del pilar pasa de A·rho·H (ON) a ~0
  //    (OFF, sin otras cargas). Sin combo fantasma (E4): la automatica no aparece en
  //    los combos con el flag OFF, asi que no hay esfuerzo residual.
  // ---------------------------------------------------------------------------
  it(
    "toggle peso propio ON vs OFF: OFF no añade axil/reaccion de peso propio",
    () => {
      const H = 4;
      const A = 0.03;
      const peso = A * RHO_ACERO * H; // 9.42 kN
      const on = fixturePesoPropioPilar({ H, A });
      const off = conPesoPropioOff(on);

      const cOn = correrConFEM(on);
      const cOff = correrConFEM(off);
      if (!cOn || !cOff) return;

      const combo = "ELS";
      const pilarOn = nombreBarraVertical(cOn.fem);
      const pilarOff = nombreBarraVertical(cOff.fem);

      // ON: axil = peso. OFF: axil ~0 (no hay otras cargas; sin termino fantasma).
      assertOk(compararEsfuerzo(picoAxil(cOn.res, pilarOn, combo), peso), "ON: axil=A·rho·H");
      assertOk(compararEsfuerzo(picoAxil(cOff.res, pilarOff, combo), 0), "OFF: axil~0 (sin peso propio)");

      // La diferencia de reaccion vertical ON-OFF es exactamente el peso propio.
      const rOn = sumaReaccionVertical(cOn.res, combo);
      const rOff = sumaReaccionVertical(cOff.res, combo);
      assertOk(compararReaccion(rOn - rOff, peso), "ΔR_vert (ON - OFF) = peso propio");
      assertOk(compararReaccion(rOff, 0), "OFF: reaccion vertical ~0 (sin cargas)");
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 4) P-Δ AMPLIFICACION (CV2) con CARGA LATERAL EXPLICITA.  Columna esbelta en
  //    voladizo (base empotrada) con axil de compresion P (40% de la critica de
  //    Euler) + carga lateral H que provoca el sway. El momento en la base CRECE de
  //    `general` (analyze, 1.º orden, M=H·L) a `pDelta` (2.º orden, amplificado).
  //    GOLDEN DE REFERENCIA (medido con el par de versiones fijado, F2.2):
  //      M(general)=20.000 kN·m  M(pDelta)=30.887 kN·m  amp=1.544.
  //    NO es solo-gravedad simetrico (no amplificaria: artefacto); la carga lateral
  //    es explicita (plan CV2). El modelo se construye como Capa 2 cruda (el
  //    discretizador F1 no emite carga axil nodal de compresion en cabeza).
  // ---------------------------------------------------------------------------
  it(
    "P-Δ amplificacion: el momento en base crece de `general` a `pDelta` (columna esbelta, carga lateral)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN PP/P-Δ][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const motor = arranque.motor;

      // Geometria/material de la columna (mismos numeros que el smoke F2.2).
      const L = 4; // m
      const E = 2.1e8; // kN/m²
      const G = 8.077e7;
      const A = 5.3e-3; // m²
      const IZ = 1.5e-5; // m⁴ (gobierna la flexion en el plano XY de la lateral)
      const Hlat = 5; // kN lateral (sway)
      const PCR = (Math.PI * Math.PI * E * IZ) / (4 * L * L); // critica Euler voladizo
      const P = 0.4 * PCR; // axil estable (40% de Pcr)

      // Columna en voladizo a lo largo de global Y; base N1 empotrada, cabeza N2 con
      // axil de compresion en -Y y lateral en +X. `tipo` selecciona analyze/PDelta.
      const payload = (tipo: "analyze" | "PDelta"): ModeloFEM => ({
        units: "kN-m",
        nodes: [
          { name: "N1", x: 0, y: 0, z: 0 },
          { name: "N2", x: 0, y: L, z: 0 },
        ],
        materials: [{ name: "ACERO", E, G, nu: 0.3, rho: 78.5 }],
        sections: [{ name: "SEC", A, Iy: 8.36e-6, Iz: IZ, J: 1e-7 }],
        members: [
          { name: "C1", i: "N1", j: "N2", material: "ACERO", section: "SEC", rotation: 0, tension_only: false, comp_only: false, releases: null },
        ],
        supports: [{ node: "N1", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true }],
        node_loads: [
          { node: "N2", direction: "FY", P: -P, case: "P" }, // compresion
          { node: "N2", direction: "FX", P: Hlat, case: "H" }, // lateral (sway)
        ],
        dist_loads: [],
        pt_loads: [],
        combos: [{ name: "ELU", factors: { P: 1, H: 1 } }],
        analysis: { type: tipo, check_statics: false },
      });

      const r1 = motor.calcular(payload("analyze"));
      const r2 = motor.calcular(payload("PDelta"));

      // Momento en la base = |RxnMZ| en N1 (flector de la columna en su plano XY).
      const m1 = Math.abs(r1.nodos["N1"]["ELU"].rxn[5]);
      const m2 = Math.abs(r2.nodos["N1"]["ELU"].rxn[5]);
      const amp = m2 / m1;
      console.warn(
        `\n[GOLDEN P-Δ][AMP] Pcr=${PCR.toFixed(1)} P=${P.toFixed(1)} ` +
          `M(general)=${m1.toFixed(3)} M(pDelta)=${m2.toFixed(3)} amp=${amp.toFixed(3)}\n`,
      );

      // El eco del tipo confirma la rama del glue ejecutada.
      expect(r1.analysis.type).toBe("analyze");
      expect(r2.analysis.type).toBe("PDelta");

      // (a) 1.º orden: M(general) = H·L = 20.0 kN·m (esfuerzo, tolerancia estricta).
      assertOk(compararEsfuerzo(m1, Hlat * L), "P-Δ M(general)=H·L");

      // (b) AMPLIFICACION REAL: M(pDelta) > M(general) por el sway. Golden de
      //     referencia: M(pDelta)=30.887 kN·m, amp=1.544 (medido, par de versiones
      //     fijado). Tolerancia de esfuerzo (0,1%) contra el valor de referencia.
      expect(m2, "P-Δ amplifica el momento en base (m2 > m1)").toBeGreaterThan(m1);
      assertOk(compararEsfuerzo(m2, 30.887), "P-Δ M(pDelta) golden de REFERENCIA");
      assertOk(compararEsfuerzo(amp, 1.544), "P-Δ factor de amplificacion golden de REFERENCIA");
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // 5) P-Δ INESTABLE -> ErrorMotor LEGIBLE.  Caso canonico de inestabilidad LOCAL de
  //    nudo (el disparador FIABLE bajo sparse, F2.2: una inestabilidad GLOBAL de
  //    Euler en una barra unica NO lanza con spsolve -> da NaN). La columna con la
  //    rotacion RZ liberada en ambos extremos deja el nudo cabeza (RZ y la traslacion
  //    X que depende de el) sin rigidez -> "Nodal instability" que check_stability
  //    detecta y lanza; el glue lo traduce a la frase de obra. El closure del arnes
  //    re-lanza un Error con el `mensaje` del glue embebido -> verificamos la frase.
  // ---------------------------------------------------------------------------
  it(
    "P-Δ inestable: nudo sin rigidez -> ErrorMotor 'inestable bajo P-Δ' (no traceback crudo)",
    () => {
      if (!arranque || !arranque.ok) {
        console.warn(`[GOLDEN PP/P-Δ][SKIP] ${arranque?.motivo ?? "arranque no ejecutado"}`);
        return;
      }
      const motor = arranque.motor;
      const L = 4;
      const E = 2.1e8;
      const IZ = 1.5e-5;
      const PCR = (Math.PI * Math.PI * E * IZ) / (4 * L * L);

      // RZ liberada en ambos extremos -> GDL RZ (y la traslacion X) del nudo cabeza
      // sin rigidez ni apoyo -> inestabilidad local de nudo que check_stability lanza.
      const rzLiberada = [
        false, false, false, false, false, true, // i: RZi liberado
        false, false, false, false, false, true, // j: RZj liberado
      ];
      const inestable: ModeloFEM = {
        units: "kN-m",
        nodes: [
          { name: "N1", x: 0, y: 0, z: 0 },
          { name: "N2", x: 0, y: L, z: 0 },
        ],
        materials: [{ name: "ACERO", E, G: 8.077e7, nu: 0.3, rho: 78.5 }],
        sections: [{ name: "SEC", A: 5.3e-3, Iy: 8.36e-6, Iz: IZ, J: 1e-7 }],
        members: [
          { name: "C1", i: "N1", j: "N2", material: "ACERO", section: "SEC", rotation: 0, tension_only: false, comp_only: false, releases: rzLiberada },
        ],
        supports: [{ node: "N1", DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true }],
        node_loads: [
          { node: "N2", direction: "FY", P: -0.4 * PCR, case: "P" },
          { node: "N2", direction: "FX", P: 5, case: "H" },
        ],
        dist_loads: [],
        pt_loads: [],
        combos: [{ name: "ELU", factors: { P: 1, H: 1 } }],
        analysis: { type: "PDelta", check_statics: false },
      };

      let lanzo = false;
      let mensaje = "";
      try {
        motor.calcular(inestable);
      } catch (e) {
        lanzo = true;
        mensaje = e instanceof Error ? e.message : String(e);
      }
      expect(lanzo, "el motor debe LANZAR ante inestabilidad bajo P-Δ").toBe(true);
      // Frase de obra del glue (embebida por el arnes); NO el texto crudo de PyNite.
      expect(mensaje, "mensaje en lenguaje de obra").toContain("inestable bajo P-Δ");
      expect(mensaje.toLowerCase(), "menciona arriostramiento (lenguaje de obra)").toContain("arriostramiento");
    },
    TIMEOUT_ARRANQUE,
  );
});
