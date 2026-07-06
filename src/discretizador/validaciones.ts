// Validaciones previas del modelo de obra (Capa 1), feature-4 / Tarea 1.2.
//
// PROPOSITO: detectar, ANTES de construir la Capa 2, los errores que el
// discretizador no puede traducir o que producirian un modelo de calculo invalido
// (referencias rotas, estructura sin sujetar, nombres ambiguos). Cada error se
// devuelve en LENGUAJE DE OBRA: prohibido "release", "nodo N12", "member", "DOF".
// El `codigo` (estable) y el `elementoId` son para tests y para que la UI resalte
// el elemento culpable; el `mensaje` es texto de UI en espanol con tildes.
//
// PURO: sin React, sin IO, sin Pyodide. Solo lee el Modelo y los catalogos.
//
// Estas comprobaciones son HEURISTICAS BARATAS, complementarias (no sustitutas) del
// veredicto exacto de estabilidad/mecanismo que dara `check_stability` del solver
// (feature-5/6). Aqui se atrapa lo evidente en lenguaje del arquitecto.
import type { Modelo, Pilar, Viga, Carga, Pano } from "../dominio";
import { plantaPorId, nudoPorId, seccionPorId, esHipotesisAutomatica } from "../dominio";
import { getMaterial, getSeccion } from "../biblioteca";
import { TOL_NODO, mapearEjes, clavePosicion, hayTresNoColineales } from "./geometria";
import { materialAportaMasa } from "./propiedadesBarra";
import { mallarPano, type PuntoPlano } from "./mallado";
// [1A] El acople paño<->portico (F3.2) se computa UNA vez por discretizacion:
// `discretizar` lo pasa como parametro; el fallback interno cubre a los llamantes
// que no lo tienen (prepararModeloCR, tests). Sus resultados gobiernan la
// relajacion de PANO_SIN_APOYO [OV-2], la sujecion y los avisos/errores de acople.
import {
  calcularAcoples,
  pilaresInterioresBajoPano,
  vigasInterioresBajoPano,
  type ResultadoAcoples,
} from "./acople";
import {
  CASE_CM_PLANTA,
  CASE_USO_PLANTA,
  cargasPlantaDePano,
  plantasConValorNegativo,
  plantasConCargaSinPano,
} from "./cargasPlanta";

// Memoizador de `pilaresInterioresBajoPano` por paño para una MISMA discretizacion.
// El helper rehace geometria (limitesDePano + filtro sobre todos los pilares) en cada
// llamada y se invoca varias veces por paño (validarRefsPano en el bloque PANO_SIN_APOYO
// + validarElementosInterioresPano). `validarModelo` crea UNA instancia y la pasa a
// ambas: misma pasada por paño. Determinismo intacto (el helper ya ordena por id; el
// cache es por `pano.id`, no altera el orden de recorrido).
type PilaresInteriores = (modelo: Modelo, pano: Pano) => Pilar[];
function crearMemoPilaresInteriores(): PilaresInteriores {
  const cache = new Map<string, Pilar[]>();
  return (modelo: Modelo, pano: Pano): Pilar[] => {
    const previo = cache.get(pano.id);
    if (previo !== undefined) return previo;
    const val = pilaresInterioresBajoPano(modelo, pano);
    cache.set(pano.id, val);
    return val;
  };
}

// Error de obra: contrato estable consumido por la UI (resaltado del elemento) y
// por los tests (assert de `codigo` + `elementoId`).
//
// `severidad` separa lo que IMPIDE calcular de lo que solo informa:
//   - "error": bloquea la discretizacion (ok:false). Hay que corregirlo antes de
//     calcular: referencias rotas, estructura sin sujetar, nombres duplicados, o
//     limitaciones de traduccion que descartarian carga real (paño, no aplicable).
//   - "aviso": NO impide calcular (ok:true + canal `avisos`). Es una limitacion que
//     el codigo trata de forma segura o una sugerencia de limpieza del modelo:
//     hipotesis vacia (COMBO_SIN_CARGAS), nudo huerfano (FLOTANTE), arranque
//     elastico calculado como empotrado (ELASTICO_NO_SOPORTADO).
export type ErrorObra = {
  codigo: string; // estable para tests: "REF_SECCION", "SIN_SUJECION", ...
  severidad: "error" | "aviso"; // error = bloquea; aviso = informa, no bloquea
  mensaje: string; // espanol con tildes, SIN jerga FEM (es texto de UI)
  elementoId?: string; // id del Pilar/Viga/Nudo/Carga/Pano/... culpable
  elementoTipo?: "pilar" | "viga" | "nudo" | "carga" | "pano" | "hipotesis" | "planta" | "modelo";
  // [D22a] Coordenadas de OBRA (no FEM: x=Este, y=Norte en m, ejes del plano de planta)
  // del elemento culpable, cuando aportan navegabilidad. Hoy solo lo rellena FLOTANTE
  // (posicion del nudo suelto): el reporte puede mostrar "en (4.00, 3.00)" y la UI puede
  // encuadrar ahi. OPCIONAL: la inmensa mayoria de errores no la necesita (el elementoId
  // basta para navegar). NUNCA son coordenadas de nudo FEM.
  posicion?: { x: number; y: number };
};

// Nombre de obra del elemento sobre el que actua una carga, SOLO si resuelve a una viga,
// pilar o paño del modelo (los ambitos de F1). Si el ambito no resuelve (elemento
// borrado, nudo, id desconocido) devuelve null y el llamador cae al mensaje generico:
// asi el mensaje enriquecido nunca miente ("la carga sobre la viga V3…") ni inventa un
// nombre. Lenguaje de obra; sin jerga FEM.
function nombreDeAmbito(
  modelo: Modelo,
  ambito: string,
): { etiqueta: string; nombre: string } | null {
  const viga = modelo.vigas.find((v) => v.id === ambito);
  if (viga !== undefined) return { etiqueta: "la viga", nombre: viga.nombre };
  const pilar = modelo.pilares.find((p) => p.id === ambito);
  if (pilar !== undefined) return { etiqueta: "el pilar", nombre: pilar.nombre };
  const pano = modelo.panos.find((pa) => pa.id === ambito);
  if (pano !== undefined) return { etiqueta: "el paño", nombre: pano.nombre };
  return null;
}

// Resuelve si la seccion referenciada por `seccionId` existe y es construible.
//
// DOS fuentes validas (misma regla que la UI: validacionesPilar/Viga y SelectSeccion):
//   1. Seccion de OBRA (`modelo.secciones`, union discriminada): hormigon parametrico
//      (b/h, d) o generico (A/Iy/Iz/J), que se autoabastecen; o un perfilMetalico, cuyo
//      `perfilId` debe apuntar a una entrada real del catalogo (PERFILES via getSeccion).
//   2. Un PERFIL del catalogo referenciado DIRECTAMENTE por su id (igual que los
//      materiales, que son catalogo fijo por id). Esto es lo que produce el SelectSeccion
//      al elegir un IPE/HEB; sin esta rama el discretizador rechazaba ("la sección no
//      existe en la obra") perfiles que la propia UI da por validos.
function seccionResoluble(modelo: Modelo, seccionId: string): boolean {
  const seccion = seccionPorId(modelo, seccionId);
  if (seccion !== undefined) {
    if (seccion.tipo === "perfilMetalico") {
      return getSeccion(seccion.perfilId) !== undefined;
    }
    return true;
  }
  // No es seccion de obra: ¿es un perfil del catalogo referenciado por id?
  return getSeccion(seccionId) !== undefined;
}

