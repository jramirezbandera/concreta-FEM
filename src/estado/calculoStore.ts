// calculoStore: estado del CALCULO (estado del motor + progreso/errores del ultimo
// intento). Fuente UNICA de verdad que comparten el boton (BotonCalcular via
// useCalcular), el menu (Menubar) y la Brandbar. Antes este estado vivia disperso en
// hooks locales de useCalcular y no lo compartian brandbar/menu; al centralizarlo
// aqui, todos los disparadores convergen en el mismo estado (feature-17).
//
// Estado de UI derivado del cálculo: NO participa en undo (como vistaStore/
// resultadosStore). subscribeWithSelector para que los consumidores se suscriban a
// campos sueltos sin re-render global (CLAUDE.md §10). SIN logica de calculo aqui:
// solo almacena lo que el pipeline (useCalcular/calcularObra) le vuelca (CLAUDE.md
// §2: no se reimplementa nada de calculo). CERO jerga FEM: los mensajes que guarda
// (ErrorObra/ErrorCalculo) ya vienen en lenguaje de obra desde el discretizador/solver.
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { EstadoMotor } from "../solver";
// ErrorObra (errores/avisos de OBRA) viene del discretizador; ErrorCalculo (fallo del
// MOTOR) es el alias de ErrorMotor que expone useCalcular. Importar el tipo desde alli
// mantiene una sola definicion del contrato (no se duplica la forma del error).
import type { ErrorObra } from "../discretizador";
import type { ErrorCalculo } from "../ui/resultados/useCalcular";

// Shape exacto del contrato de feature-17 (Brandbar/Menubar/useCalcular lo consumen):
//  - estadoMotor: ciclo de vida del worker (descargado/cargando/listo/calculando/error).
//  - calculando: true mientras hay un calcular() en vuelo end-to-end (discretizar +
//    carga + analisis); distinto de estadoMotor==="calculando" (solo la fase analyze()).
//  - errores/avisos: del ultimo discretizar (lenguaje de obra, apuntan al elemento).
//  - ultimoError: ultimo fallo del MOTOR (carga/calculo) o null. Mensaje ya legible.
interface CalculoState {
  estadoMotor: EstadoMotor;
  calculando: boolean;
  errores: ErrorObra[];
  avisos: ErrorObra[];
  ultimoError: ErrorCalculo | null;
  // CANALES PROPIOS del camino MODAL ("Calcular modos"): el estado del MOTOR
  // (estadoMotor/calculando) SI es compartido -es el mismo motor-, pero los
  // errores/fallos son RESULTADO de un calculo concreto y NO deben mezclarse: el panel
  // estatico (BotonCalcular) y el modal (PanelFrecuencias) estan montados a la vez en
  // Resultados; sin canales separados, un "Calcular modos" fallido mostraria su error
  // bajo "Calcular obra" (y viceversa), y un modal con exito borraria los errores de
  // obra del estatico. Cada panel lee su propio canal.
  erroresModal: ErrorObra[];
  ultimoErrorModal: ErrorCalculo | null;
  // CANALES PROPIOS del camino CENTRO DE RIGIDEZ ("Calcular centro de rigidez", F2):
  // mismo razonamiento que el modal. El estado del MOTOR (estadoMotor/calculando) es
  // compartido (un solo motor), pero los errores/fallos del CR no deben mezclarse con
  // los del estatico ni con los del modal: el panel del CR (CentroRigidez) lee SU canal.
  erroresCR: ErrorObra[];
  ultimoErrorCR: ErrorCalculo | null;
  setEstadoMotor(e: EstadoMotor): void;
  setCalculando(b: boolean): void;
  setErrores(e: ErrorObra[]): void;
  setAvisos(a: ErrorObra[]): void;
  setUltimoError(e: ErrorCalculo | null): void;
  setErroresModal(e: ErrorObra[]): void;
  setUltimoErrorModal(e: ErrorCalculo | null): void;
  setErroresCR(e: ErrorObra[]): void;
  setUltimoErrorCR(e: ErrorCalculo | null): void;
  // Merge superficial de varios campos a la vez (lo usa el sink por defecto de
  // calcularObra para reflejar transiciones sin encadenar setters sueltos).
  aplicar(parcial: Partial<CalculoEstadoDatos>): void;
}

// Solo los campos de datos (sin setters): el tipo del parche de aplicar().
type CalculoEstadoDatos = Pick<
  CalculoState,
  "estadoMotor" | "calculando" | "errores" | "avisos" | "ultimoError"
>;

export const calculoStore = create<CalculoState>()(
  subscribeWithSelector((set) => ({
    estadoMotor: "descargado",
    calculando: false,
    errores: [],
    avisos: [],
    ultimoError: null,
    erroresModal: [],
    ultimoErrorModal: null,
    erroresCR: [],
    ultimoErrorCR: null,
    setEstadoMotor: (e) => set({ estadoMotor: e }),
    setCalculando: (b) => set({ calculando: b }),
    setErrores: (e) => set({ errores: e }),
    setAvisos: (a) => set({ avisos: a }),
    setUltimoError: (e) => set({ ultimoError: e }),
    setErroresModal: (e) => set({ erroresModal: e }),
    setUltimoErrorModal: (e) => set({ ultimoErrorModal: e }),
    setErroresCR: (e) => set({ erroresCR: e }),
    setUltimoErrorCR: (e) => set({ ultimoErrorCR: e }),
    aplicar: (parcial) => set(parcial),
  })),
);
