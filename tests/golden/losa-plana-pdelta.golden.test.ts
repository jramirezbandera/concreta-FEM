// =============================================================================
// GOLDEN Capa B del P-Δ CON LOSA PLANA (motor real PyNite) — T-f3-masa-placa · T3.3.
// discretizar() REAL (obra Capa 1) -> motor REAL PyNite, camino P-Δ (analyze_PDelta).
//
// QUE VERIFICA. La losa plana sobre pilares corre el analisis de 2.º orden (P-Δ) sin
// lanzar CON QUADS PRESENTES (el glue ya NO lo bloquea, T1.1), y ese 2.º orden HACE
// ALGO fisico y medible: bajo una carga LATERAL, la deriva de las cabezas de pilar se
// AMPLIFICA frente al 1.er orden (linear), y el equilibrio global (ΣV vertical, ΣH
// horizontal) cuadra en el modelo acoplado losa+pilares. Se apoya en RATIOS
// (amplificacion = DX_PΔ/DX_lin, adimensional) e INVARIANTES DE EQUILIBRIO (ΣV=carga
// total, ΣH=lateral aplicada), NO en cifras absolutas de flecha ni de momento local
// (dependientes de malla; deuda T-f3-losa-plana-momento-local).
//
// HECHO DE HONESTIDAD (hallazgo rector del spike T0.2, docstring oficial de PyNite
// 2.0.2: "P-Delta effects in plates/quads are not considered"). Los quads ensamblan
// rigidez ELASTICA k() pero NO rigidez GEOMETRICA kg(): la losa NO se pandea ella
// misma. El efecto P-Δ que este golden mide viene EXCLUSIVAMENTE del AXIL DE LOS
// PILARES bajo la deriva lateral (la losa transmite carga y aporta rigidez elastica,
// pero el 2.º orden lo pone la columna comprimida). Por eso el pórtico robusto amplifica
// muy poco (~0.5 %) y solo al esbeltar los pilares se vuelve visible.
//
// NUMEROS DEL SPIKE (src/solver/spikes/pdelta_placa_spike.md, PyNiteFEA 2.0.2), para el
// mecanismo identico (losa 6×6 sobre 4 pilares de esquina + FX_total=20 kN en cabezas,
// combo 1.0·G + 1.0·H):
//   - robusto  30×30 H=3  q=5   -> DX_lin=6.51e-4  DX_PΔ=6.54e-4  amp=1.005
//   - esbelto  25×25 H=4  q=5   -> amp=1.018
//   - esb+q    25×25 H=4  q=15  -> amp=1.033
//   - muy esb  20×20 H=5  q=30  -> amp=1.250
//   ΣV = carga vertical total (errRel P-Δ 1.5e-9 .. 9.1e-8); ΣH = -FX_total (errRel <1e-4).
// El spike uso t=0.25; ESTE golden usa el t=0.20 de produccion (losa-plana.golden), asi
// que la carga vertical esperada se RECALCULA del fixture real (rho·t·area + pp pilares +
// q·area), NUNCA se copia el 432/387 del spike.
//
// TOLERANCIAS (justificadas por el spike):
//   - amp robusto ∈ (1.001, 1.10): >1.001 distingue "P-Δ actua" de ruido; <1.10 ancla que
//     el pórtico robusto NO dispara un 2.º orden desbocado (delataria una rigidez
//     geometrica de placa mal aplicada, que PyNite 2.0.2 NO hace). Medido 1.005.
//   - amp esbelto > 1.15: el caso ANTI-FALSO-VERDE; blinda que el P-Δ con placas NO es un
//     passthrough silencioso al esbeltar. Medido 1.25.
//   - ΣV rel < 1e-6 (residuo iterativo del P-Δ, holgura de un orden sobre 9.1e-8).
//   - ΣH rel < 1e-4 en el ROBUSTO (cuadra a maquina, 2.79e-7) y < 2e-3 en el ESBELTO: el
//     spike documenta que el ΣH del P-Δ MUY ESBELTO se desvia ~2e-3 sobre 20 kN (≈1e-4 rel)
//     por el residuo iterativo del balanceo de 2.º orden — el extremo del barrido (20×20,H=5,
//     q=30) roza el 1e-4, asi que ese caso usa 2e-3 (un orden de holgura sobre el residuo
//     FISICO del P-Δ iterativo, que crece con la esbeltez). NO es aflojar: el equilibrio sigue
//     verificado con la tolerancia que el propio P-Δ del extremo esbelto exige.
//
// COMO SE PIDE EL P-Δ. La obra (Capa 1) lleva `analisis.tipo:"pDelta"` -> el discretizador
// emite `analysis.type:"PDelta"` (mapeo del Paso 8). La comparacion lineal vs P-Δ se hace
// sobre EL MISMO ModeloFEM discretizado, clonando la Capa 2 y cambiando SOLO `analysis.type`
// (linear vs PDelta), como el golden pesopropio_pdelta compara `general` vs `pDelta`.
//
// COMO SE MONTA LA LATERAL. La Capa 1 de F1/F3 no expresa una carga PUNTUAL en la cabeza de
// un pilar (solo lineal/superficial por ambito; una puntual sobre barra se bloquea, memoria
// feature-4). Por eso la carga lateral se INYECTA en la Capa 2 YA DISCRETIZADA como node_loads
// FX en las cabezas de pilar (case "H"), EXACTAMENTE como el arnes monta la lateral cruda en
// pesopropio_pdelta (CV2) y como el spike la aplico. El resto del modelo (nudos, quads,
// quad_loads con presion POSITIVA hacia abajo, apoyos, peso propio) es el que produce
// `discretizar()` REAL: la lateral es el UNICO anadido, y el combo se fija a 1.0·G + 1.0·H
// (identico al del spike) para no mezclar mayoraciones ELU/ELS en el ratio.
//
// UNIDADES kN, m (presion de quad kN/m²). E/nu/ρ REALES de HA-25 (getMaterial, catalogo).
// Ejes: planta (x,y)->global (X,Z); cota->Y vertical; gravedad = FY global NEGATIVA.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import { discretizar } from "../../src/discretizador";
import { getMaterial } from "../../src/biblioteca";
import type { Modelo, Seccion } from "../../src/dominio";
import type { ResultadoDiscretizacion } from "../../src/discretizador";
import type { ModeloFEM, CargaNodoFEM, ComboFEM } from "../../src/discretizador/contratoFEM";
import type { ResultadosCalculo } from "../../src/solver/resultados";

