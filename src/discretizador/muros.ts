// Emision PURA de los MUROS/pantallas a Capa 2 (F3, muros). Traduce la malla de cada
// muro (ya computada por el pre-pase `calcularAcoples`) a nudos + quads + apoyos de
// base, con el remap por celda al portico. MODULO HOJA con DOS llamantes:
//   - `discretizar` (Paso 6e): añade ademas el peso propio nodal (aqui solo se
//     preparan los tributarios `pesosPropios`; el case lo decide el llamante).
//   - `prepararModeloCR` (F3-muros, revision de la decision 3A): la base del CR
//     lleva la malla de MUROS (su rigidez de membrana ES la rigidez lateral que el
//     CR mide) pero NO la de losas (el diafragma se impone; la placa horizontal no
//     aporta al CR). Compartir esta emision garantiza que el CR y el calculo
//     estatico ven EXACTAMENTE el mismo muro.
//
// Reglas de emision (espejo del Paso 6c de losa, con las diferencias del muro):
//   - Remap SIEMPRE activo (sin umbral >=2): cada nudo de malla cuya CELDA 3D tiene
//     un N* estructural se FUSIONA con el (mismo criterio [M-4] del snapping global:
//     dos puntos en la misma celda = mismo nudo). La whitelist `nodosAcoplados` del
//     acople actua de red anti-bug: un nudo whitelisted SIN N* en su celda es un bug
//     interno (throw), nunca un error de obra.
//   - Fusion MURO<->MURO (nucleos en L/T): dos muros que comparten celda (columna de
//     extremo comun) comparten nudo; el primero por orden de id gana el nombre.
//     Filas intermedias con tamMalla distinto NO se fusionan (solo cotas de planta
//     coinciden por construccion) — deuda T-muro-malla-desalineada.
//   - Apoyos de BASE: con `vinculacionExterior`, la fila base se empotra 6 GDL por
//     nudo (espejo del arranque empotrado de pilar; el spike P3 verifico que el GDL
//     de drilling restringido es inocuo: reaccion parasita = 0.0). Sobre el nombre
//     FINAL (un N* compartido se fusiona por OR aguas arriba). SIN estabilizacion
//     DX/DZ de losa: la base 6 GDL ya fija los modos rigidos; sin base, validaciones
//     exige acople suficiente (MURO_SIN_SUJECION).
//   - Peso propio: NUNCA presion de superficie (la normal del muro es HORIZONTAL);
//     se preparan tributarios nodales W/4 por quad (`pesosPropios`) que el Paso 6e
//     emite como node_loads FY negativas. Verificado en el spike P5 (SumaV exacta) y
//     SIN doble conteo con la masa modal del glue (case __masa_modal__ separado).
//
// PURO y determinista: muros por id, nudos/quads en el orden del mallado.
import type { Modelo } from "../dominio";
import { getMaterial } from "../biblioteca";
import { TOL_NODO, clavePosicion, cuantizar } from "./geometria";
import type { ResultadoAcoples } from "./acople";
import type { NodoFEM, QuadFEM, ApoyoFEM } from "./contratoFEM";

// Resultado de la emision de TODOS los muros del modelo. Vacio (arrays/mapas
// vacios) si no hay muros: el llamante no añade ni un byte (regresion).
export type EmisionMuros = {
  // Nudos PROPIOS (MQ<idx>-N*) no fusionados con el portico ni con otro muro.
  nodes: NodoFEM[];
  // Quads de muro con nombres de nudo FINALES (N* donde hubo fusion).
  quads: QuadFEM[];
  // Apoyos de fila base (6 GDL) acumulados por nudo FINAL (OR): el llamante los
  // fusiona con el resto de supports (def_support ASIGNA: nunca dos entradas por nudo).
  supportsPorNodo: Map<string, ApoyoFEM>;
  // Ids de material de muro que el llamante debe garantizar en `materials`.
  materialIds: Set<string>;
  // Trazabilidad (espejo panoAQuads/quadAPano) + campos compartidos con la losa.
  muroAQuads: Record<string, string[]>;
  quadAMuro: Record<string, string>;
  quadANodos: Record<string, [string, string, string, string]>;
  // Nudos de malla PROPIOS (para Trazabilidad.nodosDeMalla).
  nodosDeMalla: string[];
  // Nudos PROPIOS con apoyo de base (para Trazabilidad.apoyosDeMalla). Un N*
  // estructural con apoyo de base de muro NO entra aqui: su reaccion se presenta
  // como estructural (ocultarla escamotearia la reaccion del pilar fusionado).
  apoyosDeMalla: string[];
  // Peso propio por quad: nudos FINALES + peso total W = rho*t*area (kN). El Paso 6e
  // lo emite como node_loads FY = -W/4 por nudo si incluirPesoPropio; el CR lo ignora.
  pesosPropios: { nodos: [string, string, string, string]; w: number }[];
  // plantaId -> nudos FINALES (dedup, orden lexicografico) de las filas de muro en la
  // cota de esa planta. Lo consume `prepararModeloCR` para incluir el muro en el
  // diafragma de cada planta (union con nodoFEMAPlanta, dedup alli). Dos plantas a la
  // misma cota: gana la de menor id (espejo de plantaDeCotaPilar).
  nodosMuroPorPlanta: Record<string, string[]>;
};

