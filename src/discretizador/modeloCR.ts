// Preparacion del modelo para el CENTRO DE RIGIDEZ (CR) FEM-exacto (F1.1, F2).
//
// `prepararModeloCR(modelo)` produce la Capa 2 BASE (geometria + rigidez, SIN cargas/
// combos de usuario ni peso propio) + la informacion por planta (`plantasInfo`) que el
// glue Python `calcular_cr` necesita para fabricar un diafragma rigido por planta y
// medir el centro de rigidez. El CR NO usa cargas del usuario: el glue aplica sus
// propias cargas unitarias (FX/FZ/MY) sobre el nudo maestro de cada planta.
//
// FACTORING (Codex #15, decision del plan): NO es un wrapper de `discretizar`. Si la
// validacion de `discretizar` bloqueara por motivos de CARGA que no afectan al CR
// (p.ej. una carga superficial sin paños -> PANO_NO_SOPORTADO, una hipotesis vacia),
// el CR quedaria injustamente bloqueado. Por eso aqui se SEPARA el camino:
//   1) Se valida solo lo que afecta a la rigidez: REFERENCIAS, SUJECION y nombres
//      (via `validarModelo`, cuya capa de "error" NO incluye la traduccion de cargas:
//      esa vive dentro de `discretizar`, no en `validarModelo`).
//   2) Se construye la base FEM reusando `construirBaseFEM` (la MISMA factorizacion
//      que usa `discretizar` para sus Pasos 1-5: snapping, propiedadesBarra, releases,
//      apoyos, trazabilidad). No se duplica logica FEM ni geometria.
// Resultado: un modelo con carga superficial (que `discretizar` bloquearia) SI produce
// un CR ok (el golden/unit lo demuestra).
//
// PURO y DETERMINISTA (byte a byte): sin React/IO/Pyodide; reusa el determinismo del
// discretizador (nodos por (Y,X,Z), trazabilidad ordenada por id, desempate por id en
// nodoFEMAPlanta). Lo consumen el worker/cliente (`calcularCR`) en F1.3.

import type { Modelo } from "../dominio";
import { plantaPorId } from "../dominio";
import type { ModeloFEM } from "./contratoFEM";
import { ModeloFEMSchema } from "./contratoFEM";
import { construirBaseFEM } from "./discretizar";
import { validarModelo, type ErrorObra } from "./validaciones";

// Informacion por planta para el diafragma rigido del glue (F1.2). Coordenadas FEM
// (mapearEjes: FEM X = obra x, FEM Z = obra y, FEM Y = cota). El CR resultante en
// (FEM X, FEM Z) se reinterpreta como obra (x,y) por la identidad de mapearEjes.
export type PlantaInfoCR = {
  plantaId: string;
  // Nombres de nudos FEM ("N3", ...) de esta planta, via trazabilidad.nodoFEMAPlanta.
  nodos: string[];
  // Coords FEM del nudo MAESTRO del diafragma: centroide aritmetico de (X,Z) de
  // `nodos`, a la cota (Y) de la planta. El glue ata `nodos` a este maestro y aplica
  // sobre el las cargas unitarias del CR.
  maestro: { x: number; y: number; z: number };
};

// Resultado de `prepararModeloCR`. Espejo del contrato del discretizador (ok/errores
// en lenguaje de obra). En `ok:true` no hay canal de avisos: el CR ignora los avisos
// de la base (p.ej. arranque elastico tratado como empotrado), que se reportan en el
// camino normal de calculo.
export type ResultadoPrepararCR =
  | { ok: true; modeloFEM: ModeloFEM; plantasInfo: PlantaInfoCR[] }
  | { ok: false; errores: ErrorObra[] };

