import type { ReactNode } from "react";
import "./shell.css";
import { Brandbar } from "./Brandbar";
import { Menubar } from "./Menubar";
import { Sidebar } from "./Sidebar";
import { ToolsRail } from "./ToolsRail";
import { StatusBar, type StatusBarProps } from "./StatusBar";
import { BottomTabs } from "./BottomTabs";
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
}

export function Shell({ children, nombreObra, status, dock }: ShellProps) {
  return (
    <div className="cx-app">
      <Brandbar nombreObra={nombreObra} />
      <Menubar />

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
        {/* Dock al borde de ventana (tools queda pegado al lienzo). Solo se monta si
            App compuso contenido para la pestana activa: las pestanas sin paneles de
            datos dejan el lienzo a ancho completo. */}
        {dock != null && dock !== false && (
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
