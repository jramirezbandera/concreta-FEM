// EL CORAZON DEL PRODUCTO: discretizar(modelo) traduce la Capa 1 (obra que el
// arquitecto entiende) a la Capa 2 (JSON contrato que consume PyNite). PURO: sin
// React, sin IO, sin Pyodide; ejecutable y testeable en Node. Solo importa de
// ../dominio, ../biblioteca, ../unidades (conversion de borde m->mm),
// ./contratoFEM, ./validaciones y zod.
//
// Invariantes (CLAUDE.md §2, §7):
//  - Unidades internas kN-m. La UNICA conversion admitida es el borde m->mm hacia
//    la biblioteca de secciones parametricas, CENTRALIZADA en `resolverSeccion`.
//  - Determinismo byte a byte: mismo modelo logico (aunque venga reordenado) =>
//    misma Capa 2. Se logra ordenando nodos por (Y,X,Z) y barras por un orden
//    total explicito antes de numerar.
//  - Direcciones de carga (#3, el error nº1): gravedad = GLOBAL `FY` negativo. El
//    signo se decide en UN UNICO punto (`signoGravitatorio`).
//  - Releases canonicos (#8): articulado libera Ry,Rz del extremo; NUNCA se libera
//    Rx (torsion) en ambos extremos (mecanismo torsional). El builder no puede
//    emitir Rxi&&Rxj.
//  - Ejes (#18): planta (x,y) -> global (X,Z); cota/altura -> Y (vertical).

import type {
  Modelo,
  Pilar,
  Pano,
  Carga,
  Hipotesis,
  Planta,
} from "../dominio";
import { plantaPorId, nudoPorId, hipotesisAutomatica } from "../dominio";
import { getMaterial } from "../biblioteca";
import {
  ModeloFEMSchema,
  type ModeloFEM,
  type NodoFEM,
  type MaterialFEM,
  type SeccionFEM,
  type MiembroFEM,
  type ApoyoFEM,
  type QuadFEM,
  type CargaNodoFEM,
  type CargaDistFEM,
  type CargaPuntualFEM,
  type CargaQuadFEM,
  type AnalisisFEM,
  type Trazabilidad,
} from "./contratoFEM";
import { mallarPano, type PuntoPlano } from "./mallado";
import { validarModelo, type ErrorObra, type ContextoModal } from "./validaciones";
import { generarCombos } from "./combinaciones";
// resolverSeccion y las propiedades de barra viven en el modulo hoja
// ./propiedadesBarra (A-dry): el discretizador las consume, no las define. Se
// re-exporta resolverSeccion para no romper imports existentes (index.ts, tests).
import {
  resolverSeccion,
  resolverSeccionFEMPorId,
  propiedadesDePilar,
  propiedadesDeViga,
} from "./propiedadesBarra";
export { resolverSeccion };

// Resultado del discretizador. NO lanza. Tres canales en lenguaje de obra:
//  - ok:true + modeloFEM   => Capa 2 valida lista para el solver.
//  - ok:true + avisos[]     => Capa 2 valida PERO con limitaciones que el codigo
//    trata de forma segura sin perder seguridad estructural (p.ej. arranque
//    elastico calculado como empotrado). No bloquea el calculo; informa al
//    arquitecto. `avisos` puede ser [].
//  - ok:false + errores[]   => no se construye Capa 2. Errores bloqueantes:
//    los de `validarModelo` (refs, sujecion, nombres dup) y los de traduccion que
//    descartarian carga real silenciosamente (carga superficial/no aplicable en F1).
// `trazabilidad` (campo ADITIVO en ok:true): mapa obra<->FEM derivado por el propio
// discretizar() reusando sus mapas internos (sin recalcular geometria). La UI de
// Resultados (feature-14) lo usa para dibujar la deformada y mapear el elemento de
// obra seleccionado a su `member` FEM. No altera el ModeloFEM ni su validacion.
export type ResultadoDiscretizacion =
  | { ok: true; modeloFEM: ModeloFEM; avisos: ErrorObra[]; trazabilidad: Trazabilidad }
  | { ok: false; errores: ErrorObra[] };

// Opciones de calculo TRANSITORIAS de discretizar(). NO se persisten (no son parte
// del Modelo de Capa 1): son parametros del calculo en curso, como `nPoints` de los
// diagramas. Hoy solo portan el camino MODAL (F2b).
//
// `modal`: cuando esta presente, el calculo es un ANALISIS MODAL (camino separado del
// estatico). El Paso 8 emite `analysis.type:"modal"` con `num_modes = modal.numModos`,
// IGNORANDO `modelo.analisis.tipo` (lineal/general/pDelta solo gobiernan el estatico).
// La masa modal NO se emite en Capa 2: la fabrica el glue (add_member_self_weight +
// gravity=9.81), por eso `generarCombos` NO cambia y aqui no hay combo de masa. El
// numero de modos NO se persiste en el Modelo: llega por aqui y se valida (guardas
// MODAL_NUM_MODOS / MODAL_SIN_MASA).
export type DiscretizarOpts = {
  modal?: { numModos: number };
};

// Geometria de snapping (TOL_NODO + mapearEjes + clavePosicion) definida en
// ./geometria (modulo hoja, fuente unica del criterio "mismo nodo") y re-exportada
// aqui para no romper los imports existentes (`from ".../discretizar"` en index.ts
// y los tests). validaciones.ts las toma de ./geometria para evitar el ciclo
// discretizar<->validaciones. Se importan ademas para uso interno (snapping).
import { TOL_NODO, mapearEjes, clavePosicion } from "./geometria";
export { TOL_NODO, mapearEjes, clavePosicion };

// Releases canonicos (#8) en el orden EXACTO de def_releases:
// [Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj].
//  - extremo articulado => liberar Ry,Rz de ESE extremo (rotula de flexion).
//  - tirante (biarticulado, celosia) => los 4 giros de flexion (Ryi,Rzi,Ryj,Rzj).
//  - NUNCA se libera Rx (torsion) en ambos extremos: el indice 3 (Rxi) y el 9
//    (Rxj) JAMAS se ponen a true aqui, por construccion.
//  - ambos empotrados y no tirante => null (barra sin liberar).
export function releasesDeExtremo(
  extremoI: "empotrado" | "articulado",
  extremoJ: "empotrado" | "articulado",
  tirante: boolean,
): boolean[] | null {
  const artI = tirante || extremoI === "articulado";
  const artJ = tirante || extremoJ === "articulado";
  if (!artI && !artJ) return null;
  // Orden: Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj
  return [
    false, false, false, false, artI, artI, // i: solo Ryi,Rzi (nunca Rxi)
    false, false, false, false, artJ, artJ, // j: solo Ryj,Rzj (nunca Rxj)
  ];
}

// Signo gravitatorio de una carga (#3). En F1 toda carga introducida es
// gravitatoria (peso, sobrecarga, cargas muertas), por lo que su efecto es
// DESCENDENTE: signo negativo aplicado a la direccion global FY (Y vertical, #18).
// El valor del dominio se toma en magnitud (Math.abs): el signo lo decide ESTE
// unico punto, no la captura de datos, evitando el error nº1 de doble signo.
export function signoGravitatorio(_carga: Carga, _hipotesis: Hipotesis): number {
  return -1;
}