export function emitirMuros(
  modelo: Modelo,
  acoples: ResultadoAcoples,
  nombrePorClave: ReadonlyMap<string, string>,
): EmisionMuros {
  const nodes: NodoFEM[] = [];
  const quads: QuadFEM[] = [];
  const supportsPorNodo = new Map<string, ApoyoFEM>();
  const materialIds = new Set<string>();
  const muroAQuads: Record<string, string[]> = {};
  const quadAMuro: Record<string, string> = {};
  const quadANodos: Record<string, [string, string, string, string]> = {};
  const nodosDeMalla: string[] = [];
  const apoyosDeMalla: string[] = [];
  const pesosPropios: { nodos: [string, string, string, string]; w: number }[] = [];
  const nodosPorPlanta = new Map<string, Set<string>>();

  // Fusion muro<->muro por celda: celda 3D -> nombre PROPIO ya emitido por un muro
  // anterior (por orden de id). El portico (nombrePorClave) tiene precedencia.
  const nombrePorCeldaEmitida = new Map<string, string>();

  // Planta "dueña" de cada cota (cuantizada): la de MENOR id entre las que comparten
  // cota (espejo exacto del desempate de plantaDeCotaPilar / nodoFEMAPlanta).
  const plantaPorQCota = new Map<number, string>();
  const plantasOrdenadas = [...modelo.plantas].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const pl of plantasOrdenadas) {
    const q = cuantizar(pl.cota);
    if (!plantaPorQCota.has(q)) plantaPorQCota.set(q, pl.id);
  }

  const murosOrdenados = [...modelo.muros].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  murosOrdenados.forEach((muro, indiceMuro) => {
    const acople = acoples.porMuro.get(muro.id);
    if (acople === undefined) {
      // Cap del planificador: validaciones lo bloqueo como MURO_DEMASIADO_DENSO; si
      // el llamante llega aqui (no deberia: es un error bloqueante), se salta limpio.
      if (acoples.erroresMalladoMuro.has(muro.id)) return;
      // Muro mallable ausente de ambos mapas = bug interno (las validaciones ya
      // bloquearon refs/geometria invalidas antes de llamar a la emision).
      throw new Error(`Acople de muro ausente tras validar: ${muro.id}`);
    }
    if (acople.indiceMuro !== indiceMuro) {
      throw new Error(
        `Indice de muro desalineado (bug interno): ${muro.id} (${acople.indiceMuro} != ${indiceMuro})`,
      );
    }
    materialIds.add(muro.materialId);
    const malla = acople.malla;
    const material = getMaterial(muro.materialId);
    if (material === undefined) {
      throw new Error(`Material de muro inexistente tras validar: ${muro.materialId}`);
    }

    // --- Resolucion del nombre FINAL de cada nudo de malla -----------------------
    // Precedencia: N* del portico (fusion estructural) > nudo de OTRO muro en la
    // celda (nucleos L/T) > nudo propio nuevo. La whitelist del acople es la red
    // anti-bug: un nudo acoplado DEBE encontrar su N*.
    const nombreFinalPorNudo = new Map<string, string>();
    for (const nd of malla.nodos) {
      const clave = clavePosicion([nd.x, nd.y, nd.z], TOL_NODO);
      const estructural = nombrePorClave.get(clave);
      if (estructural !== undefined) {
        nombreFinalPorNudo.set(nd.name, estructural);
        continue;
      }
      if (acople.nodosAcoplados.has(nd.name)) {
        // El N* SIEMPRE existe para un nudo acoplado: la viga se subdividio en esa
        // celda, el pilar nace de cotasDePilar, el extremo de viga es nudo de obra.
        throw new Error(`Nudo de muro acoplado sin nodo estructural (bug interno): ${nd.name}`);
      }
      const previo = nombrePorCeldaEmitida.get(clave);
      if (previo !== undefined) {
        nombreFinalPorNudo.set(nd.name, previo); // fusion con un muro anterior
        continue;
      }
      nombreFinalPorNudo.set(nd.name, nd.name);
      nombrePorCeldaEmitida.set(clave, nd.name);
      nodes.push({ name: nd.name, x: nd.x, y: nd.y, z: nd.z });
      nodosDeMalla.push(nd.name);
    }
    const nombreFinal = (name: string): string => nombreFinalPorNudo.get(name)!;

    // --- Quads + trazabilidad (nombres FINALES; el orden canonico no se altera) --
    // El mallado emite fila-major (k = fila*nx + col): se recorre igual para derivar
    // el area de cada quad de ss/cotas sin recomputar geometria 3D.
    const quadNames: string[] = [];
    for (let k = 0; k < malla.quads.length; k++) {
      const q = malla.quads[k];
      const col = k % malla.nx;
      const fila = Math.floor(k / malla.nx);
      const [qi, qj, qm, qn] = [
        nombreFinal(q.i),
        nombreFinal(q.j),
        nombreFinal(q.m),
        nombreFinal(q.n),
      ] as [string, string, string, string];
      quads.push({
        name: q.name,
        i: qi,
        j: qj,
        m: qm,
        n: qn,
        t: muro.espesor,
        material: muro.materialId,
      });
      quadNames.push(q.name);
      quadAMuro[q.name] = muro.id;
      quadANodos[q.name] = [qi, qj, qm, qn];

      // Peso propio tributario del quad: W = rho * t * area (kN), con el area del
      // plano (s x cota). El signo (FY negativa) y el case los pone el Paso 6e.
      const area =
        (malla.ss[col + 1] - malla.ss[col]) * (malla.cotas[fila + 1] - malla.cotas[fila]);
      pesosPropios.push({
        nodos: [qi, qj, qm, qn],
        w: material.peso * muro.espesor * area,
      });
    }
    muroAQuads[muro.id] = quadNames;

    // --- Apoyos de fila BASE (vinculacionExterior): 6 GDL por nudo FINAL ---------
    if (muro.vinculacionExterior) {
      for (const nombre of malla.porFila[0]) {
        const final = nombreFinal(nombre);
        supportsPorNodo.set(final, {
          node: final,
          DX: true,
          DY: true,
          DZ: true,
          RX: true,
          RY: true,
          RZ: true,
        });
        // Solo los nudos PROPIOS se agregan como "apoyo de malla" (la TablaReacciones
        // los agrupa); un N* estructural conserva su presentacion propia.
        if (final === nombre) apoyosDeMalla.push(final);
      }
    }

    // --- Nudos del muro por planta (para el diafragma del CR) --------------------
    for (const [qCotaFila, fila] of malla.filaPorCotaQ) {
      const plantaId = plantaPorQCota.get(qCotaFila);
      if (plantaId === undefined) continue; // fila intermedia sin planta
      let setPlanta = nodosPorPlanta.get(plantaId);
      if (setPlanta === undefined) {
        setPlanta = new Set();
        nodosPorPlanta.set(plantaId, setPlanta);
      }
      for (const nombre of malla.porFila[fila]) setPlanta.add(nombreFinal(nombre));
    }
  });

  // Emision determinista del mapa por planta (ids de planta y nombres ordenados).
  const nodosMuroPorPlanta: Record<string, string[]> = {};
  for (const plantaId of [...nodosPorPlanta.keys()].sort()) {
    nodosMuroPorPlanta[plantaId] = [...nodosPorPlanta.get(plantaId)!].sort();
  }

  return {
    nodes,
    quads,
    supportsPorNodo,
    materialIds,
    muroAQuads,
    quadAMuro,
    quadANodos,
    nodosDeMalla,
    apoyosDeMalla,
    pesosPropios,
    nodosMuroPorPlanta,
  };
}
