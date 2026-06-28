// CentroMasa: control HUD del Centro de Masas (F2.4, D-diseño-1/2). Combina el
// TOGGLE (encender/apagar el overlay ⊕) y el PANEL de datos (nombre de planta +
// coords del CM + peso total). Vive en el HUD glass (HTML sobre el canvas, no en la
// escena WebGL), montado en el Hud persistente -> disponible en TODAS las pestanas
// (entrada + resultados) sin duplicar montaje.
//
// VISIBILIDAD (D-diseño-1): el control solo aparece en VISTA PLANTA (el CM es ayuda
// de planta; en 3D/mosaico no tiene sentido el marcador cenital). El toggle arranca
// APAGADO (regla de subtraccion: nunca siempre-visible). Al encenderlo se muestra el
// panel de datos; el overlay ⊕ lo dibuja CentroMasaOverlay (sceneOverlay).
//
// ESTADO VACIO (D-diseño-2): si la planta activa no tiene masa (cm===null), el
// marcador se oculta y el panel muestra "Sin masa en esta planta". El CM se recalcula
// EN VIVO al editar (useCentroMasa memoiza sobre modelo+planta; nunca obsoleto).
//
// DATOS NUMERICOS EN MONO TABULAR (Spec §7.4): coords (x,y en m) y peso (kN) en
// .mono. "Centro de masas" es el termino de obra (CYPECAD); cero jerga FEM.
import { useSyncExternalStore } from "react";
import { vistaStore } from "../../estado";
import { PanelFlotante } from "../primitivas";
import { useCentroMasa } from "./useCentroMasa";
import "./centroMasa.css";

// Vista planta? El control del CM solo se ofrece en planta (D-diseño-1).
function useEnPlanta(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modoVista, cb),
    () => vistaStore.getState().modoVista === "planta",
    () => vistaStore.getState().modoVista === "planta",
  );
}

function useMostrarCM(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.mostrarCentroMasa, cb),
    () => vistaStore.getState().mostrarCentroMasa,
    () => vistaStore.getState().mostrarCentroMasa,
  );
}

// Detalle del panel: nombre de planta + coords/peso, o el estado "Sin masa".
function DetalleCentroMasa() {
  const { cm, nombrePlanta } = useCentroMasa();
  if (cm === null) {
    return (
      <div className="cx-cm__detalle">
        <span className="cx-cm__sin-masa">Sin masa en esta planta</span>
      </div>
    );
  }
  return (
    <div className="cx-cm__detalle">
      <div className="cx-cm__fila">
        <span className="cx-cm__clave">Planta</span>
        <span className="cx-cm__valor">{nombrePlanta ?? "—"}</span>
      </div>
      <div className="cx-cm__fila">
        <span className="cx-cm__clave">X</span>
        <span className="cx-cm__valor mono">{cm.x.toFixed(2)} m</span>
      </div>
      <div className="cx-cm__fila">
        <span className="cx-cm__clave">Y</span>
        <span className="cx-cm__valor mono">{cm.y.toFixed(2)} m</span>
      </div>
      <div className="cx-cm__fila">
        <span className="cx-cm__clave">Peso</span>
        <span className="cx-cm__valor mono">{cm.pesoTotal.toFixed(1)} kN</span>
      </div>
    </div>
  );
}

export function CentroMasa() {
  const enPlanta = useEnPlanta();
  const mostrar = useMostrarCM();
  const toggle = () => vistaStore.getState().toggleCentroMasa();

  // El control solo se ofrece en vista planta (D-diseño-1).
  if (!enPlanta) return null;

  return (
    <PanelFlotante
      className="cx-cm"
      // El glifo ⊕ en el icono ata visualmente el panel con el marcador de la escena.
      icono={<span className="cx-cm__glifo" aria-hidden="true">⊕</span>}
      titulo="Centro de masas"
    >
      <label className="cx-cm__toggle">
        <input
          type="checkbox"
          checked={mostrar}
          onChange={toggle}
          aria-label="Mostrar centro de masas"
        />
        <span>Mostrar en planta</span>
      </label>
      {mostrar ? <DetalleCentroMasa /> : null}
    </PanelFlotante>
  );
}
