// Deteccion PURA del ACOPLE paño<->portico (F3 corte 2). Responde, sin efectos y
// de forma determinista, a dos preguntas que el discretizador necesita ANTES de
// construir la base FEM:
//   1. ¿Que nudos de BORDE de la malla de cada paño caen sobre una viga del
//      contorno? (esos nudos se REMAPEAN a nudos estructurales N* en el Paso 6c:
//      compartir nudo = acople FEM natural, PyNite ensambla K global por nudo).
//   2. ¿En que puntos hay que SUBDIVIDIR cada viga para que exista un nudo N* en
//      cada posicion intermedia de la malla? (un member de PyNite solo conecta en
//      sus extremos: sin subdivision, los nudos intermedios del borde no tocarian
//      la viga y la losa no descargaria en el portico).
//
// MODULO HOJA: importa solo ../dominio, ./geometria y ./mallado (sin ciclos: NO
// importa discretizar.ts ni validaciones.ts, que son sus consumidores). PURO: sin
// React, sin IO, sin Pyodide; ejecutable y testeable en Node.
//
// Criterio geometrico = cuantizacion por celda de ./geometria (cuantizar /
// clavePosicion), NUNCA distancia euclidea |Δ|<TOL: es el MISMO criterio del
// snapping de nodos del Paso 2, de modo que "acoplado" aqui y "mismo nodo" alli
// no pueden divergir ([AUDITORIA M-4]).
//
// --- Reglas de acople (plan F3.2, revision OV-2) -------------------------------
//  - Viga de CONTORNO de una arista: misma cota (cuantizada) que la planta del
//    paño, colineal con la arista (ambos extremos sobre su recta, cuantizado) y
//    con solape > TOL_NODO. Se EXCLUYEN los tirantes (subdividir un biarticulado
//    tension-only crearia tramos con rotulas interiores = mecanismo; TODO-4) y las
//    vigas diagonales o de otras cotas.
//  - Nudo de borde ACOPLADO: su coordenada a lo largo de la arista cae dentro del
//    segmento de alguna viga de contorno (extremos INCLUIDOS: las esquinas del
//    paño remapean al nudo de obra existente).
//  - Subdivision de una viga: nudos de borde ESTRICTAMENTE interiores a su
//    segmento (los extremos ya son nudos N*). UNION sobre todos los paños que la
//    tocan, dedup por clave de celda, orden por distancia a nudoI.
//  - Activacion tecnica del remap: >=2 nudos de borde acoplados. Con 0-1 el paño
//    se DEGRADA a aislado (corte 1 intacto: ni remap ni subdivisiones); con
//    exactamente 1, validaciones emite el aviso PANO_ACOPLE_INSUFICIENTE.
//  - `bordesCompletos` (OV-2): nº de aristas cuyo TODOS los nudos de borde estan
//    acoplados (via una viga de esta arista o de la adyacente, en las esquinas).
//    Gobierna la relajacion de PANO_SIN_APOYO: una losa "libre" solo se sostiene
//    si al menos un borde COMPLETO descansa sobre vigas (dos esquinas sueltas NO
//    son un apoyo).
//
// `calcularAcoples` NUNCA lanza: un paño no mallable (refs rotas, geometria no
// rectangular, tamMalla invalido) simplemente se salta (queda fuera de `porPano`);
// quien lo reporta en lenguaje de obra es validarRefsPano, como en el corte 1.

import type { Modelo, Pano, Pilar } from "../dominio";
import { plantaPorId, nudoPorId } from "../dominio";
import { TOL_NODO, clavePosicion, mapearEjes, cuantizar } from "./geometria";
import {
  mallarPano,
  limitesRectangulo,
  type LimitesRectangulo,
  type MallaPano,
  type PuntoPlano,
  type ErrorMallado,
} from "./mallado";

type Viga = Modelo["vigas"][number];