// Anade un error de "nombre duplicado" por cada elemento cuyo `nombre` colisiona.
function comprobarNombresUnicos(
  errores: ErrorObra[],
  elementos: ReadonlyArray<{ id: string; nombre: string }>,
  tipo: ErrorObra["elementoTipo"],
  etiqueta: string, // "pilar", "viga", "hipotesis" para el mensaje
): void {
  const vistos = new Map<string, string>(); // nombre -> primer id que lo uso
  for (const el of elementos) {
    const previo = vistos.get(el.nombre);
    if (previo === undefined) {
      vistos.set(el.nombre, el.id);
    } else {
      errores.push({
        codigo: "NOMBRE_DUP",
        severidad: "error",
        mensaje: `Hay más de un ${etiqueta} con el nombre "${el.nombre}". Usa un nombre distinto para cada uno.`,
        elementoId: el.id,
        elementoTipo: tipo,
      });
    }
  }
}

// 1. Nombres unicos de pilares, vigas, hipotesis y plantas.
function validarNombresUnicos(modelo: Modelo, errores: ErrorObra[]): void {
  comprobarNombresUnicos(errores, modelo.pilares, "pilar", "pilar");
  comprobarNombresUnicos(errores, modelo.vigas, "viga", "viga");
  comprobarNombresUnicos(errores, modelo.hipotesis, "hipotesis", "hipótesis");
  comprobarNombresUnicos(errores, modelo.plantas, "planta", "planta");
}

// 1b. [AUDITORIA M-1] IDS unicos por coleccion. El borde Zod valida solo forma
// (delega la integridad aqui) y TODOS los lookups del dominio son `.find()`
// (primer match): dos elementos con el mismo id hacen que el segundo se IGNORE en
// silencio (p.ej. dos nudos con el mismo id y posiciones distintas -> la viga usa
// el primero -> geometria erronea con ok:true). Los comandos de la UI generan ids
// unicos (nuevoId), asi que esta red protege el borde de import/persistencia.
// BLOQUEA: un proyecto con ids duplicados esta dañado y no debe calcular.
function comprobarIdsUnicos(
  errores: ErrorObra[],
  elementos: ReadonlyArray<{ id: string }>,
  tipo: ErrorObra["elementoTipo"],
  etiqueta: string, // "punto", "planta", "carga"... para el mensaje de obra
): void {
  const vistos = new Set<string>();
  for (const el of elementos) {
    if (vistos.has(el.id)) {
      errores.push({
        codigo: "ID_DUP",
        severidad: "error",
        mensaje: `Hay más de un ${etiqueta} con el mismo identificador interno: el proyecto está dañado. Vuelve a importarlo o elimina el elemento repetido.`,
        elementoId: el.id,
        elementoTipo: tipo,
      });
    }
    vistos.add(el.id);
  }
}

function validarIdsUnicos(modelo: Modelo, errores: ErrorObra[]): void {
  comprobarIdsUnicos(errores, modelo.plantas, "planta", "planta");
  comprobarIdsUnicos(errores, modelo.secciones, "modelo", "sección");
  comprobarIdsUnicos(errores, modelo.nudos, "modelo", "punto");
  comprobarIdsUnicos(errores, modelo.pilares, "pilar", "pilar");
  comprobarIdsUnicos(errores, modelo.vigas, "viga", "viga");
  comprobarIdsUnicos(errores, modelo.panos, "pano", "paño");
  comprobarIdsUnicos(errores, modelo.cargas, "carga", "carga");
  comprobarIdsUnicos(errores, modelo.hipotesis, "hipotesis", "hipótesis");
}

// 1c. [AUDITORIA M-3] Pilar DEGENERADO (longitud ~0): plantaInicial === plantaFinal
// o dos plantas a la misma cota. El troceo por cotas no emite NINGUNA barra para el
// pilar, pero su support de arranque SI se emitia: un apoyo fantasma sin barra que
// ademas contaba como sujecion valida (haySujecionPilar). Simetrico de
// VIGA_DEGENERADA. Se comparan las COTAS (no los ids): dos plantas distintas a la
// misma cota tambien degeneran. Umbral TOL_NODO, el criterio geometrico unico.
function validarPilaresDegenerados(modelo: Modelo, errores: ErrorObra[]): void {
  for (const p of modelo.pilares) {
    const pi = plantaPorId(modelo, p.plantaInicial);
    const pf = plantaPorId(modelo, p.plantaFinal);
    if (pi === undefined || pf === undefined) continue; // REF_PLANTA ya bloquea
    if (Math.abs(pf.cota - pi.cota) <= TOL_NODO) {
      errores.push({
        codigo: "PILAR_DEGENERADO",
        severidad: "error",
        mensaje: `El pilar "${p.nombre}" arranca y termina a la misma altura: no tiene longitud. Revisa sus plantas inicial y final.`,
        elementoId: p.id,
        elementoTipo: "pilar",
      });
    }
  }
}

// 2a. Referencias de un Pilar: material, seccion, plantas.
function validarRefsPilar(p: Pilar, modelo: Modelo, errores: ErrorObra[]): void {
  if (getMaterial(p.materialId) === undefined) {
    errores.push({
      codigo: "REF_MATERIAL",
      severidad: "error",
      mensaje: `El pilar "${p.nombre}" usa un material que no existe en la biblioteca.`,
      elementoId: p.id,
      elementoTipo: "pilar",
    });
  }
  if (!seccionResoluble(modelo, p.seccionId)) {
    errores.push({
      codigo: "REF_SECCION",
      severidad: "error",
      mensaje: `El pilar "${p.nombre}" usa una sección que no existe en la obra.`,
      elementoId: p.id,
      elementoTipo: "pilar",
    });
  }
  if (plantaPorId(modelo, p.plantaInicial) === undefined) {
    errores.push({
      codigo: "REF_PLANTA",
      severidad: "error",
      mensaje: `El pilar "${p.nombre}" arranca en una planta que no existe.`,
      elementoId: p.id,
      elementoTipo: "pilar",
    });
  }
  if (plantaPorId(modelo, p.plantaFinal) === undefined) {
    errores.push({
      codigo: "REF_PLANTA",
      severidad: "error",
      mensaje: `El pilar "${p.nombre}" llega a una planta que no existe.`,
      elementoId: p.id,
      elementoTipo: "pilar",
    });
  }
}

