// Hud: controles "glass" en HTML posicionados sobre el <Canvas> (no dentro de la
// escena WebGL; Spec §4.2). Tres zonas canonicas:
//  - Arriba-izq: GroupRibbon (grupo/planta activos + cota, flechas para cambiar de
//    planta dentro del grupo).
//  - Arriba-der: Segmentado 2D/3D/Mosaico (modo de vista).
//  - Abajo-der: zoom +/-.
//
// El HUD lee vistaStore/modeloStore con useSyncExternalStore (re-render solo al
// cambiar grupo/planta/modo, nunca por frame). NO usa jerga FEM (CLAUDE.md §17).
import { useSyncExternalStore } from "react";
import { modeloStore, vistaStore, type ModoVista } from "../../estado";
import { Segmentado, type OpcionSegmento, PanelFlotante, Boton } from "../primitivas";
import { Slot } from "./Slot";
import { CentroMasa } from "./CentroMasa";
import { ModeloCalculo } from "./ModeloCalculo";
import { plantasDeGrupo } from "./hooks/useGeometriaModelo";
import { emitirZoom } from "./hooks/zoomBus";
import { emitirEncuadre } from "./hooks/encuadreBus";

const OPCIONES_MODO: ReadonlyArray<OpcionSegmento<ModoVista>> = [
  { valor: "planta", etiqueta: "2D", titulo: "Planta (2D)" },
  { valor: "3d", etiqueta: "3D", titulo: "Vista 3D" },
  { valor: "mosaico", etiqueta: "Mosaico", titulo: "Mosaico (varias vistas)" },
];

// Suscripcion a un selector de vistaStore con useSyncExternalStore: re-render solo
// cuando cambia el valor seleccionado.
function useVista<T>(selector: (s: ReturnType<typeof vistaStore.getState>) => T): T {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe(selector, cb),
    () => selector(vistaStore.getState()),
    () => selector(vistaStore.getState()),
  );
}

// Re-render cuando cambia el modelo (para refrescar nombres/cotas tras editar la
// obra) o el grupo/planta activos.
function useRibbonData() {
  return useSyncExternalStore(
    (cb) => {
      const offM = modeloStore.subscribe((s) => s.modelo, cb);
      const offG = vistaStore.subscribe((s) => s.grupoActivoId, cb);
      const offP = vistaStore.subscribe((s) => s.plantaActivaId, cb);
      return () => {
        offM();
        offG();
        offP();
      };
    },
    leerRibbon,
    leerRibbon,
  );
}

interface RibbonData {
  grupoNombre: string | null;
  plantaNombre: string | null;
  cota: number | null;
  hayAnterior: boolean;
  haySiguiente: boolean;
}

let ribbonCache: RibbonData = vacioRibbon();
function vacioRibbon(): RibbonData {
  return {
    grupoNombre: null,
    plantaNombre: null,
    cota: null,
    hayAnterior: false,
    haySiguiente: false,
  };
}

function leerRibbon(): RibbonData {
  const { grupoActivoId, plantaActivaId } = vistaStore.getState();
  const modelo = modeloStore.getState().modelo;
  const grupo = grupoActivoId
    ? (modelo.grupos.find((g) => g.id === grupoActivoId) ?? null)
    : null;
  const plantas = plantasDeGrupo(grupoActivoId);
  const idx = plantas.findIndex((p) => p.id === plantaActivaId);
  const planta = idx >= 0 ? plantas[idx] : null;
  const next: RibbonData = {
    grupoNombre: grupo?.nombre ?? null,
    plantaNombre: planta?.nombre ?? null,
    cota: planta?.cota ?? null,
    hayAnterior: idx > 0,
    haySiguiente: idx >= 0 && idx < plantas.length - 1,
  };
  // Estabilidad de referencia para useSyncExternalStore.
  if (
    next.grupoNombre === ribbonCache.grupoNombre &&
    next.plantaNombre === ribbonCache.plantaNombre &&
    next.cota === ribbonCache.cota &&
    next.hayAnterior === ribbonCache.hayAnterior &&
    next.haySiguiente === ribbonCache.haySiguiente
  ) {
    return ribbonCache;
  }
  ribbonCache = next;
  return next;
}