// Resultado del acople de UN paño losa mallable.
export type AcoplePano = {
  // Malla YA computada (mallarPano con el MISMO indicePano que usara el Paso 6c):
  // el discretizador la reutiliza para no mallar dos veces.
  malla: MallaPano;
  // Indice posicional del paño en modelo.panos ordenados por id (fija el prefijo
  // PQ<idx> de los nombres de la malla; debe coincidir con el del Paso 6c).
  indicePano: number;
  // Nombres de nudos de la malla (borde) que caen sobre una viga de contorno: el
  // Paso 6c los remapea a nudos estructurales N* en vez de emitirlos como PQ*.
  nodosAcoplados: ReadonlySet<string>;
  // >=2 nudos acoplados: el remap se activa (y la estabilizacion de plano se
  // omite: el portico ya sujeta la losa en su plano). Con false, el paño queda
  // AISLADO exactamente como en el corte 1.
  acopleActivo: boolean;
  // Hay nudos de BORDE acoplados Y sin acoplar a la vez (parte del borde descansa
  // en vigas y parte en el bordeApoyo elegido). Gobierna el aviso PANO_BORDE_PARCIAL.
  // [F2.0/RESERVA-4] Se evalua SOLO sobre `malla.nodosBorde ∩ nodosAcoplados`, NUNCA
  // sobre `nodosAcoplados.size` (que ahora incluye cabezas de pilar interiores).
  bordeParcial: boolean;
  // Nº de aristas del rectangulo (0..4) con TODOS sus nudos de borde acoplados.
  // Gobierna la relajacion de PANO_SIN_APOYO (OV-2): "libre" exige >=1. Vive sobre
  // los nombres de borde (nombresPorArista): una cabeza de pilar interior nunca cuenta.
  bordesCompletos: number;
  // --- NUEVO F2.0 (losa plana sobre pilares) --------------------------------
  // Pilares interiores acoplados a ESTE paño: su cabeza cae en un nudo de malla que
  // el Paso 6c remapea a su N*. Ordenados por id. VACIO en el corte 2 (sin lineas de
  // control) y en el caso 1-pilar (RESERVA-1: volcado SOLO bajo `acopleActivo`, espejo
  // del volcado condicional de `subsDelPano`). Lo consume validaciones.ts para NO
  // emitir PANO_PILAR_INTERIOR sobre ellos. INVARIANTE: length>0 ⇒ acopleActivo.
  pilaresAcoplados: readonly string[];
};

export type ResultadoAcoples = {
  // Solo paños LOSA mallables (refs y geometria validas). Un paño ausente aqui se
  // trata como aislado/invalido; sus errores los reporta validarRefsPano.
  porPano: Map<string, AcoplePano>;
  // vigaId -> puntos de subdivision (x,y de obra), UNION sobre todos los paños con
  // acople activo, dedup por celda, ordenados por distancia a nudoI de la viga.
  // Las coordenadas son las MISMAS que emite mallarPano para el nudo de borde
  // correspondiente: la clave de celda del punto y la del nudo coinciden por
  // construccion (el remap del Paso 6c depende de ello).
  subdivisionesViga: Map<string, PuntoPlano[]>;
  // --- NUEVO F2.0 (losa plana sobre pilares) --------------------------------
  // Paños losa cuya malla NO se pudo construir por el cap de lineas de control
  // (PANO_DEMASIADOS_PILARES): antes mallarPano fallaba y el paño se saltaba en
  // silencio; ahora se superficia para que validaciones lo emita como error de obra.
  // XOR con `porPano`: un paño losa mallable esta en `porPano`, uno con cap esta aqui,
  // nunca en ambos. Recorrido en orden de id de paño (determinismo). Clave = panoId.
  erroresMallado: Map<string, ErrorMallado>;
  // panoId -> pares de pilarId interiores cuyas cabezas caen en la MISMA celda 2D de
  // la malla (`clavePosicion(mapearEjes(x,y,cota),TOL_NODO)` coincidente): reclamarian
  // el mismo nudo de malla, colision de acople silenciosa. `acople.ts` DETECTA, lo
  // EMITE validaciones.ts (PANO_PILARES_JUNTOS). Cada par [a,b] con a<b (id menor
  // primero); pares ordenados; paños en orden de id. NUNCA dedup por eje 1D ni |Δ|<TOL.
  pilaresJuntos: Map<string, [string, string][]>;
};

