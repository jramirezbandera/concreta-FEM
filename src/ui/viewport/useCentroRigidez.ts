// useCentroRigidez: estado derivado del CENTRO DE RIGIDEZ (CR) de la planta activa para
// el overlay y el panel HUD (F2). Espejo de useCentroMasa, con DOS diferencias clave:
//
//  1) El CR NO es puro: lo calcula PyNite (diafragma rigido + cargas unitarias por
//     planta) y el resultado vive en crStore (no se recomputa al editar; queda obsoleto
//     hasta recalcular, como la deformada). Aqui solo LEEMOS el crStore + el Modelo (para
//     resolver la cota de la planta y, opcionalmente, el CM para el segmento de excentricidad).
//  2) El segmento CM<->CR (valor visual) NO recalcula el CM aqui: el ex/ey del crStore ya
//     viene ensamblado contra el CM del MOMENTO DEL CALCULO (ensamblarResultadosCR), asi que
//     el CM "horneado" se reconstruye en el overlay como CR+(ex,ey). Recalcular el CM vivo
//     aqui descuadraria el segmento dibujado de los numeros ex/ey del panel tras una edicion
//     (CR obsoleto, CM vivo): por eso NO se deriva el CM en este hook.
//
// RENDIMIENTO (regla #11): lectura via subscribeWithSelector (useSyncExternalStore) +
// useMemo; se recomputa SOLO al cambiar el CR calculado, el modelo o la planta activa,
// NUNCA por frame. El modelo no entra como prop reactiva del render loop.
//
// COORDENADAS (Z-up): el CR viene en coords de OBRA (x,y; el glue las emite en el plano
// horizontal FEM que coincide con obra por identidad de mapearEjes). La cota de la planta
// activa se anade para situar el marcador en Z, igual que useCentroMasa.
import { useMemo, useSyncExternalStore } from "react";
import { crStore, modeloStore, vistaStore } from "../../estado";
import type { Modelo } from "../../dominio";
import type { ResultadosCR } from "../../solver/resultadosCR";

// CR de la planta activa, ya resuelto (coords de obra + excentricidad al CM).
export interface CRPlantaUI {
  /** Coords de obra del CR (m). null si la planta es no determinable o no hay CR. */
  x: number | null;
  y: number | null;
  /** Excentricidad estructural CM - CR (m). null si CM null o CR no determinable. */
  ex: number | null;
  ey: number | null;
}

export interface CentroRigidezUI {
  /** CR de la planta activa, o null si no hay CR calculado para ella (planta sin
   *  entrada en cr_por_planta) o no hay planta activa. Una planta CON entrada pero no
   *  determinable devuelve { x:null, y:null, ... } (NO null): la UI distingue
   *  "no calculado" (cr===null) de "no determinable" (cr.x===null). */
  cr: CRPlantaUI | null;
  /** Cota de la planta activa (m), para situar el marcador en Z. null si no hay planta. */
  cota: number | null;
  /** Nombre de la planta activa (lenguaje de obra), o null. */
  nombrePlanta: string | null;
  /** Id de la planta activa, o null. */
  plantaActivaId: string | null;
  /** true si el CR del crStore corresponde al modelo actual; false tras editar la obra. */
  vigente: boolean;
}

// Snapshot estable de las entradas que disparan el recalculo (no por frame).
interface Entradas {
  cr: ResultadosCR | null;
  vigente: boolean;
  modelo: Modelo;
  plantaActivaId: string | null;
}

let snapCache: Entradas = leerEntradas();
function leerEntradas(): Entradas {
  return {
    cr: crStore.getState().cr,
    vigente: crStore.getState().vigente,
    modelo: modeloStore.getState().modelo,
    plantaActivaId: vistaStore.getState().plantaActivaId,
  };
}
function getSnapshot(): Entradas {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.cr === c.cr &&
    a.vigente === c.vigente &&
    a.modelo === c.modelo &&
    a.plantaActivaId === c.plantaActivaId
  ) {
    return c;
  }
  snapCache = a;
  return a;
}
function suscribir(cb: () => void): () => void {
  const offCr = crStore.subscribe((s) => s.cr, cb);
  const offVig = crStore.subscribe((s) => s.vigente, cb);
  const offM = modeloStore.subscribe((s) => s.modelo, cb);
  const offP = vistaStore.subscribe((s) => s.plantaActivaId, cb);
  return () => {
    offCr();
    offVig();
    offM();
    offP();
  };
}

export function useCentroRigidez(): CentroRigidezUI {
  const { cr, vigente, modelo, plantaActivaId } = useSyncExternalStore(
    suscribir,
    getSnapshot,
    getSnapshot,
  );
  return useMemo(() => {
    if (plantaActivaId === null) {
      return {
        cr: null,
        cota: null,
        nombrePlanta: null,
        plantaActivaId: null,
        vigente,
      };
    }
    const planta = modelo.plantas.find((p) => p.id === plantaActivaId) ?? null;
    // CR de la planta activa: la entrada del record (o null si no hay CR calculado).
    const entrada = cr?.cr_por_planta[plantaActivaId] ?? null;
    const crPlanta: CRPlantaUI | null =
      entrada === null
        ? null
        : { x: entrada.x, y: entrada.y, ex: entrada.ex, ey: entrada.ey };
    return {
      cr: crPlanta,
      cota: planta?.cota ?? null,
      nombrePlanta: planta?.nombre ?? null,
      plantaActivaId,
      vigente,
    };
  }, [cr, vigente, modelo, plantaActivaId]);
}

// Si el overlay/panel del CR debe estar VISIBLE: el toggle esta encendido Y la vista es
// planta (espejo de useCentroMasaVisible: el CR es ayuda de planta; en 3D/mosaico no se
// dibuja el marcador cenital). Hook ligero: re-render solo al cambiar el toggle o el
// modo de vista, nunca por frame.
export function useCentroRigidezVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const offT = vistaStore.subscribe((s) => s.mostrarCentroRigidez, cb);
      const offV = vistaStore.subscribe((s) => s.modoVista, cb);
      return () => {
        offT();
        offV();
      };
    },
    () => {
      const s = vistaStore.getState();
      return s.mostrarCentroRigidez && s.modoVista === "planta";
    },
    () => {
      const s = vistaStore.getState();
      return s.mostrarCentroRigidez && s.modoVista === "planta";
    },
  );
}
