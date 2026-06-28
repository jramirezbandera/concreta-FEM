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
import type { Modelo, Pilar, Viga, Carga } from "../dominio";
import { plantaPorId, nudoPorId, seccionPorId, esHipotesisAutomatica } from "../dominio";
import { getMaterial, getSeccion } from "../biblioteca";
import { TOL_NODO, mapearEjes, clavePosicion } from "./geometria";

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
  elementoId?: string; // id del Pilar/Viga/Nudo/Carga/... culpable
  elementoTipo?: "pilar" | "viga" | "nudo" | "carga" | "hipotesis" | "planta" | "modelo";
};

// Resuelve si la seccion referenciada por `seccionId` existe y es construible.
//
// DECISION (cierre de hueco, Fase 2): el `Modelo` ya PERSISTE `modelo.secciones`
// (union discriminada por `tipo`). La seccion se resuelve contra ese almacen de
// obra con `seccionPorId`, no contra el catalogo. Reglas por variante:
//   - perfilMetalico: ademas de existir en la obra, su `perfilId` debe apuntar a
//     una entrada real del catalogo de perfiles (PERFILES via `getSeccion`).
//   - hormigonRectangular / hormigonCircular / generico: se autoabastecen de sus
//     propias dimensiones/propiedades (b/h, d, o A/Iy/Iz/J), no dependen del
//     catalogo; basta con que la seccion exista en la obra.
function seccionResoluble(modelo: Modelo, seccionId: string): boolean {
  const seccion = seccionPorId(modelo, seccionId);
  if (seccion === undefined) return false;
  if (seccion.tipo === "perfilMetalico") {
    return getSeccion(seccion.perfilId) !== undefined;
  }
  return true;
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

// 1. Nombres unicos de pilares, vigas, hipotesis, plantas y grupos.
function validarNombresUnicos(modelo: Modelo, errores: ErrorObra[]): void {
  comprobarNombresUnicos(errores, modelo.pilares, "pilar", "pilar");
  comprobarNombresUnicos(errores, modelo.vigas, "viga", "viga");
  comprobarNombresUnicos(errores, modelo.hipotesis, "hipotesis", "hipótesis");
  comprobarNombresUnicos(errores, modelo.plantas, "planta", "planta");
  // Grupos tambien se nombran; un grupo duplicado confunde el arbol de obra.
  comprobarNombresUnicos(errores, modelo.grupos, "modelo", "grupo");
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

// 2c. Referencias de una Carga: ambito (elemento existente) e hipotesis.
function validarRefsCarga(
  c: Carga,
  modelo: Modelo,
  errores: ErrorObra[],
  ambitosValidos: ReadonlySet<string>,
): void {
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
      mensaje: `Una carga pertenece a una hipótesis que no existe.`,
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
      mensaje: `Una carga está asignada a la hipótesis de peso propio, que el sistema calcula automáticamente. Asígnala a otra hipótesis.`,
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
function validarReferencias(modelo: Modelo, errores: ErrorObra[]): void {
  for (const p of modelo.pilares) validarRefsPilar(p, modelo, errores);
  for (const v of modelo.vigas) validarRefsViga(v, modelo, errores);

  // Ambito de carga: el id de cualquier elemento sobre el que puede actuar una
  // carga en F1 (viga, pilar, nudo o pano). Se precomputa un Set para O(1).
  const ambitosValidos = new Set<string>();
  for (const v of modelo.vigas) ambitosValidos.add(v.id);
  for (const p of modelo.pilares) ambitosValidos.add(p.id);
  for (const n of modelo.nudos) ambitosValidos.add(n.id);
  for (const pano of modelo.panos) ambitosValidos.add(pano.id);

  for (const c of modelo.cargas) validarRefsCarga(c, modelo, errores, ambitosValidos);
}

// 3. Sujecion suficiente (6 GDL de solido rigido) ANTES del solver.
// HEURISTICA F1: la estructura debe tener al menos un pilar con vinculacion
// exterior (su arranque sujeta la obra al terreno). Sin ninguno, la estructura
// "flota" y el calculo no tendria solucion. El veredicto exacto de mecanismo lo
// dara `check_stability` del solver (feature-5/6); aqui se atrapa el caso obvio.
function validarSujecion(modelo: Modelo, errores: ErrorObra[]): void {
  // Si no hay elementos estructurales, no hay nada que sujetar (no es un error de
  // sujecion: un modelo vacio es valido como punto de partida).
  if (modelo.pilares.length === 0 && modelo.vigas.length === 0) return;

  const haySujecion = modelo.pilares.some((p) => p.vinculacionExterior);
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
        mensaje: `Hay un punto en la obra que no conecta con ninguna viga.`,
        elementoId: n.id,
        elementoTipo: "nudo",
      });
    }
  }
}

// Punto de entrada: ejecuta todas las validaciones y devuelve la lista de errores.
// `[]` significa modelo valido (apto para discretizar). PURO: no muta el modelo.
export function validarModelo(modelo: Modelo): ErrorObra[] {
  const errores: ErrorObra[] = [];
  validarNombresUnicos(modelo, errores);
  validarReferencias(modelo, errores);
  validarHipotesisPesoPropio(modelo, errores); // E1: guard de desincronizacion
  validarSujecion(modelo, errores);
  validarHipotesisConCargas(modelo, errores);
  validarVariablesConcomitantes(modelo, errores);
  validarNudosFlotantes(modelo, errores);
  return errores;
}