// --- Helpers internos ----------------------------------------------------------

// Una arista del rectangulo del paño: direccion a lo largo ("x" = varia obra-x),
// valor de la coordenada perpendicular (fija) y rango a lo largo.
type Arista = { eje: "x" | "y"; fijo: number; desde: number; hasta: number };

// Orden fijo y documentado (espejo del recorrido de nodosBorde del mallado):
// inferior, derecha, superior, izquierda. El orden solo afecta al orden de
// descubrimiento (los resultados finales se ordenan aparte).
function aristasDe(l: LimitesRectangulo): Arista[] {
  return [
    { eje: "x", fijo: l.yMin, desde: l.xMin, hasta: l.xMax }, // inferior
    { eje: "y", fijo: l.xMax, desde: l.yMin, hasta: l.yMax }, // derecha
    { eje: "x", fijo: l.yMax, desde: l.xMin, hasta: l.xMax }, // superior
    { eje: "y", fijo: l.xMin, desde: l.yMin, hasta: l.yMax }, // izquierda
  ];
}

// Resuelve el perimetro de un paño a 4 puntos de obra, o undefined si no es
// resoluble (referencias rotas / nº de nudos distinto de 4). Compartido por
// calcularAcoples y los detectores de elementos interiores.
function puntosPerimetro(
  modelo: Modelo,
  pano: Pano,
): [PuntoPlano, PuntoPlano, PuntoPlano, PuntoPlano] | undefined {
  if (pano.perimetro.length !== 4) return undefined;
  const puntos: PuntoPlano[] = [];
  for (const nudoId of pano.perimetro) {
    const n = nudoPorId(modelo, nudoId);
    if (n === undefined) return undefined;
    puntos.push({ x: n.x, y: n.y });
  }
  return puntos as [PuntoPlano, PuntoPlano, PuntoPlano, PuntoPlano];
}

// Limites del rectangulo de un paño losa (o undefined si no es mallable). Fuente
// unica: limitesRectangulo del mallado.
function limitesDePano(modelo: Modelo, pano: Pano): LimitesRectangulo | undefined {
  const puntos = puntosPerimetro(modelo, pano);
  if (puntos === undefined) return undefined;
  const limites = limitesRectangulo(puntos);
  return "codigo" in limites ? undefined : limites;
}

// Clave de celda de un punto de obra EN PLANTA (cota 0): dedup de subdivisiones.
// La cota no participa (las vigas candidatas ya se filtraron por cota cuantizada).
function claveEnPlanta(p: PuntoPlano): string {
  return clavePosicion(mapearEjes(p.x, p.y, 0), TOL_NODO);
}

// Clave de celda 3D de una posicion de obra (x,y) a una cota concreta. Es el MISMO
// criterio que usa el remap del Paso 6c para casar cabeza de pilar <-> N* y que usa
// el mallado para colocar el nudo de la linea de control. FUENTE UNICA del "mismo
// nudo de malla" entre acople y discretizar; nunca |Δ|<TOL (F2.0, RESERVA-2, [M-4]).
function claveCabeza(x: number, y: number, cota: number): string {
  return clavePosicion(mapearEjes(x, y, cota), TOL_NODO);
}

// --- calcularAcoples -----------------------------------------------------------

