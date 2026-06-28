import { Boton, Pill } from "../primitivas";
import { modeloStore, calculoStore } from "../../estado";
import { calcularObra } from "../resultados/useCalcular";
import {
  rotuloEstadoMotor,
  tonoEstadoMotor,
  calculoHabilitado,
} from "../resultados/estadoMotorUI";

// Brandbar (Spec Diseno UI §2): marca Concreta · Estructuras + nombre de obra +
// pill de unidades (kN · m, siempre visible, mono) y, a la derecha, undo/redo
// cableados a modeloStore, un indicador del estado del motor y el boton primario
// "Calcular obra". El toggle 2D/3D NO va aqui: vive en el HUD del viewport (no
// duplicar). Los helpers de presentacion del estado del motor (rotulo/tono/
// habilitacion) viven en estadoMotorUI.ts, compartidos con BotonCalcular y Menubar
// (cerro T-estado-motor-helpers; antes estaban triplicados).

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

  // Estado del motor: seleccion PUNTUAL de calculoStore (no polling propio). El shell
  // no esta en el bucle de render del viewport, asi que basta una suscripcion normal;
  // solo re-renderiza cuando cambian estos campos sueltos, nunca por frame (#11).
  const estadoMotor = calculoStore((s) => s.estadoMotor);
  const calculando = calculoStore((s) => s.calculando);
  const habilitarCalculo = calculoHabilitado(estadoMotor, calculando);

  return (
    <header className="cx-brandbar">
      <span className="cx-brand">
        <span className="cx-brand__name">Concreta</span>
        <span className="cx-brand__sub caps">Estructuras</span>
      </span>

      <span className="cx-brandbar__obra">{nombreObra ?? "Obra sin título"}</span>

      <Pill>kN · m</Pill>

      <span className="cx-brandbar__spacer" />

      {/* Indicador del estado del motor en lenguaje de obra (cero jerga FEM): punto
          de color semantico + rotulo. role=status para que lo anuncien lectores. */}
      <span
        className="cx-motor"
        data-tono={tonoEstadoMotor(estadoMotor, calculando)}
        role="status"
        aria-live="polite"
      >
        <span className="cx-motor__dot" aria-hidden="true" />
        <span className="cx-motor__txt">{rotuloEstadoMotor(estadoMotor, calculando)}</span>
      </span>

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
          disabled={!habilitarCalculo}
          aria-busy={calculando || estadoMotor === "cargando"}
          onClick={() => void calcularObra()}
        >
          ▶ Calcular obra
        </Boton>
      </span>
    </header>
  );
}