// 2b. Referencias de una Viga: material, seccion, planta, nudos.
function validarRefsViga(v: Viga, modelo: Modelo, errores: ErrorObra[]): void {
  if (getMaterial(v.materialId) === undefined) {
    errores.push({
      codigo: "REF_MATERIAL",
      severidad: "error",
      mensaje: `La viga "${v.nombre}" usa un material que no existe en la biblioteca.`,
      elementoId: v.id,
      elementoTipo: "viga",
    });
  }
  if (!seccionResoluble(modelo, v.seccionId)) {
    errores.push({
      codigo: "REF_SECCION",
      severidad: "error",
      mensaje: `La viga "${v.nombre}" usa una sección que no existe en la obra.`,
      elementoId: v.id,
      elementoTipo: "viga",
    });
  }
  if (plantaPorId(modelo, v.plantaId) === undefined) {
    errores.push({
      codigo: "REF_PLANTA",
      severidad: "error",
      mensaje: `La viga "${v.nombre}" pertenece a una planta que no existe.`,
      elementoId: v.id,
      elementoTipo: "viga",
    });
  }
  if (nudoPorId(modelo, v.nudoI) === undefined) {
    errores.push({
      codigo: "REF_NUDO",
      severidad: "error",
      mensaje: `La viga "${v.nombre}" arranca en un punto que no existe en la obra.`,
      elementoId: v.id,
      elementoTipo: "viga",
    });
  }
  if (nudoPorId(modelo, v.nudoJ) === undefined) {
    errores.push({
      codigo: "REF_NUDO",
      severidad: "error",
      mensaje: `La viga "${v.nombre}" termina en un punto que no existe en la obra.`,
      elementoId: v.id,
      elementoTipo: "viga",
    });
  }
  // Viga degenerada: ambos extremos colapsarian en el MISMO nodo FEM => barra de
  // longitud cero (el solver fallaria). El criterio debe ser EXACTAMENTE el del
  // discretizador: clave de rejilla (clavePosicion), no distancia euclidea — dos
  // puntos a >TOL_NODO en euclideo pueden caer en la misma celda (caso diagonal) y
  // colapsar igual. La UI ya lo evita, pero esta red protege CUALQUIER via (import
  // .json de F8, cargas de F13, edicion futura). Solo si ambos nudos y la planta
  // existen (si no, ya hay REF_NUDO/REF_PLANTA arriba).
  const nI = nudoPorId(modelo, v.nudoI);
  const nJ = nudoPorId(modelo, v.nudoJ);
  const planta = plantaPorId(modelo, v.plantaId);
  if (nI !== undefined && nJ !== undefined && planta !== undefined) {
    const claveI = clavePosicion(mapearEjes(nI.x, nI.y, planta.cota), TOL_NODO);
    const claveJ = clavePosicion(mapearEjes(nJ.x, nJ.y, planta.cota), TOL_NODO);
    if (claveI === claveJ) {
      errores.push({
        codigo: "VIGA_DEGENERADA",
        severidad: "error",
        mensaje: `La viga "${v.nombre}" tiene sus dos extremos en el mismo punto.`,
        elementoId: v.id,
        elementoTipo: "viga",
      });
    }
  }
}

// 2b-bis. Referencias y geometria de un Paño LOSA (F3 corte 1). Rechaza en lenguaje de
// obra: material/planta inexistentes, tamMalla no positivo, perimetro != 4 nudos
// existentes, geometria no rectangular o sin area, y tipo != "losa" (reticular /
// unidireccional aun no se calculan). El mallado real (mallado.ts) es la FUENTE UNICA
// del criterio geometrico (rectangulo / area ~0): si el acople YA mallo el paño
// (esta en `acoples.porPano`) la geometria es valida por construccion y NO se
// re-malla [1A]; solo se re-malla para EXPLICAR el motivo de un rechazo.
function validarRefsPano(
  pano: Pano,
  modelo: Modelo,
  errores: ErrorObra[],
  acoples: ResultadoAcoples,
  pilaresInteriores: PilaresInteriores,
): void {
  // Solo la LOSA se calcula en el corte 1. Reticular/unidireccional se rechazan (NO se
  // mallan como losa, que daria un calculo fisicamente erroneo en silencio).
  if (pano.tipo !== "losa") {
    errores.push({
      codigo: "PANO_TIPO_NO_SOPORTADO",
      severidad: "error",
      mensaje: `El forjado "${pano.nombre}" es ${
        pano.tipo === "reticular" ? "reticular" : "unidireccional"
      } y aún no se calcula en esta fase. Usa una losa maciza.`,
      elementoId: pano.id,
      elementoTipo: "pano",
    });
    return; // sin tipo soportado no tiene sentido validar el resto de su geometria
  }

  if (getMaterial(pano.materialId) === undefined) {
    errores.push({
      codigo: "REF_MATERIAL",
      severidad: "error",
      mensaje: `El paño "${pano.nombre}" usa un material que no existe en la biblioteca.`,
      elementoId: pano.id,
      elementoTipo: "pano",
    });
  }
  const planta = plantaPorId(modelo, pano.plantaId);
  if (planta === undefined) {
    errores.push({
      codigo: "REF_PLANTA",
      severidad: "error",
      mensaje: `El paño "${pano.nombre}" pertenece a una planta que no existe.`,
      elementoId: pano.id,
      elementoTipo: "pano",
    });
  }
  if (!(pano.tamMalla > 0)) {
    errores.push({
      codigo: "PANO_TAM_MALLA",
      severidad: "error",
      mensaje: `El paño "${pano.nombre}" tiene un tamaño de malla no válido.`,
      elementoId: pano.id,
      elementoTipo: "pano",
    });
  }

  // [AUDITORIA M-5, relajado en F3.2/OV-2, y en F2.3/T-f3-losa-plana] Losa con TODOS los
  // bordes libres: sin apoyo de borde solo se sostiene si DESCANSA en algo. Dos vias:
  //   (a) el PORTICO: un BORDE COMPLETO del rectangulo sobre vigas (bordesCompletos >= 1,
  //       criterio del acople) — dos esquinas sueltas NO son apoyo.
  //   (b) los PILARES: la losa apoyada SOLO en pilares interiores acoplados (la tipologia
  //       "forjado plano sobre pilares"). El acople de cabeza (F2.0) la deja `acopleActivo`
  //       y descarga axil en los pilares; su sujecion global la da el ARRANQUE de esos
  //       pilares (validarSujecion). PERO una placa de bordes libres necesita >=3 apoyos
  //       NO colineales para no BASCULAR: con 2 (siempre colineales: 2 puntos = 1 recta)
  //       el plano queda cuasi-singular y el motor NO lo caza bajo el solver disperso
  //       (devuelve basura silenciosa — flecha absurda sin lanzar; verificado motor real
  //       F2.3·T3.2). Por eso el criterio de sujecion AUTONOMA por pilares es >=3 NO
  //       colineales (decision de producto).
  // Sin ninguna de las dos: se bloquea en lenguaje de obra ANTES del motor.
  const acople = acoples.porPano.get(pano.id);
  const sinBordeCompleto = acople === undefined || acople.bordesCompletos === 0;
  if (pano.bordeApoyo === "libre" && sinBordeCompleto) {
    // Pilares interiores UNA sola vez (el helper rehace geometria): se reusa para
    // `puntosApoyo` (los acoplados) y para el chequeo `.length === 0` de mas abajo.
    const interiores = pilaresInteriores(modelo, pano);
    // Pilares REALMENTE acoplados a ESTE paño (su cabeza remapea a N*); vacio si <2 o cap.
    const acoplados = new Set(acople?.pilaresAcoplados ?? []);
    const puntosApoyo = interiores
      .filter((p) => acoplados.has(p.id))
      .map((p) => ({ x: p.x, y: p.y }));
    if (hayTresNoColineales(puntosApoyo)) {
      // Sujeta por >=3 pilares no alineados: apoyo autonomo legitimo, no se bloquea.
    } else if (puntosApoyo.length >= 2) {
      // Se apoya en pilares pero insuficientes: 2 (colineales) o >=3 alineados. BLOQUEA con
      // un mensaje ESPECIFICO que guia a >=3 no alineados (o una viga/apoyo en algun borde).
      // Precede a PANO_PILAR_INTERIOR: esos pilares SI estan acoplados (no disparan interior),
      // asi que aqui no hay doble reporte contradictorio.
      errores.push({
        codigo: "PANO_PILARES_INSUFICIENTES",
        severidad: "error",
        mensaje: `El paño "${pano.nombre}" se apoya solo en pilares alineados: con los apoyos en línea la losa vuelca. Necesita al menos tres pilares no alineados, o un apoyo en algún borde (viga, borde apoyado o empotrado).`,
        elementoId: pano.id,
        elementoTipo: "pano",
      });
    } else if (interiores.length === 0) {
      // Ni borde sobre viga ni pilar interior alguno: la losa flota. Mensaje clasico. Con 1
      // pilar interior (o pilares NO acoplados) NO se emite aqui: ya lo explica, sin
      // contradiccion, PANO_PILAR_INTERIOR (DP1: exige >=2 apoyos acoplados) [precedencia].
      errores.push({
        codigo: "PANO_SIN_APOYO",
        severidad: "error",
        mensaje: `El paño "${pano.nombre}" tiene todos los bordes libres y ningún borde descansa entero sobre vigas: no se sostiene. Elige borde apoyado o empotrado, o dibuja vigas bajo su contorno.`,
        elementoId: pano.id,
        elementoTipo: "pano",
      });
    }
  }

  // Perimetro: corte 1 = rectangulo de 4 nudos PROPIOS existentes. El schema admite
  // >=3 (un poligono generico futuro); aqui se exige exactamente 4 para la losa.
  if (pano.perimetro.length !== 4) {
    errores.push({
      codigo: "PANO_PERIMETRO",
      severidad: "error",
      mensaje: `El paño "${pano.nombre}" debe tener cuatro esquinas (un rectángulo).`,
      elementoId: pano.id,
      elementoTipo: "pano",
    });
    return; // sin 4 nudos no se puede comprobar la geometria
  }
  const puntos: PuntoPlano[] = [];
  let faltaNudo = false;
  for (const nudoId of pano.perimetro) {
    const n = nudoPorId(modelo, nudoId);
    if (n === undefined) {
      faltaNudo = true;
      break;
    }
    puntos.push({ x: n.x, y: n.y });
  }
  if (faltaNudo) {
    errores.push({
      codigo: "REF_NUDO",
      severidad: "error",
      mensaje: `El paño "${pano.nombre}" tiene una esquina en un punto que no existe en la obra.`,
      elementoId: pano.id,
      elementoTipo: "pano",
    });
    return;
  }
  // Geometria: la FUENTE UNICA del criterio (rectangulo alineado / area > 0) es el
  // propio mallado. [1A] Si el acople ya mallo este paño, la geometria es valida por
  // construccion: no se re-malla (el camino feliz malla UNA sola vez, en acople.ts).
  if (acople !== undefined) return;
  // Solo se re-malla para EXPLICAR el motivo del rechazo. Se invoca con la cota de
  // la planta (0 si aun falta: el error de planta ya se reporto arriba). Si el
  // mallado rechaza la geometria, se traduce su motivo a un ErrorObra con el id del
  // paño culpable.
  const cota = planta !== undefined ? planta.cota : 0;
  const res = mallarPano({
    perimetro: puntos as [PuntoPlano, PuntoPlano, PuntoPlano, PuntoPlano],
    cota,
    tamMalla: pano.tamMalla > 0 ? pano.tamMalla : 1, // tam invalido ya reportado; evita div/0
    indicePano: 0,
  });
  if (!res.ok) {
    errores.push({
      codigo: res.error.codigo, // PANO_NO_RECTANGULAR | PANO_DEGENERADO
      severidad: "error",
      mensaje: res.error.mensaje,
      elementoId: pano.id,
      elementoTipo: "pano",
    });
  }
}