export function calcularAcoples(modelo: Modelo): ResultadoAcoples {
  const porPano = new Map<string, AcoplePano>();
  // Paños losa cuya malla no se pudo construir por el cap (PANO_DEMASIADOS_PILARES).
  const erroresMallado = new Map<string, ErrorMallado>();
  // panoId -> pares de pilares interiores en la misma celda 2D (junta a bloquear).
  const pilaresJuntos = new Map<string, [string, string][]>();
  // vigaId -> (clave de celda -> {punto, t}). El primer punto de una celda gana
  // (orden de descubrimiento determinista: paños por id, aristas en orden fijo,
  // vigas por id); los siguientes caen en la misma celda = mismo nodo FEM.
  const subsPorViga = new Map<string, Map<string, { punto: PuntoPlano; t: number }>>();

  // Mismo orden posicional que el Paso 6c de discretizar: TODOS los paños por id
  // (el indice cuenta tambien los no-losa, que alli se saltan igual).
  const panosOrdenados = [...modelo.panos].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  // Vigas candidatas por id (orden estable para el descubrimiento de subdivisiones)
  // con sus extremos y cota ya resueltos; una viga con refs rotas se salta (la
  // reporta validarRefsViga).
  type VigaResuelta = { viga: Viga; ni: PuntoPlano; nj: PuntoPlano; qCota: number };
  const vigasResueltas: VigaResuelta[] = [];
  const vigasOrdenadas = [...modelo.vigas].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const v of vigasOrdenadas) {
    if (v.tirante) continue; // TODO-4: los tirantes no se acoplan ni subdividen
    const planta = plantaPorId(modelo, v.plantaId);
    const ni = nudoPorId(modelo, v.nudoI);
    const nj = nudoPorId(modelo, v.nudoJ);
    if (planta === undefined || ni === undefined || nj === undefined) continue;
    vigasResueltas.push({
      viga: v,
      ni: { x: ni.x, y: ni.y },
      nj: { x: nj.x, y: nj.y },
      qCota: cuantizar(planta.cota),
    });
  }

  panosOrdenados.forEach((pano, indicePano) => {
    if (pano.tipo !== "losa") return;
    if (!(Number.isFinite(pano.tamMalla) && pano.tamMalla > 0)) return;
    const planta = plantaPorId(modelo, pano.plantaId);
    if (planta === undefined) return;
    const puntos = puntosPerimetro(modelo, pano);
    if (puntos === undefined) return;
    const limites = limitesRectangulo(puntos);
    if ("codigo" in limites) return;

    // --- Lineas de control desde las cabezas de pilar interiores (losa plana) ---
    // Fuente unica: pilaresInterioresBajoPano (ya filtra a estrictamente interior +
    // cota alcanzada + ordenado por id). Las coords se pasan REALES a mallarPano (el
    // mallado las emite EXACTAS) para que el nudo de malla case con el N* del pilar
    // (que nace de p.x/p.y reales). Dedup por celda cuantizada (dos pilares en la MISMA
    // X colapsan a UNA linea de control X; cada uno tendra su nudo por su Y). Sin
    // pilares interiores -> listas VACIAS -> camino de mallado uniforme byte-identico.
    const pilaresInteriores = pilaresInterioresBajoPano(modelo, pano);
    const lineasControlX = dedupPorCelda(pilaresInteriores.map((p) => p.x));
    const lineasControlY = dedupPorCelda(pilaresInteriores.map((p) => p.y));

    // Deteccion de PILARES JUNTOS: dos cabezas en la MISMA celda 2D (clave coincidente)
    // reclamarian el mismo nudo de malla (colision de acople silenciosa). Se detecta
    // ANTES de mallar y se acumula por paño (validaciones.ts EMITE PANO_PILARES_JUNTOS).
    const juntosDelPano = detectarPilaresJuntos(pilaresInteriores, planta.cota);
    if (juntosDelPano.length > 0) pilaresJuntos.set(pano.id, juntosDelPano);

    const res = mallarPano({
      perimetro: puntos,
      cota: planta.cota,
      tamMalla: pano.tamMalla,
      indicePano,
      lineasControlX,
      lineasControlY,
    });
    if (!res.ok) {
      // Cap de lineas de control (PANO_DEMASIADOS_PILARES): antes se perdia en
      // silencio; ahora se superficia para que validaciones lo emita en obra. El paño
      // queda FUERA de porPano (XOR con erroresMallado). Otros codigos no deberian
      // ocurrir (limites ya OK); se registran igual por robustez (siempre error de obra).
      erroresMallado.set(pano.id, res.error);
      return;
    }
    const malla = res.malla;

    const qCotaPano = cuantizar(planta.cota);
    const vigasEnCota = vigasResueltas.filter((vr) => vr.qCota === qCotaPano);

    // Nudos de borde con sus coordenadas de OBRA (nd.x = obra-x, nd.z = obra-y).
    const bordeSet = new Set(malla.nodosBorde);
    const nodosBorde = malla.nodos.filter((nd) => bordeSet.has(nd.name));

    const nodosAcoplados = new Set<string>();
    // Nudos por arista (para bordesCompletos, tras conocer el acople global).
    const nombresPorArista: string[][] = [];
    // Subdivisiones candidatas de ESTE paño (se vuelcan solo si acopleActivo).
    const subsDelPano: { vigaId: string; punto: PuntoPlano; t: number }[] = [];

    for (const arista of aristasDe(limites)) {
      const qFijo = cuantizar(arista.fijo);
      // Nudos de la malla sobre esta arista (igualdad cuantizada de la perpendicular).
      const nodosArista = nodosBorde
        .filter((nd) => cuantizar(arista.eje === "x" ? nd.z : nd.x) === qFijo)
        .map((nd) => ({
          name: nd.name,
          along: arista.eje === "x" ? nd.x : nd.z,
          punto: { x: nd.x, y: nd.z } as PuntoPlano,
        }));
      nombresPorArista.push(nodosArista.map((n) => n.name));

      // Vigas de contorno de esta arista: colineales (perpendicular cuantizada) y
      // con solape real (> TOL_NODO) con el rango de la arista.
      const vigasArista = vigasEnCota
        .filter((vr) => {
          const perpI = arista.eje === "x" ? vr.ni.y : vr.ni.x;
          const perpJ = arista.eje === "x" ? vr.nj.y : vr.nj.x;
          if (cuantizar(perpI) !== qFijo || cuantizar(perpJ) !== qFijo) return false;
          const alongI = arista.eje === "x" ? vr.ni.x : vr.ni.y;
          const alongJ = arista.eje === "x" ? vr.nj.x : vr.nj.y;
          const a = Math.min(alongI, alongJ);
          const b = Math.max(alongI, alongJ);
          return Math.min(b, arista.hasta) - Math.max(a, arista.desde) > TOL_NODO;
        })
        .map((vr) => {
          const alongI = arista.eje === "x" ? vr.ni.x : vr.ni.y;
          const alongJ = arista.eje === "x" ? vr.nj.x : vr.nj.y;
          return {
            vr,
            qA: cuantizar(Math.min(alongI, alongJ)),
            qB: cuantizar(Math.max(alongI, alongJ)),
          };
        });

      for (const nodo of nodosArista) {
        const qAlong = cuantizar(nodo.along);
        for (const va of vigasArista) {
          // Acoplado: dentro del segmento de la viga, extremos INCLUIDOS.
          if (qAlong >= va.qA && qAlong <= va.qB) {
            nodosAcoplados.add(nodo.name);
            // Subdivision: ESTRICTAMENTE interior (los extremos ya son N*).
            if (qAlong > va.qA && qAlong < va.qB) {
              const t = Math.hypot(nodo.punto.x - va.vr.ni.x, nodo.punto.y - va.vr.ni.y);
              subsDelPano.push({ vigaId: va.vr.viga.id, punto: nodo.punto, t });
            }
          }
        }
      }
    }

    // Completitud por arista: TODOS sus nudos acoplados (una esquina puede venir
    // acoplada por la viga de la arista ADYACENTE: sigue atada al portico). Vive sobre
    // `nombresPorArista` (solo nombres de BORDE): una cabeza de pilar interior anadida
    // a `nodosAcoplados` mas abajo nunca cuenta como "arista completa" (RESERVA-4).
    let bordesCompletos = 0;
    for (const nombres of nombresPorArista) {
      if (nombres.length > 0 && nombres.every((n) => nodosAcoplados.has(n))) {
        bordesCompletos += 1;
      }
    }

    // [RESERVA-4] bordeParcial ANTES de anadir las cabezas: es una propiedad del BORDE
    // (parte del contorno sobre vigas, parte no). Se calcula sobre `malla.nodosBorde ∩
    // nodosAcoplados`, NUNCA sobre `nodosAcoplados.size` (que a continuacion se infla con
    // las cabezas de pilar interiores). En este punto `nodosAcoplados` es solo borde.
    let bordeAcopladoCount = 0;
    for (const n of malla.nodosBorde) if (nodosAcoplados.has(n)) bordeAcopladoCount += 1;
    const bordeParcial =
      bordeAcopladoCount > 0 && bordeAcopladoCount < malla.nodosBorde.length;

    // --- Union de las cabezas de pilar interiores a nodosAcoplados (borde ∪ cabezas) ---
    // Mapa clave de celda 2D -> nombre de nudo de malla (a la cota del paño). Cada cabeza
    // de pilar interior tiene un nudo EXACTO en su celda (garantia de las lineas de
    // control + construirEjeRejilla). Match por clave = mismo criterio que el remap 6c.
    const nombrePorCeldaMalla = new Map<string, string>();
    for (const nd of malla.nodos) nombrePorCeldaMalla.set(clavePosicion([nd.x, nd.y, nd.z], TOL_NODO), nd.name);
    // Pilares cuya cabeza SI tiene nudo de malla: candidatos a acople (su nudo entra en
    // nodosAcoplados para contar hacia size>=2). Si NO hay nudo (linea saneada fuera, o
    // cap que engroso): el pilar NO se acopla -> cae a PANO_PILAR_INTERIOR aguas abajo.
    // Nunca se fuerza un acople sin nudo.
    const pilaresConNudo: string[] = [];
    for (const p of pilaresInteriores) {
      const nombre = nombrePorCeldaMalla.get(claveCabeza(p.x, p.y, planta.cota));
      if (nombre === undefined) continue;
      nodosAcoplados.add(nombre);
      pilaresConNudo.push(p.id);
    }

    // acopleActivo cuenta ahora tambien las cabezas (borde ∪ cabezas). Con 2 pilares
    // interiores no coincidentes (sin vigas): size==2 -> activo. Con 1 solo pilar:
    // size==1 -> inactivo -> BLOQUEO por DP1 (pilaresAcoplados quedara []).
    const acopleActivo = nodosAcoplados.size >= 2;

    // [RESERVA-1] Volcado CONDICIONAL a acopleActivo (espejo de subsDelPano): solo si el
    // paño resulta acoplado se declaran los pilares como acoplados. Asi pilaresAcoplados
    // refleja el remap REAL emitido (el 6c mira acopleActivo), no el potencial. En el
    // caso 1-pilar (!acopleActivo) queda [] y PANO_PILAR_INTERIOR sigue disparando (DP1).
    // Ordenado por id (pilaresInteriores ya viene ordenado, se preserva).
    const pilaresAcoplados: string[] = acopleActivo ? pilaresConNudo : [];

    if (acopleActivo) {
      for (const sub of subsDelPano) {
        let porClave = subsPorViga.get(sub.vigaId);
        if (porClave === undefined) {
          porClave = new Map();
          subsPorViga.set(sub.vigaId, porClave);
        }
        const clave = claveEnPlanta(sub.punto);
        if (!porClave.has(clave)) {
          porClave.set(clave, { punto: sub.punto, t: sub.t });
        }
      }
    }

    porPano.set(pano.id, {
      malla,
      indicePano,
      nodosAcoplados,
      acopleActivo,
      bordeParcial,
      bordesCompletos,
      pilaresAcoplados,
    });
  });

  // Emision final determinista: vigas por id; puntos por distancia a nudoI.
  const subdivisionesViga = new Map<string, PuntoPlano[]>();
  const vigaIds = [...subsPorViga.keys()].sort();
  for (const vigaId of vigaIds) {
    const puntos = [...subsPorViga.get(vigaId)!.values()]
      .sort((a, b) => a.t - b.t)
      .map((s) => s.punto);
    subdivisionesViga.set(vigaId, puntos);
  }

  return { porPano, subdivisionesViga, erroresMallado, pilaresJuntos };
}