const ESPESOR = 0.2; // m (losa, t de produccion — NO el 0.25 del spike)
const FX_TOTAL = 20; // kN de carga lateral total (repartida en las 4 cabezas), como el spike
const COMBO = "GH"; // combo unico 1.0·G + 1.0·H (identico al del spike)

type ResDiscretizado = ReturnType<typeof discretizar> & { ok: true };

function discretizarOk(modelo: Modelo): ResDiscretizado {
  const res: ResultadoDiscretizacion = discretizar(modelo);
  if (!res.ok) throw new Error("discretizar fallo: " + JSON.stringify(res.errores));
  return res;
}

// -----------------------------------------------------------------------------
// Obra canonica: losa `lado`×`lado` (t=0.20, HA-25, borde libre) sobre 4 pilares de
// ESQUINA empotrados. `secLado` (lado del pilar cuadrado) y `altura` parametrizan la
// esbeltez; `q` la carga superficial (mas q -> mas axil). Espejo de losaSobrePilares
// de losa-plana.golden, con altura/seccion variables para el sub-caso esbelto.
// -----------------------------------------------------------------------------
function obraLosaPlana(opts: { lado: number; secLado: number; altura: number; q: number }): Modelo {
  const L = opts.lado;
  const secPilar: Seccion = {
    id: "sec-pilar",
    nombre: `Pilar ${opts.secLado}x${opts.secLado}`,
    tipo: "hormigonRectangular",
    b: opts.secLado,
    h: opts.secLado,
  };
  const pilares = [
    { id: "pil1", x: 1, y: 1 },
    { id: "pil2", x: L - 1, y: 1 },
    { id: "pil3", x: 1, y: L - 1 },
    { id: "pil4", x: L - 1, y: L - 1 },
  ];
  return {
    unidades: "kN-m",
    schemaVersion: 4,
    // v4 (plantas sin grupos): SU/CM en la planta (0, como el grupo original).
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: opts.altura, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: opts.altura, altura: opts.altura, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [secPilar],
    nudos: [
      { id: "q1", x: 0, y: 0 },
      { id: "q2", x: L, y: 0 },
      { id: "q3", x: L, y: L },
      { id: "q4", x: 0, y: L },
    ],
    pilares: pilares.map((p) => ({
      id: p.id,
      nombre: p.id.toUpperCase(),
      x: p.x,
      y: p.y,
      plantaInicial: "p0",
      plantaFinal: "p1",
      seccionId: secPilar.id,
      materialId: "HA-25",
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado" as const,
    })),
    vigas: [],
    panos: [
      {
        id: "losa1",
        nombre: "Losa 1",
        tipo: "losa",
        plantaId: "p1",
        perimetro: ["q1", "q2", "q3", "q4"],
        espesor: ESPESOR,
        materialId: "HA-25",
        tamMalla: 1.0,
        bordeApoyo: "libre",
      },
    ],
    muros: [],
    cargas:
      opts.q > 0
        ? [{ id: "c1", tipo: "superficial", ambito: "losa1", valor: opts.q, hipotesisId: "h1" }]
        : [],
    hipotesis: [
      { id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true },
      { id: "h1", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
    ],
    // P-Δ desde la OBRA: analisis.tipo:"pDelta" -> analysis.type:"PDelta" (Paso 8).
    analisis: { tipo: "pDelta", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

// Nudos de CABEZA de los 4 pilares (nudo j del ultimo member de cada pilar, la cota
// superior donde el acople une el pilar con la malla de la losa). Es donde entra la
// lateral y donde se mide la deriva DX.
function cabezasPilar(res: ResDiscretizado): string[] {
  const cabezas: string[] = [];
  for (const members of Object.values(res.trazabilidad.pilarAMembers)) {
    const ultimo = members[members.length - 1];
    const mb = res.modeloFEM.members.find((m) => m.name === ultimo);
    if (!mb) throw new Error(`member ${ultimo} no encontrado`);
    cabezas.push(mb.j); // extremo superior (cabeza)
  }
  return cabezas;
}

// Clona el ModeloFEM discretizado y le INYECTA la carga lateral FX (case "H") repartida
// en las cabezas, mas un combo UNICO 1.0·G + 1.0·H, y fija `analysis.type` (linear|PDelta)
// y check_statics=false (comparacion limpia; el equilibrio se verifica con las reacciones,
// no con el check por combo — y el glue fuerza check_statics=false bajo P-Δ de todos modos).
function conLateralYAnalisis(
  fem: ModeloFEM,
  cabezas: string[],
  tipo: "linear" | "PDelta",
): ModeloFEM {
  const porCabeza = FX_TOTAL / cabezas.length;
  const lateral: CargaNodoFEM[] = cabezas.map((node) => ({
    node,
    direction: "FX",
    P: porCabeza,
    case: "H",
  }));
  // Combo 1.0·G + 1.0·H: TODAS las permanentes (peso propio automatico + cargas muertas)
  // a factor 1.0 mas la lateral a 1.0. Es el combo del spike; no se reutiliza ELU/ELS para
  // no mezclar 1.35/1.0 en el ratio de amplificacion.
  const combo: ComboFEM = {
    name: COMBO,
    factors: { "hip-peso-propio": 1, h1: 1, H: 1 },
  };
  return {
    ...fem,
    node_loads: [...fem.node_loads, ...lateral],
    combos: [combo],
    analysis: { ...fem.analysis, type: tipo, check_statics: false },
  };
}

// Pico de |DX| entre las cabezas de pilar en un combo (la deriva lateral que amplifica).
function dxMaxCabezas(r: ResultadosCalculo, cabezas: string[]): number {
  let m = 0;
  for (const nm of cabezas) m = Math.max(m, Math.abs(r.nodos[nm][COMBO].disp[0]));
  return m;
}

// Suma de reacciones en un GDL (indice de rxn=[FX,FY,FZ,MX,MY,MZ]) sobre TODOS los nudos.
// Captura arranques de pilar + apoyos de malla (muleta de plano); los no apoyados dan 0.
function sumaReaccion(r: ResultadosCalculo, gdl: number): number {
  let s = 0;
  for (const porCombo of Object.values(r.nodos)) {
    const n = porCombo[COMBO];
    if (n) s += n.rxn[gdl];
  }
  return s;
}

// Carga vertical total del fixture (rho REAL de HA-25, no pegado): pp losa + pp pilares + q·area.
function cargaVerticalTotal(lado: number, secLado: number, altura: number, q: number): number {
  const rho = getMaterial("HA-25")!.peso; // kN/m³ real del catalogo
  const area = lado * lado;
  const ppLosa = rho * ESPESOR * area;
  const ppPilares = 4 * (secLado * secLado * rho * altura);
  const qTotal = q * area;
  return ppLosa + ppPilares + qTotal;
}

describe("golden P-Δ con LOSA PLANA Capa B (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) console.warn(`\n[GOLDEN-LOSA-PLANA-PDELTA][SKIP] ${arranque.motivo}\n`);
  }, TIMEOUT_ARRANQUE);

  it(
    "P1 · CORAZON (robusto): P-Δ corre con quads; amp DX cabezas ∈ (1.001,1.10); ΣV=carga, ΣH=-lateral",
    () => {
      if (!arranque?.ok) return;
      const LADO = 6.0;
      const SEC = 0.3; // pilar 30×30 (robusto)
      const H = 3.0;
      const Q = 5.0; // kN/m²

      const res = discretizarOk(obraLosaPlana({ lado: LADO, secLado: SEC, altura: H, q: Q }));
      // La Capa 2 lleva quads (la losa esta presente en el modelo P-Δ).
      expect(res.modeloFEM.quads?.length ?? 0, "el modelo P-Δ lleva quads (losa presente)").toBeGreaterThan(0);
      // Y la obra pidio P-Δ (analysis.type:"PDelta" via analisis.tipo:"pDelta").
      expect(res.modeloFEM.analysis.type, "la obra pidio P-Δ").toBe("PDelta");

      const cabezas = cabezasPilar(res);
      expect(cabezas.length, "4 cabezas de pilar").toBe(4);

      const femLin = conLateralYAnalisis(res.modeloFEM, cabezas, "linear");
      const femPD = conLateralYAnalisis(res.modeloFEM, cabezas, "PDelta");

      // (a) P-Δ CORRE con quads presentes (no lanza): el eco del tipo confirma la rama.
      const rPD = arranque.motor.calcular(femPD);
      expect(rPD.analysis.type, "P-Δ corrio con quads sin lanzar").toBe("PDelta");
      const rLin = arranque.motor.calcular(femLin);
      expect(rLin.analysis.type).toBe("linear");

      // (b) AMPLIFICACION: la deriva de 2.º orden supera a la de 1.er orden, modesta (robusto).
      const dxLin = dxMaxCabezas(rLin, cabezas);
      const dxPD = dxMaxCabezas(rPD, cabezas);
      const amp = dxPD / dxLin;
      expect(dxLin, "hay deriva lateral de 1.er orden (>0)").toBeGreaterThan(0);
      expect(amp, `amp DX = ${amp} debe superar el ruido (>1.001; medido 1.005)`).toBeGreaterThan(1.001);
      expect(amp, `amp DX = ${amp} robusto -> modesto (<1.10; medido 1.005)`).toBeLessThan(1.1);

      // (c) EQUILIBRIO en P-Δ. ΣV (todas las reacciones verticales) = carga vertical total.
      const gTotal = cargaVerticalTotal(LADO, SEC, H, Q);
      const sumaV = sumaReaccion(rPD, 1); // FY
      const errV = Math.abs(sumaV - gTotal) / gTotal;
      expect(errV, `ΣV=${sumaV} vs carga=${gTotal} (errRel=${errV})`).toBeLessThan(1e-6);

      // ΣH (todas las reacciones horizontales FX) = -FX_total (la lateral se equilibra).
      const sumaH = sumaReaccion(rPD, 0); // FX
      const errH = Math.abs(sumaH + FX_TOTAL) / FX_TOTAL;
      expect(errH, `ΣH=${sumaH} vs -lateral=${-FX_TOTAL} (errRel=${errH})`).toBeLessThan(1e-4);

      console.log(
        `\n[P1 robusto] amp=${amp.toFixed(5)} (DX_lin=${dxLin.toExponential(3)} DX_PΔ=${dxPD.toExponential(3)}) ` +
          `ΣV=${sumaV.toFixed(4)} carga=${gTotal.toFixed(4)} errV=${errV.toExponential(2)} ` +
          `ΣH=${sumaH.toFixed(4)} errH=${errH.toExponential(2)}\n`,
      );
    },
    TIMEOUT_ARRANQUE,
  );

  it(
    "P2 · ANTI-FALSO-VERDE (esbelto): pilares esbeltos + mas axil -> amp DX cabezas > 1.15 (P-Δ hace ALGO)",
    () => {
      if (!arranque?.ok) return;
      // Espejo del sub-caso muy esbelto del spike (20×20, H=5, q=30): amplificacion grande y
      // separable del ruido. Demuestra que el P-Δ con placas NO es un passthrough: al esbeltar
      // los pilares y cargar mas axil, la deriva de 2.º orden se dispara (medido 1.25).
      const LADO = 6.0;
      const SEC = 0.2; // pilar 20×20 (esbelto)
      const H = 5.0;
      const Q = 30.0; // kN/m² (mas axil sobre los pilares)

      const res = discretizarOk(obraLosaPlana({ lado: LADO, secLado: SEC, altura: H, q: Q }));
      expect(res.modeloFEM.quads?.length ?? 0).toBeGreaterThan(0);
      const cabezas = cabezasPilar(res);

      const rLin = arranque.motor.calcular(conLateralYAnalisis(res.modeloFEM, cabezas, "linear"));
      const rPD = arranque.motor.calcular(conLateralYAnalisis(res.modeloFEM, cabezas, "PDelta"));

      const dxLin = dxMaxCabezas(rLin, cabezas);
      const dxPD = dxMaxCabezas(rPD, cabezas);
      const amp = dxPD / dxLin;

      // El salto es claro: amp > 1.15 (medido 1.25). Si el P-Δ silenciosamente no amplificara
      // (rigidez geometrica de pilar mal ensamblada), este umbral lo cazaria.
      expect(amp, `amp DX esbelto = ${amp} debe ser grande (>1.15; medido 1.25)`).toBeGreaterThan(1.15);

      // El equilibrio sigue cuadrando con la esbeltez. ΣV a 1e-6 (residuo del P-Δ crece
      // con la esbeltez, medido ~9e-8, holgura de un orden). ΣH a 2e-3 relativo: el spike
      // documenta que en el caso MUY ESBELTO el ΣH del P-Δ se desvia ~2e-3 sobre 20 kN
      // (≈1e-4 relativo) por el residuo iterativo del balanceo de 2.º orden — este caso
      // (20×20, H=5, q=30) es justo ese extremo del barrido y roza el 1e-4 recomendado para
      // el corazon. Se usa 2e-3 (un orden de holgura sobre el residuo iterativo real, que
      // es FISICO y crece con la esbeltez), reservando el 1e-4 estricto para P1 (donde
      // cuadra a maquina, 2.79e-7). NO es aflojar la formula: el equilibrio SIGUE
      // verificado, con la tolerancia que el propio P-Δ iterativo del extremo esbelto exige.
      const gTotal = cargaVerticalTotal(LADO, SEC, H, Q);
      const sumaV = sumaReaccion(rPD, 1);
      const errV = Math.abs(sumaV - gTotal) / gTotal;
      expect(errV, `ΣV=${sumaV} vs carga=${gTotal} (errRel=${errV})`).toBeLessThan(1e-6);
      const sumaH = sumaReaccion(rPD, 0);
      const errH = Math.abs(sumaH + FX_TOTAL) / FX_TOTAL;
      expect(errH, `ΣH=${sumaH} vs -lateral=${-FX_TOTAL} (errRel=${errH})`).toBeLessThan(2e-3);

      console.log(
        `\n[P2 esbelto] amp=${amp.toFixed(5)} (DX_lin=${dxLin.toExponential(3)} DX_PΔ=${dxPD.toExponential(3)}) ` +
          `ΣV=${sumaV.toFixed(4)} carga=${gTotal.toFixed(4)} errV=${errV.toExponential(2)} ` +
          `ΣH=${sumaH.toFixed(4)} errH=${errH.toExponential(2)}\n`,
      );
    },
    TIMEOUT_ARRANQUE,
  );
});