// --- Estructuras internas del algoritmo --------------------------------------

// Indice de nodos por clave de snapping: clave -> { name, coords }. Se rellena de
// forma determinista (orden de claves por (Y,X,Z)) ANTES de numerar.
type Punto = { clave: string; coord: [number, number, number] };

// Mapea EntradaMaterial del catalogo a MaterialFEM. `rho <- peso`; `fy` solo en
// acero (hormigon no lo lleva). name = id para que el glue Python lo case directo.
function materialFEM(id: string): MaterialFEM | undefined {
  const m = getMaterial(id);
  if (m === undefined) return undefined;
  const base: MaterialFEM = { name: id, E: m.E, G: m.G, nu: m.nu, rho: m.peso };
  if (m.tipo === "acero") base.fy = m.fy;
  return base;
}

// --- Base FEM: geometria + rigidez (factorizada de discretizar) --------------
// Capa 2 BASE = nodos, materiales, secciones, barras, apoyos, releases + la
// trazabilidad completa. Es la parte INDEPENDIENTE de las cargas/combos/analisis:
// `discretizar` la completa con los Pasos 6-8 (cargas de usuario, peso propio, combos,
// analysis); `prepararModeloCR` (F1.1) la reusa SIN cargas (el CR solo necesita
// geometria+rigidez; sus cargas unitarias las fabrica el glue). Factorizar aqui (no
// envolver discretizar) es lo que permite que el CR NO quede bloqueado por validaciones
// de CARGA que no le afectan (Codex #15): este builder no traduce ni valida cargas.
//
// PRESUPONE que las validaciones previas de REFERENCIAS y SUJECION ya pasaron (el
// llamante corre `validarModelo` antes): los `!`/`as Planta`/throw internos son bugs
// internos si fallan, no errores de obra. Es PURO y DETERMINISTA (byte a byte).
//
// `avisosBase` porta los avisos que nacen al construir la base (hoy solo el arranque
// elastico tratado como empotrado): el llamante decide si los expone (discretizar si;
// el CR los ignora). Los artefactos internos (barraPorAmbito, localizarNodoDeNudo,
// nombrePorClave, vigasOrdenadas/pilaresOrdenados) se devuelven para que discretizar
// emita las cargas SIN recalcular geometria.
export type BaseFEM = {
  materials: MaterialFEM[];
  sections: SeccionFEM[];
  nodes: NodoFEM[];
  members: MiembroFEM[];
  supports: ApoyoFEM[];
  trazabilidad: Trazabilidad;
  avisosBase: ErrorObra[];
  // Artefactos internos para el Paso 6/6b (cargas) de discretizar:
  barraPorAmbito: Map<string, string>;
  localizarNodoDeNudo: (nudoId: string) => string | undefined;
  pilaresOrdenados: Pilar[];
  vigasOrdenadas: Modelo["vigas"];
};

