// imanViga: helper PURO de enganche ("iman") para la introduccion grafica de
// vigas (feature-12). Dado un clic en planta, decide a que extremo se ancla:
//  - a un punto existente de la obra (nudo de otra viga, o cabeza de pilar) si
//    cae dentro del radio del iman, para que las vigas compartan nudo y el
//    discretizador (feature-4) las una sin geometria colgante;
//  - si no hay nada cerca, al punto ajustado a la rejilla (snapARejilla).
//
// Sin React, sin three.js, sin stores: solo lectura del Modelo (Capa 1) y
// aritmetica. Trabaja en unidades internas (m), como el resto de la geometria de
// la escena (#14): no hay conversion aqui.
//
// Deriva candidatos espejando useGeometriaModelo.derivar: nudos por su id (x,y) y
// cabezas de pilar por su (x,y) cuando su tramo (cota plantaInicial..plantaFinal)
// incluye la cota de la planta de destino.
import { snapARejilla } from "./snap";
import { engancharAPuntoExtra } from "./dxf/snapDxf";
import type { PuntoXY } from "./dxf/tiposDxf";
import { nudoPorId, plantaPorId, vigasDePlanta } from "../../dominio";
import type { Modelo } from "../../dominio";
// Misma tolerancia de fusion de nudos que usa el discretizador (feature-4) y
// crearViga (resolverExtremo): localizar el nudo de la cabeza de pilar por
// proximidad, no por igualdad exacta de floats, para no divergir del criterio
// unico (un nudo a <1 mm de la cabeza es "el mismo punto").
import { TOL_NODO } from "../../discretizador/discretizar";
// ExtremoViga lo define la tarea T1.1 en src/estado/comandos/comandosModelo.ts y
// se reexporta por el barrel src/estado. Importado desde el barrel (no del modulo
// concreto) para no acoplarse a su ruta interna.
import type { ExtremoViga } from "../../estado";

// Radio del iman (m): a que distancia del clic un punto existente "atrae" el
// extremo. 0.6 m da margen comodo para enganchar a un pilar/nudo sin pelearse con
// la rejilla de 0.5 m (un clic algo desviado de una cabeza de pilar engancha;
// uno claramente en vacio cae a rejilla).
export const RADIO_IMAN_M = 0.6;

// Paso de la rejilla de fallback (m). Coincide con la rejilla del lienzo
// (Escena.tsx) y con el default de snapARejilla.
export const PASO_REJILLA_M = 0.5;

export interface OpcionesImanViga {
  radioIman?: number;
  pasoRejilla?: number;
  // Si false, el fallback (sin candidato de iman) NO ajusta a rejilla: devuelve las
  // coords crudas. Refleja vistaStore.snapActivo (paridad con ColocacionPilar). El
  // iman a nudos/pilares NO depende de esto: es osnap y siempre engancha. Default
  // true (comportamiento previo).
  snapRejilla?: boolean;
  // Puntos notables de las plantillas DXF visibles de la planta activa (feature-15),
  // ya transformados a coords de obra (m) por el LLAMADOR (ColocacionViga, desde
  // vistaStore: asi imanViga sigue puro). Son candidatos de PRIORIDAD MEDIA: la obra
  // (nudos/cabezas de pilar) gana siempre; el DXF solo engancha si no hay obra mas
  // cerca; la rejilla es el ultimo recurso. Se ignoran si snapRejilla=false (el calco
  // es ayuda de dibujo, sujeta al mismo interruptor de snap que la rejilla). Default
  // [] (sin plantillas -> comportamiento previo).
  puntosSnapExtra?: PuntoXY[];
}

// Un candidato de enganche ya resuelto a su representacion ExtremoViga, con sus
// coordenadas para medir distancia al clic.
interface Candidato {
  x: number;
  y: number;
  extremo: ExtremoViga;
}

// Cota de una planta por su id (m). undefined si la planta no existe: en ese caso
// no hay candidatos de pilar (su tramo no se puede comparar) y se cae a rejilla.
function cotaDe(modelo: Modelo, plantaId: string): number | undefined {
  return plantaPorId(modelo, plantaId)?.cota;
}

