// =============================================================================
// GOLDEN Capa B del FORJADO UNIDIRECCIONAL (T3.2 / T-f3-pano-unidireccional) —
// obra (Capa 1) -> discretizar() REAL -> motor REAL PyNite. El forjado de viguetas
// en UNA direccion es la afirmacion de producto del corte: la carga baja por las
// viguetas a los DOS bordes de apoyo (perpendiculares a `direccionViguetas`) y NO a
// los bordes paralelos. Aqui se blinda de punta a punta contra el motor.
//
// Como los demas goldens Capa B (losa-plana.golden), NO se monta la Capa 2 a mano:
// se construye la OBRA, se pasa por `discretizar()` REAL (que genera las viguetas
// sinteticas PV<idx>-V<k>, su seccion VIG-<idx>, los apoyos del spike y los
// dist_loads FY-) y por el motor REAL, y se afirma la FISICA. El GATE que monta
// members a mano no ve el SWAP Iy<->Iz, ni el patron de apoyo del spike, ni la
// muleta torsional, ni el signo de la conversion presion(+abajo) -> FY-.
//
// FUENTE NUMERICA — spike T0.2 (src/solver/spikes/vigueta_spike.md/.py), medido
// contra PyNiteFEA 2.0.2 (el par del proyecto): una vigueta biapoyada AISLADA de
// L=5 m, seccion 0.12x0.30 (b x h = anchoNervio x canto), HA-25, carga w=5 kN/m
// CLAVA la analitica AL BIT:
//   M_max = qL^2/8       = 15.625000 kN·m   (err 0.0000 %)
//   delta = 5qL^4/384EI  = 4.787934e-3 m    (err 0.0000 %,  I = b·h^3/12 = 2.7e-4 m^4)
// El spike fijo TOL_REL = 0.001 (0.1 %) con holgura sobrada para el cambio de build
// numpy/scipy local <-> Pyodide (la solucion Euler-Bernoulli es analiticamente exacta:
// un member con carga distribuida la reproduce con las funciones de forma cubicas).
//
// LECTURA DE ESFUERZOS (spike §2 + contrato de resultados): la vigueta "x" corre a lo
// largo del eje FEM X; para barra horizontal PyNite pone su eje local y = Y (vertical),
// asi que la flexion vertical vive en Mz local (`moment_z`) y la flecha en dy local
// (`defl_y`). Con carga gravitatoria el pico de flector es NEGATIVO -> vive en
// `min_moment_z`; su MAGNITUD es qL^2/8 (mismo idioma que smoke.test.ts). La flecha
// hacia abajo es el min de `defl_y`.
//
// CASOS:
//  U1 · VIGUETA BIAPOYADA vs ANALITICA (n=1): paño estrecho (B < intereje -> n=1)
//       AISLADO (bordeApoyo "simple", sin vigas -> patron de apoyo del spike). Verifica
//       que discretizar produce UNA vigueta con tributario = B, y que el motor clava
//       M=qL^2/8 y delta=5qL^4/384EI a TOL_REL 0.001. Blinda el SWAP (I7): la vigueta
//       de canto>>ancho flecta como el eje FUERTE, no "acostada".
//  U2 · FORJADO COMPLETO sobre portico: 6 viguetas sobre 2 vigas de apoyo (4 pilares
//       empotrados) + 2 vigas en los bordes PARALELOS. ΣV = carga total EXACTA; las
//       vigas de APOYO cargadas (M,V > 0 claros); las PARALELAS casi descargadas
//       (< 5 % del total: el forjado reparte en UNA direccion); reacciones de la muleta
//       torsional ≈ 0 (la biapoyada no transmite torsor: la muleta es inofensiva);
//       check_statics OK.
//  U3 · SEMI-ACOPLADO estable: un borde de apoyo con viga (remap + muleta), el otro con
//       apoyo nodal propio (aislado, {DY} sin muleta de plano porque el portico ya sujeta):
//       corre sin "unstable" y ΣV exacto (el patron mixto del Paso 6d).
//  U4 · FAIL-SAFE: bordeApoyo "libre" con un borde de apoyo SIN viga -> discretizar
//       BLOQUEA con PANO_UNI_SIN_APOYO (no llega al motor: red antes del calculo).
//
// UNIDADES (kN, m; presion de paño kN/m²). E/nu/rho REALES de HA-25 (catalogo,
// getMaterial), nunca pegados. Ejes: planta (x,y)->global (X,Z); cota->Y vertical;
// gravedad = FY global NEGATIVA.
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";

