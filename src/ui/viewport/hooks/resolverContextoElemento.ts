// resolverContextoElemento: logica PURA que, dado el id de un elemento de obra
// (pilar o viga), devuelve el CONTEXTO activo (grupo + planta) al que pertenece.
// SIN React/three: testeable en Node. Espejo de estilo de resolverVistaActiva.ts.
//
// USO (F2c, "sincronizar contexto" en 3D pleno): al pickear un elemento en 3D, la
// vista fija grupoActivoId/plantaActivaId a los suyos para que sidebar, inspector,
// GroupRibbon y plantillas queden coherentes con lo seleccionado.
//
// CRITERIO de planta para un PILAR (decision F2c, Issue 6-A): un pilar puede abarcar
// un tramo (plantaInicial..plantaFinal); como se dibuja con UNA instancia de altura
// completa, el pick no aporta la planta concreta. Usamos la planta del PIE (cota
// menor). El refinamiento por altura de impacto del raycast queda como TODO
// (T-3dpleno-pick-altura). Para una VIGA es directo: su plantaId.
//
// ROBUSTEZ: id inexistente, o planta/grupo huerfanos (referencias rotas) -> null
// (el llamador no toca el contexto). Nunca lanza.
import type { Modelo } from "../../../dominio";
import { grupoPorId, plantaPorId } from "../../../dominio";

export interface ContextoElemento {
  grupoActivoId: string;
  plantaActivaId: string;
}

// Devuelve el contexto (grupo+planta) de un elemento, o null si no se puede resolver
// a un par (grupo, planta) valido (id desconocido o referencias rotas).
export function resolverContextoElemento(
  modelo: Modelo,
  elementoId: string,
): ContextoElemento | null {
  const pilar = modelo.pilares.find((p) => p.id === elementoId);
  if (pilar) {
    // Planta del PIE: la de menor cota entre arranque y cabeza (las que existan).
    const candidatas = [pilar.plantaInicial, pilar.plantaFinal]
      .map((id) => plantaPorId(modelo, id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
    if (candidatas.length === 0) return null; // ambos extremos huerfanos
    const pie = candidatas.reduce((a, b) => (b.cota < a.cota ? b : a));
    return contextoDePlanta(modelo, pie.id);
  }

  const viga = modelo.vigas.find((v) => v.id === elementoId);
  if (viga) {
    return contextoDePlanta(modelo, viga.plantaId);
  }

  return null; // ni pilar ni viga con ese id
}

// Resuelve el par (grupo, planta) a partir de una plantaId, validando que tanto la
// planta como su grupo existan (planta/grupo huerfano -> null).
function contextoDePlanta(modelo: Modelo, plantaId: string): ContextoElemento | null {
  const planta = plantaPorId(modelo, plantaId);
  if (!planta) return null;
  if (!grupoPorId(modelo, planta.grupoId)) return null; // grupo huerfano
  return { grupoActivoId: planta.grupoId, plantaActivaId: planta.id };
}
