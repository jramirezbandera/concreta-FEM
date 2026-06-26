// =============================================================================
// fixturesResultados.ts - fixtures COMPARTIDOS de ResultadosCalculo (modulo NO-test).
//
// POR QUE ESTE MODULO EXISTE (feature-16 T0.4, decision D4):
//  - `RESULTADOS_OK` y `crearPar` vivian SIN exportar en solverClient.test.ts.
//  - El mock E2E (src/test-harness/mockSolver.ts) entra en el bundle de DEV (bajo
//    VITE_E2E) y NO puede importar de un `.test.ts` (Vite no lo serviria y romperia
//    el aislamiento test/prod). Por eso se extraen aqui, a un modulo normal que
//    consumen TANTO solverClient.test.ts (fixture fijo) COMO el mock E2E (D4).
//
// SIN DEPENDENCIA DE VITEST (load-bearing): este modulo entra en el bundle de DEV,
// asi que NO importa `vitest` (`vi.fn()`). `crearParMock` recibe los metodos del
// proxy YA construidos: en el test se le pasan `vi.fn()` (para asertar llamadas);
// en el mock E2E, funciones planas. Asi el helper se comparte sin arrastrar el
// runner de tests al bundle.
//
// QUE APORTA (decision D7, el nucleo):
//  - `RESULTADOS_OK`: la salida VALIDA minima contra ResultadosCalculoSchema, usada
//    por los 20 tests de solverClient.test.ts (sin cambiar su logica).
//  - `crearParMock`: doble del par { worker, proxy } que inyecta __setFabricaWorker.
//  - `construirResultadosDesdeModeloFEM`: constructor CONSCIENTE DEL MODELO que LEE
//    members/nodes/supports/combos del ModeloFEM recibido y sintetiza un
//    ResultadosCalculo VALIDO con ESOS nombres reales, para que PanelDiagramas
//    (resuelve via trazabilidad.vigaAMember/pilarAMembers) y TablaReacciones (usa
//    modeloFEM.supports + nombres de nodo) RESUELVAN de verdad en los specs E2E.
//
// AISLAMIENTO: este modulo NO arranca Pyodide ni habla con el worker; solo fabrica
// datos JSON-serializables con la FORMA del contrato (resultados.ts). Los numeros
// son ENLATADOS pero plausibles (continuos en extremos, equilibrio aproximado): el
// objetivo es cablear la UI, no reproducir el calculo (eso es PyNite, regla #1).
// =============================================================================

import type { ModeloFEM } from "../discretizador/contratoFEM";
import type { ParWorker } from "./solverClient";
import type {
  ResultadosCalculo,
  EstadoMiembroCombo,
  EstadoNodoCombo,
  EstadoMotor,
  ErrorMotor,
} from "./resultados";

// -----------------------------------------------------------------------------
// RESULTADOS_OK: salida VALIDA minima que acepta ResultadosCalculoSchema.
// La consumen los tests de solverClient (passthrough, safeParse OK, nPoints en
// rango): no necesitan barras/nodos, solo que el esquema valide. `combos` debe ser
// NONEMPTY (de ahi ["ELU"]); barras/nodos vacios son validos (records vacios).
// -----------------------------------------------------------------------------
export const RESULTADOS_OK: ResultadosCalculo = {
  units: "kN-m",
  analysis: { type: "linear", n_points: 11 },
  combos: ["ELU"],
  nodos: {},
  barras: {},
  check_statics: null,
};

// -----------------------------------------------------------------------------
// DOBLE DE WORKER + crearParMock: identico en forma al que vivia en
// solverClient.test.ts, pero SIN `vi` (ver cabecera). El cliente SOLO usa
// worker.terminate y asigna worker.onerror/onmessageerror; el proxy se maneja como
// objeto de metodos asincronos. El cast a ParWorker es seguro porque el cliente
// nunca toca mas de esa superficie.
//
// Tipamos los metodos del proxy de forma laxa (cada uno opcional) para que ambos
// llamadores encajen: el test pasa `vi.fn()` (ReturnType laxo), el mock pasa
// funciones planas. El handle de worker.terminate es `() => void` (en el test puede
// ser un `vi.fn()`, que tambien es asignable).
// -----------------------------------------------------------------------------