import { obtenerMotor, TIMEOUT_ARRANQUE, type ArranqueMotor } from "./_arnes";
import { discretizar } from "../../src/discretizador";
import { getMaterial } from "../../src/biblioteca";
import type { Modelo, Seccion } from "../../src/dominio";
import type { ResultadoDiscretizacion } from "../../src/discretizador";
import type { ResultadosCalculo } from "../../src/solver/resultados";

// Tolerancia del MOMENTO (0.1 %, del spike): la analitica de la biapoyada es exacta y el
// glue lee el pico de flector con `mb.min_moment("Mz")` — el EXTREMO ANALITICO de PyNite,
// no un valor muestreado. Por eso M clava al bit; este margen solo cubre el cambio de build
// numpy/scipy local <-> Pyodide.
const TOL_REL = 0.001;

// Tolerancia de la FLECHA (0.5 %): el spike leyo la flecha con n_points=21 (IMPAR -> captura
// x=L/2 exacto) y clavo 4.787934e-3 (err 0.0000 %). El GLUE de produccion muestrea `defl_y`
// con `deflection_array(..., N_POINTS_DEFAULT=20, ...)` (pynite_glue.py): con 20 puntos
// (PAR) la rejilla `linspace(0,L,20)` NO incluye el centro exacto x=L/2, donde vive el pico,
// asi que el min de defl_y SUBESTIMA la flecha maxima ~0.33 % (medido). Es un artefacto del
// MUESTREO del diagrama (n par), no del calculo: la fisica es correcta. Se afirma que la
// flecha del motor ≈ la de Euler (5qL^4/384EI) dentro de este margen, que cubre el defecto de
// discretizacion con holgura. (Deuda menor: el pico exacto viviria en un `max_defl` analitico
// como el de los momentos; hoy defl_y es solo el diagrama muestreado.)
const TOL_FLECHA = 0.005;

const H_PLANTA = 3.0; // m (altura de pilar entre cota 0 y cota de la planta del paño)

// Vigueta del corte: nervio 0.12 x 0.30 (anchoNervio x canto), HA-25. I de flexion
// (eje fuerte, canto gobierna) = b·h^3/12 = 0.12·0.30^3/12 = 2.7e-4 m^4.
const ANCHO_NERVIO = 0.12; // m
const CANTO = 0.3; // m
const I_FLEXION = (ANCHO_NERVIO * CANTO ** 3) / 12; // 2.7e-4 m^4

// Pilar de hormigon 30x30 (real): recoge el forjado por AXIL en U2/U3.
const SEC_PILAR_HA: Seccion = {
  id: "sec-pilar-ha",
  nombre: "Pilar 30x30",
  tipo: "hormigonRectangular",
  b: 0.3,
  h: 0.3,
};
// Viga de apoyo/borde: rectangular de hormigon 30x50 (canto suficiente para conducir el
// forjado a los pilares sin flecha espuria). HA-25, igual que las viguetas.
const SEC_VIGA_HA: Seccion = {
  id: "sec-viga-ha",
  nombre: "Viga 30x50",
  tipo: "hormigonRectangular",
  b: 0.3,
  h: 0.5,
};

type ResDiscretizado = ReturnType<typeof discretizar> & { ok: true };

// discretizar() y explotar si falla (misma politica que los otros goldens Capa B).
function discretizarOk(modelo: Modelo): ResDiscretizado {
  const res: ResultadoDiscretizacion = discretizar(modelo);
  if (!res.ok) throw new Error("discretizar fallo: " + JSON.stringify(res.errores));
  return res;
}

// Pico de |Mz| (magnitud del flector vertical) de un member en un combo. Con carga
// gravitatoria el pico vive en min_moment_z (negativo); tomamos su magnitud (== qL^2/8).
function picoMomentoVertical(r: ResultadosCalculo, member: string, combo: string): number {
  const est = r.barras[member][combo];
  return Math.max(Math.abs(est.min_moment_z), Math.abs(est.max_moment_z));
}

// Flecha vertical (hacia abajo, negativa) de un member: el min de defl_y local.
function flechaVertical(r: ResultadosCalculo, member: string, combo: string): number {
  const dy = r.barras[member][combo].defl_y[1];
  return Math.min(...dy);
}

// Pico de |M| (cualquier flector) de TODOS los members de una viga (troceada por el
// acople), en un combo. La viga de apoyo lo tiene > 0; la paralela ≈ 0.
function picoMomentoDeViga(
  res: ResDiscretizado,
  r: ResultadosCalculo,
  vigaId: string,
  combo: string,
): number {
  let pico = 0;
  for (const member of res.trazabilidad.vigaAMembers[vigaId] ?? []) {
    for (const mz of r.barras[member][combo].moment_z[1]) {
      if (Math.abs(mz) > pico) pico = Math.abs(mz);
    }
  }
  return pico;
}

