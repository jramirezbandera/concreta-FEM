// crStore: resultados del ultimo CENTRO DE RIGIDEZ (CR) FEM-exacto (F2). Espejo de
// modalStore/resultadosStore pero para el camino del CR, que es un camino INDEPENDIENTE
// del calculo estatico y del modal (decision 8A del plan): tiene su propio disparo
// "Calcular centro de rigidez", su propio overlay (CentroRigidezOverlay) y su propio
// store. Se limpia/invalida al editar la obra (lo dispara modeloStore, igual que
// resultadosStore/modalStore). SIN logica de calculo: solo almacena lo que el pipeline
// del CR (useSolicitarCR/calcularCR) le vuelca (antipatron §17). NUNCA importa
// modeloStore (la dependencia es unidireccional modeloStore->crStore para evitar el
// ciclo, identico a resultadosStore/modalStore).
//
// QUE GUARDA: el ResultadosCR (cr_por_planta: x/y/ex/ey por planta) o null si nunca se
// calculo / se descarto al cambiar de obra. El estado del MOTOR (estadoMotor/calculando)
// NO vive aqui: es compartido (un solo motor) y vive en calculoStore, igual que el modal;
// el panel/overlay del CR lo leen de alli. Aqui solo el resultado y su vigencia.
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ResultadosCR } from "../solver/resultadosCR";

interface CRState {
  // Centro de rigidez por planta que devolvio el motor (ya ensamblado con ex/ey desde
  // el CM), o null si nunca se calculo / se descarto al cambiar de obra. OJO: puede
  // seguir no nulo con vigente=false (CR "antiguo" que el overlay puede mostrar hasta
  // recalcular, coherente con resultadosStore/modalStore).
  cr: ResultadosCR | null;
  // true si `cr` corresponde al modelo actual; false tras editar la obra. Es
  // informativo: con vigente=false puede haber `cr` no nulo (el panel lo marca obsoleto).
  vigente: boolean;
  // Fija el CR de un calculo. Al fijar resultados nuevos queda vigente=true.
  setCR(cr: ResultadosCR): void;
  // Editar la obra: baja la bandera pero CONSERVA el ultimo CR (coherente con
  // resultadosStore/modalStore: el overlay puede seguir mostrando el marcador hasta
  // recalcular; el panel lo etiqueta como obsoleto).
  limpiar(): void;
  // Cambiar de obra (cargar/importar): reset total, el CR ya no aplica.
  descartar(): void;
}

export const crStore = create<CRState>()(
  subscribeWithSelector((set) => ({
    cr: null,
    vigente: false,
    setCR: (cr) => set({ cr, vigente: true }),
    limpiar: () => set({ vigente: false }),
    descartar: () => set({ cr: null, vigente: false }),
  })),
);
