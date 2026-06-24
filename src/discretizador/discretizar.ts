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
  Carga,
  Hipotesis,
  Seccion,
  Planta,
} from "../dominio";
import { plantaPorId, nudoPorId, seccionPorId } from "../dominio";
import { getMaterial, seccionRectangular, seccionCircular, getSeccion } from "../biblioteca";
import { mToMm } from "../unidades";
import {
  ModeloFEMSchema,
  type ModeloFEM,
  type NodoFEM,
  type MaterialFEM,
  type SeccionFEM,
  type MiembroFEM,
  type ApoyoFEM,
  type CargaNodoFEM,
  type CargaDistFEM,
  type CargaPuntualFEM,
  type AnalisisFEM,
  type Trazabilidad,
} from "./contratoFEM";
import { validarModelo, type ErrorObra } from "./validaciones";
import { generarCombos } from "./combinaciones";

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

// Resuelve las propiedades de calculo (A,Iy,Iz,J) de una seccion de obra. Es el
// UNICO lugar donde ocurre la conversion de borde m->mm: el dominio persiste
// dimensiones en m, pero `seccionRectangular`/`seccionCircular` de la biblioteca
// reciben mm. Se convierte aqui con `mToMm`, justo al cruzar el borde, y en ningun
// otro sitio de la logica.
export function resolverSeccion(seccion: Seccion): SeccionFEM {
  switch (seccion.tipo) {
    case "perfilMetalico": {
      const perfil = getSeccion(seccion.perfilId);
      if (perfil === undefined) {
        // No deberia ocurrir: validaciones (REF_SECCION) ya garantiza que el
        // perfilId existe en el catalogo antes de llegar aqui. Si pasa, es un bug
        // interno, no un error de obra.
        throw new Error(`Perfil de catalogo inexistente: ${seccion.perfilId}`);
      }
      return { name: seccion.id, A: perfil.A, Iy: perfil.Iy, Iz: perfil.Iz, J: perfil.J };
    }
    case "hormigonRectangular": {
      // Borde m->mm: la biblioteca espera mm y convierte a m internamente.
      const e = seccionRectangular(mToMm(seccion.b), mToMm(seccion.h));
      return { name: seccion.id, A: e.A, Iy: e.Iy, Iz: e.Iz, J: e.J };
    }
    case "hormigonCircular": {
      const e = seccionCircular(mToMm(seccion.d));
      return { name: seccion.id, A: e.A, Iy: e.Iy, Iz: e.Iz, J: e.J };
    }
    case "generico":
      // Propiedades directas en m (sistema interno), sin biblioteca ni conversion.
      return { name: seccion.id, A: seccion.A, Iy: seccion.Iy, Iz: seccion.Iz, J: seccion.J };
  }
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

// --- discretizador -----------------------------------------------------------

export function discretizar(modelo: Modelo): ResultadoDiscretizacion {
  // Paso 0: validaciones previas, repartidas por SEVERIDAD. Los "error" bloquean
  // (referencias rotas, sin sujecion, nombres dup): no se construye nada. Los
  // "aviso" (hipotesis vacia, nudo flotante) NO impiden calcular: se acumulan en el
  // canal `avisos` del ok:true para no negar el calculo por una limpieza pendiente.
  const erroresPrevios = validarModelo(modelo);
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
      const s = seccionPorId(modelo, id);
      if (s === undefined) throw new Error(`Seccion inexistente tras validar: ${id}`);
      return resolverSeccion(s);
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

  // Asocia a cada elemento sus claves de nodo (en el orden de la barra) para el
  // paso 3, evitando recalcular geometria.
  const clavesPilar = new Map<string, string[]>(); // pilarId -> claves por cota asc
  for (const p of modelo.pilares) {
    const cotas = cotasDePilar(p);
    const claves = cotas.map((c) => registrarPunto(mapearEjes(p.x, p.y, c)));
    clavesPilar.set(p.id, claves);
  }
  const clavesViga = new Map<string, [string, string]>(); // vigaId -> [claveI, claveJ]
  for (const v of modelo.vigas) {
    const planta = plantaPorId(modelo, v.plantaId) as Planta;
    const ni = nudoPorId(modelo, v.nudoI)!;
    const nj = nudoPorId(modelo, v.nudoJ)!;
    const ci = registrarPunto(mapearEjes(ni.x, ni.y, planta.cota));
    const cj = registrarPunto(mapearEjes(nj.x, nj.y, planta.cota));
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
        avisos.push({
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

  const hipById = new Map<string, Hipotesis>(modelo.hipotesis.map((h) => [h.id, h]));

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
      // Paños (reparto de areas tributarias) son F3; en F1 no se traduce. BLOQUEA:
      // descartarla silenciosamente daria un calculo con menos carga de la real.
      erroresTraduccion.push({
        codigo: "PANO_NO_SOPORTADO",
        severidad: "error",
        mensaje: `Las cargas de superficie (paños) aún no se calculan en esta fase.`,
        elementoId: c.id,
        elementoTipo: "carga",
      });
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

  // --- Paso 7: combinaciones (delegado a ./combinaciones) ----------------------
  // ELU persistente = 1,35·permanentes + 1,50·variables; ELS caracteristica =
  // 1,00·todas. Los coeficientes gamma provienen de la biblioteca (CTE DB-SE Tabla
  // 4.1, verificada) y la logica vive en `generarCombos` (modulo puro, testeable en
  // aislamiento). En F1 hay una unica variable dominante, sin termino psi0 (eso es
  // F2). Ver `combinaciones.ts` para la justificacion normativa (CTE DB-SE §4.2.2).
  const combos = generarCombos(modelo);

  // --- Paso 8: analisis -------------------------------------------------------
  const analysis: AnalisisFEM = {
    type: modelo.analisis.tipo === "lineal" ? "linear" : "analyze",
    check_statics: modelo.analisis.comprobarEstatica,
  };

  // Si la traduccion encontro errores BLOQUEANTES (carga superficial/no aplicable),
  // se devuelven como errores de obra (ok:false). El arquitecto los ve en lenguaje
  // de obra y corrige antes de calcular: nunca se calcula con menos carga real.
  if (erroresTraduccion.length > 0) {
    return { ok: false, errores: erroresTraduccion };
  }

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
  const trazabilidad: Trazabilidad = {
    pilarAMembers,
    vigaAMember,
    pilarANodoArranque,
    nudoANodo,
  };

  const modeloFEM: ModeloFEM = {
    units: "kN-m",
    nodes,
    materials,
    sections,
    members,
    supports,
    node_loads,
    dist_loads,
    pt_loads,
    combos,
    analysis,
  };

  // --- Paso 9: validacion de salida -------------------------------------------
  // Si esto lanza, es un BUG INTERNO del discretizador (no un error de obra): la
  // Capa 2 que construimos no cumple su propio contrato. Se deja propagar.
  const validado = ModeloFEMSchema.parse(modeloFEM);
  return { ok: true, modeloFEM: validado, avisos, trazabilidad };
}

// Re-export de conveniencia para el llamante.
export type { ModeloFEM };
