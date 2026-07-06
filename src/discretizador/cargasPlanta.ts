// Cargas AUTOMATICAS de PLANTA sobre los paños (F3.4, "plantas sin grupos";
// sustituye a cargasGrupo.ts de F3.2). `Planta.cargasMuertas` (permanente, G) y
// `Planta.sobrecargaUso` (variable, Q) — que el usuario introduce en el dialogo de
// Plantas — se aplican como PRESIONES superficiales sobre cada paño losa de esa
// planta. Con el acople paño<->portico, esas cargas bajan de verdad a vigas y pilares.
//
// MECANISMO (heredado de F3.2, decision D-E): las cargas viajan en dos "cases"
// SINTETICOS de la Capa 2 (no son Hipotesis de Capa 1: no se persisten, no aparecen
// en el dialogo de hipotesis, no tocan hipotesisAutomatica/E1-E4). Los combos les
// aplican el gamma que corresponde a su naturaleza (G/Q).
//
// FUENTE UNICA [2A]: este modulo es el UNICO que decide "¿que carga de planta recibe
// este paño?" y "¿que cases sinteticos estan activos?". Lo consumen el Paso 6c de
// discretizar (emision de quad_loads) Y generarCombos (factores) — no pueden
// divergir: un combo jamas llevara un termino sin carga (espejo del principio E4)
// ni una carga se quedara sin factor.
//
// MODULO HOJA: importa solo ../dominio. PURO y determinista.

import type { Modelo, Pano, Planta } from "../dominio";
import { plantaPorId } from "../dominio";

// Ids de los cases sinteticos de la Capa 2. RESERVADOS: una Hipotesis de usuario no
// puede usarlos (colision de case en el solver). La frontera de import los SANEA
// renombrando la hipotesis intrusa [OV-4]; validaciones conserva ID_RESERVADO como
// red defensiva final.
export const CASE_CM_PLANTA = "auto-planta-cm"; // cargas muertas de la planta (G)
export const CASE_USO_PLANTA = "auto-planta-uso"; // sobrecarga de uso de la planta (Q)

// Una carga de planta a aplicar sobre un paño: presion en kN/m², POSITIVA = hacia
// abajo (convencion del quad con orden i→j→m→n CCW, misma que el peso propio de
// losa +ρ·t; verificada contra el motor real en F3 corte 1).
export type CargaPlantaPano = { case: string; presion: number };

// Cargas de planta de UN paño, en orden determinista y documentado: CM primero, uso
// despues (el Paso 6c las emite tras el peso propio: usuario → pp → CM → uso).
// Devuelve [] si el paño no es losa, su planta no resuelve (el bloqueo real llega
// antes por REF_PLANTA) o los valores no aportan (<= 0; el valor NEGATIVO ademas se
// avisa en validaciones: PLANTA_VALOR_NEGATIVO, no se aplica en silencio).
export function cargasPlantaDePano(modelo: Modelo, pano: Pano): CargaPlantaPano[] {
  if (pano.tipo !== "losa") return [];
  const planta = plantaPorId(modelo, pano.plantaId);
  if (planta === undefined) return [];
  const cargas: CargaPlantaPano[] = [];
  if (Number.isFinite(planta.cargasMuertas) && planta.cargasMuertas > 0) {
    cargas.push({ case: CASE_CM_PLANTA, presion: planta.cargasMuertas });
  }
  if (Number.isFinite(planta.sobrecargaUso) && planta.sobrecargaUso > 0) {
    cargas.push({ case: CASE_USO_PLANTA, presion: planta.sobrecargaUso });
  }
  return cargas;
}

// ¿Que cases sinteticos estan ACTIVOS en el modelo? (= algun paño losa recibira esa
// carga). Gobierna los factores de generarCombos: sin consumidor, sin termino
// fantasma (espejo de E4). Un modelo sin paños devuelve ambos false y los combos
// son byte-identicos a los de siempre.
export function casesPlantaActivos(modelo: Modelo): { cm: boolean; uso: boolean } {
  let cm = false;
  let uso = false;
  for (const pano of modelo.panos) {
    for (const carga of cargasPlantaDePano(modelo, pano)) {
      if (carga.case === CASE_CM_PLANTA) cm = true;
      if (carga.case === CASE_USO_PLANTA) uso = true;
    }
    if (cm && uso) break;
  }
  return { cm, uso };
}

// Plantas con un valor NEGATIVO en sus cargas (error de tecleo probable) que ademas
// tienen algun paño losa que lo recibiria: alimenta el aviso PLANTA_VALOR_NEGATIVO
// (validaciones). Un valor negativo NO se aplica (una "carga muerta" ascendente no
// tiene sentido fisico); avisarlo evita que el usuario crea que esta aplicada.
export function plantasConValorNegativo(
  modelo: Modelo,
): { plantaId: string; nombre: string; campo: "cargasMuertas" | "sobrecargaUso" }[] {
  // Plantas que tienen algun paño losa (si no, el valor es inerte y lo cubre el
  // aviso PLANTA_CARGA_SIN_PANO).
  const plantasConPano = new Set<string>();
  for (const pano of modelo.panos) {
    if (pano.tipo !== "losa") continue;
    if (plantaPorId(modelo, pano.plantaId) !== undefined) {
      plantasConPano.add(pano.plantaId);
    }
  }
  const res: { plantaId: string; nombre: string; campo: "cargasMuertas" | "sobrecargaUso" }[] = [];
  // Orden de modelo.plantas: el aviso es informativo (no entra en la Capa 2).
  for (const p of modelo.plantas) {
    if (!plantasConPano.has(p.id)) continue;
    if (p.cargasMuertas < 0) res.push({ plantaId: p.id, nombre: p.nombre, campo: "cargasMuertas" });
    if (p.sobrecargaUso < 0) res.push({ plantaId: p.id, nombre: p.nombre, campo: "sobrecargaUso" });
  }
  return res;
}

// HONESTIDAD (F3.4): plantas cuyos valores de carga (> 0) NO llegan al calculo
// porque la planta no tiene ningun paño losa que los reciba. Sin este aviso el
// usuario teclea kN/m² en el dialogo de Plantas y el calculo los ignora en
// silencio (el origen de la queja que motivo F3.4). Alimenta PLANTA_CARGA_SIN_PANO.
export function plantasConCargaSinPano(modelo: Modelo): Planta[] {
  const plantasConPano = new Set<string>();
  for (const pano of modelo.panos) {
    if (pano.tipo === "losa") plantasConPano.add(pano.plantaId);
  }
  return modelo.plantas.filter(
    (p) =>
      !plantasConPano.has(p.id) &&
      ((Number.isFinite(p.cargasMuertas) && p.cargasMuertas > 0) ||
        (Number.isFinite(p.sobrecargaUso) && p.sobrecargaUso > 0)),
  );
}
