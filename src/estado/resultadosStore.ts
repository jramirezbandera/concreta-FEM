// resultadosStore: resultados del ultimo calculo (DERIVADOS de la Capa 1). Se
// limpian al editar la obra (lo dispara modeloStore). SIN logica de calculo: solo
// almacena lo que el solver ya devolvio (antipatron §17). NUNCA importa
// modeloStore (la dependencia es unidireccional modeloStore->resultadosStore para
// evitar el ciclo).
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ResultadosCalculo } from "../solver";
import type { ModeloFEM, Trazabilidad } from "../discretizador";

interface ResultadosState {
  // Resultados que devolvio el solver, o null si nunca se calculo / se descartaron
  // al cambiar de obra. OJO: pueden seguir no nulos con vigente=false (ver limpiar).
  resultados: ResultadosCalculo | null;
  // ModeloFEM que produjo estos resultados. F14 lo necesita para pintar la deformada:
  // las posiciones de nodo (nodes[].x/y/z) viven aqui, no en ResultadosCalculo (que
  // solo trae desplazamientos por nodo). Se guarda junto a `resultados` porque ambos
  // provienen del MISMO calculo (coherencia: el mapeo nodo->posicion debe casar).
  modeloFEM: ModeloFEM | null;
  // Trazabilidad Capa 1 <-> Capa 2 del mismo calculo. F14 la usa para los diagramas:
  // resolver que member(s) corresponde a un pilar/viga seleccionado y mapear nudos.
  trazabilidad: Trazabilidad | null;
  // true si `resultados` corresponde al modelo actual; false tras editar la obra.
  // Es informativo: con vigente=false puede haber `resultados` no nulos (deformada
  // "antigua" que F14 muestra en gris con aviso "recalcular").
  vigente: boolean;
  // Fija el trio que produce un calculo: resultados + el ModeloFEM y la trazabilidad
  // que los generaron. Se reciben juntos a proposito (mismo origen, deben casar).
  setResultados(
    r: ResultadosCalculo,
    modeloFEM: ModeloFEM,
    trazabilidad: Trazabilidad,
  ): void;
  // Editar la obra: baja la bandera pero CONSERVA los ultimos resultados (enmienda
  // spec: F14 muestra la deformada obsoleta en gris hasta recalcular).
  limpiar(): void;
  // Cambiar de obra (cargar/importar): reset total, los resultados ya no aplican.
  descartar(): void;
}

export const resultadosStore = create<ResultadosState>()(
  subscribeWithSelector((set) => ({
    resultados: null,
    modeloFEM: null,
    trazabilidad: null,
    vigente: false,
    setResultados: (r, modeloFEM, trazabilidad) =>
      set({ resultados: r, modeloFEM, trazabilidad, vigente: true }),
    limpiar: () => set({ vigente: false }),
    descartar: () =>
      set({
        resultados: null,
        modeloFEM: null,
        trazabilidad: null,
        vigente: false,
      }),
  })),
);