// --- Helpers de losa plana (lineas de control + juntas) ------------------------

// Coords distintas por CELDA (cuantizar), en orden ascendente, conservando la coord
// REAL (la primera por orden ascendente de cada celda). Espejo del filtrado de
// `sanearLineasControl` (mallado.ts) pero SIN filtrar por borde (eso lo hace el
// mallado): aqui solo deduplicamos por celda para no pasar dos lineas identicas.
function dedupPorCelda(coords: readonly number[]): number[] {
  const ordenadas = [...coords].filter((c) => Number.isFinite(c)).sort((a, b) => a - b);
  const out: number[] = [];
  let ultimaCelda: number | null = null;
  for (const c of ordenadas) {
    const q = cuantizar(c);
    if (q === ultimaCelda) continue; // misma celda: dedup
    ultimaCelda = q;
    out.push(c);
  }
  return out;
}

// Pares de pilares interiores cuyas cabezas caen en la MISMA celda 2D a la cota del
// paño (clave de celda coincidente = reclamarian el mismo nudo de malla). Criterio
// UNICO: `claveCabeza` (clave de celda 2D), el MISMO del remap 6c; NUNCA por eje 1D
// ni |Δ|<TOL (RESERVA-2, [M-4]). `pilares` viene ordenado por id, asi que cada par
// [a,b] sale con a.id < b.id (id menor primero) y los pares en orden determinista.
function detectarPilaresJuntos(pilares: readonly Pilar[], cota: number): [string, string][] {
  const porClave = new Map<string, string[]>();
  for (const p of pilares) {
    const clave = claveCabeza(p.x, p.y, cota);
    const lista = porClave.get(clave);
    if (lista === undefined) porClave.set(clave, [p.id]);
    else lista.push(p.id);
  }
  const pares: [string, string][] = [];
  for (const ids of porClave.values()) {
    if (ids.length < 2) continue;
    // ids ya en orden de id (recorrido de pilares ordenado): todos los pares (i<j).
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) pares.push([ids[i], ids[j]]);
    }
  }
  return pares;
}

