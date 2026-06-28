// modalStore: resultados del ultimo ANALISIS MODAL (frecuencias propias + formas de
// vibracion). Espejo de resultadosStore pero para el camino MODAL (F2b), que es un
// camino INDEPENDIENTE del calculo estatico (decision de alcance: no es un `tipo` de
// analisis, tiene su propio disparo "Calcular modos", su propio overlay y su propio
// store). Se limpia/invalida al editar la obra (lo dispara modeloStore, igual que
// resultadosStore). SIN logica de calculo: solo almacena lo que el solver ya devolvio
// (antipatron §17). NUNCA importa modeloStore (la dependencia es unidireccional
// modeloStore->modalStore para evitar el ciclo, idéntico a resultadosStore).
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { ResultadosModales } from "../solver";
import type { ModeloFEM, Trazabilidad } from "../discretizador";

interface ModalState {
  // Resultados modales que devolvio el solver, o null si nunca se calcularon / se
  // descartaron al cambiar de obra. OJO: pueden seguir no nulos con vigente=false
  // (formas modales "antiguas" que el overlay puede mostrar hasta recalcular).
  modos: ResultadosModales | null;
  // ModeloFEM que produjo estos modos. El overlay lo necesita para pintar las formas
  // modales: las posiciones de nodo (nodes[].x/y/z) y la lista de barras (members)
  // viven aqui, no en ResultadosModales (que solo trae desplazamientos por nudo). Se
  // guarda junto a `modos` porque ambos provienen del MISMO calculo (coherencia: el
  // mapeo nodo->posicion debe casar).
  modeloFEM: ModeloFEM | null;
  // Trazabilidad Capa 1 <-> Capa 2 del mismo calculo. Espejo de resultadosStore; util
  // para una futura UI que mapee elementos de obra a sus barras FEM en modal.
  trazabilidad: Trazabilidad | null;
  // true si `modos` corresponde al modelo actual; false tras editar la obra. Es
  // informativo: con vigente=false puede haber `modos` no nulos.
  vigente: boolean;
  // Indice (1-indexado, == numero del modo) del modo seleccionado en el panel y
  // dibujado por el overlay. Por defecto 1 (el primer modo, frecuencia mas baja).
  modoActivo: number;
  // Fija el trio que produce un calculo modal: modos + el ModeloFEM y la trazabilidad
  // que los generaron. Se reciben juntos a proposito (mismo origen, deben casar). Al
  // fijar resultados nuevos, el modo activo se reancla al primer modo (numero 1): los
  // indices del calculo anterior no tienen por que existir en el nuevo.
  setModos(
    modos: ResultadosModales,
    modeloFEM: ModeloFEM,
    trazabilidad: Trazabilidad,
  ): void;
  // Editar la obra: baja la bandera pero CONSERVA los ultimos modos (coherente con
  // resultadosStore.limpiar: el overlay puede seguir mostrando la forma hasta recalcular).
  limpiar(): void;
  // Cambiar de obra (cargar/importar): reset total, los modos ya no aplican.
  descartar(): void;
  // Cambia el modo seleccionado/dibujado (lo dispara el selector del panel).
  setModoActivo(numero: number): void;
}

export const modalStore = create<ModalState>()(
  subscribeWithSelector((set) => ({
    modos: null,
    modeloFEM: null,
    trazabilidad: null,
    vigente: false,
    modoActivo: 1,
    setModos: (modos, modeloFEM, trazabilidad) =>
      set({ modos, modeloFEM, trazabilidad, vigente: true, modoActivo: 1 }),
    limpiar: () => set({ vigente: false }),
    descartar: () =>
      set({
        modos: null,
        modeloFEM: null,
        trazabilidad: null,
        vigente: false,
        modoActivo: 1,
      }),
    setModoActivo: (numero) => set({ modoActivo: numero }),
  })),
);
