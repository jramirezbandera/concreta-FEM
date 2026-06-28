// =============================================================================
// FIXTURES de las obras canonicas (Capa 1) para los golden tests (feature-6).
//
// SOLO LA ENTRADA: cada factoria devuelve un `Modelo` valido de Capa 1 con
// geometria y cargas conocidas. Los VALORES ANALITICOS esperados (M=qL²/8, etc.)
// NO van aqui: los pone T1.2 con las formulas verificadas de I+D #9. Estas
// factorias son reutilizables y parametrizadas (L, q, P...) para que T1.2 elija
// numeros sencillos.
//
// COMO MODELA EL DISCRETIZADOR (lo que condiciona estos fixtures; ver
// src/discretizador/discretizar.ts):
//  - Ejes (#18): planta (x,y) -> global (X,Z); la cota de la planta -> Y vertical.
//    Una viga en una planta corre en el plano horizontal global X-Z a altura Y=cota.
//  - APOYOS: solo nacen de PILARES con `vinculacionExterior:true`. No hay "apoyo"
//    de viga suelto. Para una biapoyada se ponen DOS pilares (uno por extremo) que
//    suben desde una planta de cimentacion (cota 0) hasta la planta de la viga, con
//    arranque que fija el tipo de apoyo. La viga comparte nudo con la cabeza de
//    cada pilar por snapping geometrico (mismo x,y,cota -> mismo nodo FEM).
//  - CARGA LINEAL sobre viga -> UDL global FY negativa (gravedad, #3) en toda la
//    barra. CARGA PUNTUAL sobre viga -> se aplica en el ORIGEN de la barra (x=0):
//    el discretizador F1 NO posiciona la carga a lo largo del vano (no hay dato de
//    posicion en el dominio). Por eso el fixture de "puntual centrada" coloca la
//    carga sobre un NUDO intermedio compartido (ver fixtureBiapoyadaPuntualCentro).
//
// MATERIAL/SECCION: acero S275 + IPE300 del catalogo (biblioteca). En estructuras
// isostaticas E/I no afecta a M ni a R (solo a la flecha), pero se usan valores
// reales del catalogo para que la flecha tambien sea verificable por T1.2.
// =============================================================================

import type { Modelo } from "../../../src/dominio";
import { SCHEMA_VERSION, ID_HIP_PESO_PROPIO } from "../../../src/dominio";

// Ids reales del catalogo (biblioteca): acero S275, perfil IPE300.
export const MATERIAL_GOLDEN = "S275";
export const PERFIL_GOLDEN = "IPE300";
export const SECCION_GOLDEN = "sec-ipe"; // seccion de obra que referencia el perfil

// Hipotesis unica permanente "G". En el combo ELU lleva factor 1.35 (ver
// discretizar.ts paso 7); T1.2 puede leer ELU (carga mayorada) o derivar el combo
// que prefiera. Los fixtures no fijan el combo: lo elige el caso golden.
const HIP_G = { id: "G", nombre: "Permanente", tipo: "permanente" as const, automatica: false };

// Seccion IPE300 de obra, comun a los fixtures metalicos.
function seccionIpe() {
  return {
    id: SECCION_GOLDEN,
    nombre: "IPE 300",
    tipo: "perfilMetalico" as const,
    perfilId: PERFIL_GOLDEN,
  };
}

// Plantas estandar: cimentacion en cota 0, planta de calculo en cota `cotaViga`.
// La viga vive en la planta superior; los pilares suben de p0 a p1.
function plantas(cotaViga: number) {
  return [
    { id: "p0", nombre: "Cimentacion", cota: 0, altura: cotaViga, grupoId: "g1" },
    { id: "p1", nombre: "Planta", cota: cotaViga, altura: 3, grupoId: "g1" },
  ];
}

const GRUPO = {
  id: "g1",
  nombre: "Grupo",
  categoriaUso: "A" as const,
  sobrecargaUso: 2,
  cargasMuertas: 1,
};