// 2c. Referencias de una Carga: ambito (elemento existente) e hipotesis.
function validarRefsCarga(
  c: Carga,
  modelo: Modelo,
  errores: ErrorObra[],
  ambitosValidos: ReadonlySet<string>,
): void {
  // [D22a] Nombra el ámbito de la carga SOLO si resuelve a un elemento del modelo:
  // "la carga sobre la viga V3…". Si no resuelve (elemento borrado, etc.) se cae al
  // mensaje genérico actual (nunca inventa un nombre). Para REF_AMBITO el ámbito por
  // definición NO existe, así que `ambito` será null y el mensaje queda genérico.
  const ambito = nombreDeAmbito(modelo, c.ambito);
  const sufijoAmbito = ambito ? ` sobre ${ambito.etiqueta} "${ambito.nombre}"` : "";
  if (!ambitosValidos.has(c.ambito)) {
    errores.push({
      codigo: "REF_AMBITO",
      severidad: "error",
      mensaje: `Una carga está aplicada sobre un elemento que ya no existe en la obra.`,
      elementoId: c.id,
      elementoTipo: "carga",
    });
  }
  if (!modelo.hipotesis.some((h) => h.id === c.hipotesisId)) {
    errores.push({
      codigo: "REF_HIPOTESIS",
      severidad: "error",
      mensaje: `Una carga${sufijoAmbito} pertenece a una hipótesis que no existe.`,
      elementoId: c.id,
      elementoTipo: "carga",
    });
  }
  // E2(a): ninguna carga de usuario puede pertenecer a la hipotesis AUTOMATICA. Sus
  // cargas las genera el discretizador (peso propio del modelo); una carga de usuario
  // ahi seria doble cómputo del peso propio. Los comandos ya lo impiden, pero esta
  // red protege el borde de import (.json) que se salta los comandos. BLOQUEA. Se
  // identifica la automatica por su FLAG (predicado), no por el id, para que no
  // diverjan: se busca la hipotesis destino y se comprueba el predicado.
  const hipDestino = modelo.hipotesis.find((h) => h.id === c.hipotesisId);
  if (hipDestino !== undefined && esHipotesisAutomatica(hipDestino)) {
    errores.push({
      codigo: "CARGA_EN_AUTOMATICA",
      severidad: "error",
      mensaje: `Una carga${sufijoAmbito} está asignada a la hipótesis de peso propio, que el sistema calcula automáticamente. Asígnala a otra hipótesis.`,
      elementoId: c.id,
      elementoTipo: "carga",
    });
  }
}

// 2d. Sincronizacion de la hipotesis automatica de peso propio (E1, guard de
// desincronizacion). Si `incluirPesoPropio` esta activo, el discretizador emitira
// cargas en la hipotesis `hip-peso-propio` y `generarCombos` la clasificara: ambos
// asumen que la hipotesis EXISTE. Un modelo importado o mal migrado podria tener el
// flag activo SIN la hipotesis (p.ej. un .json antiguo sin migrar). Sin esta red, el
// `hipById.get(...)!` del discretizador devolveria undefined y el calculo fallaria
// con un error tecnico opaco. BLOQUEA en lenguaje de obra. El recipro (flag OFF) no
// es error: simplemente no se computa peso propio.
function validarHipotesisPesoPropio(modelo: Modelo, errores: ErrorObra[]): void {
  if (!modelo.analisis.incluirPesoPropio) return;
  // Existencia por el FLAG (predicado), no por el id: el discretizador emite el peso
  // propio en la hipotesis hallada por `esHipotesisAutomatica`, asi que E1 debe
  // comprobar lo mismo (id y flag no pueden divergir).
  const existe = modelo.hipotesis.some(esHipotesisAutomatica);
  if (!existe) {
    errores.push({
      codigo: "FALTA_PESO_PROPIO",
      severidad: "error",
      mensaje:
        "Falta la hipótesis de peso propio: está activado el cálculo del peso propio pero el proyecto no la tiene. Vuelve a abrir el proyecto o desactiva el peso propio.",
      elementoTipo: "modelo",
    });
  }
}

// 2. Integridad referencial de todos los elementos.
function validarReferencias(
  modelo: Modelo,
  errores: ErrorObra[],
  acoples: ResultadoAcoples,
  pilaresInteriores: PilaresInteriores,
): void {
  for (const p of modelo.pilares) validarRefsPilar(p, modelo, errores);
  for (const v of modelo.vigas) validarRefsViga(v, modelo, errores);
  for (const pano of modelo.panos)
    validarRefsPano(pano, modelo, errores, acoples, pilaresInteriores);

  // Ambito de carga: el id de cualquier elemento sobre el que puede actuar una
  // carga en F1 (viga, pilar, nudo o pano). Se precomputa un Set para O(1).
  const ambitosValidos = new Set<string>();
  for (const v of modelo.vigas) ambitosValidos.add(v.id);
  for (const p of modelo.pilares) ambitosValidos.add(p.id);
  for (const n of modelo.nudos) ambitosValidos.add(n.id);
  for (const pano of modelo.panos) ambitosValidos.add(pano.id);

  for (const c of modelo.cargas) validarRefsCarga(c, modelo, errores, ambitosValidos);
}

