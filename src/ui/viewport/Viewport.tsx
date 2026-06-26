// Viewport: nucleo del lienzo CAD (feature-9). Monta el <Canvas frameloop="demand">
// con la escena R3F y un HUD glass HTML por encima. El viewport SOLO LEE el modelo
// (Capa 1) y escribe en seleccionStore (hover/seleccion) y vistaStore (modo/planta).
//
// CONTRATO DE EXTENSION (Spec feature-9, nota: "dejar APIs limpias para que
// feature-11/12/14 inyecten geometria sin tocar el nucleo"):
//   <Viewport sceneOverlays={...} hudOverlays={...} />
//   - `sceneOverlays`: ReactNode renderizado DENTRO de la escena 3D (objetos R3F:
//     introduccion grafica de pilares/vigas F11/12, deformada/diagramas F14). Se
//     dibuja tras la geometria base; comparte camara, controles y picking.
//   - `hudOverlays`: ReactNode renderizado en el HUD HTML sobre el canvas (paneles
//     flotantes adicionales: RampLegend, ComboRibbon, dock de esfuerzos F14).
// Las features de UI consumen este contrato sin modificar Escena/Hud/Geometria.
import { Canvas } from "@react-three/fiber";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { modeloStore, vistaStore, type ModoVista } from "../../estado";
import { Boton } from "../primitivas/Boton";
import { hexToken } from "./colores";
import { Escena } from "./Escena";
import { Hud } from "./Hud";
import { ProveedorHud, type ContenedoresHud, type ZonaHud } from "./Slot";

// Las 8 bandas-zona de la capa HUD (flex-column). El orden no importa: cada zona se
// ancla por su clase .cx-zone--*. Slot porta a estos contenedores (ver Slot.tsx).
const ZONAS_HUD: readonly ZonaHud[] = [
  "top-left",
  "top-center",
  "top-right",
  "mid-left",
  "mid-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

// Capa HUD: 8 contenedores de zona absolutos en flex-column. No captura el puntero
// (solo los paneles, via .cx-zone > *). Publica sus <div> por callback ref en estado
// para que los Slot descendientes re-rendericen al montarse (tolera el target null
// del primer render). Cero re-render por frame: el estado solo cambia al montar/
// desmontar la capa, nunca durante la interaccion del lienzo.
function CapaHud({ children }: { children: ReactNode }) {
  const [contenedores, setContenedores] = useState<ContenedoresHud>({});
  // Un callback ref ESTABLE por zona (creado una sola vez). Si se creara inline en el
  // render (refZona(zona) devolviendo una nueva funcion cada vez), React detectaria una
  // ref distinta en cada commit y la desengancharia/reengancharia (null -> nodo) sin
  // parar, disparando setContenedores en bucle. Con identidades fijas, cada ref solo se
  // invoca al montar/desmontar su <div>: cero re-render por frame (regla #11).
  const refsZona = useMemo(
    () =>
      ZONAS_HUD.reduce(
        (refs, zona) => {
          refs[zona] = (el: HTMLDivElement | null) => {
            setContenedores((prev) => {
              if (prev[zona] === el) return prev;
              return { ...prev, [zona]: el };
            });
          };
          return refs;
        },
        {} as Record<ZonaHud, (el: HTMLDivElement | null) => void>,
      ),
    [],
  );
  return (
    <>
      <div className="cx-hud">
        {ZONAS_HUD.map((zona) => (
          <div key={zona} ref={refsZona[zona]} className={`cx-zone cx-zone--${zona}`} />
        ))}
      </div>
      <ProveedorHud contenedores={contenedores}>{children}</ProveedorHud>
    </>
  );
}

export interface ViewportProps {
  /** Objetos R3F inyectados DENTRO de la escena (F11/12/14), tras la geometria base. */
  sceneOverlays?: ReactNode;
  /** Paneles HTML inyectados en el HUD sobre el canvas (F14: leyenda, dock, etc.). */
  hudOverlays?: ReactNode;
  className?: string;
}

function useModoVista(): ModoVista {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modoVista, cb),
    () => vistaStore.getState().modoVista,
    () => vistaStore.getState().modoVista,
  );
}

