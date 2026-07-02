// [AUDITORIA M-6] Frontera de error de React. La app no tenia NINGUN ErrorBoundary:
// un `lazy()` cuyo chunk falla al cargar (offline tras un redeploy, 404 del hash) o
// un componente que lanza en render DESMONTABA el arbol entero (pantalla en blanco),
// no solo el panel afectado. <Suspense> solo cubre el estado *pending* del lazy, no
// el *rejected*. Este boundary contiene el fallo y muestra un texto en lenguaje de
// obra; el resto de la UI (viewport, inspectores, menus) sigue vivo. El Modelo esta
// autosalvado (Dexie), asi que no hay perdida de datos, pero sin boundary se perdia
// la sesion de trabajo hasta recargar.
//
// Componente de CLASE porque React solo expone getDerivedStateFromError en clases.
// Sin estado global ni efectos: puro contenedor de fallo.
import { Component, type ReactNode } from "react";

type Props = {
  /** Texto en lenguaje de obra que se muestra si el contenido falla. */
  mensaje: string;
  children: ReactNode;
};

type State = { fallo: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { fallo: false };

  static getDerivedStateFromError(): State {
    return { fallo: true };
  }

  render(): ReactNode {
    if (this.state.fallo) {
      return (
        <p className="cx-error-boundary" role="alert">
          {this.props.mensaje}
        </p>
      );
    }
    return this.props.children;
  }
}
