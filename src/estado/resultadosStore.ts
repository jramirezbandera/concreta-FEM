// resultadosStore: resultados del ultimo calculo (DERIVADOS de la Capa 1). Se
// limpian al editar la obra (lo dispara modeloStore). SIN logica de calculo: solo
// almacena lo que el solver ya devolvio (antipatron §17). NUNCA importa
// modeloStore (la dependencia es unidireccional modeloStore->resultadosStore para
// evitar el ciclo).
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ResultadosCalculo } from "../solver";

interface ResultadosState {
  // Resultados que devolvio el solver, o null si nunca se calculo / se descartaron
  // al cambiar de obra. OJO: pueden seguir no nulos con vigente=false (ver limpiar).
  resultados: ResultadosCalculo | null;
  // true si `resultados` corresponde al modelo actual; false tras editar la obra.
  // Es informativo: con vigente=false puede haber `resultados` no nulos (deformada
  // "antigua" que F14 muestra en gris con aviso "recalcular").
  vigente: boolean;
  setResultados(r: ResultadosCalculo): void;
  // Editar la obra: baja la bandera pero CONSERVA los ultimos resultados (enmienda
  // spec: F14 muestra la deformada obsoleta en gris hasta recalcular).
  limpiar(): void;
  // Cambiar de obra (cargar/importar): reset total, los resultados ya no aplican.
  descartar(): void;
}

export const resultadosStore = create<ResultadosState>()(
  subscribeWithSelector((set) => ({
    resultados: null,
    vigente: false,
    setResultados: (r) => set({ resultados: r, vigente: true }),
    limpiar: () => set({ vigente: false }),
    descartar: () => set({ resultados: null, vigente: false }),
  })),
);