// 2e. [AUDITORIA UX-VACIA] Obra vacia: sin NINGUN elemento estructural (pilares, vigas
// ni paños) no hay nada que calcular. `validarSujecion` hace early-return con obra vacia
// (un modelo vacio es un punto de partida valido, no un error de sujecion), asi que el
// calculo procederia hasta el motor y devolveria "resultados" vacios sin aviso. Esta
// guarda BLOQUEA antes, en lenguaje de obra, para que "Calcular" con la obra vacia guie
// al arquitecto en vez de fallar en silencio. Error de MODELO (no de un elemento).
function validarObraVacia(modelo: Modelo, errores: ErrorObra[]): void {
  if (
    modelo.pilares.length === 0 &&
    modelo.vigas.length === 0 &&
    modelo.panos.length === 0
  ) {
    errores.push({
      codigo: "OBRA_VACIA",
      severidad: "error",
      mensaje:
        "La obra está vacía: introduce pilares o vigas antes de calcular.",
      elementoTipo: "modelo",
    });
  }
}

// 3. Sujecion suficiente (6 GDL de solido rigido) ANTES del solver.
// HEURISTICA F1: la estructura debe tener al menos un pilar con vinculacion
// exterior (su arranque sujeta la obra al terreno). Sin ninguno, la estructura
// "flota" y el calculo no tendria solucion. El veredicto exacto de mecanismo lo
// dara `check_stability` del solver (feature-5/6); aqui se atrapa el caso obvio.
function validarSujecion(
  modelo: Modelo,
  errores: ErrorObra[],
  acoples: ResultadoAcoples,
): void {
  // Si no hay elementos estructurales (barras NI paños), no hay nada que sujetar (no es
  // un error de sujecion: un modelo vacio es valido como punto de partida).
  if (
    modelo.pilares.length === 0 &&
    modelo.vigas.length === 0 &&
    modelo.panos.length === 0
  ) {
    return;
  }

  // Sujecion suficiente F3.2: un pilar con vinculacion exterior (su arranque sujeta la
  // obra al terreno) O un paño LOSA que EMITIRA apoyos de borde propios: bordeApoyo !=
  // "libre" Y algun nudo de borde SIN acoplar (el Paso 6c solo pone el apoyo de borde
  // en los nudos no acoplados). Un paño TOTALMENTE acoplado al portico ya no aporta
  // apoyos: descarga en las vigas, y la sujecion debe venir de los pilares — si no la
  // hay, la estructura entera flota y este error lo dice [OV-2 no empeora
  // T-f3-sujecion-componentes: sigue siendo un heuristico global, pero ahora es
  // EXACTO respecto a lo que el discretizador emite]. El veredicto final de mecanismo
  // lo da el solver; aqui se atrapa el caso obvio.
  //
  // [F2.0/DP2] Losa plana sobre pilares: una losa acoplada SOLO a pilares (bordes
  // libres) queda sujeta por el arranque de esos pilares — que YA cuenta abajo
  // (`p.vinculacionExterior`). Con >=2 pilares con arranque, `haySujecionPilar` es true
  // sin cambio estructural: el arranque del pilar interior sujeta igual que el de un
  // pilar de esquina. NO se analizan componentes conexos en este corte (sujecion SOLO
  // por pilar, DP2); una losa acoplada a pilares SIN arranque conviviendo con otra
  // subestructura sujeta pasaria este heuristico global (agujero PRE-EXISTENTE, no lo
  // introduce F2.0) y solo la cazaria `check_stability` del solver. Cerrarlo bien es
  // `T-f3-sujecion-componentes` (deuda ortogonal): cuando se aborde, el analisis de
  // componentes debera recorrer las aristas nudo<->quad que la losa plana añade al grafo
  // (los quads conectan las cabezas de pilar a la losa), no solo nudo<->barra.
  const haySujecionPilar = modelo.pilares.some((p) => p.vinculacionExterior);
  const haySujecionPano = modelo.panos.some((pano) => {
    if (pano.tipo !== "losa" || pano.bordeApoyo === "libre") return false;
    const acople = acoples.porPano.get(pano.id);
    // Paño no mallable (refs rotas): se cuenta como antes (bordeApoyo != libre); el
    // bloqueo real llegara por sus errores de referencia/geometria.
    if (acople === undefined) return true;
    // [F2.3/RESERVA-4 gemelo] Solo cuentan los nudos de BORDE acoplados: el Paso 6c
    // pone apoyos de borde en los nudos de borde SIN acoplar, asi que "queda algun
    // apoyo propio" ⇔ nodosBordeAcoplados < nº total de nudos de borde. Se usa
    // `acople.nodosBordeAcoplados` (fuente unica, ya = |nodosBorde ∩ nodosAcoplados|),
    // NUNCA `nodosAcoplados.size`, que incluye cabezas de pilar interiores y podria
    // superar nodosBorde.length -> falso SIN_SUJECION que bloquea una losa valida.
    const acoplados = acople.acopleActivo ? acople.nodosBordeAcoplados : 0;
    return acoplados < acople.malla.nodosBorde.length; // queda algun apoyo propio
  });
  const haySujecion = haySujecionPilar || haySujecionPano;
  if (!haySujecion) {
    errores.push({
      codigo: "SIN_SUJECION",
      severidad: "error",
      mensaje:
        "Ningún pilar tiene arranque ni conexión con el terreno: la estructura no está sujeta y no se puede calcular.",
      elementoTipo: "modelo",
    });
  }
}

// 4. Hipotesis sin cargas: una hipotesis vacia no aporta nada a un combo y suele
// indicar un olvido (definir el caso de carga pero no introducir la carga). Aviso
// en lenguaje de obra. (Los combos del dominio llegan en feature-13; aqui se valida
// lo que F1 permite: que cada hipotesis tenga al menos una carga.)
function validarHipotesisConCargas(modelo: Modelo, errores: ErrorObra[]): void {
  for (const h of modelo.hipotesis) {
    // E3: la hipotesis AUTOMATICA (peso propio) nunca tiene cargas en modelo.cargas
    // (las genera el discretizador a partir de la geometria), asi que jamas debe
    // avisarse de que esta "vacia": no es un olvido del usuario, es por diseno.
    if (h.automatica) continue;
    const tieneCargas = modelo.cargas.some((c) => c.hipotesisId === h.id);
    if (!tieneCargas) {
      errores.push({
        codigo: "COMBO_SIN_CARGAS",
        severidad: "aviso", // no impide calcular: una hipotesis vacia solo no aporta
        mensaje: `La hipótesis "${h.nombre}" no tiene ninguna carga: no influirá en el cálculo.`,
        elementoId: h.id,
        elementoTipo: "hipotesis",
      });
    }
  }
}