export function prepararModeloCR(modelo: Modelo): ResultadoPrepararCR {
  // 1) Validacion de RIGIDEZ (no de cargas): referencias rotas, sin sujecion, nombres
  // duplicados, viga degenerada. `validarModelo` (sin contexto modal) NO incluye la
  // traduccion de cargas (esa la hace `discretizar` en su Paso 6), de modo que una
  // carga superficial/no aplicable NO bloquea el CR. Solo los "error" bloquean; los
  // "aviso" (hipotesis vacia, nudo flotante, concomitancia) son irrelevantes para el CR.
  const bloqueantes = validarModelo(modelo).filter((e) => e.severidad === "error");
  if (bloqueantes.length > 0) {
    return { ok: false, errores: bloqueantes };
  }

  // 2) Base FEM (geometria + rigidez + trazabilidad), SIN cargas. Misma factorizacion
  // que usa `discretizar`: no se duplica logica FEM. Tras validar, sus throw internos
  // son bugs internos, no errores de obra.
  const base = construirBaseFEM(modelo);

  // ModeloFEM BASE: solo geometria + rigidez. node_loads/dist_loads/pt_loads vacios
  // (el CR no usa cargas del usuario; las fabrica el glue). `combos` vacio (no hay
  // hipotesis que combinar; el glue define sus propios combos por planta). `analysis`
  // es indiferente para el CR (el glue tiene su rutina `calcular_cr`), se fija a un
  // valor benigno que cumple el contrato.
  const modeloFEM: ModeloFEM = {
    units: "kN-m",
    nodes: base.nodes,
    materials: base.materials,
    sections: base.sections,
    members: base.members,
    supports: base.supports,
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [],
    analysis: { type: "linear", check_statics: false },
  };

  // 3) plantasInfo: una entrada por planta CON nudos FEM (via nodoFEMAPlanta). Una
  // planta sin nudos se OMITE (no es error: una planta vacia no aporta diafragma). El
  // maestro es el centroide aritmetico de (X,Z) de sus nudos, a la cota (Y) de la
  // planta. Orden determinista por plantaId.
  const coordPorNombre = new Map<string, { x: number; y: number; z: number }>(
    base.nodes.map((n) => [n.name, { x: n.x, y: n.y, z: n.z }]),
  );
  // Agrupa los nudos FEM por planta (nodoFEMAPlanta: nombre -> plantaId).
  const nodosPorPlanta = new Map<string, string[]>();
  for (const [nombre, plantaId] of Object.entries(base.trazabilidad.nodoFEMAPlanta)) {
    let lista = nodosPorPlanta.get(plantaId);
    if (lista === undefined) {
      lista = [];
      nodosPorPlanta.set(plantaId, lista);
    }
    lista.push(nombre);
  }

  const plantasInfo: PlantaInfoCR[] = [];
  // Orden determinista por plantaId.
  const plantaIds = [...nodosPorPlanta.keys()].sort();
  for (const plantaId of plantaIds) {
    // Nodos ordenados por su nombre FEM (N1<N2<... numerico-lexico estable); el orden
    // no afecta al centroide pero fija una salida byte a byte estable.
    const nodos = [...nodosPorPlanta.get(plantaId)!].sort(ordenNodoFEM);
    const planta = plantaPorId(modelo, plantaId);
    // La cota (Y FEM) del maestro = cota de la planta. Si la planta no se resolviera
    // (no deberia: nodoFEMAPlanta solo referencia plantas reales), se usa la Y del
    // primer nudo como respaldo (todos los nudos de una planta comparten cota).
    const yMaestro =
      planta !== undefined ? planta.cota : coordPorNombre.get(nodos[0])!.y;
    let sumX = 0;
    let sumZ = 0;
    for (const nombre of nodos) {
      const c = coordPorNombre.get(nombre)!;
      sumX += c.x;
      sumZ += c.z;
    }
    plantasInfo.push({
      plantaId,
      nodos,
      maestro: { x: sumX / nodos.length, y: yMaestro, z: sumZ / nodos.length },
    });
  }

  // Validacion de salida (defensa frente a un base FEM malformado): un fallo aqui es un
  // bug interno del discretizador, no un error de obra. Se deja propagar.
  const validado = ModeloFEMSchema.parse(modeloFEM);
  return { ok: true, modeloFEM: validado, plantasInfo };
}

// Orden total de nombres de nudo FEM "N<k>" por su indice numerico (N2 < N10), con
// respaldo lexico si el formato no fuera el esperado. Solo afecta al orden del array
// `nodos` (no al centroide), pero lo hace estable.
function ordenNodoFEM(a: string, b: string): number {
  const ia = indiceNodo(a);
  const ib = indiceNodo(b);
  if (ia !== null && ib !== null && ia !== ib) return ia - ib;
  return a < b ? -1 : a > b ? 1 : 0;
}
function indiceNodo(name: string): number | null {
  const m = /^N(\d+)$/.exec(name);
  return m === null ? null : Number(m[1]);
}
