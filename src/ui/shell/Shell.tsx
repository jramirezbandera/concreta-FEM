import { useSyncExternalStore, type ReactNode } from "react";
import "./shell.css";
import { Brandbar } from "./Brandbar";
import { Menubar } from "./Menubar";
import { Sidebar } from "./Sidebar";
import { ToolsRail } from "./ToolsRail";
import { StatusBar, type StatusBarProps } from "./StatusBar";
import { BottomTabs } from "./BottomTabs";
import { AvisoPersistencia } from "./AvisoPersistencia";
import type { EstadoArranquePersistencia } from "./useArranquePersistencia";
import { vistaStore } from "../../estado";
import {
  DialogoGruposYPlantas,
  DialogoHipotesis,
  DialogoOpcionesAnalisis,
} from "../dialogos";

// Shell: cromo completo de la interfaz (Spec Diseno UI §2). Compone las regiones
// fijas (brandbar, menubar, body=sidebar|work|tools, status, tabs) y deja el
// "work canvas" abierto a `children` para que la Fase 2 inyecte el <Viewport/>.
// NO conoce el viewport ni el modelo de calculo: solo lee vistaStore/modeloStore
// (lenguaje de obra) y orquesta el layout.
//
// POSTURA DESKTOP-ONLY: Concreta · Estructuras es una herramienta CAD de
// escritorio (introduccion grafica con raton, hover real, densidad alta). En F1
// NO hay objetivo movil ni tactil: targets de 26-30 px, estados :hover validos y
// sin breakpoints responsive. No implementar layouts moviles.
//
// LANDMARKS ARIA: <header> (Brandbar) · <nav> (Menubar) · <aside> (Sidebar) ·
// <main> (work canvas, aqui) · <aside> (dock de datos) · <footer> (StatusBar). Las
// solapas inferiores son un tablist Radix (role=tablist), no un landmark de
// navegacion: evitamos asi duplicar el <nav> de la menubar.

export interface ShellProps {
  /** Contenido del work canvas (el <Viewport/> lo inyecta la Fase 2). */
  children?: ReactNode;
  /** Nombre de la obra (brandbar). */
  nombreObra?: string;
  /** Estado de la barra de estado: mensaje, coords, escala, snap. */
  status?: StatusBarProps;
  /**
   * Dock de paneles de DATOS (refactor "dock de paneles", PR1): region acoplada al
   * borde derecho de la ventana que EMPUJA el lienzo (no flota sobre el). La compone
   * App.tsx por pestana (inspector, herramienta, reacciones, diagramas, plantillas…).
   * Si no hay contenido, la region NO se renderiza (el lienzo ocupa todo el ancho).
   */
  dock?: ReactNode;
  /**
   * Estado del arranque de persistencia (auditoria UX-L1). Si es "carga-fallida" (o
   * "sin-indexeddb") el Shell muestra un aviso bajo la menubar. "ok" no muestra nada.
   */
  avisoPersistencia?: EstadoArranquePersistencia;
}

// [D14 · PR3] Colapso del dock entero: cuando está colapsado, la región del dock no se
// monta y el lienzo recupera su ancho. Suscripción fina (el shell no está en el bucle del
// viewport; solo re-renderiza al conmutar el colapso).
function useDockColapsado(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.dockUI.dockColapsado, cb),
    () => vistaStore.getState().dockUI.dockColapsado,
    () => vistaStore.getState().dockUI.dockColapsado,
  );
}

export function Shell({
  children,
  nombreObra,
  status,
  dock,
  avisoPersistencia,
}: ShellProps) {
  const dockColapsado = useDockColapsado();
  return (
    <div className="cx-app">
      <Brandbar nombreObra={nombreObra} />
      <Menubar />
      {avisoPersistencia !== undefined && (
        <AvisoPersistencia estado={avisoPersistencia} />
      )}

      <div className="cx-body">
        <Sidebar />
        <main className="cx-work" aria-label="Área de trabajo">
          {children ?? (
            <div className="cx-work__placeholder">
              El lienzo se carga aquí
            </div>
          )}
        </main>
        <ToolsRail />
        {/* Dock al borde de ventana (tools queda pegado al lienzo). Solo se monta si App
            compuso contenido para la pestana activa Y el dock no está colapsado (D14e): al
            colapsarlo, la región desaparece y el lienzo recupera su ancho. */}
        {dock != null && dock !== false && !dockColapsado && (
          <aside className="cx-dock" aria-label="Panel de datos">
            {dock}
          </aside>
        )}
      </div>

      <StatusBar {...status} />
      <BottomTabs />

      {/* Dialogos modales de la app, montados una sola vez como hermanos del
          layout. Autocontrolados: se abren/cierran segun vistaStore.dialogoActivo. */}
      <DialogoGruposYPlantas />
      <DialogoHipotesis />
      <DialogoOpcionesAnalisis />
    </div>
  );
}
