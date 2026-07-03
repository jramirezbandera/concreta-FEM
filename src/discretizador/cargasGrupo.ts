// Cargas AUTOMATICAS de GRUPO sobre los paños (F3.2, cierra D-1 de la auditoria
// UI/UX). `Grupo.cargasMuertas` (permanente, G) y `Grupo.sobrecargaUso` (variable,
// Q) — que el usuario introduce en "Datos generales" y hasta ahora NO influian en
// el calculo — se aplican como PRESIONES superficiales sobre cada paño losa de las
// plantas del grupo. Con el acople paño<->portico, esas cargas bajan de verdad a
// vigas y pilares.
//
// MECANISMO (decision D-E del plan, SIN migracion de esquema): las cargas viajan en
// dos "cases" SINTETICOS de la Capa 2 (no son Hipotesis de Capa 1: no se persisten,
// no aparecen en el dialogo de hipotesis, no tocan hipotesisAutomatica/E1-E4). Los
// combos les aplican el gamma que corresponde a su naturaleza (G/Q).
//
// FUENTE UNICA [2A]: este modulo es el UNICO que decide "¿que carga de grupo recibe
// este paño?" y "¿que cases sinteticos estan activos?". Lo consumen el Paso 6c de
// discretizar (emision de quad_loads) Y generarCombos (factores) — no pueden
// divergir: un combo jamas llevara un termino sin carga (espejo del principio E4)
// ni una carga se quedara sin factor.
//
// MODULO HOJA: importa solo ../dominio. PURO y determinista.

import type { Modelo, Pano } from "../dominio";
import { plantaPorId, grupoPorId } from "../dominio";

// Ids de los cases sinteticos de la Capa 2. RESERVADOS: una Hipotesis de usuario no
// puede usarlos (colision de case en el solver). La frontera de import los SANEA
// renombrando la hipotesis intrusa [OV-4]; validaciones conserva ID_RESERVADO como
// red defensiva final.
export const CASE_CM_GRUPO = "auto-grupo-cm"; // cargas muertas del grupo (G)
export const CASE_USO_GRUPO = "auto-grupo-uso"; // sobrecarga de uso del grupo (Q)

// Una carga de grupo a aplicar sobre un paño: presion en kN/m², POSITIVA = hacia
// abajo (convencion del quad con orden i→j→m→n CCW, misma que el peso propio de
// losa +ρ·t; verificada contra el motor real en F3 corte 1).
export type CargaGrupoPano = { case: string; presion: number };

// Cargas de grupo de UN paño, en orden determinista y documentado: CM primero, uso
// despues (el Paso 6c las emite tras el peso propio: usuario → pp → CM → uso).
// Devuelve [] si el paño no es losa, su planta/grupo no resuelven (el bloqueo real
// llega antes por REF_PLANTA) o los valores no aportan (<= 0; el valor NEGATIVO
// ademas se avisa en validaciones: GRUPO_VALOR_NEGATIVO, no se aplica en silencio).
export function cargasGrupoDePano(modelo: Modelo, pano: Pano): CargaGrupoPano[] {
  if (pano.tipo !== "losa") return [];
  const planta = plantaPorId(modelo, pano.plantaId);
  if (planta === undefined) return [];
  const grupo = grupoPorId(modelo, planta.grupoId);
  if (grupo === undefined) return [];
  const cargas: CargaGrupoPano[] = [];
  if (Number.isFinite(grupo.cargasMuertas) && grupo.cargasMuertas > 0) {
    cargas.push({ case: CASE_CM_GRUPO, presion: grupo.cargasMuertas });
  }
  if (Number.isFinite(grupo.sobrecargaUso) && grupo.sobrecargaUso > 0) {
    cargas.push({ case: CASE_USO_GRUPO, presion: grupo.sobrecargaUso });
  }
  return cargas;
}

// ¿Que cases sinteticos estan ACTIVOS en el modelo? (= algun paño losa recibira esa
// carga). Gobierna los factores de generarCombos: sin consumidor, sin termino
// fantasma (espejo de E4). Un modelo sin paños devuelve ambos false y los combos
// son byte-identicos a los de siempre.
export function casesGrupoActivos(modelo: Modelo): { cm: boolean; uso: boolean } {
  let cm = false;
  let uso = false;
  for (const pano of modelo.panos) {
    for (const carga of cargasGrupoDePano(modelo, pano)) {
      if (carga.case === CASE_CM_GRUPO) cm = true;
      if (carga.case === CASE_USO_GRUPO) uso = true;
    }
    if (cm && uso) break;
  }
  return { cm, uso };
}

// Grupos con un valor NEGATIVO en sus cargas (error de tecleo probable) que ademas
// tienen algun paño losa que lo recibiria: alimenta el aviso GRUPO_VALOR_NEGATIVO
// (validaciones). Un valor negativo NO se aplica (una "carga muerta" ascendente no
// tiene sentido fisico); avisarlo evita que el usuario crea que esta aplicada.
export function gruposConValorNegativo(
  modelo: Modelo,
): { grupoId: string; nombre: string; campo: "cargasMuertas" | "sobrecargaUso" }[] {
  // Grupos que tienen algun paño losa en sus plantas (si no, el valor es inerte).
  const gruposConPano = new Set<string>();
  for (const pano of modelo.panos) {
    if (pano.tipo !== "losa") continue;
    const planta = plantaPorId(modelo, pano.plantaId);
    if (planta !== undefined) gruposConPano.add(planta.grupoId);
  }
  const res: { grupoId: string; nombre: string; campo: "cargasMuertas" | "sobrecargaUso" }[] = [];
  // Orden de modelo.grupos: el aviso es informativo (no entra en la Capa 2).
  for (const g of modelo.grupos) {
    if (!gruposConPano.has(g.id)) continue;
    if (g.cargasMuertas < 0) res.push({ grupoId: g.id, nombre: g.nombre, campo: "cargasMuertas" });
    if (g.sobrecargaUso < 0) res.push({ grupoId: g.id, nombre: g.nombre, campo: "sobrecargaUso" });
  }
  return res;
}