// True cuando no hay nada que dibujar todavia: el modelo no tiene grupos ni
// plantas (primer uso / obra recien creada). Se lee FUERA del bucle de render
// (subscribeWithSelector -> re-render solo al editar la obra, nunca por frame).
function useObraVacia(): boolean {
  return useSyncExternalStore(
    (cb) => modeloStore.subscribe((s) => s.modelo, cb),
    () => {
      const { grupos, plantas } = modeloStore.getState().modelo;
      return grupos.length === 0 || plantas.length === 0;
    },
    () => {
      const { grupos, plantas } = modeloStore.getState().modelo;
      return grupos.length === 0 || plantas.length === 0;
    },
  );
}

// Overlay HTML de primer uso: guia de arranque cuando la obra esta vacia.
// Lenguaje de obra (CLAUDE.md §17, sin jerga FEM); glass por tokens. La tarjeta
// no captura el puntero (pointer-events: none en CSS) para no tapar los controles
// del HUD; solo el boton de accion lo recupera (.cx-empty__accion). El boton hace
// obvio el siguiente paso (Krug, "no me hagas pensar"): abre Grupos/Plantas en vez
// de obligar a buscar la accion en el menu/sidebar.
function EstadoVacio() {
  return (
    <div className="cx-empty cx-float--center" role="note" aria-label="Primeros pasos">
      <p className="cx-empty__titulo">Empieza tu estructura</p>
      <p className="cx-empty__texto">
        Crea un grupo y una planta para empezar a introducir la estructura.
      </p>
      <div className="cx-empty__accion">
        <Boton
          variante="primary"
          onClick={() => vistaStore.getState().abrirDialogo("gruposPlantas")}
        >
          Crear grupo y planta
        </Boton>
      </div>
    </div>
  );
}

// Mosaico: placeholder en F1. El mosaico (varias vistas simultaneas, Spec §4.3)
// exige multiples cameras/render targets; queda fuera del alcance de feature-9.
// De momento se cae a la escena 3D con un aviso en el HUD. Documentado como
// decision: no bloquea F1 (la introduccion grafica usa 2D y la revision usa 3D).
function MosaicoPlaceholder() {
  return (
    <div className="cx-mosaico-aviso cx-float cx-float--center mono" role="status">
      Mosaico: próximamente
    </div>
  );
}

export function Viewport({ sceneOverlays, hudOverlays, className }: ViewportProps) {
  const modoVista = useModoVista();
  const obraVacia = useObraVacia();
  // En "mosaico" mostramos la escena 3D de fondo + aviso (no hay multi-vista en F1).
  const modoEscena: ModoVista = modoVista === "mosaico" ? "3d" : modoVista;
  const clases = ["cx-viewport", className].filter(Boolean).join(" ");

  return (
    <div className={clases}>
      <Canvas
        frameloop="demand"
        // data-testid para E2E (feature-16): el lienzo es un <canvas> WebGL sin rol
        // accesible; R3F reenvia esta prop DOM al <canvas> que crea. Unico gancho
        // estable para que Playwright espere/afirme la presencia del viewport.
        data-testid="viewport-canvas"
        // Color de fondo del lienzo = token --canvas (papel CAD, Spec §1.1).
        // preserveDrawingBuffer: deja el framebuffer legible tras pintar para que
        // la captura PNG (F3, ControlCaptura) pueda hacer toDataURL del canvas.
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => gl.setClearColor(hexToken("canvas"))}
        // dpr acotado: nitidez sin coste excesivo en pantallas HiDPI.
        dpr={[1, 2]}
      >
        <Escena modoVista={modoEscena} overlays={sceneOverlays} />
      </Canvas>

      {/* HUD persistente + overlays inyectados portan a las zonas (apilado en
          columna). EstadoVacio/MosaicoPlaceholder quedan FUERA de la rejilla
          (centrados, .cx-float--center). */}
      <CapaHud>
        <Hud />
        {hudOverlays}
      </CapaHud>
      {obraVacia && <EstadoVacio />}
      {modoVista === "mosaico" && <MosaicoPlaceholder />}
    </div>
  );
}