// --- Elementos interiores bajo el paño (OV-5 / TODO-2) --------------------------
// Un pilar o una viga que atraviesan el paño POR DENTRO (no por su contorno) no se
// acoplan en este corte: el calculo los ignoraria como apoyo de la losa y el
// reparto de cargas seria falso-plausible. validaciones.ts los convierte en ERROR
// bloqueante (PANO_PILAR_INTERIOR / PANO_VIGA_INTERIOR), precedente M-5: bloquear
// con mensaje de obra es mas seguro que calcular basura verosimil.

// Pilares cuyo eje (x,y) cae ESTRICTAMENTE dentro del rectangulo del paño y cuyo
// desarrollo vertical alcanza la cota del paño (cuantizado, extremos incluidos:
// un pilar que REMATA en la losa es justo el que deberia recogerla). Un pilar
// sobre el BORDE no entra aqui: lo gobiernan las reglas de borde (fallback/aviso).
export function pilaresInterioresBajoPano(modelo: Modelo, pano: Pano): Pilar[] {
  if (pano.tipo !== "losa") return [];
  const planta = plantaPorId(modelo, pano.plantaId);
  if (planta === undefined) return [];
  const limites = limitesDePano(modelo, pano);
  if (limites === undefined) return [];
  const qc = cuantizar(planta.cota);
  const dentro = modelo.pilares.filter((p) => {
    const pi = plantaPorId(modelo, p.plantaInicial);
    const pf = plantaPorId(modelo, p.plantaFinal);
    if (pi === undefined || pf === undefined) return false;
    const qMin = Math.min(cuantizar(pi.cota), cuantizar(pf.cota));
    const qMax = Math.max(cuantizar(pi.cota), cuantizar(pf.cota));
    if (qc < qMin || qc > qMax) return false;
    return (
      cuantizar(p.x) > cuantizar(limites.xMin) &&
      cuantizar(p.x) < cuantizar(limites.xMax) &&
      cuantizar(p.y) > cuantizar(limites.yMin) &&
      cuantizar(p.y) < cuantizar(limites.yMax)
    );
  });
  return dentro.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Recorte de un segmento al rectangulo CERRADO (Liang-Barsky). Devuelve el punto
// medio del tramo recortado y su longitud, o undefined si no hay interseccion.
function recortarSegmento(
  p1: PuntoPlano,
  p2: PuntoPlano,
  l: LimitesRectangulo,
): { medio: PuntoPlano; longitud: number } | undefined {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let t0 = 0;
  let t1 = 1;
  const recorta = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // paralelo al borde: dentro si q>=0
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!recorta(-dx, p1.x - l.xMin)) return undefined;
  if (!recorta(dx, l.xMax - p1.x)) return undefined;
  if (!recorta(-dy, p1.y - l.yMin)) return undefined;
  if (!recorta(dy, l.yMax - p1.y)) return undefined;
  if (t1 <= t0) return undefined;
  const tm = (t0 + t1) / 2;
  return {
    medio: { x: p1.x + dx * tm, y: p1.y + dy * tm },
    longitud: Math.hypot(dx, dy) * (t1 - t0),
  };
}