export function construirBaseFEM(modelo: Modelo): BaseFEM {
  const avisosBase: ErrorObra[] = [];

  // --- Paso 1: materiales y secciones usados (dedup por id, mapeo directo) ----
  const materialIds = new Set<string>();
  const seccionIds = new Set<string>();
  for (const p of modelo.pilares) {
    materialIds.add(p.materialId);
    seccionIds.add(p.seccionId);
  }
  for (const v of modelo.vigas) {
    materialIds.add(v.materialId);
    seccionIds.add(v.seccionId);
  }
  // Orden alfabetico de ids para salida determinista.
  const materials: MaterialFEM[] = [...materialIds]
    .sort()
    .map((id) => {
      const m = materialFEM(id);
      if (m === undefined) throw new Error(`Material inexistente tras validar: ${id}`);
      return m;
    });
  const sections: SeccionFEM[] = [...seccionIds]
    .sort()
    .map((id) => {
      // Resuelve por id desde la obra O el catalogo de perfiles (misma regla que las
      // validaciones de UI): un perfil de catalogo referenciado por id es valido.
      const s = resolverSeccionFEMPorId(modelo, id);
      if (s === undefined) throw new Error(`Seccion inexistente tras validar: ${id}`);
      return s;
    });

  // --- Paso 2: nodos por snapping determinista --------------------------------
  // Recolecta puntos candidatos (clave + coord) de pilares y vigas, colapsa por
  // clave y numera N1..Nk ordenando por (Y,X,Z).
  const puntosPorClave = new Map<string, Punto>();
  const registrarPunto = (coord: [number, number, number]): string => {
    const clave = clavePosicion(coord, TOL_NODO);
    if (!puntosPorClave.has(clave)) {
      puntosPorClave.set(clave, { clave, coord });
    }
    return clave;
  };

  // Cotas de un pilar pasante: arranque, cabeza y toda planta intermedia cuya cota
  // este entre ambas (se trocea el pilar en nodos por cada planta intermedia para
  // que vigas de plantas intermedias compartan nudo con el pilar). Orden ascendente.
  const cotasDePilar = (p: Pilar): number[] => {
    const pi = plantaPorId(modelo, p.plantaInicial) as Planta;
    const pf = plantaPorId(modelo, p.plantaFinal) as Planta;
    const cMin = Math.min(pi.cota, pf.cota);
    const cMax = Math.max(pi.cota, pf.cota);
    const cotas = new Set<number>([cMin, cMax]);
    for (const planta of modelo.plantas) {
      if (planta.cota > cMin && planta.cota < cMax) cotas.add(planta.cota);
    }
    return [...cotas].sort((a, b) => a - b);
  };

  // Planta a la que pertenece una cota de un pilar, para etiquetar el nudo FEM de esa
  // cota con su planta (trazabilidad `nodoFEMAPlanta`, F0.2, asignacion AUTORITATIVA
  // por contexto de creacion, decision 1A). Reglas:
  //  - Se buscan las plantas cuya `cota` coincide con `c` (la cota deriva de
  //    modelo.plantas via cotasDePilar, asi que SIEMPRE existe al menos una).
  //  - Se PREFIERE una planta del MISMO grupo que el pilar (su grupo lo definen
  //    plantaInicial/plantaFinal): el arranque y la cabeza del pilar, y por extension
  //    sus cotas intermedias dentro del tramo, pertenecen a ese grupo.
  //  - DESEMPATE determinista (mismo grupo o no): la PRIMERA planta por orden canonico
  //    de `id` (min). Independiente del orden de modelo.plantas (determinismo byte a
  //    byte, CLAUDE.md §7).
  // No puede devolver undefined para una cota de pilar (la cota proviene de una planta
  // real); si lo hiciera seria un bug interno y el Paso 1b/validacion lo detecta.
  const gruposDelPilar = (p: Pilar): Set<string> => {
    const grupos = new Set<string>();
    const pi = plantaPorId(modelo, p.plantaInicial);
    const pf = plantaPorId(modelo, p.plantaFinal);
    if (pi !== undefined) grupos.add(pi.grupoId);
    if (pf !== undefined) grupos.add(pf.grupoId);
    return grupos;
  };
  const plantaDeCotaPilar = (p: Pilar, c: number): string | undefined => {
    const grupos = gruposDelPilar(p);
    const enCota = modelo.plantas.filter((pl) => pl.cota === c);
    if (enCota.length === 0) return undefined;
    const preferidas = enCota.filter((pl) => grupos.has(pl.grupoId));
    const candidatas = preferidas.length > 0 ? preferidas : enCota;
    // Min por id (orden canonico) = desempate estable e independiente del orden.
    return candidatas.reduce((min, pl) => (pl.id < min ? pl.id : min), candidatas[0].id);
  };

  // Candidatos de planta por clave de nodo (F0.2): clave de snapping -> conjunto de
  // plantaIds que reclaman ese nudo FEM. Se rellena en las MISMAS pasadas que
  // registran los puntos (pilares y vigas), por su CONTEXTO DE CREACION (la planta de
  // la cota para nudos de pilar; la planta declarada de la viga para sus extremos).
  // Es un Set de candidatos (no una asignacion directa) para resolver de forma
  // determinista el CONFLICTO DE SNAP: dos elementos de plantas DISTINTAS con misma
  // clave (mismo X,Z y misma cota) comparten un unico nudo FEM pero lo reclaman dos
  // plantas. El desempate se aplica DESPUES (min por id), independiente del orden de
  // recorrido => byte a byte estable.
  const candidatosPlantaPorClave = new Map<string, Set<string>>();
  const anotarPlanta = (clave: string, plantaId: string | undefined): void => {
    if (plantaId === undefined) return;
    let set = candidatosPlantaPorClave.get(clave);
    if (set === undefined) {
      set = new Set<string>();
      candidatosPlantaPorClave.set(clave, set);
    }
    set.add(plantaId);
  };

  // Asocia a cada elemento sus claves de nodo (en el orden de la barra) para el
  // paso 3, evitando recalcular geometria.
  const clavesPilar = new Map<string, string[]>(); // pilarId -> claves por cota asc
  for (const p of modelo.pilares) {
    const cotas = cotasDePilar(p);
    const claves = cotas.map((c) => {
      const clave = registrarPunto(mapearEjes(p.x, p.y, c));
      // Cada nudo del pilar (pie, cabeza e intermedios de troceo) -> planta de su cota.
      anotarPlanta(clave, plantaDeCotaPilar(p, c));
      return clave;
    });
    clavesPilar.set(p.id, claves);
  }
  const clavesViga = new Map<string, [string, string]>(); // vigaId -> [claveI, claveJ]
  for (const v of modelo.vigas) {
    const planta = plantaPorId(modelo, v.plantaId) as Planta;
    const ni = nudoPorId(modelo, v.nudoI)!;
    const nj = nudoPorId(modelo, v.nudoJ)!;
    const ci = registrarPunto(mapearEjes(ni.x, ni.y, planta.cota));
    const cj = registrarPunto(mapearEjes(nj.x, nj.y, planta.cota));
    // Ambos extremos de la viga -> su planta DECLARADA (autoritativa, v.plantaId).
    anotarPlanta(ci, v.plantaId);
    anotarPlanta(cj, v.plantaId);
    clavesViga.set(v.id, [ci, cj]);
  }

  // Numeracion determinista: ordena claves unicas por (Y,X,Z) -> N1,N2,...
  const puntosOrdenados = [...puntosPorClave.values()].sort((a, b) => {
    const [ax, ay, az] = a.coord;
    const [bx, by, bz] = b.coord;
    if (ay !== by) return ay - by; // Y (vertical) primero
    if (ax !== bx) return ax - bx; // luego X
    return az - bz; // luego Z
  });
  const nombrePorClave = new Map<string, string>();
  const nodes: NodoFEM[] = puntosOrdenados.map((pt, i) => {
    const name = `N${i + 1}`;
    nombrePorClave.set(pt.clave, name);
    const [x, y, zc] = pt.coord;
    return { name, x, y, z: zc };
  });
  const nodoNombre = (clave: string): string => nombrePorClave.get(clave)!;

  // --- Paso 3: barras ---------------------------------------------------------
  // Orden total explicito: primero pilares, luego vigas; dentro de cada grupo, por
  // el `id` de dominio (orden estable e independiente del orden de entrada). Asi la
  // numeracion M1.. es determinista aunque el modelo llegue reordenado.
  const members: MiembroFEM[] = [];

  // FUENTE UNICA de la numeracion de barras: se rellena MIENTRAS se construyen las
  // barras, no se recomputa despues. ambitoId (vigaId / pilarId) -> nombre de barra.
  // Para un pilar pasante (varios tramos), se mapea su PRIMER tramo (pie): la carga
  // sobre pilar va a ese tramo (comportamiento estable de F1). El Paso 6 lee de aqui,
  // de modo que el orden/troceado de barras y la atribucion de cargas no pueden
  // divergir en silencio.
  const barraPorAmbito = new Map<string, string>();

  // TRAZABILIDAD (campo aditivo): mapas obra<->FEM construidos MIENTRAS se generan
  // las barras, reusando los mapas internos sin recalcular geometria. A diferencia de
  // `barraPorAmbito` (que para un pilar pasante solo guarda el primer tramo, por la
  // atribucion de cargas), `pilarAMembers` acumula TODOS los tramos del pilar.
  const pilarAMembers: Record<string, string[]> = {};
  const vigaAMember: Record<string, string> = {};

  // Pilares: troceados por cota; cada tramo consecutivo es una barra pie->cabeza.
  const pilaresOrdenados = [...modelo.pilares].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Vigas en orden por id para el segundo bloque de la numeracion.
  const vigasOrdenadas = [...modelo.vigas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let contador = 0;
  for (const p of pilaresOrdenados) {
    const claves = clavesPilar.get(p.id)!; // por cota ascendente (pie->cabeza)
    const tramos: string[] = []; // todas las barras de ESTE pilar, pie->cabeza
    for (let k = 0; k < claves.length - 1; k++) {
      contador += 1;
      const name = `M${contador}`;
      tramos.push(name);
      // El primer tramo (k===0, pie) es la barra asociada al ambito del pilar.
      if (k === 0) barraPorAmbito.set(p.id, name);
      members.push({
        name,
        i: nodoNombre(claves[k]),
        j: nodoNombre(claves[k + 1]),
        material: p.materialId,
        section: p.seccionId,
        rotation: p.angulo, // #19: la orientacion del pilar vertical la fija rotation
        tension_only: false,
        comp_only: false,
        releases: null, // F1: los pilares no liberan giros (extremos empotrados)
      });
    }
    pilarAMembers[p.id] = tramos;
  }
  for (const v of vigasOrdenadas) {
    contador += 1;
    const name = `M${contador}`;
    barraPorAmbito.set(v.id, name);
    vigaAMember[v.id] = name;
    const [ci, cj] = clavesViga.get(v.id)!;
    const release = releasesDeExtremo(v.extremoI, v.extremoJ, v.tirante);
    members.push({
      name,
      i: nodoNombre(ci),
      j: nodoNombre(cj),
      material: v.materialId,
      section: v.seccionId,
      rotation: 0,
      tension_only: v.tirante, // tirante = barra que solo trabaja a traccion
      comp_only: false,
      releases: release,
    });
  }

  // --- Paso 4: apoyos ---------------------------------------------------------
  // Pilar con vinculacionExterior aplica un support en su nodo de arranque (la cota
  // MENOR, el pie). empotrado => 6 GDL; articulado => 3 traslaciones; elastico =>
  // se trata como empotrado y se emite un aviso (no hay muelle en F1).
  // Un unico support por nodo compartido (varios pilares en el mismo arranque no
  // duplican el apoyo).
  const supportsPorNodo = new Map<string, ApoyoFEM>();
  for (const p of modelo.pilares) {
    if (!p.vinculacionExterior) continue;
    const claves = clavesPilar.get(p.id)!; // [pie..cabeza] por cota asc
    const claveArranque = claves[0];
    const node = nodoNombre(claveArranque);
    let apoyo: ApoyoFEM;
    if (p.arranque === "articulado") {
      apoyo = { node, DX: true, DY: true, DZ: true, RX: false, RY: false, RZ: false };
    } else {
      // empotrado y elastico -> empotrado (6 GDL).
      apoyo = { node, DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true };
      if (p.arranque === "elastico") {
        avisosBase.push({
          codigo: "ELASTICO_NO_SOPORTADO",
          severidad: "aviso",
          mensaje: `El arranque elástico del pilar "${p.nombre}" aún no se modela: se calcula como empotrado.`,
          elementoId: p.id,
          elementoTipo: "pilar",
        });
      }
    }
    // Un support por nodo: si ya existe, el primero gana (mismo arranque fisico).
    if (!supportsPorNodo.has(node)) supportsPorNodo.set(node, apoyo);
  }
  // Orden determinista por nombre de nodo.
  const supports: ApoyoFEM[] = [...supportsPorNodo.values()].sort((a, b) =>
    a.node < b.node ? -1 : a.node > b.node ? 1 : 0,
  );

  // Localiza el nodo FEM de un nudo de dominio: la viga que lo usa aporta la cota
  // (un Nudo de Capa 1 es {id,x,y} en planta, SIN cota; la cota la pone la planta de
  // la viga, ver dominio/nudo.ts). Itera `vigasOrdenadas` (orden total por id), NO
  // `modelo.vigas` (orden de insercion), para que el resultado sea INDEPENDIENTE del
  // orden de entrada del modelo (determinismo byte a byte, CLAUDE.md §7): afecta a
  // node_loads (carga puntual sobre nudo) y a trazabilidad.nudoANodo (feature-14).
  //
  // DESEMPATE nudo compartido entre plantas: un mismo nudoId puede ser usado por
  // vigas en plantas DISTINTAS (cotas distintas => nodos FEM distintos), y una Carga
  // sobre `ambito=nudoId` no porta planta (el dominio no la modela): es entonces un
  // input ambiguo. Se elige de forma DETERMINISTA y documentada la PRIMERA viga por
  // `id` (orden canonico del discretizador) que use el nudo, y su cota fija el nodo.
  // No se bloquea ni se avisa: en F1 prima determinismo + comportamiento estable y
  // documentado; el caso comun (nudo en UNA sola planta) se resuelve igual que antes
  // (la unica viga que lo usa). Si el dominio modelara la planta del ambito en una
  // fase futura, este desempate dejaria de ser necesario.
  const localizarNodoDeNudo = (nudoId: string): string | undefined => {
    const n = nudoPorId(modelo, nudoId);
    if (n === undefined) return undefined;
    for (const v of vigasOrdenadas) {
      if (v.nudoI === nudoId || v.nudoJ === nudoId) {
        const planta = plantaPorId(modelo, v.plantaId) as Planta;
        const clave = clavePosicion(mapearEjes(n.x, n.y, planta.cota), TOL_NODO);
        const name = nombrePorClave.get(clave);
        if (name !== undefined) return name;
      }
    }
    return undefined;
  };

  // --- Trazabilidad (campo aditivo): completar los mapas que dependen de nodos --
  // pilarAMembers y vigaAMember ya se llenaron en el Paso 3. Aqui se anaden los dos
  // que mapean a NODOS, reusando datos ya calculados (clavesPilar, localizarNodoDeNudo).
  // Orden de insercion determinista: se recorren las colecciones YA ordenadas por id
  // (pilaresOrdenados/vigasOrdenadas), no `modelo.pilares`/`modelo.vigas`, de modo que
  // un modelo reordenado produce la misma trazabilidad byte a byte.
  const pilarANodoArranque: Record<string, string> = {};
  for (const p of pilaresOrdenados) {
    if (!p.vinculacionExterior) continue;
    // Mismo nodo de arranque que el Paso 4 (apoyos): pie = clave de cota menor.
    const claveArranque = clavesPilar.get(p.id)![0];
    pilarANodoArranque[p.id] = nodoNombre(claveArranque);
  }
  const nudoANodo: Record<string, string> = {};
  for (const v of vigasOrdenadas) {
    for (const nudoId of [v.nudoI, v.nudoJ]) {
      if (nudoANodo[nudoId] !== undefined) continue; // ya localizado por otra viga
      const nodo = localizarNodoDeNudo(nudoId);
      if (nodo !== undefined) nudoANodo[nudoId] = nodo;
    }
  }

  // nodoFEMAPlanta (F0.2): nombre de nudo FEM -> plantaId, asignacion AUTORITATIVA por
  // contexto de creacion (decision 1A). Se resuelve cada clave a UNA planta aplicando
  // el desempate del conflicto de snap: la PRIMERA por orden canonico de id (min) entre
  // sus candidatos. Se recorren los nodos YA ordenados (puntosOrdenados, por (Y,X,Z))
  // para un orden de insercion determinista, byte a byte estable e independiente del
  // orden de modelo.pilares/vigas/plantas. Todo nudo de `nodes` DEBE tener candidato:
  // si no, es un BUG INTERNO del discretizador (un nudo se creo sin contexto de planta),
  // no un error de obra; se deja propagar como los otros throw del Paso 1.
  const nodoFEMAPlanta: Record<string, string> = {};
  for (const pt of puntosOrdenados) {
    const candidatos = candidatosPlantaPorClave.get(pt.clave);
    const nombre = nodoNombre(pt.clave);
    if (candidatos === undefined || candidatos.size === 0) {
      throw new Error(`Nudo FEM sin planta asignada (bug interno): ${nombre}`);
    }
    // Min por id = desempate determinista del conflicto de snap (plantas distintas que
    // comparten el mismo nudo). En el caso comun el set tiene un unico candidato.
    let plantaId: string | undefined;
    for (const id of candidatos) {
      if (plantaId === undefined || id < plantaId) plantaId = id;
    }
    nodoFEMAPlanta[nombre] = plantaId!;
  }

  // La trazabilidad de la BASE NO conoce paños (3A: la malla se añade en `discretizar`,
  // DESPUES de `construirBaseFEM`, para que el CR no la vea). Los campos de procedencia
  // de malla nacen vacios aqui; `discretizar` los rellena al mallar los paños.
  const trazabilidad: Trazabilidad = {
    pilarAMembers,
    vigaAMember,
    pilarANodoArranque,
    nudoANodo,
    nodoFEMAPlanta,
    panoAQuads: {},
    quadAPano: {},
    quadANodos: {},
    nodosDeMalla: [],
    apoyosDeMalla: [],
  };

  return {
    materials,
    sections,
    nodes,
    members,
    supports,
    trazabilidad,
    avisosBase,
    barraPorAmbito,
    localizarNodoDeNudo,
    pilaresOrdenados,
    vigasOrdenadas,
  };
}

// --- discretizador -----------------------------------------------------------

export function discretizar(modelo: Modelo, opts?: DiscretizarOpts): ResultadoDiscretizacion {
  // Camino modal (F2b): `opts.modal` => analisis MODAL, separado del estatico. Las
  // validaciones reciben el contexto modal para correr las guardas exclusivas
  // (MODAL_NUM_MODOS, MODAL_SIN_MASA); sin `opts.modal` el comportamiento es identico
  // al estatico (sin regresion). Funcion PURA y determinista en ambos caminos.
  const contextoModal: ContextoModal | undefined =
    opts?.modal !== undefined ? { numModos: opts.modal.numModos } : undefined;

  // Paso 0: validaciones previas, repartidas por SEVERIDAD. Los "error" bloquean
  // (referencias rotas, sin sujecion, nombres dup): no se construye nada. Los
  // "aviso" (hipotesis vacia, nudo flotante) NO impiden calcular: se acumulan en el
  // canal `avisos` del ok:true para no negar el calculo por una limpieza pendiente.
  const erroresPrevios = validarModelo(modelo, contextoModal);
  const bloqueantesPrevios = erroresPrevios.filter((e) => e.severidad === "error");
  if (bloqueantesPrevios.length > 0) {
    return { ok: false, errores: bloqueantesPrevios };
  }

  // Avisos NO bloqueantes: limitaciones que el codigo trata de forma segura (p.ej.
  // arranque elastico -> empotrado) y avisos previos de modelo (COMBO_SIN_CARGAS,
  // FLOTANTE). Se acumulan y se devuelven con ok:true. Distintos de
  // `erroresTraduccion` (bloqueantes, mas abajo).
  const avisos: ErrorObra[] = erroresPrevios.filter((e) => e.severidad === "aviso");

  // Errores BLOQUEANTES de la traduccion: limitaciones que, de ignorarse,
  // descartarian carga real sin que el arquitecto lo sepa (carga superficial/no
  // aplicable en F1). Es mas seguro bloquear el calculo que dar menos carga.
  const erroresTraduccion: ErrorObra[] = [];

  // --- Pasos 1-5: base FEM (geometria + rigidez + trazabilidad) ---------------
  // Factorizada en `construirBaseFEM`: nodos, materiales, secciones, barras, apoyos,
  // releases y la trazabilidad completa. La parte INDEPENDIENTE de las cargas. El CR
  // (prepararModeloCR) reusa esta misma base sin cargas. Aqui se completa con los
  // Pasos 6-8 (cargas de usuario + peso propio + combos + analysis).
  const base = construirBaseFEM(modelo);
  const { materials, sections, nodes, members, supports, barraPorAmbito } = base;
  const { localizarNodoDeNudo, pilaresOrdenados, vigasOrdenadas } = base;
  const { pilarAMembers, vigaAMember } = base.trazabilidad;
  // Avisos nacidos al construir la base (hoy: arranque elastico -> empotrado).
  avisos.push(...base.avisosBase);

  // --- Paso 6: cargas (case = hipotesisId) ------------------------------------
  // (El paso 5, releases, ya quedo resuelto en el paso 3 por barra.)
  // La barra de una carga sobre viga/pilar se lee de `barraPorAmbito` (FUENTE UNICA,
  // construida en el Paso 3): en F1 una viga es una sola barra; un pilar puede ser
  // varias (pasante) y la carga va a su primer tramo (pie). Cargas sobre nudo van a
  // node_loads.
  const node_loads: CargaNodoFEM[] = [];
  const dist_loads: CargaDistFEM[] = [];
  // pt_loads: F1 NO emite cargas puntuales sobre barra. El dominio no tiene posicion
  // para una puntual sobre viga (una puntual en el apoyo no produce flexion y se
  // perderia en silencio), asi que ese caso se BLOQUEA (CARGA_PUNTUAL_SIN_POSICION)
  // mas abajo. CargaPuntualFEM/pt_loads permanecen en el contrato para una fase
  // futura que aporte posicion; aqui se emite siempre vacio.
  const pt_loads: CargaPuntualFEM[] = [];

  // Cargas de presion superficial sobre PAÑOS, recolectadas en el Paso 6 y consumidas
  // por el Paso de paños (mas abajo): { panoId, presion (con signo), case }. La presion
  // se reparte a TODOS los quads del paño (presion uniforme por quad). Se separa del
  // bucle de cargas porque el reparto necesita la malla, que se genera despues de los
  // combos. Determinista: se rellena recorriendo `cargasOrdenadas` (por id).
  type PresionPano = { panoId: string; presion: number; case: string };
  const presionesPorPano: PresionPano[] = [];
  // Indice de paños por id para clasificar el ambito de una carga superficial.
  const panoById = new Map<string, Pano>(modelo.panos.map((pano) => [pano.id, pano]));

  const hipById = new Map<string, Hipotesis>(modelo.hipotesis.map((h) => [h.id, h]));
  // `localizarNodoDeNudo` viene de la base (Pasos 1-5): mismo desempate documentado
  // (primera viga por id) que usa la trazabilidad. Se consume aqui para las cargas
  // nodales sin recalcular geometria.

  // Determinismo byte a byte: emitir las cargas FEM en orden estable, independiente
  // del orden de `modelo.cargas`. Clave de orden = `id` (unico por Carga, garantiza
  // un orden total reproducible); si dos ids coincidieran, no hay desempate posible
  // pero el dominio garantiza ids unicos. El orden de id determina el orden de
  // node_loads/dist_loads/pt_loads.
  const cargasOrdenadas = [...modelo.cargas].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const c of cargasOrdenadas) {
    const hip = hipById.get(c.hipotesisId)!;
    const signo = signoGravitatorio(c, hip);
    const valor = signo * Math.abs(c.valor); // signo en un UNICO punto (#3)
    const caseName = c.hipotesisId;

    if (c.tipo === "superficial") {
      // F3: una carga superficial sobre un PAÑO LOSA SE TRADUCE a presion en sus quads
      // (ya no bloquea: el bloqueo PANO_NO_SOPORTADO de F1 se levanta aqui). El reparto
      // a los quads ocurre en el Paso de paños (necesita la malla). SIGNO: la presion de
      // quad NO usa `valor` (que lleva el signo FY-negativo de las barras): con el orden
      // de nudos i→j→m→n CCW una presion POSITIVA empuja hacia ABAJO (gravedad), opuesto
      // a la convencion de barras. Se emite POSITIVA = magnitud de la carga gravitatoria.
      const pano = panoById.get(c.ambito);
      if (pano === undefined) {
        // Carga superficial sobre algo que NO es un paño (p.ej. una viga): no aplicable.
        // BLOQUEA: ignorarla quitaria carga real del calculo sin avisar.
        erroresTraduccion.push({
          codigo: "CARGA_NO_APLICABLE",
          severidad: "error",
          mensaje: `Una carga de superficie está aplicada sobre un elemento que no es un paño.`,
          elementoId: c.id,
          elementoTipo: "carga",
        });
        continue;
      }
      presionesPorPano.push({ panoId: pano.id, presion: Math.abs(c.valor), case: caseName });
      continue;
    }

    // El ambito puede ser una viga, un pilar (barra) o un nudo.
    const member = barraPorAmbito.get(c.ambito);
    if (c.tipo === "lineal") {
      if (member === undefined) {
        // Carga lineal sobre algo que no es barra (p.ej. un nudo): no aplicable.
        // BLOQUEA: ignorarla quitaria carga real del calculo sin avisar.
        erroresTraduccion.push({
          codigo: "CARGA_NO_APLICABLE",
          severidad: "error",
          mensaje: `Una carga lineal está aplicada sobre un elemento que no es una barra.`,
          elementoId: c.id,
          elementoTipo: "carga",
        });
        continue;
      }
      // Gravedad: direccion GLOBAL FY (#3, #18). Toda la barra (x1=x2=null).
      dist_loads.push({
        member,
        direction: "FY",
        w1: valor,
        w2: valor,
        x1: null,
        x2: null,
        case: caseName,
      });
    } else {
      // puntual
      if (member !== undefined) {
        // Sobre BARRA (viga o pilar): F1 no tiene posicion para la puntual. Aplicarla
        // en el extremo i (x=0) la pone sobre el apoyo, donde no produce flexion: la
        // carga "desaparece" estructuralmente sin que el arquitecto lo sepa. BLOQUEA.
        erroresTraduccion.push({
          codigo: "CARGA_PUNTUAL_SIN_POSICION",
          severidad: "error",
          mensaje: `Una carga puntual sobre una viga necesita una posición; aplícala sobre un punto (nudo) o espera a una versión posterior.`,
          elementoId: c.id,
          elementoTipo: "carga",
        });
        continue;
      } else {
        // Sobre nudo: node_load. Se localiza el nodo FEM por la clave del nudo de
        // dominio (su xy + la cota de alguna viga que lo use). Si no se puede
        // localizar, se avisa.
        const nodo = localizarNodoDeNudo(c.ambito);
        if (nodo === undefined) {
          // BLOQUEA: ignorarla quitaria carga real del calculo sin avisar.
          erroresTraduccion.push({
            codigo: "CARGA_NO_APLICABLE",
            severidad: "error",
            mensaje: `Una carga puntual está aplicada sobre un punto que no forma parte de ninguna barra.`,
            elementoId: c.id,
            elementoTipo: "carga",
          });
          continue;
        }
        node_loads.push({ node: nodo, direction: "FY", P: valor, case: caseName });
      }
    }
  }

  // --- Paso 6b: peso propio automatico (F2a) ----------------------------------
  // Si `incluirPesoPropio` esta activo, se emite el peso propio de cada barra como
  // carga distribuida en la hipotesis automatica `hip-peso-propio` (#3, #18):
  //   w = A·rho (kN/m), direccion GLOBAL FY NEGATIVA (gravedad, vertical Y).
  // Es ENSAMBLADO DE CARGA (no `add_member_self_weight` del solver): puro,
  // golden-testable y visible en "Ver modelo de calculo". PyNite integra w sobre la
  // longitud real de cada barra, de modo que para una viga horizontal produce
  // flexion y para un pilar vertical produce axil (la carga global se proyecta sobre
  // el eje de la barra): es correcto, no hace falta distinguir aqui.
  //
  // Se emite UNA carga por CADA member (todos los tramos de un pilar pasante, no solo
  // el pie): el peso es de toda la barra. Orden determinista: pilares ordenados por
  // id (con sus tramos pie->cabeza) y luego vigas ordenadas por id, el mismo orden de
  // numeracion de `members`, de modo que la salida es byte a byte estable.
  // El `case` es el id de la hipotesis AUTOMATICA hallada por su flag (no el literal
  // ID_HIP_PESO_PROPIO): asi id y flag no pueden desincronizarse. Guard E1
  // (validaciones.ts) garantiza que existe cuando el flag esta activo; aqui solo se
  // consume (en modelos sembrados normalmente su id ES ID_HIP_PESO_PROPIO).
  if (modelo.analisis.incluirPesoPropio) {
    const casePesoPropio = hipotesisAutomatica(modelo)!.id;
    for (const p of pilaresOrdenados) {
      const props = propiedadesDePilar(modelo, p);
      const w = -(props.A * props.rho); // w=A·rho; signo negativo = gravedad (FY-)
      for (const member of pilarAMembers[p.id]) {
        dist_loads.push({
          member,
          direction: "FY",
          w1: w,
          w2: w,
          x1: null,
          x2: null,
          case: casePesoPropio,
        });
      }
    }
    for (const v of vigasOrdenadas) {
      const props = propiedadesDeViga(modelo, v);
      const w = -(props.A * props.rho);
      dist_loads.push({
        member: vigaAMember[v.id],
        direction: "FY",
        w1: w,
        w2: w,
        x1: null,
        x2: null,
        case: casePesoPropio,
      });
    }
  }

  // --- Paso 6c: paños LOSA (F3, mallado AISLADO) ------------------------------
  // DESPUES de `construirBaseFEM` (decision 3A): la malla NO entra en la base, de modo
  // que el centro de rigidez (que reusa `construirBaseFEM` via `prepararModeloCR`) NO ve
  // los quads. Por cada paño tipo "losa" se malla (mallado.ts, AISLADO: nudos PROPIOS,
  // sin snapping al portico), y se acumulan en arrays SEPARADOS: nudos de malla, quads,
  // apoyos de borde + estabilizacion, y cargas de presion (superficial de usuario +
  // peso propio de la losa). Solo se emiten en la Capa 2 SI hay quads (regresion: un
  // portico de barras no lleva claves quads/quad_loads). Determinista: paños ordenados
  // por id; cada paño numera sus nudos/quads con un prefijo propio (PQ<idx>).
  //
  // Las validaciones previas (validarRefsPano) ya garantizaron tipo "losa", material/
  // planta/nudos validos, tamMalla>0 y geometria rectangular: aqui el mallado no puede
  // fallar por obra (un { ok:false } seria un bug interno, se deja propagar como throw).
  const meshNodes: NodoFEM[] = [];
  const quads: QuadFEM[] = [];
  const meshSupportsPorNodo = new Map<string, ApoyoFEM>();
  const quad_loads: CargaQuadFEM[] = [];
  const panoAQuads: Record<string, string[]> = {};
  const quadAPano: Record<string, string> = {};
  const quadANodos: Record<string, [string, string, string, string]> = {};
  const nodosDeMalla: string[] = [];
  const apoyosDeMalla = new Set<string>();
  const avisosPano: ErrorObra[] = [];
  // Materiales de paños que el portico NO referencia: deben anadirse a `materials`
  // (PyNite resuelve el material del quad por nombre). El espesor va en el quad (`t`),
  // no en una SeccionFEM (que es 1D), asi que NO se anaden secciones por paño.
  const materialIdsPano = new Set<string>();

  // Paños ordenados por id: el indice posicional fija el prefijo de nombres (PQ<idx>),
  // independiente del orden de entrada (determinismo byte a byte, CLAUDE.md §7).
  const panosOrdenados = [...modelo.panos].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  // Presiones de usuario agrupadas por paño (mantienen el orden de cargasOrdenadas).
  const presionesDePano = (panoId: string): PresionPano[] =>
    presionesPorPano.filter((pp) => pp.panoId === panoId);
  // Hipotesis automatica (peso propio): mismo `case` que el peso propio de barras.
  const casePesoPropioPano =
    modelo.analisis.incluirPesoPropio ? hipotesisAutomatica(modelo)!.id : undefined;

  panosOrdenados.forEach((pano, indicePano) => {
    if (pano.tipo !== "losa") return; // reticular/unidireccional ya bloqueados en validaciones
    materialIdsPano.add(pano.materialId);
    const planta = plantaPorId(modelo, pano.plantaId) as Planta;
    const puntos: PuntoPlano[] = pano.perimetro.map((nudoId) => {
      const n = nudoPorId(modelo, nudoId)!;
      return { x: n.x, y: n.y };
    });
    const res = mallarPano({
      perimetro: puntos as [PuntoPlano, PuntoPlano, PuntoPlano, PuntoPlano],
      cota: planta.cota,
      tamMalla: pano.tamMalla,
      indicePano,
    });
    if (!res.ok) {
      // Bug interno: las validaciones previas garantizan geometria mallable. Propaga.
      throw new Error(`Mallado de paño fallo tras validar: ${pano.id} (${res.error.codigo})`);
    }
    const malla = res.malla;

    // Aviso de cap (4A): si el mallado engroso la malla para respetar el limite de quads.
    if (malla.capAplicado) {
      avisosPano.push({
        codigo: "PANO_MALLA_LIMITADA",
        severidad: "aviso",
        mensaje: `El paño "${pano.nombre}" se ha mallado con elementos más grandes de lo pedido para no exceder el límite de cálculo.`,
        elementoId: pano.id,
        elementoTipo: "pano",
      });
    }

    // Nudos PROPIOS del paño -> nodes (y marca de procedencia para la UI).
    for (const nd of malla.nodos) {
      meshNodes.push({ name: nd.name, x: nd.x, y: nd.y, z: nd.z });
      nodosDeMalla.push(nd.name);
    }

    // Quads + trazabilidad (panoAQuads / quadAPano / quadANodos).
    const quadNames: string[] = [];
    for (const q of malla.quads) {
      quads.push({
        name: q.name,
        i: q.i,
        j: q.j,
        m: q.m,
        n: q.n,
        t: pano.espesor,
        material: pano.materialId,
      });
      quadNames.push(q.name);
      quadAPano[q.name] = pano.id;
      quadANodos[q.name] = [q.i, q.j, q.m, q.n];
    }
    panoAQuads[pano.id] = quadNames;

    // Apoyos de borde segun bordeApoyo (propiedad de OBRA, no jerga FEM):
    //   simple    -> DY (impide la flecha vertical): losa simplemente apoyada.
    //   empotrado -> DY + giros de placa (RX,RZ, en el plano horizontal): encastre.
    //                NO se restringe RY (giro alrededor de la vertical): es el GDL
    //                "drilling" del quad, sin rigidez fisica; restringirlo no aporta.
    //   libre     -> sin apoyo de borde (voladizo / apoyado en otros bordes).
    const acumularApoyo = (node: string, gdl: Partial<ApoyoFEM>): void => {
      const previo = meshSupportsPorNodo.get(node);
      const base0: ApoyoFEM = previo ?? {
        node,
        DX: false,
        DY: false,
        DZ: false,
        RX: false,
        RY: false,
        RZ: false,
      };
      meshSupportsPorNodo.set(node, {
        node,
        DX: base0.DX || gdl.DX === true,
        DY: base0.DY || gdl.DY === true,
        DZ: base0.DZ || gdl.DZ === true,
        RX: base0.RX || gdl.RX === true,
        RY: base0.RY || gdl.RY === true,
        RZ: base0.RZ || gdl.RZ === true,
      });
      apoyosDeMalla.add(node);
    };
    if (pano.bordeApoyo !== "libre") {
      for (const node of malla.nodosBorde) {
        if (pano.bordeApoyo === "empotrado") {
          acumularApoyo(node, { DY: true, RX: true, RZ: true });
        } else {
          acumularApoyo(node, { DY: true }); // simple
        }
      }
    }
    // Estabilizacion en el plano (anti-singular): DX/DZ en 2 nudos NO colineales del
    // borde. SIEMPRE (independiente de bordeApoyo): una losa apoyada solo en vertical
    // tiene 3 modos de cuerpo rigido en el plano X-Z (la matriz seria singular). NO
    // contamina la flexion (no toca DY ni RX/RZ). Acumula sobre el apoyo de borde del
    // mismo nudo si lo hubiera.
    for (const e of malla.estabilizacion) {
      acumularApoyo(e.node, { DX: e.DX, DZ: e.DZ });
    }

    // Cargas de presion del paño -> quad_loads (presion uniforme repartida a TODOS sus
    // quads). Orden determinista: por carga (presionesDePano respeta cargasOrdenadas) y
    // dentro de cada carga por quad (orden del mallado). Peso propio al final.
    for (const pp of presionesDePano(pano.id)) {
      for (const q of malla.quads) {
        quad_loads.push({ quad: q.name, presion: pp.presion, case: pp.case });
      }
    }
    // Peso propio de la losa (F2a, espejo del peso propio de barras): presion ρ·t
    // (kN/m²) hacia ABAJO en la hipotesis automatica. ρ = peso especifico del material
    // (kN/m³), t = espesor (m). SIGNO: la presion de quad sigue la convencion OPUESTA a
    // la FY de barras (alli gravedad = FY negativa); con el orden de nudos i→j→m→n CCW,
    // una presion POSITIVA empuja la placa hacia ABAJO (verificado contra el motor real:
    // presion +q → DY_centro < 0). Por eso el peso propio es +ρ·t, NO −ρ·t.
    if (casePesoPropioPano !== undefined) {
      const material = getMaterial(pano.materialId);
      if (material === undefined) {
        throw new Error(`Material de paño inexistente tras validar: ${pano.materialId}`);
      }
      const presionPP = material.peso * pano.espesor; // ρ·t, POSITIVA = hacia abajo
      for (const q of malla.quads) {
        quad_loads.push({ quad: q.name, presion: presionPP, case: casePesoPropioPano });
      }
    }
  });

  avisos.push(...avisosPano);

  // --- Paso 7: combinaciones (delegado a ./combinaciones) ----------------------
  // ELU persistente = 1,35·permanentes + 1,50·variables; ELS caracteristica =
  // 1,00·todas. Los coeficientes gamma provienen de la biblioteca (CTE DB-SE Tabla
  // 4.1, verificada) y la logica vive en `generarCombos` (modulo puro, testeable en
  // aislamiento). En F1 hay una unica variable dominante, sin termino psi0 (eso es
  // F2). Ver `combinaciones.ts` para la justificacion normativa (CTE DB-SE §4.2.2).
  const combos = generarCombos(modelo);

  // --- Paso 8: analisis -------------------------------------------------------
  // Camino MODAL (F2b): si `opts.modal` esta presente, el analisis es modal,
  // IGNORANDO `modelo.analisis.tipo` (lineal/general/pDelta gobiernan solo el camino
  // estatico). Se emite `type:"modal"` + `num_modes` (de opts.modal.numModos, ya
  // validado >0). `check_statics:false`: el analisis modal no comprueba equilibrio
  // por combo (no hay combo estatico que comprobar). La masa NO se emite en Capa 2:
  // la fabrica el glue (add_member_self_weight + gravity=9.81); no hay combo de masa.
  //
  // Camino ESTATICO (sin opts.modal): mapeo `tipo` (Capa 1) -> AnalisisFEM.type, 3 ramas:
  //   lineal -> linear   (analisis lineal de primer orden)
  //   general -> analyze (analisis general; geometria de primer orden)
  //   pDelta -> PDelta   (P-Delta de balanceo a nivel nudo; lo ejecuta el glue con
  //                       analyze_PDelta). En P-Delta el glue ignora check_statics
  //                       (no hace comprobacion de equilibrio); el forzado a false
  //                       bajo P-Delta vive en el glue (F2.2/E6), no aqui.
  let analysis: AnalisisFEM;
  if (contextoModal !== undefined) {
    analysis = {
      type: "modal",
      check_statics: false,
      num_modes: contextoModal.numModos,
    };
  } else {
    const tipoAnalisis: AnalisisFEM["type"] =
      modelo.analisis.tipo === "lineal"
        ? "linear"
        : modelo.analisis.tipo === "general"
          ? "analyze"
          : "PDelta";
    analysis = {
      type: tipoAnalisis,
      check_statics: modelo.analisis.comprobarEstatica,
    };
  }

  // Si la traduccion encontro errores BLOQUEANTES (carga superficial/no aplicable),
  // se devuelven como errores de obra (ok:false). El arquitecto los ve en lenguaje
  // de obra y corrige antes de calcular: nunca se calcula con menos carga real.
  if (erroresTraduccion.length > 0) {
    return { ok: false, errores: erroresTraduccion };
  }

  // --- Trazabilidad (campo aditivo): la base la construye `construirBaseFEM` (Pasos
  // 1-5), independiente de las cargas. Aqui se COMPLETA con la procedencia de la malla
  // de paños (2A): panoAQuads/quadAPano/quadANodos + nodosDeMalla/apoyosDeMalla, que la
  // base dejo vacios (la malla nace en este Paso 6c, fuera de la base). PURA y
  // determinista. `apoyosDeMalla` se ordena para una salida estable.
  const trazabilidad: Trazabilidad = {
    ...base.trazabilidad,
    panoAQuads,
    quadAPano,
    quadANodos,
    nodosDeMalla,
    apoyosDeMalla: [...apoyosDeMalla].sort(),
  };

  // Nudos y apoyos finales: primero los ESTRUCTURALES (portico, ya ordenados de forma
  // determinista por construirBaseFEM) y DESPUES los de la MALLA de paños (en su orden
  // determinista: paño por id, nudos del mallado). Asi un modelo SIN paños produce
  // exactamente los mismos `nodes`/`supports` que antes (regresion byte-a-byte) y la
  // malla queda claramente segregada al final.
  // Materiales finales: los del portico (base) MAS los de paños que no estuvieran ya
  // referenciados por barras (PyNite resuelve el material del quad por nombre, asi que
  // debe existir en `materials`). Determinista: se anaden por orden alfabetico de id,
  // detras de los del portico, sin duplicar. Si no hay material de paño nuevo, es el
  // mismo array que antes (regresion byte-a-byte de la Capa 2 de un portico).
  const materialIdsBase = new Set(materials.map((m) => m.name));
  const materialesPanoNuevos: MaterialFEM[] = [...materialIdsPano]
    .filter((id) => !materialIdsBase.has(id))
    .sort()
    .map((id) => {
      const m = materialFEM(id);
      if (m === undefined) throw new Error(`Material de paño inexistente tras validar: ${id}`);
      return m;
    });
  const materialsFinal: MaterialFEM[] =
    materialesPanoNuevos.length > 0 ? [...materials, ...materialesPanoNuevos] : materials;

  const nodesFinal: NodoFEM[] = meshNodes.length > 0 ? [...nodes, ...meshNodes] : nodes;
  const meshSupports = [...meshSupportsPorNodo.values()].sort((a, b) =>
    a.node < b.node ? -1 : a.node > b.node ? 1 : 0,
  );
  const supportsFinal: ApoyoFEM[] =
    meshSupports.length > 0 ? [...supports, ...meshSupports] : supports;

  const modeloFEM: ModeloFEM = {
    units: "kN-m",
    nodes: nodesFinal,
    materials: materialsFinal,
    sections,
    members,
    supports: supportsFinal,
    node_loads,
    dist_loads,
    pt_loads,
    combos,
    analysis,
  };
  // quads / quad_loads SOLO si hay paños (decision: claves OPCIONALES). Un portico de
  // barras NO lleva esas claves -> Capa 2 byte-identica a antes (regresion). Los
  // consumidores leen `quads ?? []`.
  if (quads.length > 0) {
    modeloFEM.quads = quads;
  }
  if (quad_loads.length > 0) {
    modeloFEM.quad_loads = quad_loads;
  }

  // --- Paso 9: validacion de salida -------------------------------------------
  // Si esto lanza, es un BUG INTERNO del discretizador (no un error de obra): la
  // Capa 2 que construimos no cumple su propio contrato. Se deja propagar.
  const validado = ModeloFEMSchema.parse(modeloFEM);
  return { ok: true, modeloFEM: validado, avisos, trazabilidad };
}

// Re-export de conveniencia para el llamante.
export type { ModeloFEM };