// Pilar de apoyo: sube de p0 (cota 0) a p1 (cota `cotaViga`) en (x,y), con
// vinculacion exterior y el `arranque` dado (empotrado | articulado). Su cabeza
// (x, cotaViga, y) comparte nodo con el extremo de viga en ese mismo punto.
function pilarApoyo(
  id: string,
  x: number,
  y: number,
  arranque: "empotrado" | "articulado",
) {
  return {
    id,
    nombre: id.toUpperCase(),
    x,
    y,
    plantaInicial: "p0",
    plantaFinal: "p1",
    seccionId: SECCION_GOLDEN,
    materialId: MATERIAL_GOLDEN,
    angulo: 0,
    vinculacionExterior: true,
    arranque,
  };
}

// -----------------------------------------------------------------------------
// 1) BIAPOYADA con carga uniforme (UDL).  Formula (I+D #9): M=qL²/8, δ=5qL⁴/384EI.
//    Geometria: viga de luz L en cota `cota`, entre nudos (0,0) y (L,0). Dos
//    pilares con BASE EMPOTRADA bajo cada extremo (columnas estables), y la VIGA
//    ARTICULADA en ambos extremos (rotula -> no transmite momento al pilar): asi
//    la viga flecta como biapoyada pura. Carga lineal gravitatoria q (kN/m) en
//    hipotesis permanente sobre la viga.
//    POR QUE BASE EMPOTRADA Y NO ARTICULADA: dos pilares pin-top + base articulada
//    forman un MECANISMO (giro libre de todo el portico) y el solver devuelve NaN
//    en el equilibrio. Con base empotrada las columnas son estables; la rotula de
//    la viga garantiza el comportamiento biapoyado en flexion. T1.2 valida M y R
//    (isostaticos, exactos) y la flecha (tolerancia 1%).
// -----------------------------------------------------------------------------
export type ParamsUDL = { L: number; q: number; cota?: number };

export function fixtureBiapoyadaUDL({ L, q, cota = 3 }: ParamsUDL): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [GRUPO],
    plantas: plantas(cota),
    secciones: [seccionIpe()],
    nudos: [
      { id: "ni", x: 0, y: 0 },
      { id: "nj", x: L, y: 0 },
    ],
    pilares: [
      pilarApoyo("api", 0, 0, "empotrado"),
      pilarApoyo("apj", L, 0, "empotrado"),
    ],
    vigas: [
      {
        id: "viga",
        nombre: "V",
        plantaId: "p1",
        nudoI: "ni",
        nudoJ: "nj",
        seccionId: SECCION_GOLDEN,
        materialId: MATERIAL_GOLDEN,
        extremoI: "articulado",
        extremoJ: "articulado",
        tirante: false,
      },
    ],
    panos: [],
    muros: [],
    cargas: [{ id: "q", tipo: "lineal", ambito: "viga", valor: q, hipotesisId: "G" }],
    hipotesis: [HIP_G],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

// -----------------------------------------------------------------------------
// 2) VOLADIZO con carga puntual en el extremo.  Formula (I+D #9): M=PL, δ=PL³/3EI.
//    Geometria: una viga empotrada en su extremo j (nudo en L,0, sobre un pilar
//    EMPOTRADO -> 6 GDL) y LIBRE en su extremo i (nudo en 0,0, sin pilar). La carga
//    puntual P se aplica EN EL EXTREMO LIBRE como carga sobre NUDO (node_load): el
//    discretizador F1 NO posiciona puntuales sobre barra (no hay dato de posicion en
//    el dominio; una puntual sobre el apoyo en x=0 no produce flexion y se perderia
//    en silencio -> el discretizador la BLOQUEA). El uso correcto en F1 es aplicar la
//    puntual sobre el NUDO libre, que es donde fisicamente actua la carga del
//    voladizo. El pilar de empotramiento se coloca bajo el nudo j (empotrado).
// -----------------------------------------------------------------------------
export type ParamsVoladizoP = { L: number; P: number; cota?: number };