// 4b. Concomitancia de varias acciones variables (red para la via de IMPORT .json).
//
// CONTEXTO: `generarCombos` (combinaciones.ts) construye el ELU poniendo TODAS las
// hipotesis `variable` a su coeficiente pleno (1,50), porque el alcance F1 asume UNA
// unica accion variable dominante (no hay concomitancia con coeficiente de
// simultaneidad psi0 todavia; eso es F2). La UI ya restringe a una sola hipotesis
// variable, pero un proyecto importado (.json, feature-8) puede traer 2+ y saltarse
// esa validacion de UI. "Todo dato que entra se valida" (CLAUDE.md regla de oro 8).
//
// SEVERIDAD = "aviso" (NO bloquea): mayorar todas las variables a 1,50 a la vez es
// CONSERVADOR (mas carga => del lado de la seguridad), asi que el calculo puede
// proceder; solo se informa de que aun no es psi0-correcto.
//
// CRITERIO: solo cuentan las variables CON al menos una carga asociada. Una variable
// vacia no entra en ningun esfuerzo (sus factores no mueven nada en el combo), asi
// que no genera concomitancia real; ademas ya la avisa COMBO_SIN_CARGAS. Asi el
// aviso aparece exactamente cuando hay >1 variable que de verdad suma esfuerzo.
function validarVariablesConcomitantes(modelo: Modelo, errores: ErrorObra[]): void {
  const variablesConCarga = modelo.hipotesis.filter(
    (h) => h.tipo === "variable" && modelo.cargas.some((c) => c.hipotesisId === h.id),
  );
  if (variablesConCarga.length > 1) {
    errores.push({
      codigo: "VARIAS_VARIABLES",
      severidad: "aviso", // conservador (todas a 1,50): no impide calcular
      mensaje:
        "Hay más de una acción variable con cargas. En esta fase se combinan todas con su coeficiente pleno (resultado del lado de la seguridad); la combinación con coeficientes de simultaneidad llegará en una fase posterior.",
      elementoTipo: "modelo", // es un aviso de modelo, no de un elemento concreto
    });
  }
}

// 5. Nudos huerfanos: un punto de la obra que ninguna viga usa como extremo. Suele
// ser un resto de una edicion (se borro la viga pero quedo el punto). Heuristica
// ligera; no impide calcular, pero ensucia el modelo. Aviso, no bloqueo.
function validarNudosFlotantes(modelo: Modelo, errores: ErrorObra[]): void {
  const nudosUsados = new Set<string>();
  for (const v of modelo.vigas) {
    nudosUsados.add(v.nudoI);
    nudosUsados.add(v.nudoJ);
  }
  for (const n of modelo.nudos) {
    if (!nudosUsados.has(n.id)) {
      errores.push({
        codigo: "FLOTANTE",
        severidad: "aviso", // no impide calcular: solo ensucia el modelo
        // [D22a] Mensaje NAVEGABLE: nombra la posicion de obra del punto suelto para que
        // el usuario lo localice ("Hay un punto en (4.00, 3.00)…"). La `posicion` va
        // ademas estructurada para que la UI pueda encuadrar/mostrar la coordenada.
        mensaje: `Hay un punto en (${n.x.toFixed(2)}, ${n.y.toFixed(2)}) que no conecta con ninguna viga.`,
        elementoId: n.id,
        elementoTipo: "nudo",
        posicion: { x: n.x, y: n.y },
      });
    }
  }
}

// --- Validaciones del ACOPLE paño<->portico (F3.2) ----------------------------

// 6. Elementos que ATRAVIESAN el paño por dentro [OV-5 + TODO-2 + F2.0 losa plana].
// Un pilar estrictamente interior que alcanza la cota del paño, o una viga cuyo
// tramo pasa por dentro del rectangulo. Reparto correcto solo si REALMENTE se
// acoplan a la losa; si no, el calculo los ignoraria como apoyo y el reparto de
// cargas seria falso pero verosimil. Precedente M-5: BLOQUEAR con mensaje de obra
// y salida clara es mas seguro que calcular basura plausible.
//
// F2.0 (losa plana sobre pilares): un pilar interior YA NO bloquea SIEMPRE. Si la
// losa plana lo recogio (su cabeza cae en un nudo de malla que el Paso 6c remapea a
// su N*), el pilar esta en `acople.pilaresAcoplados` y es un apoyo legitimo: NO se
// emite PANO_PILAR_INTERIOR. Reglas por paño (todas via `acoples`), en este orden:
//
//   1. Paño en `erroresMallado` (cap de lineas de control, PANO_DEMASIADOS_PILARES):
//      se emite SOLO ese error una vez [RESERVA-3] y se CALLAN por completo los
//      elementos interiores de ese paño (pilares Y vigas). Motivo: el paño NO se
//      malla (esta fuera de `porPano`, XOR §1.2), luego no hay reparto que validar
//      elemento a elemento; superponer PANO_PILAR_INTERIOR por cada pilar seria
//      doble reporte contradictorio del MISMO problema (demasiados pilares). La viga
//      interior tambien se calla: sin malla no hay losa donde embrochalarla, y el
//      arreglo de obra es el mismo (dividir el paño), asi que un solo error guia
//      mejor que dos.
//   2. Pilar en `pilaresAcoplados` -> OK (la losa plana lo recoge), no error.
//   3. Pilar en algun par de `pilaresJuntos` -> lo explica PANO_PILARES_JUNTOS
//      (validarPilaresJuntos); no se duplica aqui como PANO_PILAR_INTERIOR.
//   4. Resto (interior NI acoplado NI junto: p.ej. 1 solo pilar, DP1) -> bloquea
//      con PANO_PILAR_INTERIOR (la losa plana exige >=2 apoyos acoplados).
//
// Las vigas interiores (embrochaladas) siguen bloqueando salvo bajo cap (regla 1):
// una viga que pasa por dentro sin acoplarse no la recoge la losa plana en este corte.
function validarElementosInterioresPano(
  modelo: Modelo,
  errores: ErrorObra[],
  acoples: ResultadoAcoples,
  pilaresInteriores: PilaresInteriores,
): void {
  // Orden por id de paño (determinista); dentro, los helpers ya ordenan por id.
  const panosOrdenados = [...modelo.panos].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const pano of panosOrdenados) {
    // [RESERVA-3] Precedencia del cap: el paño no se mallo (esta en erroresMallado, XOR
    // con porPano). Se emite SOLO PANO_DEMASIADOS_PILARES y se callan sus elementos
    // interiores (pilares Y vigas): un unico error de obra en vez de doble reporte.
    const errorMallado = acoples.erroresMallado.get(pano.id);
    if (errorMallado !== undefined) {
      errores.push({
        codigo: "PANO_DEMASIADOS_PILARES",
        severidad: "error",
        // El mensaje ya viene en lenguaje de obra desde mallado.ts (mallado.ts:409-411).
        mensaje: errorMallado.mensaje,
        elementoId: pano.id,
        elementoTipo: "pano",
      });
      continue;
    }

    const acople = acoples.porPano.get(pano.id);
    // Pilares REALMENTE acoplados por la losa plana (vacio en el corte 2 y en DP1).
    const acoplados = new Set(acople?.pilaresAcoplados ?? []);
    // Pilares que forman parte de una junta (los explica PANO_PILARES_JUNTOS).
    const juntos = new Set<string>();
    for (const [a, b] of acoples.pilaresJuntos.get(pano.id) ?? []) {
      juntos.add(a);
      juntos.add(b);
    }

    for (const pilar of pilaresInteriores(modelo, pano)) {
      if (acoplados.has(pilar.id)) continue; // recogido por la losa plana: apoyo legitimo
      if (juntos.has(pilar.id)) continue; // lo explica PANO_PILARES_JUNTOS
      errores.push({
        codigo: "PANO_PILAR_INTERIOR",
        severidad: "error",
        mensaje: `El pilar "${pilar.nombre}" atraviesa el paño "${pano.nombre}" por dentro y no lo recoge. La losa plana necesita al menos dos pilares (o pilares y vigas) para apoyarse; añade otro apoyo, lleva vigas hasta el pilar (partiendo el paño en crujías) o retíralo.`,
        elementoId: pilar.id,
        elementoTipo: "pilar",
        posicion: { x: pilar.x, y: pilar.y },
      });
    }
    for (const viga of vigasInterioresBajoPano(modelo, pano)) {
      errores.push({
        codigo: "PANO_VIGA_INTERIOR",
        severidad: "error",
        mensaje: `La viga "${viga.nombre}" pasa por dentro del paño "${pano.nombre}" y aún no puede recogerlo. Parte el paño en crujías siguiendo la viga o retírala.`,
        elementoId: viga.id,
        elementoTipo: "viga",
      });
    }
  }
}