/** Doble de worker: terminate (espia o no-op) y handlers onerror/onmessageerror. */
export interface DobleWorker {
  terminate: () => void;
  onerror: ((ev: unknown) => void) | null;
  onmessageerror: ((ev: unknown) => void) | null;
}

// Helper: el proxy real es un `Comlink.Remote<SolverWorkerAPI>`, donde Comlink
// convierte TODO metodo en asincrono. Por eso aceptamos retorno SINCRONO o promesa
// (`T | Promise<T>`): el test pasa funciones `async`, el mock tambien; el cast a
// ParWorker dentro de crearParMock absorbe la diferencia con el tipo Comlink exacto.
type SyncOAsync<T> = T | Promise<T>;

/** Metodos del proxy que `crearParMock` acepta; cada uno opcional (el test/el mock
 *  aportan los que necesitan). Firmas alineadas con la API del worker pero con
 *  retorno SyncOAsync (el proxy Comlink real es siempre async). El cast interno a
 *  ParWorker reconcilia con el tipo Comlink.Remote exacto. */
export interface MetodosProxyMock {
  // calcular: retorno LAXO (unknown) a proposito. El cliente valida la salida con
  // safeParse en el borde, asi que un test puede inyectar un payload MALFORMADO
  // (p. ej. sin `units`) para ejercitar el rechazo Zod; un `ResultadosCalculo` bien
  // formado tambien encaja (es subtipo de unknown).
  calcular?: (modeloFEM: ModeloFEM, nPoints?: number) => SyncOAsync<unknown>;
  precargar?: () => SyncOAsync<void>;
  estado?: () => SyncOAsync<EstadoMotor>;
  error?: () => SyncOAsync<ErrorMotor | null>;
  terminate?: () => void;
}

/** Crea un par { worker, proxy } doble con los metodos de proxy que se le pasen. */
export function crearParMock(metodos: MetodosProxyMock): {
  par: ParWorker;
  worker: DobleWorker;
} {
  const worker: DobleWorker = {
    terminate: metodos.terminate ?? (() => undefined),
    onerror: null,
    onmessageerror: null,
  };
  const proxy = {
    calcular: metodos.calcular ?? (async () => RESULTADOS_OK),
    precargar: metodos.precargar ?? (async () => undefined),
    estado: metodos.estado ?? (async () => "listo" as const),
    error: metodos.error ?? (async () => null),
  };
  // El cliente solo usa worker.terminate y asigna worker.onerror/onmessageerror;
  // el proxy se usa como objeto de metodos asincronos. El cast es seguro para test.
  return { par: { worker, proxy } as unknown as ParWorker, worker };
}

// =============================================================================
// CONSTRUCTOR CONSCIENTE DEL MODELO (decision D7).
//
// Sintetiza un ResultadosCalculo VALIDO leyendo los nombres REALES del ModeloFEM:
//   - combos: nombres de modeloFEM.combos (o "Combo 1" si no hay, como el glue).
//   - barras: una entrada por cada member.name, con diagramas (2, n_points) y la
//     deformada_global (3, n_points), valores enlatados pero CONTINUOS en extremos.
//   - nodos: una entrada por cada nodo de supports (los que TablaReacciones lista),
//     con disp/rxn (6) y EQUILIBRIO plausible: ΣFY de las reacciones ~ carga total.
//
// El objetivo (D7): que PanelDiagramas y TablaReacciones resuelvan de verdad y no
// muestren "sin barra"/vacio en los specs E2E.
// =============================================================================

// n_points enlatado del mock. 2 estaciones bastan para un diagrama valido y para
// que la UI dibuje (extremos), y mantienen el payload pequeno; el schema exige
// exactamente 2 filas de igual longitud y >=2 estaciones en la deformada.
const N_POINTS_MOCK = 2;