// Cambia a la planta adyacente (por cota) dentro del grupo activo.
function cambiarPlanta(direccion: 1 | -1): void {
  const { grupoActivoId, plantaActivaId, setPlantaActiva } = vistaStore.getState();
  const plantas = plantasDeGrupo(grupoActivoId);
  const idx = plantas.findIndex((p) => p.id === plantaActivaId);
  const destino = idx + direccion;
  if (destino >= 0 && destino < plantas.length) {
    setPlantaActiva(plantas[destino].id);
  }
}

function GroupRibbon() {
  const { grupoNombre, plantaNombre, cota, hayAnterior, haySiguiente } = useRibbonData();
  // En 3D/mosaico se ve TODO el edificio (3D pleno, F2c): el tag lo comunica en lenguaje
  // de obra. La cota y las flechas de planta pertenecen a la navegacion 2D por plantas;
  // en 3D pleno se ocultan (mostrar la cota de UNA planta junto a "Edificio completo"
  // se contradice, hallazgo /design-review). El contexto de planta lo fija el picking.
  const enPleno = useVista((s) => s.modoVista) !== "planta";
  return (
    <PanelFlotante
      titulo={grupoNombre ?? "Sin grupo"}
      tag={enPleno ? "Edificio completo" : (plantaNombre ?? "—")}
    >
      {!enPleno && (
        <div className="cx-ribbon-row">
          <span className="mono cx-ribbon-cota">
            {cota !== null ? `${cota.toFixed(2)} m` : "—"}
          </span>
          <div className="cx-ribbon-nav">
            <Boton
              variante="ghost"
              aria-label="Planta inferior"
              disabled={!hayAnterior}
              onClick={() => cambiarPlanta(-1)}
            >
              ↓
            </Boton>
            <Boton
              variante="ghost"
              aria-label="Planta superior"
              disabled={!haySiguiente}
              onClick={() => cambiarPlanta(1)}
            >
              ↑
            </Boton>
          </div>
        </div>
      )}
    </PanelFlotante>
  );
}

function SelectorModo() {
  const modoVista = useVista((s) => s.modoVista);
  return (
    <div className="cx-float cx-float--bare">
      <Segmentado<ModoVista>
        aria-label="Modo de vista"
        opciones={OPCIONES_MODO}
        valor={modoVista}
        onValor={(m) => {
          const v = vistaStore.getState();
          v.setModoVista(m);
          // La introduccion grafica (colocar pilares/vigas) es solo en 2D planta (F2c,
          // decision #3): al pasar a 3D/mosaico se fuerza la herramienta de seleccion,
          // de modo que el clic siempre selecciona y la colocacion queda inhabilitada.
          if (m !== "planta") v.setHerramienta("seleccion");
        }}
      />
    </div>
  );
}

function ControlesZoom() {
  // El boton "Encuadrar" solo tiene sentido en 3D (reencuadra el edificio completo).
  const enPleno = useVista((s) => s.modoVista) !== "planta";
  return (
    <div className="cx-float cx-float--bare cx-zoom">
      <Boton variante="ghost" aria-label="Acercar" onClick={() => emitirZoom("in")}>
        +
      </Boton>
      <Boton variante="ghost" aria-label="Alejar" onClick={() => emitirZoom("out")}>
        −
      </Boton>
      {enPleno && (
        <Boton
          variante="ghost"
          aria-label="Encuadrar edificio"
          title="Encuadrar el edificio"
          onClick={() => emitirEncuadre()}
        >
          ⤢
        </Boton>
      )}
    </div>
  );
}

export function Hud() {
  // Cada control se porta (Slot) a su zona; el apilado en columna lo da la zona, ya
  // no la clase de ancla de esquina (.cx-float--*). La capa .cx-hud vive en Viewport.
  return (
    <>
      <Slot zona="top-left">
        <GroupRibbon />
      </Slot>
      <Slot zona="top-right">
        <SelectorModo />
      </Slot>
      {/* Control del Centro de masas (F2.4): toggle + panel de datos. En mid-left
          (zona reservada hasta ahora) para no competir con GroupRibbon (top-left) ni
          con los inspectores (mid-right). Se autooculta fuera de vista planta. */}
      {/* Centro de masas (vista planta) y "Ver modelo de cálculo" (vista 3D) comparten
          la zona mid-left; cada uno se autooculta segun el modo, asi nunca coinciden. */}
      <Slot zona="mid-left">
        <CentroMasa />
        <ModeloCalculo />
      </Slot>
      <Slot zona="bottom-right">
        <ControlesZoom />
      </Slot>
    </>
  );
}
