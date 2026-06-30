// ModeloCalculo: control HUD de "Ver modelo de calculo" (F2c). Toggle + panel con los
// conteos de la Capa 2 (nudos/barras/apoyos) o, si la obra no se puede calcular, el
// motivo en lenguaje de obra (asi el toggle no parece roto, outside-voice #12). Vive en
// el Hud persistente -> disponible en TODAS las pestanas (como CentroMasa) sin duplicar
// montaje (resuelve el cableado per-pestana, outside-voice #14).
//
// VISIBILIDAD: solo en vista 3D (el overlay se aprecia sobre el edificio completo; en
// planta se descuadraria). "Ver modelo de calculo" es el UNICO punto donde se permite
// jerga FEM en la UI (CLAUDE.md Â§2/Â§3). Vista SIMPLIFICADA de apoyos/releases (Issue
// 7-B): el panel lo rotula; la fidelidad 6-GDL es un TODO (T-modelo-calculo-6dof).
import { useSyncExternalStore } from "react";
import { vistaStore } from "../../estado";
import { PanelFlotante } from "../primitivas";
import { useFuenteModeloCalculo } from "./modeloCalculoFuente";
import type { ModeloFEM } from "../../discretizador";
import "./modeloCalculo.css";

// Vista 3D pleno? El control (y el overlay) se ofrecen en cualquier vista que NO sea
// planta (3D y mosaico comparten la escena 3D y muestran el edificio completo: el mismo
// criterio `!== "planta"` que usan el colapso de geometria y el gating de App). Antes
// usaba `=== "3d"`, lo que dejaba mosaico como un 3D-pleno SIN el toggle (incoherente).
function useEnPleno(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modoVista, cb),
    () => vistaStore.getState().modoVista !== "planta",
    () => vistaStore.getState().modoVista !== "planta",
  );
}

function useMostrar(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.mostrarModeloCalculo, cb),
    () => vistaStore.getState().mostrarModeloCalculo,
    () => vistaStore.getState().mostrarModeloCalculo,
  );
}

function useSolo(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.soloModeloCalculo, cb),
    () => vistaStore.getState().soloModeloCalculo,
    () => vistaStore.getState().soloModeloCalculo,
  );
}

// Conteos directos del ModeloFEM (sin reconstruir la geometria del overlay: el panel
// solo necesita los totales).
function conteos(fem: ModeloFEM): { nudos: number; barras: number; apoyos: number } {
  return {
    nudos: fem.nodes.length,
    barras: fem.members.length,
    apoyos: fem.supports.length,
  };
}

export function ModeloCalculo() {
  const enPleno = useEnPleno();
  const mostrar = useMostrar();
  const solo = useSolo();
  // Mismo `activo` que el overlay (mostrar && pleno): comparte el memo de fuente (un solo
  // discretizar). Se llama SIEMPRE (reglas de hooks); fuera de pleno el control no se pinta.
  const fuente = useFuenteModeloCalculo(mostrar && enPleno);

  if (!enPleno) return null;

  const toggle = () => vistaStore.getState().toggleModeloCalculo();
  const toggleSolo = () => vistaStore.getState().toggleSoloModeloCalculo();

  return (
    <PanelFlotante
      className="cx-mc"
      icono={
        <span className="cx-mc__glifo" aria-hidden="true">
          ◫
        </span>
      }
      titulo="Ver modelo de cálculo"
    >
      <label className="cx-mc__toggle">
        <input
          type="checkbox"
          checked={mostrar}
          onChange={toggle}
          aria-label="Ver modelo de cálculo"
        />
        <span>Mostrar sobre la obra</span>
      </label>
      {/* "Ver solo el modelo": oculta la obra solida (pilares/vigas) para que el modelo de
          calculo no quede tapado/solapado por ella. Solo aplica con "Mostrar" activo. */}
      {mostrar ? (
        <label className="cx-mc__toggle">
          <input
            type="checkbox"
            checked={solo}
            onChange={toggleSolo}
            aria-label="Ver solo el modelo de cálculo (ocultar la obra)"
          />
          <span>Ocultar la obra (ver solo el modelo)</span>
        </label>
      ) : null}
      {mostrar ? <Detalle fuente={fuente} /> : null}
    </PanelFlotante>
  );
}

function Detalle({ fuente }: { fuente: ReturnType<typeof useFuenteModeloCalculo> }) {
  if (fuente.estado === "no-calculable") {
    return (
      <div className="cx-mc__detalle">
        <span className="cx-mc__aviso">No se puede mostrar: {fuente.motivo}</span>
      </div>
    );
  }
  if (fuente.estado !== "ok") return null; // inactivo: no deberia ocurrir con mostrar=true
  const c = conteos(fuente.modeloFEM);
  return (
    <div className="cx-mc__detalle">
      <div className="cx-mc__fila">
        <span className="cx-mc__clave">Nudos</span>
        <span className="cx-mc__valor mono">{c.nudos}</span>
      </div>
      <div className="cx-mc__fila">
        <span className="cx-mc__clave">Barras</span>
        <span className="cx-mc__valor mono">{c.barras}</span>
      </div>
      <div className="cx-mc__fila">
        <span className="cx-mc__clave">Apoyos</span>
        <span className="cx-mc__valor mono">{c.apoyos}</span>
      </div>
      <span className="cx-mc__nota">Vista simplificada del modelo</span>
    </div>
  );
}