// Carga vertical total enlatada (kN) que el mock "reparte" entre los apoyos para un
// equilibrio plausible: las reacciones verticales (FY) suman +CARGA_TOTAL_FY, signo
// correcto (un apoyo empuja hacia ARRIBA contra una carga gravitatoria hacia abajo).
// Valor con decimales no triviales para que el spec happy pueda asertar un numero
// concreto (req del plan) sin ambiguedad con un 0.
const CARGA_TOTAL_FY = 100;

// Magnitudes enlatadas de los esfuerzos por barra (kN, kN·m). Plausibles para un
// portico pequeno; el signo del momento sigue la convencion observada en PyNite
// (UDL gravitatoria -> Mz negativo en el vano, pico en min_moment_z; ver memoria
// feature-5). max_moment_z queda >= 0 y min_moment_z <= 0 para coherencia de extremos.
const AXIL_MOCK = -50; // compresion tipica de un soporte (kN)
const CORTANTE_MOCK = 30; // pico de cortante (kN)
const MOMENTO_PICO_MOCK = -40; // pico de flector en el vano (kN·m, negativo)
const FLECHA_PICO_MOCK = -0.004; // flecha vertical local en el centro (m)

/** Coordenada de un nodo por nombre (para deducir la longitud L de cada barra). */
interface PuntoFEM {
  x: number;
  y: number;
  z: number;
}

/** Longitud de una barra a partir de las coords de sus nodos i/j; >0 siempre. */
function longitudBarra(
  i: string,
  j: string,
  coords: Map<string, PuntoFEM>,
): number {
  const ni = coords.get(i);
  const nj = coords.get(j);
  if (!ni || !nj) return 1; // sin geometria: longitud unidad (no rompe la forma)
  const dx = nj.x - ni.x;
  const dy = nj.y - ni.y;
  const dz = nj.z - ni.z;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return L > 0 ? L : 1; // barra degenerada en el mock -> longitud unidad
}

/**
 * Construye un diagrama (2, n_points): fila 0 = posiciones x en [0, L] uniformes,
 * fila 1 = valores. El valor varia parabolicamente (cero en extremos, `pico` en el
 * centro) para parecer un diagrama de esfuerzos de vano y, sobre todo, ser CONTINUO
 * en los extremos (0 en x=0 y x=L), invariante natural de un diagrama de barra.
 */
function diagramaParabolico(L: number, n: number, pico: number): number[][] {
  const xs: number[] = [];
  const vs: number[] = [];
  for (let k = 0; k < n; k += 1) {
    const t = n === 1 ? 0 : k / (n - 1); // parametro normalizado 0..1
    xs.push(t * L);
    // 4·t·(1-t): 0 en t=0 y t=1, 1 en t=0.5 -> parabola con `pico` en el centro.
    vs.push(pico * 4 * t * (1 - t));
  }
  return [xs, vs];
}

/**
 * Deformada global (3, n_points) = [DX[], DY[], DZ[]] por estacion. Enlatada: DX/DZ
 * nulos y DY parabolico con la flecha de pico en el centro y CERO en los extremos
 * (continuidad estacion-extremo == disp de nudos, que aqui valen 0: nudos fijos en
 * el mock). 3 filas de igual longitud y >=2 estaciones (invariante de DeformadaSchema).
 */
function deformadaGlobal(n: number, flechaPico: number): number[][] {
  const dx: number[] = [];
  const dy: number[] = [];
  const dz: number[] = [];
  for (let k = 0; k < n; k += 1) {
    const t = n === 1 ? 0 : k / (n - 1);
    dx.push(0);
    dy.push(flechaPico * 4 * t * (1 - t)); // 0 en extremos, pico en el centro
    dz.push(0);
  }
  return [dx, dy, dz];
}

