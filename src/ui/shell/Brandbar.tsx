import { Boton, Pill } from "../primitivas";
import { modeloStore } from "../../estado";

// Brandbar (Spec Diseno UI §2): marca Concreta · Estructuras + nombre de obra +
// pill de unidades (kN · m, siempre visible, mono) y, a la derecha, undo/redo
// cableados a modeloStore y el boton primario "Calcular obra" (deshabilitado en
// F1: el motor se integra mas adelante). El toggle 2D/3D NO va aqui: vive en el
// HUD del viewport (no duplicar).

export interface BrandbarProps {
  /** Nombre de la obra a mostrar. Si se omite, etiqueta neutra. */
  nombreObra?: string;
}

export function Brandbar({ nombreObra }: BrandbarProps) {
  // Estado reactivo normal (el shell no esta en el bucle de render del viewport).
  const deshacer = modeloStore((s) => s.deshacer);
  const rehacer = modeloStore((s) => s.rehacer);
  // Habilitacion como estado derivado del store: seleccion directa, sin suscribirse
  // a todo el modelo. Cualquier cambio de la pila actualiza estos booleanos y
  // re-evalua la barra.
  const puedeDeshacer = modeloStore((s) => s.puedeDeshacer);
  const puedeRehacer = modeloStore((s) => s.puedeRehacer);

  return (
    <header className="cx-brandbar">
      <span className="cx-brand">
        <span className="cx-brand__name">Concreta</span>
        <span className="cx-brand__sub caps">Estructuras</span>
      </span>

      <span className="cx-brandbar__obra">{nombreObra ?? "Obra sin título"}</span>

      <Pill>kN · m</Pill>

      <span className="cx-brandbar__spacer" />

      <span className="cx-brandbar__actions">
        <button
          type="button"
          className="cx-iconbtn"
          title="Deshacer"
          aria-label="Deshacer"
          disabled={!puedeDeshacer}
          onClick={deshacer}
        >
          ↶
        </button>
        <button
          type="button"
          className="cx-iconbtn"
          title="Rehacer"
          aria-label="Rehacer"
          disabled={!puedeRehacer}
          onClick={rehacer}
        >
          ↷
        </button>
        <Boton
          variante="primary"
          disabled
          title="El motor de cálculo se integra más adelante"
        >
          ▶ Calcular obra
        </Boton>
      </span>
    </header>
  );
}