// Vigas (INCLUIDOS tirantes: igual de ignorados) a la cota del paño cuyo segmento
// atraviesa el INTERIOR del rectangulo: el tramo recortado tiene longitud real y
// su punto medio es estrictamente interior (una viga de CONTORNO, colineal con una
// arista, tiene el punto medio SOBRE el borde y queda fuera; asi el contorno nunca
// se confunde con una viga embrochalada).
export function vigasInterioresBajoPano(modelo: Modelo, pano: Pano): Viga[] {
  if (pano.tipo !== "losa") return [];
  const planta = plantaPorId(modelo, pano.plantaId);
  if (planta === undefined) return [];
  const limites = limitesDePano(modelo, pano);
  if (limites === undefined) return [];
  const qc = cuantizar(planta.cota);
  const dentro = modelo.vigas.filter((v) => {
    const pv = plantaPorId(modelo, v.plantaId);
    const ni = nudoPorId(modelo, v.nudoI);
    const nj = nudoPorId(modelo, v.nudoJ);
    if (pv === undefined || ni === undefined || nj === undefined) return false;
    if (cuantizar(pv.cota) !== qc) return false;
    const rec = recortarSegmento({ x: ni.x, y: ni.y }, { x: nj.x, y: nj.y }, limites);
    if (rec === undefined || rec.longitud <= TOL_NODO) return false;
    return (
      cuantizar(rec.medio.x) > cuantizar(limites.xMin) &&
      cuantizar(rec.medio.x) < cuantizar(limites.xMax) &&
      cuantizar(rec.medio.y) > cuantizar(limites.yMin) &&
      cuantizar(rec.medio.y) < cuantizar(limites.yMax)
    );
  });
  return dentro.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