// 6b. Pilares JUNTOS bajo un paño [F2.0]: dos (o mas) cabezas de pilar interiores caen
// en la MISMA celda 2D de la malla (misma clave de posicion = reclamarian el MISMO
// nudo de malla, colision de acople silenciosa). `acople.ts` lo DETECTA por celda 2D
// (RESERVA-2, el mismo criterio del remap del Paso 6c); aqui se EMITE como error de
// obra que NOMBRA los dos pilares y el paño. BLOQUEA: no se puede acoplar cada pilar por
// separado si comparten nudo. Determinista: paños por id, pares ya ordenados por id (a<b)
// desde acople.ts.
function validarPilaresJuntos(
  modelo: Modelo,
  errores: ErrorObra[],
  acoples: ResultadoAcoples,
): void {
  const panoPorId = new Map(modelo.panos.map((p) => [p.id, p]));
  const pilarPorId = new Map(modelo.pilares.map((p) => [p.id, p]));
  const panoIds = [...acoples.pilaresJuntos.keys()].sort();
  for (const panoId of panoIds) {
    // [Codex #5] Precedencia del cap: si el paño esta en `erroresMallado`
    // (PANO_DEMASIADOS_PILARES), el cap manda y emite SOLO ese error; sus pilares juntos
    // se CALLAN (igual que validarElementosInterioresPano hace `continue` bajo cap). Sin
    // esto, un paño capado con un par junto recibiria ademas PANO_PILARES_JUNTOS: doble
    // error que contradice la precedencia documentada.
    if (acoples.erroresMallado.has(panoId)) continue;
    const pano = panoPorId.get(panoId);
    if (pano === undefined) continue; // defensivo: acople siempre parte de modelo.panos
    for (const [idA, idB] of acoples.pilaresJuntos.get(panoId)!) {
      const pa = pilarPorId.get(idA);
      const pb = pilarPorId.get(idB);
      if (pa === undefined || pb === undefined) continue; // defensivo
      errores.push({
        codigo: "PANO_PILARES_JUNTOS",
        severidad: "error",
        mensaje: `Los pilares "${pa.nombre}" y "${pb.nombre}" caen en el mismo punto del paño "${pano.nombre}" y no se pueden apoyar por separado. Sepáralos o revisa sus coordenadas.`,
        // Apunta al primer pilar del par (el de id menor); ambos nombres van en el mensaje.
        elementoId: pa.id,
        elementoTipo: "pilar",
        posicion: { x: pa.x, y: pa.y },
      });
    }
  }
}

// 7. Avisos del estado del acople [OV-2]: comunican COMO va a apoyar la losa sin
// bloquear (el calculo es correcto en ambos casos; se gestiona la expectativa).
function validarAvisosAcople(
  modelo: Modelo,
  errores: ErrorObra[],
  acoples: ResultadoAcoples,
): void {
  const panosOrdenados = [...modelo.panos].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const pano of panosOrdenados) {
    const acople = acoples.porPano.get(pano.id);
    if (acople === undefined) continue;
    // Un UNICO nudo de BORDE sobre viga: el acople se degrada a aislado (con un
    // punto no se puede sujetar la losa en su plano a traves del portico). El
    // usuario probablemente ESPERABA que apoyara en esa viga: se le avisa. Se
    // cuenta con `nodosBordeAcoplados` (fuente unica, RESERVA-4), NUNCA con
    // `nodosAcoplados.size`: ese set incluye cabezas de pilar interiores y un
    // pilar solitario dispararia aqui un aviso que habla de prolongar vigas
    // (su caso real es PANO_PILAR_INTERIOR, DP1).
    if (!acople.acopleActivo && acople.nodosBordeAcoplados === 1) {
      errores.push({
        codigo: "PANO_ACOPLE_INSUFICIENTE",
        severidad: "aviso",
        mensaje: `El paño "${pano.nombre}" solo toca el pórtico en un punto: se calcula aislado (no descarga en las vigas). Prolonga las vigas bajo su contorno para acoplarlo.`,
        elementoId: pano.id,
        elementoTipo: "pano",
      });
    }
    // Acople PARCIAL con apoyo de borde elegido: parte del borde descansa en vigas
    // (acoplado) y el resto usa el bordeApoyo. Es legitimo (p.ej. un borde futuro
    // sobre muro) pero conviene decirlo: el reparto no es simetrico.
    if (acople.acopleActivo && acople.bordeParcial && pano.bordeApoyo !== "libre") {
      errores.push({
        codigo: "PANO_BORDE_PARCIAL",
        severidad: "aviso",
        mensaje: `El paño "${pano.nombre}" descarga en vigas solo en parte de su contorno; el resto del borde usa el apoyo elegido (${pano.bordeApoyo === "simple" ? "apoyado" : "empotrado"}).`,
        elementoId: pano.id,
        elementoTipo: "pano",
      });
    }
  }
}

// 8. Cargas AUTOMATICAS de planta (F3.4; antes de grupo, F3.2 D-1): red del borde
// y gestion de expectativas.
function validarCargasPlanta(modelo: Modelo, errores: ErrorObra[]): void {
  // ID_RESERVADO (red defensiva FINAL): la frontera de import ya SANEA la colision
  // renombrando la hipotesis intrusa [OV-4]; si aun asi llega una hipotesis con un
  // id sintetico (p.ej. creada programaticamente saltandose la frontera), se
  // bloquea: su `case` colisionaria en el solver con la carga automatica de planta
  // y se sumarian esfuerzos en silencio.
  for (const h of modelo.hipotesis) {
    if (h.id === CASE_CM_PLANTA || h.id === CASE_USO_PLANTA) {
      errores.push({
        codigo: "ID_RESERVADO",
        severidad: "error",
        mensaje: `La hipótesis "${h.nombre}" usa un identificador reservado para las cargas automáticas de planta. Vuelve a importar el proyecto o recrea la hipótesis.`,
        elementoId: h.id,
        elementoTipo: "hipotesis",
      });
    }
  }
  // PLANTA_VALOR_NEGATIVO (aviso, [2A]): un valor negativo NO se aplica (una carga
  // "muerta" ascendente es un error de tecleo casi seguro); callarlo haria creer al
  // usuario que esa carga existe. Solo avisa si la planta tiene paños que la
  // recibirian (si no, lo cubre PLANTA_CARGA_SIN_PANO).
  for (const p of plantasConValorNegativo(modelo)) {
    errores.push({
      codigo: "PLANTA_VALOR_NEGATIVO",
      severidad: "aviso",
      mensaje: `La planta "${p.nombre}" tiene un valor negativo en ${
        p.campo === "cargasMuertas" ? "cargas muertas" : "la sobrecarga de uso"
      }: no se aplica a sus paños. Revisa el dato en el diálogo de Plantas.`,
      elementoId: p.plantaId,
      elementoTipo: "planta",
    });
  }
  // PLANTA_CARGA_SIN_PANO (aviso, F3.4 honestidad): la planta declara sobrecarga o
  // cargas muertas (> 0) pero no tiene ningun paño que las reciba, asi que el
  // calculo las IGNORA. Callarlo hacia creer que esas cargas actuaban (la queja
  // que motivo F3.4). No bloquea: un portico desnudo con cargas lineales en vigas
  // es un modelo legitimo.
  for (const p of plantasConCargaSinPano(modelo)) {
    const campos: string[] = [];
    if (Number.isFinite(p.sobrecargaUso) && p.sobrecargaUso > 0) campos.push("la sobrecarga de uso");
    if (Number.isFinite(p.cargasMuertas) && p.cargasMuertas > 0) campos.push("las cargas muertas");
    errores.push({
      codigo: "PLANTA_CARGA_SIN_PANO",
      severidad: "aviso",
      mensaje: `La planta "${p.nombre}" define ${campos.join(" y ")} pero no tiene ningún paño: esas cargas no entran en el cálculo. Introduce un paño, aplica cargas lineales sobre las vigas o pon el valor a cero.`,
      elementoId: p.id,
      elementoTipo: "planta",
    });
  }
  // PLANTA_Y_SUPERFICIAL (aviso, [OV-1]): un paño con carga superficial MANUAL y
  // ademas cargas automaticas de planta puede estar contando la misma accion dos
  // veces (proyectos anteriores a F3.2 metian a mano lo que el grupo no aplicaba).
  // Coexistir es legitimo (p.ej. tabiqueria manual + uso de la planta): NO bloquea.
  const panosOrdenados = [...modelo.panos].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const pano of panosOrdenados) {
    if (cargasPlantaDePano(modelo, pano).length === 0) continue;
    const tieneSuperficialManual = modelo.cargas.some(
      (c) => c.tipo === "superficial" && c.ambito === pano.id,
    );
    if (tieneSuperficialManual) {
      errores.push({
        codigo: "PLANTA_Y_SUPERFICIAL",
        severidad: "aviso",
        mensaje: `El paño "${pano.nombre}" recibe cargas superficiales introducidas a mano además de las automáticas de su planta: revisa que no estén duplicadas.`,
        elementoId: pano.id,
        elementoTipo: "pano",
      });
    }
  }
}

