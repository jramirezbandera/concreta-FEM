// Tools rail (Spec Diseno UI §3.4): columna de ayudas de dibujo CAD a la derecha
// (52px). F4 abre/cierra el PanelPlantillas (DXF) y F3 dispara la captura PNG del
// viewport (feature-15, T4.1). snap esta CABLEADO al store: refleja y conmuta
// vistaStore.snapActivo (gobierna el snapping real, incl. enganche a entidades DXF
// de feature-15). orto/rejilla siguen siendo toggles de estado LOCAL cosmeticos
// (su logica real se cablea en otra feature); biblioteca/config/ayuda quedan como
// placeholders accesibles (title + aria-label).
import { useState, useSyncExternalStore } from "react";
import { vistaStore } from "../../estado";
import { capturarViewport } from "../viewport";

interface HerramientaIcono {
  clave: string;
  glifo: string;
  title: string;
  /** Conmutable con estado LOCAL (snap/orto/rejilla): pinta estado activo. */
  toggle?: boolean;
  /** Accion real al pulsar (F4/F3). Si esta, el boton no es un toggle local. */
  onClick?: () => void;
  /**
   * Estado "activo" gobernado por un store externo (F4 refleja
   * panelPlantillasAbierto). Distinto de `toggle`, que usa estado local.
   */
  activoExterno?: boolean;
}

// orto/rejilla son toggles cosmeticos de estado LOCAL (sin logica real aun). snap
// se construye dentro del componente porque va cableado al store (ver AYUDAS).
const AYUDAS_LOCALES: HerramientaIcono[] = [
  { clave: "orto", glifo: "∟", title: "Modo orto", toggle: true },
  { clave: "rejilla", glifo: "▤", title: "Rejilla", toggle: true },
];
const FINALES: HerramientaIcono[] = [
  { clave: "biblioteca", glifo: "≣", title: "Biblioteca de secciones" },
  { clave: "config", glifo: "⚙", title: "Configuración" },
  { clave: "ayuda", glifo: "?", title: "Ayuda" },
];

// Suscripcion fina: el boton F4 refleja si el panel de plantillas esta abierto.
function usePanelPlantillasAbierto(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.panelPlantillasAbierto, cb),
    () => vistaStore.getState().panelPlantillasAbierto,
    () => vistaStore.getState().panelPlantillasAbierto,
  );
}

// Suscripcion fina: el boton snap refleja el snapping real (vistaStore.snapActivo).
function useSnapActivo(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.snapActivo, cb),
    () => vistaStore.getState().snapActivo,
    () => vistaStore.getState().snapActivo,
  );
}

export function ToolsRail() {
  // Estado local solo para el feedback visual de los toggles CAD cosmeticos
  // (orto/rejilla). No afecta a ningun store (su logica real se cablea en otra
  // feature). snap NO esta aqui: va cableado al store (ver useSnapActivo).
  const [activos, setActivos] = useState<Record<string, boolean>>({
    orto: false,
    rejilla: true,
  });

  // F4 abre/cierra el PanelPlantillas; su estado activo lo gobierna el store.
  const panelPlantillasAbierto = usePanelPlantillasAbierto();
  // snap refleja vistaStore.snapActivo y lo conmuta al pulsar (gobierna el
  // snapping real, igual patron que F4: onClick + activoExterno).
  const snapActivo = useSnapActivo();
  const SNAP: HerramientaIcono = {
    clave: "snap",
    glifo: "⌖",
    title: "Referencia a objetos (snap)",
    onClick: () => vistaStore.getState().setSnapActivo(!vistaStore.getState().snapActivo),
    activoExterno: snapActivo,
  };
  const ANTES: HerramientaIcono[] = [
    {
      clave: "f4",
      glifo: "▦",
      title: "F4 · Plantillas DXF/DWG",
      onClick: () => vistaStore.getState().togglePanelPlantillas(),
      activoExterno: panelPlantillasAbierto,
    },
    {
      clave: "f3",
      glifo: "▣",
      title: "F3 · Capturas",
      // Captura la vista actual a PNG (el ControlCaptura interno a la escena
      // hace render + toDataURL + descarga; aqui solo se emite la orden).
      onClick: () => capturarViewport(),
    },
  ];

  const boton = (h: HerramientaIcono) => {
    // Activo: estado externo (F4) tiene prioridad; si no, el toggle local.
    const activo = h.onClick
      ? h.activoExterno
      : h.toggle
        ? Boolean(activos[h.clave])
        : undefined;
    // Pressed se anuncia para conmutables (toggle local o reflejo de store).
    const conmutable = h.toggle || h.activoExterno !== undefined;
    return (
      <button
        key={h.clave}
        type="button"
        className="cx-iconbtn"
        title={h.title}
        aria-label={h.title}
        aria-pressed={conmutable ? Boolean(activo) : undefined}
        data-activo={activo ? "true" : undefined}
        onClick={
          h.onClick ??
          (h.toggle
            ? () => setActivos((s) => ({ ...s, [h.clave]: !s[h.clave] }))
            : undefined)
        }
      >
        {h.glifo}
      </button>
    );
  };

  return (
    <div className="cx-tools" role="toolbar" aria-label="Herramientas de dibujo">
      {ANTES.map(boton)}
      <span className="cx-tools__sep" aria-hidden="true" />
      {/* snap (cableado al store) + orto/rejilla (cosmeticos locales). */}
      {[SNAP, ...AYUDAS_LOCALES].map(boton)}
      <span className="cx-tools__sep" aria-hidden="true" />
      {FINALES.map(boton)}
    </div>
  );
}