// Reune los puntos de enganche de la planta de destino.
function candidatos(modelo: Modelo, plantaId: string): Candidato[] {
  const lista: Candidato[] = [];

  // (a) Nudos ya usados por vigas de esta planta: el extremo se referencia por id
  // (comparten nudo => el discretizador los une). Dedup por nudoId para no medir
  // el mismo punto varias veces.
  const vistos = new Set<string>();
  for (const viga of vigasDePlanta(modelo, plantaId)) {
    for (const nudoId of [viga.nudoI, viga.nudoJ]) {
      if (vistos.has(nudoId)) continue;
      vistos.add(nudoId);
      const nudo = nudoPorId(modelo, nudoId);
      if (nudo === undefined) continue; // referencia rota: la valida feature-4
      lista.push({ x: nudo.x, y: nudo.y, extremo: { nudoId } });
    }
  }

  // (b) Cabezas de pilar cuyo tramo incluye la cota de esta planta. El enganche es
  // el nudo existente en (x,y) del pilar si ya lo hay (referencia por id, como en
  // (a)); si no, las coords del pilar para que crearViga cree el nudo alli.
  const cota = cotaDe(modelo, plantaId);
  if (cota !== undefined) {
    for (const pilar of modelo.pilares) {
      const c0 = cotaDe(modelo, pilar.plantaInicial);
      const c1 = cotaDe(modelo, pilar.plantaFinal);
      if (c0 === undefined || c1 === undefined) continue;
      const cMin = Math.min(c0, c1);
      const cMax = Math.max(c0, c1);
      if (cota < cMin || cota > cMax) continue; // el tramo no llega a esta cota

      // Hay nudo en (x,y) del pilar (a <TOL_NODO)? entonces enganchar a ese id.
      const nudoEnPilar = modelo.nudos.find(
        (n) => Math.hypot(n.x - pilar.x, n.y - pilar.y) < TOL_NODO,
      );
      if (nudoEnPilar !== undefined) {
        if (vistos.has(nudoEnPilar.id)) continue; // ya contado como nudo de viga
        vistos.add(nudoEnPilar.id);
        lista.push({
          x: nudoEnPilar.x,
          y: nudoEnPilar.y,
          extremo: { nudoId: nudoEnPilar.id },
        });
      } else {
        lista.push({ x: pilar.x, y: pilar.y, extremo: { x: pilar.x, y: pilar.y } });
      }
    }
  }

  return lista;
}

// Resuelve el extremo de una viga para un clic en (x,y) sobre `plantaId`, con
// PRIORIDAD obra > DXF > rejilla:
//  1. obra: si el nudo/cabeza de pilar mas cercano cae dentro de `radioIman`,
//     devuelve ese candidato (nudo existente por id, o coords de una cabeza de pilar
//     sin nudo aun). La obra real no la roba la plantilla.
//  2. DXF: si no hay obra en radio, engancha al punto notable de plantilla mas
//     cercano dentro de `radioIman` (devuelto como coords { x, y }). Solo si el snap
//     esta activo (snapRejilla): el calco es ayuda de dibujo, sujeta al mismo snap.
//  3. rejilla: si no hay nada, { x, y } ajustado a rejilla (o crudo si snap off).
export function resolverPunto(
  modelo: Modelo,
  plantaId: string,
  x: number,
  y: number,
  opts: OpcionesImanViga = {},
): ExtremoViga {
  const radioIman = opts.radioIman ?? RADIO_IMAN_M;
  const pasoRejilla = opts.pasoRejilla ?? PASO_REJILLA_M;
  const snapRejilla = opts.snapRejilla ?? true;

  // (1) Obra: nudos/cabezas de pilar. Maxima prioridad (geometria real).
  let mejor: Candidato | null = null;
  let mejorDist2 = Infinity;
  const radio2 = radioIman * radioIman;
  for (const cand of candidatos(modelo, plantaId)) {
    const dx = cand.x - x;
    const dy = cand.y - y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 <= radio2 && dist2 < mejorDist2) {
      mejor = cand;
      mejorDist2 = dist2;
    }
  }
  if (mejor !== null) return mejor.extremo;

  // (2) DXF: solo si el snap esta activo y no hubo candidato de obra mas cercano.
  if (snapRejilla && opts.puntosSnapExtra && opts.puntosSnapExtra.length > 0) {
    const p = engancharAPuntoExtra(x, y, opts.puntosSnapExtra, radioIman);
    if (p !== null) return { x: p.x, y: p.y };
  }

  // (3) Rejilla: punto libre. Ajustado a rejilla solo si snap activo; si no, crudo.
  return snapRejilla ? snapARejilla(x, y, pasoRejilla) : { x, y };
}
