// Tools rail (Spec Diseno UI §3.4): columna de ayudas de dibujo CAD a la derecha
// (52px). F4 abre/cierra el PanelPlantillas (DXF) y F3 dispara la captura PNG del
// viewport (feature-15, T4.1). snap y rejilla estan CABLEADOS al store: reflejan y
// conmutan vistaStore.snapActivo / vistaStore.rejillaVisible (gobiernan el snapping
// real y la visibilidad de la rejilla en la Escena). "Orto" aun no tiene logica real:
// se muestra DESHABILITADO (no como un toggle muerto que aparenta funcionar).
// biblioteca/config/ayuda tampoco tienen destino todavia: deshabilitados con title.
import { useSyncExternalStore } from "react";
import { vistaStore } from "../../estado";
import { capturarViewport } from "../viewport";

// Copy unico para lo que aun no tiene destino (mismo que menus/ToolsRail): honesto
// sobre que la accion llegara, en vez de un clic muerto que no hace nada.
const PROXIMAMENTE = "Disponible próximamente";

interface HerramientaIcono {
  clave: string;
  glifo: string;
  title: string;
  /** Accion real al pulsar (F4/F3/snap/rejilla). Si esta, el boton actua. */
  onClick?: () => void;
  /**
   * Estado "activo" gobernado por un store externo (F4 refleja panelPlantillasAbierto;
   * snap/rejilla reflejan su flag). Distinto de `toggle`, que usa estado local.
   */
  activoExterno?: boolean;
  /** Placeholder sin destino todavia: se pinta deshabilitado (title "próximamente"). */
  deshabilitado?: boolean;
}

// [D13e] "Biblioteca de secciones" pasa a accionable: abre el diálogo de sección
// personalizada (crear sección de obra a medida, D3). config/ayuda siguen como
// placeholders (sin destino todavía).
const FINALES: HerramientaIcono[] = [
  {
    clave: "biblioteca",
    glifo: "≣",
    title: "Biblioteca de secciones",
    onClick: () => vistaStore.getState().abrirDialogo("seccionPersonalizada"),
  },
  { clave: "config", glifo: "⚙", title: "Configuración", deshabilitado: true },
  { clave: "ayuda", glifo: "?", title: "Ayuda", deshabilitado: true },
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

// Suscripcion fina: el boton rejilla refleja vistaStore.rejillaVisible (la Escena la
// monta segun ese flag). Igual patron que snap: onClick + activoExterno.
function useRejillaVisible(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.rejillaVisible, cb),
    () => vistaStore.getState().rejillaVisible,
    () => vistaStore.getState().rejillaVisible,
  );
}

// [D14 · PR3] Suscripcion fina: el boton de colapsar el dock refleja dockUI.dockColapsado.
function useDockColapsado(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.dockUI.dockColapsado, cb),
    () => vistaStore.getState().dockUI.dockColapsado,
    () => vistaStore.getState().dockUI.dockColapsado,
  );
}

export function ToolsRail() {
  // F4 abre/cierra el PanelPlantillas; su estado activo lo gobierna el store.
  const panelPlantillasAbierto = usePanelPlantillasAbierto();
  // snap refleja vistaStore.snapActivo y lo conmuta al pulsar (gobierna el
  // snapping real, igual patron que F4: onClick + activoExterno).
  const snapActivo = useSnapActivo();
  // rejilla refleja vistaStore.rejillaVisible y lo conmuta al pulsar.
  const rejillaVisible = useRejillaVisible();
  // [D14 · PR3] colapso del dock entero: refleja dockUI.dockColapsado y lo conmuta.
  const dockColapsado = useDockColapsado();
  // Botón de colapsar/expandir el dock (recupera/entrega los ~400px al lienzo). aria-pressed
  // = colapsado; title cambia según estado (afordancia clara de la acción disponible).
  const DOCK: HerramientaIcono = {
    clave: "dock",
    glifo: dockColapsado ? "◧" : "◨",
    title: dockColapsado ? "Mostrar el panel de datos" : "Ocultar el panel de datos",
    onClick: () => vistaStore.getState().toggleDockColapsado(),
    activoExterno: dockColapsado,
  };
  const SNAP: HerramientaIcono = {
    clave: "snap",
    glifo: "⌖",
    title: "Referencia a objetos (snap)",
    onClick: () => vistaStore.getState().setSnapActivo(!vistaStore.getState().snapActivo),
    activoExterno: snapActivo,
  };
  // snap (cableado) + orto (placeholder deshabilitado) + rejilla (cableada al store).
  const AYUDAS: HerramientaIcono[] = [
    SNAP,
    // "Modo orto" descriptivo en aria-label; el flag `deshabilitado` hace que el title
    // VISIBLE pase a "Disponible próximamente" (patron de los FINALES).
    { clave: "orto", glifo: "∟", title: "Modo orto", deshabilitado: true },
    {
      clave: "rejilla",
      glifo: "▤",
      title: "Rejilla",
      onClick: () => vistaStore.getState().toggleRejilla(),
      activoExterno: rejillaVisible,
    },
  ];
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
    // Activo: reflejo del store (F4/snap/rejilla via activoExterno). Ya no hay toggles
    // de estado local (snap y rejilla van cableados al store).
    const activo = h.activoExterno;
    // Pressed se anuncia para conmutables (reflejo de store). Un placeholder
    // deshabilitado no es conmutable: no anuncia aria-pressed.
    const conmutable = !h.deshabilitado && h.activoExterno !== undefined;
    // Placeholders sin destino: title "próximamente" (mantiene el aria-label de la
    // herramienta para que el lector siga nombrandola, pero deja claro que no actua).
    const title = h.deshabilitado ? PROXIMAMENTE : h.title;
    return (
      <button
        key={h.clave}
        type="button"
        className="cx-iconbtn"
        title={title}
        aria-label={h.title}
        aria-disabled={h.deshabilitado ? true : undefined}
        disabled={h.deshabilitado}
        aria-pressed={conmutable ? Boolean(activo) : undefined}
        data-activo={activo ? "true" : undefined}
        onClick={h.deshabilitado ? undefined : h.onClick}
      >
        {h.glifo}
      </button>
    );
  };

  return (
    <div className="cx-tools" role="toolbar" aria-label="Herramientas de dibujo">
      {ANTES.map(boton)}
      {/* [D14 · PR3] Colapsar/expandir el dock de datos (recupera el ancho al lienzo). */}
      {boton(DOCK)}
      <span className="cx-tools__sep" aria-hidden="true" />
      {/* snap (cableado) + orto (placeholder) + rejilla (cableada al store). */}
      {AYUDAS.map(boton)}
      <span className="cx-tools__sep" aria-hidden="true" />
      {FINALES.map(boton)}
    </div>
  );
}