describe("golden FORJADO UNIDIRECCIONAL Capa B (motor real PyNite)", () => {
  let arranque: ArranqueMotor | null = null;

  beforeAll(async () => {
    arranque = await obtenerMotor();
    if (!arranque.ok) console.warn(`\n[GOLDEN-UNI][SKIP] ${arranque.motivo}\n`);
  }, TIMEOUT_ARRANQUE);

  // ---------------------------------------------------------------------------
  // U1 · VIGUETA BIAPOYADA AISLADA vs ANALITICA (el corazon numerico del corte).
  //
  // Paño ESTRECHO (ancho B = 0.5 m < intereje 1.0 -> round(0.5) = 0 -> max(1,0) = 1):
  // UNA sola vigueta centrada, tributario s = B = 0.5 m. Con bordeApoyo "simple" y SIN
  // vigas de contorno, sus dos extremos son nudos PROPIOS -> vigueta AISLADA -> el
  // discretizador emite el patron de apoyo del spike (i: todo; j: todo menos DX) que la
  // estabiliza sin empotrar. Luz = 5 m (dimension en direccionViguetas "x").
  //
  // Carga: superficial de USUARIO q = 10 kN/m² (permanente). El reparto a la unica
  // vigueta es w = q · s = 10 · 0.5 = 5 kN/m -> EXACTAMENTE el w del spike. Sin peso
  // propio (para aislar el numero). Analitica: M = qL^2/8 = 15.625 kN·m,
  // delta = 5qL^4/384EI con I = b·h^3/12 (eje fuerte tras el swap).
  // ---------------------------------------------------------------------------
  function forjadoUnaVigueta(): Modelo {
    return {
      unidades: "kN-m",
      schemaVersion: 5,
      plantas: [
        { id: "p0", nombre: "Cimentacion", cota: 0, altura: H_PLANTA, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
        { id: "p1", nombre: "Planta 1", cota: H_PLANTA, altura: H_PLANTA, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      ],
      secciones: [],
      // Rectangulo 5 (X, luz) x 0.5 (Y, ancho de reparto): B = 0.5 < intereje -> n=1.
      nudos: [
        { id: "q1", x: 0, y: 0 },
        { id: "q2", x: 5, y: 0 },
        { id: "q3", x: 5, y: 0.5 },
        { id: "q4", x: 0, y: 0.5 },
      ],
      pilares: [],
      vigas: [],
      panos: [
        {
          id: "forj1",
          nombre: "Forjado 1",
          tipo: "unidireccional",
          plantaId: "p1",
          perimetro: ["q1", "q2", "q3", "q4"],
          // espesor/tamMalla obligatorios en el schema pero IGNORADOS bajo unidireccional.
          espesor: 0.3,
          materialId: "HA-25",
          tamMalla: 1,
          bordeApoyo: "simple",
          direccionViguetas: "x", // viguetas a lo largo de X (luz = 5), reparto en Y (B = 0.5)
          intereje: 1.0, // > B -> n=1
          canto: CANTO,
          anchoNervio: ANCHO_NERVIO,
          pesoPropio: 0, // sin peso propio: aislamos la carga de usuario (w = q·s)
        },
      ],
      muros: [],
      cargas: [{ id: "c1", tipo: "superficial", ambito: "forj1", valor: 10, hipotesisId: "h1" }],
      hipotesis: [{ id: "h1", nombre: "Cargas muertas", tipo: "permanente", automatica: false }],
      analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
    };
  }

  it(
    "U1 · vigueta biapoyada aislada (n=1) vs analitica: M=qL^2/8, delta=5qL^4/384EI (TOL 0.1 %); tributario = B",
    () => {
      if (!arranque?.ok) return;
      const res = discretizarOk(forjadoUnaVigueta());

      // (a) UNA sola vigueta (n=1) con tributario = B = 0.5 (el paño estrecho no pierde su
      //     vigueta; el reparto la centra). panoAMembers apunta a su member sintetico.
      const members = res.trazabilidad.panoAMembers?.["forj1"] ?? [];
      expect(members, "un paño estrecho da EXACTAMENTE 1 vigueta (max(1,round(B/intereje)))").toHaveLength(1);
      const member = members[0];

      // La luz de la vigueta debe ser 5 m (dimension en X), no 0.5 (el ancho): la geometria
      // del member lo confirma (i en x=0, j en x=5). Blinda R-7 (luz != ancho).
      const mb = res.modeloFEM.members.find((m) => m.name === member)!;
      const ni = res.modeloFEM.nodes.find((n) => n.name === mb.i)!;
      const nj = res.modeloFEM.nodes.find((n) => n.name === mb.j)!;
      const luz = Math.abs(nj.x - ni.x);
      expect(luz, `luz de la vigueta = 5 m (dim en direccionViguetas), no el ancho`).toBeCloseTo(5, 6);

      const r = arranque.motor.calcular(res.modeloFEM);
      const combo = "ELS"; // permanente, factor 1.0 -> carga sin mayorar (comparable directo)

      // (b) M_max = qL^2/8. q = 5 kN/m (= presion 10 · tributario 0.5), L = 5.
      const w = 5.0; // kN/m
      const L = 5.0;
      const mTeo = (w * L ** 2) / 8; // 15.625 kN·m
      const mMotor = picoMomentoVertical(r, member, combo);
      const errM = Math.abs(mMotor - mTeo) / mTeo;
      expect(errM, `M motor=${mMotor} teo=${mTeo} errRel=${errM}`).toBeLessThan(TOL_REL);

      // (c) delta = 5qL^4/(384·E·I), E REAL de HA-25 (catalogo), I = eje fuerte (b·h^3/12).
      //     El SWAP Iy<->Iz garantiza que la vigueta usa el canto (no "acostada", I7): si
      //     el discretizador emitiera sin swap, la flecha seria (canto/ancho)^2 ~6.25x mayor
      //     y este assert FALLARIA -> el golden blinda el swap de la seccion sintetica.
      const E = getMaterial("HA-25")!.E; // kN/m² (Ecm Codigo Estructural, no pegado)
      const deltaTeo = (5 * w * L ** 4) / (384 * E * I_FLEXION);
      const deltaMotor = Math.abs(flechaVertical(r, member, combo)); // magnitud (hacia abajo)
      const errD = Math.abs(deltaMotor - deltaTeo) / deltaTeo;
      expect(deltaMotor, "la vigueta flecta hacia ABAJO (dy < 0)").toBeGreaterThan(0);
      // TOL_FLECHA (no TOL_REL): el glue muestrea defl_y con n=20 (par) y no cae en x=L/2
      // exacto -> subestima el pico ~0.33 %. El SWAP se blinda igual: sin el, la flecha seria
      // ~6.25x mayor (canto/ancho)^2, muy fuera de este margen. Ver cabecera de TOL_FLECHA.
      expect(errD, `delta motor=${deltaMotor} teo=${deltaTeo} errRel=${errD}`).toBeLessThan(TOL_FLECHA);

      // (d) Resolvio limpio (sin NaN silencioso del mecanismo del plano): el patron del
      //     spike estabiliza. check_statics del equilibrio global OK.
      expect(r.check_statics?.equilibrio_ok).toBe(true);

      console.log(
        `\n[U1] member=${member} luz=${luz} M=${mMotor.toFixed(6)} (teo ${mTeo.toFixed(6)}, err ${(errM * 100).toExponential(2)}%) ` +
          `delta=${deltaMotor.toExponential(6)} (teo ${deltaTeo.toExponential(6)}, err ${(errD * 100).toExponential(2)}%)\n`,
      );
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // U2 · FORJADO COMPLETO sobre portico (la afirmacion de producto del corte).
  //
  // Paño 6 (X) x 5 (Y). Viguetas en "x" (luz 5), reparto en Y (B = 6), intereje 1.0 ->
  // n = 6 viguetas. Apoyan en los bordes x=0 y x=6 (bordes de APOYO): sobre ELLOS van dos
  // vigas de contorno (viga_apoyoA, viga_apoyoB) que las viguetas subdividen -> descargan
  // en el portico. Los bordes PARALELOS (y=0, y=6) llevan tambien vigas (viga_parA,
  // viga_parB) para MEDIR que quedan casi descargadas: el forjado reparte en UNA direccion.
  // 4 pilares empotrados en las esquinas conducen todo a las bases.
  //
  // La vigueta anclada al portico es INESTABLE en RX (torsion) con J=0 (spike §3: la viga de
  // contorno va en Y y con J=0 no da rigidez RX al nudo compartido). El Paso 6d pone una
  // MULETA torsional {RX} sobre cada N* nacido de la subdivision (nunca sobre esquinas). Este
  // caso PINA que: (i) el modelo resuelve (la muleta cura la inestabilidad), y (ii) las
  // reacciones de esa muleta son ≈ 0 (la biapoyada no transmite torsor: es inofensiva).
  // ---------------------------------------------------------------------------
  function forjadoCompleto(): Modelo {
    const LX = 6.0; // luz de la vigueta (X)
    const LY = 6.0; // ancho de reparto (Y) -> con intereje 1.0, n=6 viguetas
    const uso = { categoriaUso: "A" as const, sobrecargaUso: 0, cargasMuertas: 0 };
    const pilar = (id: string, x: number, y: number) => ({
      id,
      nombre: id.toUpperCase(),
      x,
      y,
      plantaInicial: "p0",
      plantaFinal: "p1",
      seccionId: SEC_PILAR_HA.id,
      materialId: "HA-25",
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado" as const,
    });
    const viga = (id: string, nudoI: string, nudoJ: string) => ({
      id,
      nombre: id.toUpperCase(),
      plantaId: "p1",
      nudoI,
      nudoJ,
      seccionId: SEC_VIGA_HA.id,
      materialId: "HA-25",
      extremoI: "empotrado" as const,
      extremoJ: "empotrado" as const,
      tirante: false,
    });
    return {
      unidades: "kN-m",
      schemaVersion: 5,
      plantas: [
        { id: "p0", nombre: "Cimentacion", cota: 0, altura: H_PLANTA, ...uso },
        { id: "p1", nombre: "Planta 1", cota: H_PLANTA, altura: H_PLANTA, ...uso },
      ],
      secciones: [SEC_PILAR_HA, SEC_VIGA_HA],
      nudos: [
        { id: "q1", x: 0, y: 0 },
        { id: "q2", x: LX, y: 0 },
        { id: "q3", x: LX, y: LY },
        { id: "q4", x: 0, y: LY },
      ],
      pilares: [
        pilar("pil1", 0, 0),
        pilar("pil2", LX, 0),
        pilar("pil3", LX, LY),
        pilar("pil4", 0, LY),
      ],
      vigas: [
        // Bordes de APOYO (x=0 y x=LX): corren en Y. Las viguetas descargan aqui.
        viga("viga_apoyoA", "q1", "q4"), // x=0, de y=0 a y=6
        viga("viga_apoyoB", "q2", "q3"), // x=6, de y=0 a y=6
        // Bordes PARALELOS (y=0 e y=LY): corren en X. Casi descargados.
        viga("viga_parA", "q1", "q2"), // y=0
        viga("viga_parB", "q4", "q3"), // y=6
      ],
      panos: [
        {
          id: "forj1",
          nombre: "Forjado 1",
          tipo: "unidireccional",
          plantaId: "p1",
          perimetro: ["q1", "q2", "q3", "q4"],
          espesor: 0.3,
          materialId: "HA-25",
          tamMalla: 1,
          bordeApoyo: "simple",
          direccionViguetas: "x",
          intereje: 1.0, // B=6 -> n=6
          canto: CANTO,
          anchoNervio: ANCHO_NERVIO,
          pesoPropio: 3.0, // kN/m² tabulado (se reparte a las viguetas, gated ON)
        },
      ],
      muros: [],
      cargas: [{ id: "c1", tipo: "superficial", ambito: "forj1", valor: 5, hipotesisId: "h1" }],
      hipotesis: [
        { id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true },
        { id: "h1", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
      ],
      analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
    };
  }

  it(
    "U2 · forjado completo sobre portico: ΣV=carga total, vigas de APOYO cargadas, PARALELAS descargadas, muleta torsional ≈ 0",
    () => {
      if (!arranque?.ok) return;
      const res = discretizarOk(forjadoCompleto());
      const r = arranque.motor.calcular(res.modeloFEM);
      const combo = "ELS"; // todo permanente -> factor 1.0

      // (a) 6 viguetas (n = B/intereje = 6/1).
      const viguetas = res.trazabilidad.panoAMembers?.["forj1"] ?? [];
      expect(viguetas, "n = 6 viguetas (B=6 / intereje 1)").toHaveLength(6);

      // (b) EQUILIBRIO: ΣV (reacciones verticales de los 4 arranques de pilar) = carga total.
      //     Carga total = presion·area (usuario) + pesoPropio tabulado·area + peso propio de
      //     BARRAS (pilares + vigas de contorno). Las viguetas NO suman ρ·A como peso estatico
      //     (DP2: su peso propio es el TABULADO, ya contado en pesoPropio·area). Criterio del
      //     golden de losa-plana adaptado al forjado unidireccional.
      const mat = getMaterial("HA-25")!;
      const rho = mat.peso; // kN/m³ real de HA-25 (catalogo)
      const area = 6 * 6;
      const qUsuario = 5.0; // kN/m²
      const ppTabulado = 3.0; // kN/m²
      const cargaForjado = (qUsuario + ppTabulado) * area;
      // Peso propio de las barras del portico (gated ON): 4 pilares (0.3·0.3·H) + 4 vigas
      // de contorno (0.3·0.5·luz). Las 2 de apoyo miden 6 (en Y), las 2 paralelas 6 (en X).
      const ppPilares = 4 * (0.3 * 0.3 * rho * H_PLANTA);
      const ppVigas = 4 * (0.3 * 0.5 * rho * 6.0);
      const gTotal = cargaForjado + ppPilares + ppVigas;

      const arranques = Object.values(res.trazabilidad.pilarANodoArranque);
      expect(arranques, "4 arranques de pilar").toHaveLength(4);
      let sumaV = 0;
      for (const nodo of arranques) sumaV += r.nodos[nodo][combo].rxn[1]; // FY
      const errRel = Math.abs(sumaV - gTotal) / gTotal;
      expect(errRel, `ΣV=${sumaV} vs carga total=${gTotal} (errRel=${errRel})`).toBeLessThan(TOL_REL);

      // (c) Vigas de APOYO cargadas (M y V claros): reciben la mitad del forjado cada una.
      const mApoyoA = picoMomentoDeViga(res, r, "viga_apoyoA", combo);
      const mApoyoB = picoMomentoDeViga(res, r, "viga_apoyoB", combo);
      expect(mApoyoA, `viga de apoyo A cargada (M>0); real=${mApoyoA}`).toBeGreaterThan(1);
      expect(mApoyoB, `viga de apoyo B cargada (M>0); real=${mApoyoB}`).toBeGreaterThan(1);

      // (d) Vigas PARALELAS casi descargadas: el forjado NO reparte hacia ellas (afirmacion de
      //     producto). Reciben solo su peso propio de barra (pequeño frente a las de apoyo).
      //     Umbral relativo: M paralela < 20 % de M apoyo (holgado; la fisica da mucho menos,
      //     pero la paralela lleva SU propio peso, no es exactamente cero).
      const mParA = picoMomentoDeViga(res, r, "viga_parA", combo);
      const mParB = picoMomentoDeViga(res, r, "viga_parB", combo);
      const mApoyoMax = Math.max(mApoyoA, mApoyoB);
      expect(mParA / mApoyoMax, `paralela A descargada: MparA=${mParA} vs Mapoyo=${mApoyoMax}`).toBeLessThan(0.2);
      expect(mParB / mApoyoMax, `paralela B descargada: MparB=${mParB} vs Mapoyo=${mApoyoMax}`).toBeLessThan(0.2);

      // (e) MULETA TORSIONAL inofensiva: los apoyos de malla del forjado son las muletas {RX}
      //     que el Paso 6d clava sobre los N* de subdivision. Sus reacciones de MOMENTO
      //     (MX = rxn[3], MZ = rxn[5]) deben ser ≈ 0: la vigueta biapoyada no transmite
      //     torsor, la muleta solo mata el mecanismo numerico (spike §3). Si absorbiera
      //     momento real, seria una restriccion espuria que falsea el reparto.
      let maxTorsorMuleta = 0;
      for (const nodo of res.trazabilidad.apoyosDeMalla) {
        const rxn = r.nodos[nodo]?.[combo]?.rxn;
        if (rxn === undefined) continue;
        maxTorsorMuleta = Math.max(maxTorsorMuleta, Math.abs(rxn[3]), Math.abs(rxn[5]));
      }
      expect(maxTorsorMuleta, `reaccion de la muleta torsional ≈ 0; real=${maxTorsorMuleta}`).toBeLessThan(1e-3);

      // (f) check_statics OK con el forjado en juego.
      expect(r.check_statics?.equilibrio_ok).toBe(true);

      const pctPar = (100 * mApoyoMax > 0 ? (Math.max(mParA, mParB) / mApoyoMax) * 100 : 0);
      console.log(
        `\n[U2] ΣV=${sumaV.toFixed(3)} carga=${gTotal.toFixed(3)} errRel=${errRel.toExponential(2)}; ` +
          `Mapoyo=[${mApoyoA.toFixed(2)}, ${mApoyoB.toFixed(2)}] Mparalela=[${mParA.toFixed(3)}, ${mParB.toFixed(3)}] ` +
          `(${pctPar.toFixed(1)}% del apoyo); torsorMuleta=${maxTorsorMuleta.toExponential(2)}\n`,
      );
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // U3 · SEMI-ACOPLADO estable (el patron MIXTO del Paso 6d).
  //
  // Un borde de apoyo (x=0) con viga de contorno -> remap + muleta torsional. El otro
  // (x=6) SIN viga -> apoyo nodal propio. Como AL MENOS un extremo cae en el portico, la
  // vigueta NO es "aislada": el nudo propio del otro extremo recibe el patron J ({DY,DZ,
  // RX,RY,RZ} sin DX; sin muleta de plano completa, porque el portico ya sujeta el plano,
  // contrato §4-E). Se pina que resuelve SIN "unstable" y con ΣV exacto.
  //
  // Un pilar bajo el borde con viga (arranque de la estructura) + el propio apoyo nodal del
  // borde sin viga dan sujecion. bordeApoyo "simple" (NO "libre"): el borde x=6 sin viga es
  // legitimo porque hay apoyo nodal propio ahi (no dispara PANO_UNI_SIN_APOYO, que solo salta
  // con "libre").
  // ---------------------------------------------------------------------------
  function forjadoSemiAcoplado(): Modelo {
    const LX = 6.0;
    const LY = 4.0;
    const uso = { categoriaUso: "A" as const, sobrecargaUso: 0, cargasMuertas: 0 };
    const pilar = (id: string, x: number, y: number) => ({
      id,
      nombre: id.toUpperCase(),
      x,
      y,
      plantaInicial: "p0",
      plantaFinal: "p1",
      seccionId: SEC_PILAR_HA.id,
      materialId: "HA-25",
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado" as const,
    });
    return {
      unidades: "kN-m",
      schemaVersion: 5,
      plantas: [
        { id: "p0", nombre: "Cimentacion", cota: 0, altura: H_PLANTA, ...uso },
        { id: "p1", nombre: "Planta 1", cota: H_PLANTA, altura: H_PLANTA, ...uso },
      ],
      secciones: [SEC_PILAR_HA, SEC_VIGA_HA],
      nudos: [
        { id: "q1", x: 0, y: 0 },
        { id: "q2", x: LX, y: 0 },
        { id: "q3", x: LX, y: LY },
        { id: "q4", x: 0, y: LY },
      ],
      // Solo 2 pilares, bajo el borde de apoyo x=0 (que lleva la viga). El borde x=6 apoya en
      // nudos propios ({DY} + muleta minima), sin pilar.
      pilares: [pilar("pil1", 0, 0), pilar("pil2", 0, LY)],
      vigas: [
        // Viga de contorno SOLO en el borde de apoyo x=0 (de y=0 a y=4). El borde x=6 no la tiene.
        {
          id: "viga_apoyoA",
          nombre: "VIGA_APOYOA",
          plantaId: "p1",
          nudoI: "q1",
          nudoJ: "q4",
          seccionId: SEC_VIGA_HA.id,
          materialId: "HA-25",
          extremoI: "empotrado",
          extremoJ: "empotrado",
          tirante: false,
        },
      ],
      panos: [
        {
          id: "forj1",
          nombre: "Forjado 1",
          tipo: "unidireccional",
          plantaId: "p1",
          perimetro: ["q1", "q2", "q3", "q4"],
          espesor: 0.3,
          materialId: "HA-25",
          tamMalla: 1,
          bordeApoyo: "simple", // x=6 sin viga es legitimo: hay apoyo nodal propio
          direccionViguetas: "x",
          intereje: 1.0, // B=4 -> n=4
          canto: CANTO,
          anchoNervio: ANCHO_NERVIO,
          pesoPropio: 3.0,
        },
      ],
      muros: [],
      cargas: [{ id: "c1", tipo: "superficial", ambito: "forj1", valor: 5, hipotesisId: "h1" }],
      hipotesis: [
        { id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true },
        { id: "h1", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
      ],
      analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
    };
  }

  it(
    "U3 · semi-acoplado (un borde con viga+muleta, otro con apoyo nodal): resuelve SIN unstable y ΣV exacto",
    () => {
      if (!arranque?.ok) return;
      const res = discretizarOk(forjadoSemiAcoplado());

      // No lanza (el patron mixto es estable): calcular NO explota con "Unstable".
      let lanzo = false;
      let mensaje = "";
      let r: ResultadosCalculo | null = null;
      try {
        r = arranque.motor.calcular(res.modeloFEM);
      } catch (e) {
        lanzo = true;
        mensaje = e instanceof Error ? e.message : String(e);
      }
      expect(lanzo, `semi-acoplado debe resolver sin 'unstable'; mensaje="${mensaje}"`).toBe(false);
      if (r === null) return; // narrowing (ya fallo el expect)

      const combo = "ELS";

      // ΣV: reacciones verticales de los arranques de pilar (borde x=0) + apoyos nodales
      // propios del borde x=6 (registrados en apoyosDeMalla) = carga total.
      const mat = getMaterial("HA-25")!;
      const rho = mat.peso;
      const area = 6 * 4;
      const cargaForjado = (5.0 + 3.0) * area;
      const ppPilares = 2 * (0.3 * 0.3 * rho * H_PLANTA);
      const ppViga = 0.3 * 0.5 * rho * 4.0; // la unica viga de contorno (borde x=0, en Y, luz 4)
      const gTotal = cargaForjado + ppPilares + ppViga;

      let sumaV = 0;
      for (const nodo of Object.values(res.trazabilidad.pilarANodoArranque)) {
        sumaV += r.nodos[nodo][combo].rxn[1];
      }
      for (const nodo of res.trazabilidad.apoyosDeMalla) {
        sumaV += r.nodos[nodo]?.[combo]?.rxn[1] ?? 0;
      }
      const errRel = Math.abs(sumaV - gTotal) / gTotal;
      expect(errRel, `ΣV=${sumaV} vs carga=${gTotal} (errRel=${errRel})`).toBeLessThan(TOL_REL);

      expect(r.check_statics?.equilibrio_ok).toBe(true);

      console.log(
        `\n[U3] lanzo=${lanzo} ΣV=${sumaV.toFixed(3)} carga=${gTotal.toFixed(3)} errRel=${errRel.toExponential(2)}\n`,
      );
    },
    TIMEOUT_ARRANQUE,
  );

  // ---------------------------------------------------------------------------
  // U4 · FAIL-SAFE: la red antes del motor. bordeApoyo "libre" con un borde de apoyo SIN
  // viga -> las viguetas quedan con un extremo suelto (voladizo sin recoger / mecanismo).
  // discretizar BLOQUEA con PANO_UNI_SIN_APOYO ANTES de llegar al motor. NO depende de
  // Pyodide (es puro discretizador): la red que ataja el calculo de basura plausible.
  // ---------------------------------------------------------------------------
  it(
    "U4 · fail-safe: bordeApoyo 'libre' sin viga en un borde de apoyo -> PANO_UNI_SIN_APOYO (no llega al motor)",
    () => {
      const modelo: Modelo = {
        unidades: "kN-m",
        schemaVersion: 5,
        plantas: [
          { id: "p0", nombre: "Cimentacion", cota: 0, altura: H_PLANTA, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
          { id: "p1", nombre: "Planta 1", cota: H_PLANTA, altura: H_PLANTA, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
        ],
        secciones: [SEC_PILAR_HA],
        nudos: [
          { id: "q1", x: 0, y: 0 },
          { id: "q2", x: 6, y: 0 },
          { id: "q3", x: 6, y: 4 },
          { id: "q4", x: 0, y: 4 },
        ],
        // Un pilar cualquiera para no disparar SIN_SUJECION por otra via: el foco es que el
        // borde "libre" sin viga dispara PANO_UNI_SIN_APOYO.
        pilares: [
          {
            id: "pil1",
            nombre: "PIL1",
            x: 0,
            y: 0,
            plantaInicial: "p0",
            plantaFinal: "p1",
            seccionId: SEC_PILAR_HA.id,
            materialId: "HA-25",
            angulo: 0,
            vinculacionExterior: true,
            arranque: "empotrado",
          },
        ],
        vigas: [],
        panos: [
          {
            id: "forj1",
            nombre: "Forjado 1",
            tipo: "unidireccional",
            plantaId: "p1",
            perimetro: ["q1", "q2", "q3", "q4"],
            espesor: 0.3,
            materialId: "HA-25",
            tamMalla: 1,
            bordeApoyo: "libre", // <- borde de apoyo sin viga y libre: voladizo suelto
            direccionViguetas: "x",
            intereje: 1.0,
            canto: CANTO,
            anchoNervio: ANCHO_NERVIO,
            pesoPropio: 3.0,
          },
        ],
        muros: [],
        cargas: [{ id: "c1", tipo: "superficial", ambito: "forj1", valor: 5, hipotesisId: "h1" }],
        hipotesis: [
          { id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true },
          { id: "h1", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
        ],
        analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
      };

      const res = discretizar(modelo);
      // discretizar FALLA (ok:false): NO produce Capa 2 -> NO llega al motor.
      expect(res.ok, "borde de apoyo 'libre' sin viga: discretizar debe BLOQUEAR").toBe(false);
      if (res.ok) return; // narrowing para TS
      const codigos = res.errores.map((e) => e.codigo);
      expect(codigos, `debe emitir PANO_UNI_SIN_APOYO; codigos=${JSON.stringify(codigos)}`).toContain(
        "PANO_UNI_SIN_APOYO",
      );
      // El error apunta al paño y su mensaje esta en lenguaje de obra (nombra el forjado, guia
      // a poner una viga o cambiar a apoyado), SIN jerga FEM.
      const err = res.errores.find((e) => e.codigo === "PANO_UNI_SIN_APOYO")!;
      expect(err.elementoTipo).toBe("pano");
      expect(err.mensaje).toMatch(/viga|apoyo|borde/i);
      expect(err.mensaje).not.toMatch(/quad|N\*|drilling|release|member|vigueta PV/i);

      console.log(`\n[U4] ok=${res.ok} codigos=${JSON.stringify(codigos)}\n`);
    },
  );
});