// --- Validaciones EXCLUSIVAS del camino modal (F2b) --------------------------
// El analisis modal es un camino de calculo SEPARADO (no un OpcionesAnalisis.tipo):
// se invoca con `discretizar(modelo, { modal: { numModos } })`. Estas dos guardas
// SOLO se ejecutan en ese camino (la orquestacion les pasa el contexto modal); en el
// calculo estatico no aplican. Fallan RAPIDO en lenguaje de obra, antes del motor:
// el spike confirmo que sin masa el motor lanza "massless" (jerga inutil para el
// arquitecto) y que numModos invalido produce errores tecnicos opacos.

// Contexto modal que la orquestacion (discretizar) pasa a las validaciones cuando el
// calculo es modal. `undefined`/ausente => calculo estatico, las guardas no corren.
export type ContextoModal = { numModos: number };

// M1 (MODAL_NUM_MODOS): el nº de modos pedido debe ser un entero > 0. Un 0 o negativo
// no tiene sentido fisico y el motor lo rechazaria con un error tecnico. BLOQUEA.
function validarModalNumModos(modal: ContextoModal, errores: ErrorObra[]): void {
  if (!Number.isInteger(modal.numModos) || modal.numModos <= 0) {
    errores.push({
      codigo: "MODAL_NUM_MODOS",
      severidad: "error",
      mensaje: "El número de modos a calcular debe ser mayor que cero.",
      elementoTipo: "modelo",
    });
  }
}

// M2 (MODAL_SIN_MASA): el analisis modal necesita masa para vibrar. La masa ya no viene
// solo de las barras: el motor la deriva del peso propio (`rho` del material) de pilares
// y vigas Y de la masa de placa (rho·t) que fabrica el glue para las losas (F-masa-placa).
// Asi que basta con que exista un pilar, una viga o un paño LOSA con material de `rho>0`.
// Solo cuentan los paños `tipo === "losa"`: reticular/unidireccional no se discretizan
// (los bloquea PANO_TIPO_NO_SOPORTADO aguas abajo) y por tanto no aportan masa. Si no hay
// masa alguna, el motor lanzaria "massless" (jerga); esta red lo atrapa antes, en lenguaje
// de obra. Se lee `rho` via `materialAportaMasa` (A-dry, throw-safe: una ref de material
// rota no aporta masa y ya la cazo REF_MATERIAL). BLOQUEA.
function validarModalConMasa(modelo: Modelo, errores: ErrorObra[]): void {
  const hayMasa =
    modelo.pilares.some((p) => materialAportaMasa(p.materialId)) ||
    modelo.vigas.some((v) => materialAportaMasa(v.materialId)) ||
    modelo.panos.some(
      (p) => p.tipo === "losa" && materialAportaMasa(p.materialId),
    );
  if (!hayMasa) {
    errores.push({
      codigo: "MODAL_SIN_MASA",
      severidad: "error",
      mensaje:
        "El análisis modal necesita masa: el modelo no tiene elementos estructurales con peso.",
      elementoTipo: "modelo",
    });
  }
}

// Punto de entrada: ejecuta todas las validaciones y devuelve la lista de errores.
// `[]` significa modelo valido (apto para discretizar). PURO: no muta el modelo.
//
// `modal` (opcional): si se pasa, el calculo es MODAL y se aplican ademas las dos
// guardas exclusivas del camino modal (MODAL_NUM_MODOS, MODAL_SIN_MASA). Ausente =>
// calculo estatico, identico a antes (las guardas modales no corren): sin regresion.
//
// `acoples` (opcional, [1A]): resultado de `calcularAcoples(modelo)` YA computado por
// el llamante. `discretizar` lo pasa (computa UNA vez y lo comparte con su Paso 6c);
// sin el, se computa aqui (fallback para prepararModeloCR y llamantes directos). Por
// ser una funcion PURA del modelo, pasado o computado el resultado es identico: las
// validaciones y lo que el discretizador emite no pueden divergir.
export function validarModelo(
  modelo: Modelo,
  modal?: ContextoModal,
  acoples?: ResultadoAcoples,
): ErrorObra[] {
  const errores: ErrorObra[] = [];
  const acoplesReales = acoples ?? calcularAcoples(modelo);
  // Memo de pilares interiores por paño (una sola pasada de geometria por paño,
  // reusada por validarRefsPano y validarElementosInterioresPano).
  const pilaresInteriores = crearMemoPilaresInteriores();
  validarNombresUnicos(modelo, errores);
  validarIdsUnicos(modelo, errores); // [M-1] ids duplicados = proyecto dañado
  validarPilaresDegenerados(modelo, errores); // [M-3] pilar de longitud 0
  validarReferencias(modelo, errores, acoplesReales, pilaresInteriores);
  validarHipotesisPesoPropio(modelo, errores); // E1: guard de desincronizacion
  validarObraVacia(modelo, errores); // UX-VACIA: sin elementos no hay nada que calcular
  validarSujecion(modelo, errores, acoplesReales);
  validarElementosInterioresPano(modelo, errores, acoplesReales, pilaresInteriores); // [OV-5/TODO-2/F2.0] pilar/viga interior condicional + cap
  validarPilaresJuntos(modelo, errores, acoplesReales); // [F2.0] dos pilares en la misma celda de malla
  validarAvisosAcople(modelo, errores, acoplesReales); // [OV-2] parcial/insuficiente
  validarCargasPlanta(modelo, errores); // [D-1/F3.4] id reservado + negativo + sin paño + duplicidad
  validarHipotesisConCargas(modelo, errores);
  validarVariablesConcomitantes(modelo, errores);
  validarNudosFlotantes(modelo, errores);
  if (modal !== undefined) {
    validarModalNumModos(modal, errores);
    validarModalConMasa(modelo, errores);
  }
  return errores;
}