export function fixtureVoladizoPuntual({ L, P, cota = 3 }: ParamsVoladizoP): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [GRUPO],
    plantas: plantas(cota),
    secciones: [seccionIpe()],
    nudos: [
      // i = extremo LIBRE: ahi se aplica la carga puntual (node_load).
      { id: "nlibre", x: 0, y: 0 },
      // j = extremo EMPOTRADO (bajo el pilar empotrado).
      { id: "nemp", x: L, y: 0 },
    ],
    pilares: [
      // Pilar EMPOTRADO bajo el extremo j -> empotramiento del voladizo (6 GDL).
      pilarApoyo("apemp", L, 0, "empotrado"),
    ],
    vigas: [
      {
        id: "viga",
        nombre: "V",
        plantaId: "p1",
        nudoI: "nlibre", // libre
        nudoJ: "nemp", // empotrado
        seccionId: SECCION_GOLDEN,
        materialId: MATERIAL_GOLDEN,
        // El empotramiento del voladizo lo da el PILAR empotrado en el extremo j;
        // la viga mantiene continuidad rigida con el (extremos empotrados).
        extremoI: "empotrado",
        extremoJ: "empotrado",
        tirante: false,
      },
    ],
    panos: [],
    muros: [],
    // Carga puntual sobre el NUDO libre -> node_load FY negativa en el extremo del
    // voladizo (donde fisicamente actua P). M en el empotramiento = P·L.
    cargas: [{ id: "P", tipo: "puntual", ambito: "nlibre", valor: P, hipotesisId: "G" }],
    hipotesis: [HIP_G],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

// -----------------------------------------------------------------------------
// 3) BIAPOYADA con carga puntual CENTRADA.  Formula (I+D #9): M=PL/4, δ=PL³/48EI.
//    El discretizador F1 no posiciona una carga puntual a media barra; para tener
//    P en el CENTRO se parte la viga en DOS vanos (i->centro, centro->j) que
//    comparten el nudo central, y la carga puntual se aplica sobre ese NUDO
//    (node_load), no sobre una barra. Apoyos: dos pilares con BASE EMPOTRADA en los
//    extremos (columnas estables; ver nota de fixtureBiapoyadaUDL sobre el
//    mecanismo/NaN con base articulada). La viga esta ARTICULADA en los dos apoyos
//    extremos (biapoyada en flexion) y CONTINUA en el nudo central. El nudo central
//    NO tiene pilar (queda libre verticalmente para flectar). T1.2 lee M en el nudo
//    central y la flecha ahi.
//    Geometria: nudos (0,0), (L/2,0), (L,0); dos vigas colineales; P sobre el nudo
//    central. Extremos de viga en los apoyos = articulado; en nc = empotrado entre
//    si (continuidad): una viga continua partida en el punto de carga, equivalente
//    a la biapoyada con P centrada.
// -----------------------------------------------------------------------------
export type ParamsBiapoyadaP = { L: number; P: number; cota?: number };

