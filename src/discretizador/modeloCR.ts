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
import type { ModeloFEM, MaterialFEM } from "./contratoFEM";
import { ModeloFEMSchema } from "./contratoFEM";
import { construirBaseFEM, fusionarApoyosEnLista, materialFEM } from "./discretizar";
import { calcularAcoples } from "./acople";
import { emitirMuros } from "./muros";
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
  // Pre-pase de acoples: el CR necesita las subdivisiones de viga que introducen los
  // MUROS (subdivisionesVigaMuro) y sus mallas ya computadas (porMuro). Se computa
  // UNA vez y se comparte con las validaciones (mismo patron [1A] que discretizar).
  const acoples = calcularAcoples(modelo);

  // 1) Validacion de RIGIDEZ (no de cargas): referencias rotas, sin sujecion, nombres
  // duplicados, viga degenerada. `validarModelo` (sin contexto modal) NO incluye la
  // traduccion de cargas (esa la hace `discretizar` en su Paso 6), de modo que una
  // carga superficial/no aplicable NO bloquea el CR. Solo los "error" bloquean; los
  // "aviso" (hipotesis vacia, nudo flotante, concomitancia) son irrelevantes para el CR.
  const bloqueantes = validarModelo(modelo, undefined, acoples).filter(
    (e) => e.severidad === "error",
  );
  if (bloqueantes.length > 0) {
    return { ok: false, errores: bloqueantes };
  }

  // [OV-3] Sujecion del CR contra SU PROPIA base: esta base NO lleva la malla de
  // paños (decision 3A intacta: el diafragma se IMPONE, la placa horizontal no aporta
  // al CR), asi que los apoyos de borde de una losa NO existen aqui. Los MUROS en
  // cambio SI entran (F3-muros: su membrana ES la rigidez lateral que el CR mide), y
  // su base vinculada ancla la base del CR igual que el arranque de un pilar.
  // `validarModelo` puede aceptar la losa como sujecion del modelo (valido para el
  // calculo normal, donde la malla SI se emite), pero si esa fuera la UNICA
  // sujecion, la base del CR seria un mecanismo y el resultado saldria "no
  // determinable" (guarda cond>1e12) sin explicacion — un null opaco. Se exige lo
  // que la base SI puede cumplir: un pilar O un muro anclados al terreno. (Un modelo
  // VACIO no entra aqui: sin elementos no hay CR que medir y plantasInfo sale
  // vacia, comportamiento previo intacto.)
  const hayElementos =
    modelo.pilares.length > 0 ||
    modelo.vigas.length > 0 ||
    modelo.panos.length > 0 ||
    modelo.muros.length > 0;
  const hayAnclaje =
    modelo.pilares.some((p) => p.vinculacionExterior) ||
    modelo.muros.some((mu) => mu.vinculacionExterior);
  if (hayElementos && !hayAnclaje) {
    return {
      ok: false,
      errores: [
        {
          codigo: "CR_SIN_PILARES",
          severidad: "error",
          mensaje:
            "El centro de rigidez necesita al menos un pilar o un muro anclados al terreno; el apoyo del borde de una losa no basta para medirlo.",
          elementoTipo: "modelo",
        },
      ],
    };
  }

  // 2) Base FEM (geometria + rigidez + trazabilidad), SIN cargas. Misma factorizacion
  // que usa `discretizar`: no se duplica logica FEM. Tras validar, sus throw internos
  // son bugs internos, no errores de obra. Las vigas se subdividen SOLO en los puntos
  // que introducen los MUROS (subdivisionesVigaMuro, mapa solo-muro): sin muros es un
  // mapa vacio y la base del CR es byte-identica a antes (regresion, 3A).
  const base = construirBaseFEM(modelo, {
    subdivisionesViga: acoples.subdivisionesVigaMuro,
  });

  // 2b) MUROS en la base del CR (F3-muros, la razon de ser del corte): la MISMA
  // emision que usa el Paso 6e de discretizar (fuente unica emitirMuros): nudos,
  // quads con remap por celda y apoyos de fila base. El glue `calcular_cr` NO cambia
  // (build_model ya monta quads; la fusion de apoyos del diafragma preserva la base
  // del muro; la deteccion de cimentacion DX∧DZ clasifica bien su fila base). El peso
  // propio (pesosPropios) se IGNORA: el CR no lleva cargas.
  const muros = emitirMuros(modelo, acoples, base.nombrePorClave);
  const materialIdsBase = new Set(base.materials.map((m) => m.name));
  const materialesMuroNuevos: MaterialFEM[] = [...muros.materialIds]
    .filter((id) => !materialIdsBase.has(id))
    .sort()
    .map((id) => {
      const m = materialFEM(id);
      if (m === undefined) throw new Error(`Material de muro inexistente tras validar: ${id}`);
      return m;
    });

  // ModeloFEM BASE: solo geometria + rigidez. node_loads/dist_loads/pt_loads vacios
  // (el CR no usa cargas del usuario; las fabrica el glue). `combos` vacio (no hay
  // hipotesis que combinar; el glue define sus propios combos por planta). `analysis`
  // es indiferente para el CR (el glue tiene su rutina `calcular_cr`), se fija a un
  // valor benigno que cumple el contrato. Sin muros, cada rama toma el array base
  // intacto y NO se emite la clave `quads` (regresion byte a byte).
  const modeloFEM: ModeloFEM = {
    units: "kN-m",
    nodes: muros.nodes.length > 0 ? [...base.nodes, ...muros.nodes] : base.nodes,
    materials:
      materialesMuroNuevos.length > 0
        ? [...base.materials, ...materialesMuroNuevos]
        : base.materials,
    sections: base.sections,
    members: base.members,
    supports: fusionarApoyosEnLista(base.supports, muros.supportsPorNodo),
    node_loads: [],
    dist_loads: [],
    pt_loads: [],
    combos: [],
    analysis: { type: "linear", check_statics: false },
  };
  if (muros.quads.length > 0) {
    modeloFEM.quads = muros.quads;
  }

  // 3) plantasInfo: una entrada por planta CON nudos FEM (via nodoFEMAPlanta) ∪ los
  // nudos de MURO de la fila de su cota (nodosMuroPorPlanta: el diafragma debe
  // arrastrar tambien el muro en su nivel; sus nudos intermedios quedan libres y la
  // rigidez de membrana se condensa de forma natural). Una planta sin nudos se OMITE
  // (no es error: una planta vacia no aporta diafragma). El maestro es el centroide
  // aritmetico de (X,Z) de la union, a la cota (Y) de la planta. Orden determinista
  // por plantaId; dedup por Set (un nudo remapeado puede venir por ambas fuentes).
  const coordPorNombre = new Map<string, { x: number; y: number; z: number }>(
    modeloFEM.nodes.map((n) => [n.name, { x: n.x, y: n.y, z: n.z }]),
  );
  // Agrupa los nudos FEM por planta (nodoFEMAPlanta: nombre -> plantaId) y une los
  // del muro por planta.
  const nodosPorPlanta = new Map<string, Set<string>>();
  const anotar = (plantaId: string, nombre: string): void => {
    let set = nodosPorPlanta.get(plantaId);
    if (set === undefined) {
      set = new Set();
      nodosPorPlanta.set(plantaId, set);
    }
    set.add(nombre);
  };
  for (const [nombre, plantaId] of Object.entries(base.trazabilidad.nodoFEMAPlanta)) {
    anotar(plantaId, nombre);
  }
  for (const [plantaId, nombres] of Object.entries(muros.nodosMuroPorPlanta)) {
    for (const nombre of nombres) anotar(plantaId, nombre);
  }

  const plantasInfo: PlantaInfoCR[] = [];
  // Orden determinista por plantaId.
  const plantaIds = [...nodosPorPlanta.keys()].sort();
  for (const plantaId of plantaIds) {
    // Nodos ordenados por su nombre FEM (N1<N2<... numerico-lexico estable; los MQ*
    // de muro caen al respaldo lexicografico, tambien estable); el orden no afecta
    // al centroide pero fija una salida byte a byte estable.
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