/** Esfuerzos enlatados de UNA barra en UNA combinacion (forma EstadoMiembroCombo). */
function estadoBarra(L: number, n: number): EstadoMiembroCombo {
  return {
    axial: diagramaParabolico(L, n, AXIL_MOCK),
    shear_y: diagramaParabolico(L, n, CORTANTE_MOCK),
    moment_z: diagramaParabolico(L, n, MOMENTO_PICO_MOCK),
    defl_y: diagramaParabolico(L, n, FLECHA_PICO_MOCK),
    deformada_global: deformadaGlobal(n, FLECHA_PICO_MOCK),
    // Extremos coherentes con moment_z/shear_y (pico negativo en el vano).
    max_moment_z: 0, // el flector enlatado no es positivo en ningun punto
    min_moment_z: MOMENTO_PICO_MOCK, // pico negativo (kN·m)
    max_shear_y: CORTANTE_MOCK, // pico positivo de cortante (kN)
  };
}

/** Estado enlatado de UN nodo de apoyo en UNA combinacion (disp/rxn de 6). */
function estadoNodo(reaccionFY: number): EstadoNodoCombo {
  return {
    // disp: nudo de apoyo -> desplazamientos ~0 (apoyo restringido). 6 componentes.
    disp: [0, 0, 0, 0, 0, 0],
    // rxn = [FX, FY, FZ, MX, MY, MZ]: solo la vertical FY es no trivial (la que
    // TablaReacciones suma en ΣFY). Signo positivo: el apoyo empuja hacia arriba.
    rxn: [0, reaccionFY, 0, 0, 0, 0],
  };
}

export function construirResultadosDesdeModeloFEM(
  modeloFEM: ModeloFEM,
): ResultadosCalculo {
  // --- Combos reales (NONEMPTY): nombres de modeloFEM.combos -----------------
  // Si el modelo no define combos, replicamos el fallback del glue ("Combo 1")
  // para no violar el .nonempty() del esquema (un E2E siempre traera combos CTE).
  const nombresCombos =
    modeloFEM.combos.length > 0
      ? modeloFEM.combos.map((c) => c.name)
      : ["Combo 1"];

  // --- Coords por nombre de nodo (para deducir la longitud de cada barra) ----
  const coords = new Map<string, PuntoFEM>(
    modeloFEM.nodes.map((n) => [n.name, { x: n.x, y: n.y, z: n.z }]),
  );

  // --- Barras: una entrada por cada member.name, por combo -------------------
  // Asi resolverBarra() de PanelDiagramas (via trazabilidad.vigaAMember /
  // pilarAMembers, que apuntan a member.name) SIEMPRE encuentra su barra.
  const barras: ResultadosCalculo["barras"] = {};
  for (const mb of modeloFEM.members) {
    const L = longitudBarra(mb.i, mb.j, coords);
    const porCombo: Record<string, EstadoMiembroCombo> = {};
    for (const combo of nombresCombos) {
      porCombo[combo] = estadoBarra(L, N_POINTS_MOCK);
    }
    barras[mb.name] = porCombo;
  }

  // --- Nodos: una entrada por cada nodo de supports, por combo ---------------
  // TablaReacciones itera modeloFEM.supports y lee resultados.nodos[node][combo].rxn:
  // una entrada por apoyo basta para que la tabla muestre filas no vacias. Repartimos
  // CARGA_TOTAL_FY a partes iguales entre los apoyos -> ΣFY = +CARGA_TOTAL_FY (equilibrio
  // plausible: las reacciones verticales igualan la carga total, signo correcto).
  const nodosApoyo = modeloFEM.supports.map((s) => s.node);
  const reaccionPorApoyo =
    nodosApoyo.length > 0 ? CARGA_TOTAL_FY / nodosApoyo.length : 0;

  const nodos: ResultadosCalculo["nodos"] = {};
  for (const node of nodosApoyo) {
    const porCombo: Record<string, EstadoNodoCombo> = {};
    for (const combo of nombresCombos) {
      porCombo[combo] = estadoNodo(reaccionPorApoyo);
    }
    nodos[node] = porCombo;
  }

  return {
    units: "kN-m",
    // Eco del tipo de analisis del modelo (default "linear" si llegara "analyze").
    analysis: {
      type: modeloFEM.analysis.type,
      n_points: N_POINTS_MOCK,
    },
    combos: nombresCombos as [string, ...string[]], // garantizado nonempty arriba
    nodos,
    barras,
    check_statics: null, // el mock no calcula equilibrio real
  };
}
