// useCentroMasa: estado derivado del Centro de Masas (CM) de la planta activa para
// el overlay y el panel HUD (F2.4, D-diseño-1/2). Lo consumen DOS componentes
// (CentroMasaOverlay en la escena R3F + PanelCentroMasa en el HUD HTML); este hook
// centraliza el calculo para no recomputar dos veces ni divergir.
//
// RENDIMIENTO (regla #11): el CM se calcula PURO (calcularCentroMasaPlanta, sin
// solver) y se MEMOIZA sobre (modelo, plantaActivaId): se recomputa SOLO al editar la
// obra o cambiar de planta, NUNCA por frame. El modelo no entra como prop reactiva del
// render loop: se lee con subscribeWithSelector (useSyncExternalStore) y el useMemo
// deriva. "Recompute en vivo" (D-diseño-2): al editar la obra el CM nunca queda
// obsoleto (a diferencia de la deformada, que exige recalcular con el motor).
//
// COORDENADAS: el CM viene en sistema de OBRA (x,y en m de replanteo). La cota de la
// planta activa se anade para situar el marcador en Z (la escena del viewport es
// Z-up: la geometria de obra se dibuja en [x, y, cota], igual que pilares/vigas en
// GeometriaModelo). Asi NO se arrastra la convencion de ejes FEM (#18) hasta aqui.
import { useMemo, useSyncExternalStore } from "react";
import { modeloStore, vistaStore } from "../../estado";
import { calcularCentroMasaPlanta, type CentroMasaPlanta } from "../../discretizador";
import type { Modelo } from "../../dominio";

export interface CentroMasaUI {
  /** CM de la planta activa (coords de obra, peso en kN), o null si no hay masa. */
  cm: CentroMasaPlanta | null;
  /** Cota de la planta activa (m), para situar el marcador en Z. null si no hay planta. */
  cota: number | null;
  /** Nombre de la planta activa (lenguaje de obra), o null. */
  nombrePlanta: string | null;
  /** Id de la planta activa, o null. */
  plantaActivaId: string | null;
}

// Snapshot estable de las entradas que disparan el recalculo (no por frame).
interface Entradas {
  modelo: Modelo;
  plantaActivaId: string | null;
}

let snapCache: Entradas = leerEntradas();
function leerEntradas(): Entradas {
  return {
    modelo: modeloStore.getState().modelo,
    plantaActivaId: vistaStore.getState().plantaActivaId,
  };
}
function getSnapshot(): Entradas {
  const a = leerEntradas();
  const c = snapCache;
  if (a.modelo === c.modelo && a.plantaActivaId === c.plantaActivaId) return c;
  snapCache = a;
  return a;
}
function suscribir(cb: () => void): () => void {
  const offM = modeloStore.subscribe((s) => s.modelo, cb);
  const offP = vistaStore.subscribe((s) => s.plantaActivaId, cb);
  return () => {
    offM();
    offP();
  };
}

export function useCentroMasa(): CentroMasaUI {
  const { modelo, plantaActivaId } = useSyncExternalStore(
    suscribir,
    getSnapshot,
    getSnapshot,
  );
  return useMemo(() => {
    if (plantaActivaId === null) {
      return { cm: null, cota: null, nombrePlanta: null, plantaActivaId: null };
    }
    const planta = modelo.plantas.find((p) => p.id === plantaActivaId) ?? null;
    const cm = calcularCentroMasaPlanta(modelo, plantaActivaId);
    return {
      cm,
      cota: planta?.cota ?? null,
      nombrePlanta: planta?.nombre ?? null,
      plantaActivaId,
    };
  }, [modelo, plantaActivaId]);
}

// Si el overlay/panel del CM debe estar VISIBLE: el toggle esta encendido Y la vista
// es planta (D-diseño-1: el CM es ayuda de planta; en 3D/mosaico no se dibuja). Hook
// ligero: re-render solo al cambiar el toggle o el modo de vista, nunca por frame.
export function useCentroMasaVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const offT = vistaStore.subscribe((s) => s.mostrarCentroMasa, cb);
      const offV = vistaStore.subscribe((s) => s.modoVista, cb);
      return () => {
        offT();
        offV();
      };
    },
    () => {
      const s = vistaStore.getState();
      return s.mostrarCentroMasa && s.modoVista === "planta";
    },
    () => {
      const s = vistaStore.getState();
      return s.mostrarCentroMasa && s.modoVista === "planta";
    },
  );
}
