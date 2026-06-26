import { Boton, Pill } from "../primitivas";
import { modeloStore, calculoStore } from "../../estado";
import { calcularObra } from "../resultados/useCalcular";
import type { EstadoMotor } from "../../solver";

// Brandbar (Spec Diseno UI §2): marca Concreta · Estructuras + nombre de obra +
// pill de unidades (kN · m, siempre visible, mono) y, a la derecha, undo/redo
// cableados a modeloStore, un indicador del estado del motor y el boton primario
// "Calcular obra". El toggle 2D/3D NO va aqui: vive en el HUD del viewport (no
// duplicar).

// Rotulo del estado del motor en LENGUAJE DE OBRA (CLAUDE.md §17: cero jerga FEM;
// el arquitecto nunca ve el estado tecnico crudo "descargado"/"cargando"). Misma
// semantica que tagEstadoMotor de BotonCalcular, replicada aqui a proposito: esas
// funciones son privadas de /src/ui/resultados (que toca otra tarea en paralelo);
// la duplicacion es minima y se puede DRY-ear despues.
function rotuloMotor(estadoMotor: EstadoMotor, calculando: boolean): string {
  if (calculando || estadoMotor === "calculando") return "calculando";
  switch (estadoMotor) {
    case "listo":
      return "motor listo";
    case "error":
      return "motor con error";
    default: // "descargado" | "cargando"
      return "preparando motor";
  }
}

// Clase de color semantico del punto del indicador segun el estado del motor.
// Mapea a tokens (--success/--warning/--danger/--text-3) via shell.css.
function tonoMotor(estadoMotor: EstadoMotor, calculando: boolean): string {
  if (calculando || estadoMotor === "calculando") return "calculando";
  if (estadoMotor === "listo") return "listo";
  if (estadoMotor === "error") return "error";
  return "preparando";
}

// El boton solo admite pulsacion cuando el motor esta "listo" (o en "error", para
// reintentar) y no hay calculo en curso. Espeja botonHabilitado de BotonCalcular.
function botonCalculoHabilitado(estadoMotor: EstadoMotor, calculando: boolean): boolean {
  if (calculando) return false;
  return estadoMotor === "listo" || estadoMotor === "error";
}

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
  const habilitarCalculo = botonCalculoHabilitado(estadoMotor, calculando);

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
        data-tono={tonoMotor(estadoMotor, calculando)}
        role="status"
        aria-live="polite"
      >
        <span className="cx-motor__dot" aria-hidden="true" />
        <span className="cx-motor__txt">{rotuloMotor(estadoMotor, calculando)}</span>
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