export function fixtureBiapoyadaPuntualCentro({
  L,
  P,
  cota = 3,
}: ParamsBiapoyadaP): Modelo {
  const medio = L / 2;
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [GRUPO],
    plantas: plantas(cota),
    secciones: [seccionIpe()],
    nudos: [
      { id: "ni", x: 0, y: 0 },
      { id: "nc", x: medio, y: 0 }, // nudo central: ahi va P (node_load)
      { id: "nj", x: L, y: 0 },
    ],
    pilares: [
      pilarApoyo("api", 0, 0, "empotrado"),
      pilarApoyo("apj", L, 0, "empotrado"),
    ],
    vigas: [
      {
        id: "vizq",
        nombre: "V-izq",
        plantaId: "p1",
        nudoI: "ni",
        nudoJ: "nc",
        seccionId: SECCION_GOLDEN,
        materialId: MATERIAL_GOLDEN,
        extremoI: "articulado", // rotula en el apoyo izquierdo (biapoyada)
        extremoJ: "empotrado", // continuidad en el centro
        tirante: false,
      },
      {
        id: "vder",
        nombre: "V-der",
        plantaId: "p1",
        nudoI: "nc",
        nudoJ: "nj",
        seccionId: SECCION_GOLDEN,
        materialId: MATERIAL_GOLDEN,
        extremoI: "empotrado", // continuidad en el centro
        extremoJ: "articulado", // rotula en el apoyo derecho (biapoyada)
        tirante: false,
      },
    ],
    panos: [],
    muros: [],
    // Carga puntual sobre el NUDO central -> node_load FY negativa en el centro.
    cargas: [{ id: "P", tipo: "puntual", ambito: "nc", valor: P, hipotesisId: "G" }],
    hipotesis: [HIP_G],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

// -----------------------------------------------------------------------------
// 4) PORTICO SIMPLE: dos pilares empotrados en base + un dintel (viga) con carga
//    uniforme. Hiperestatico: NO hay formula cerrada de M elemental; T1.2 lo
//    verifica contra valores tabulados de portico (I+D #9 "+ celosia y portico")
//    o contra equilibrio global + simetria. El fixture solo aporta la geometria.
//    Geometria: pilares en (0,0) y (B,0) de cota 0 a `H`; dintel entre nudos (0,0)
//    y (B,0) en la planta superior (cota H). Carga lineal q sobre el dintel.
//    Bases EMPOTRADAS; uniones dintel-pilar rigidas (extremos empotrados).
// -----------------------------------------------------------------------------
export type ParamsPortico = { B: number; H: number; q: number };

export function fixturePorticoSimple({ B, H, q }: ParamsPortico): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [GRUPO],
    plantas: plantas(H), // p0 cota 0 (bases), p1 cota H (dintel)
    secciones: [seccionIpe()],
    nudos: [
      { id: "nizq", x: 0, y: 0 },
      { id: "nder", x: B, y: 0 },
    ],
    pilares: [
      pilarApoyo("pizq", 0, 0, "empotrado"),
      pilarApoyo("pder", B, 0, "empotrado"),
    ],
    vigas: [
      {
        id: "dintel",
        nombre: "Dintel",
        plantaId: "p1",
        nudoI: "nizq",
        nudoJ: "nder",
        seccionId: SECCION_GOLDEN,
        materialId: MATERIAL_GOLDEN,
        extremoI: "empotrado", // union rigida con los pilares
        extremoJ: "empotrado",
        tirante: false,
      },
    ],
    panos: [],
    muros: [],
    cargas: [{ id: "q", tipo: "lineal", ambito: "dintel", valor: q, hipotesisId: "G" }],
    hipotesis: [HIP_G],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

// =============================================================================
// FIXTURES F2a — PESO PROPIO automatico (golden de Capa B, F3.1).
//
// El peso propio lo emite el DISCRETIZADOR como hipotesis automatica
// `hip-peso-propio` (w=A·rho, FY global negativa) cuando `incluirPesoPropio:true`
// (ver discretizar.ts paso 6b). Para AISLAR el efecto del peso propio en el golden,
// estos fixtures NO llevan cargas de usuario: el unico esfuerzo proviene del peso
// propio. Leyendo el combo ELS (factor 1.0 sobre la permanente automatica;
// combinaciones.ts) se obtiene el peso propio SIN mayorar -> comparable directo con
// la formula cerrada. El combo ELU lo lleva con factor 1.35 (permanente desfav.).
//
// Para que el peso (w=A·rho) salga con numeros CERRADOS y verificables a mano se usa
// una seccion GENERICA de area A directa (m²) en lugar del IPE300 tabulado: asi
// w=A·rho es exacto (rho del material de catalogo) sin arrastrar el A del perfil.
// =============================================================================

// rho del acero S275 (catalogo): peso especifico 78.5 kN/m³ (aceros.ts).
export const RHO_ACERO = 78.5; // kN/m³ (peso especifico, = material.peso)

// Seccion generica de obra con A directo en m² (math de peso exacta: w=A·rho).
function seccionGenerica(id: string, A: number) {
  return {
    id,
    nombre: id,
    tipo: "generico" as const,
    A,
    // Iz gobierna la flexion vertical de las vigas horizontales (ver cabecera de
    // pipeline.golden.test.ts). Iy/J no influyen en M/flecha de estos casos planos.
    Iy: 1e-4,
    Iz: 6e-5,
    J: 1e-6,
  };
}

const SEC_PP = "sec-pp"; // id de la seccion generica de peso propio

// Pilar de apoyo con seccion generica (espejo de pilarApoyo, pero seccion SEC_PP).
function pilarApoyoGen(
  id: string,
  x: number,
  y: number,
  arranque: "empotrado" | "articulado",
) {
  return { ...pilarApoyo(id, x, y, arranque), seccionId: SEC_PP };
}

// -----------------------------------------------------------------------------
// PP-1) PESO PROPIO de VIGA biapoyada (sin cargas de usuario).  La viga horizontal
//    de seccion A recibe w_pp = A·rho (kN/m). Como esta ARTICULADA en ambos apoyos
//    (biapoyada en flexion, igual que fixtureBiapoyadaUDL), su flector pico de peso
//    propio es |M| = w_pp·L²/8 en el combo ELS (factor 1.0). Los pilares de apoyo
//    tambien reciben su peso propio (axil), que NO flecta la viga.
//    Si se pasa `q` (kN/m) ademas, hay carga repartida de usuario en la hipotesis G,
//    y en ELS el flector de la viga = (q + w_pp)·L²/8 (superposicion lineal).
// -----------------------------------------------------------------------------
export type ParamsPesoPropioViga = { L: number; A: number; q?: number; cota?: number };

export function fixturePesoPropioVigaBiapoyada({
  L,
  A,
  q = 0,
  cota = 3,
}: ParamsPesoPropioViga): Modelo {
  const cargas =
    q > 0
      ? [{ id: "q", tipo: "lineal" as const, ambito: "viga", valor: q, hipotesisId: "G" }]
      : [];
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [GRUPO],
    plantas: plantas(cota),
    secciones: [seccionGenerica(SEC_PP, A)],
    nudos: [
      { id: "ni", x: 0, y: 0 },
      { id: "nj", x: L, y: 0 },
    ],
    pilares: [
      pilarApoyoGen("api", 0, 0, "empotrado"),
      pilarApoyoGen("apj", L, 0, "empotrado"),
    ],
    vigas: [
      {
        id: "viga",
        nombre: "V",
        plantaId: "p1",
        nudoI: "ni",
        nudoJ: "nj",
        seccionId: SEC_PP,
        materialId: MATERIAL_GOLDEN,
        extremoI: "articulado",
        extremoJ: "articulado",
        tirante: false,
      },
    ],
    panos: [],
    muros: [],
    cargas,
    hipotesis: [HIP_G, HIP_PESO_PROPIO],
    // FLAG ON: el discretizador emite el peso propio (w=A·rho). El toggle OFF se
    // obtiene con `conPesoPropioOff(...)` (mismo modelo, sin la carga automatica).
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

// -----------------------------------------------------------------------------
// PP-2) PESO PROPIO de PILAR (columna vertical, base empotrada).  El pilar vertical
//    de seccion A y altura H recibe w_pp = A·rho (kN/m) en direccion GLOBAL FY
//    NEGATIVA. Para una barra vertical esa carga global es AXIL (no flexion): el
//    axil en la base = A·rho·H y la reaccion vertical en el apoyo = A·rho·H (hacia
//    arriba). ⚠ Si la direccion del peso propio fuera la equivocada (no FY-), la
//    barra vertical recibiria FLEXION en vez de axil -> el golden lo CAZA exigiendo
//    reaccion VERTICAL (FY) = peso y flector ~0.
//    Una sola columna empotrada en la base es estable (6 GDL); no necesita viga.
// -----------------------------------------------------------------------------
export type ParamsPesoPropioPilar = { H: number; A: number };

export function fixturePesoPropioPilar({ H, A }: ParamsPesoPropioPilar): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [GRUPO],
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: H, grupoId: "g1" },
      { id: "p1", nombre: "Planta", cota: H, altura: 3, grupoId: "g1" },
    ],
    secciones: [seccionGenerica(SEC_PP, A)],
    nudos: [],
    pilares: [pilarApoyoGen("pil", 0, 0, "empotrado")], // p0->p1, base empotrada
    vigas: [],
    panos: [],
    muros: [],
    cargas: [],
    hipotesis: [HIP_G, HIP_PESO_PROPIO],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

// Hipotesis automatica de peso propio: invariante de dominio (automatica:true). El
// discretizador la referencia por id para emitir w=A·rho; el guard E1
// (validaciones.ts) exige que exista cuando incluirPesoPropio===true.
const HIP_PESO_PROPIO = {
  id: ID_HIP_PESO_PROPIO,
  nombre: "Peso propio",
  tipo: "permanente" as const,
  automatica: true,
};

// Devuelve una COPIA del modelo con el peso propio DESACTIVADO (toggle OFF). Mismo
// modelo en todo lo demas: el golden compara ON vs OFF para verificar que el flag
// gobierna la presencia del esfuerzo de peso propio (sin combo fantasma, E4).
export function conPesoPropioOff(modelo: Modelo): Modelo {
  return { ...modelo, analisis: { ...modelo.analisis, incluirPesoPropio: false } };
}
