// seleccionStore: elementos seleccionados y hover (estado de interaccion, no de
// obra). subscribeWithSelector para que el viewport (feature-9) se suscriba a
// hover/seleccion como transient updates sin re-render del arbol React. Guarda
// solo ids de dominio; NO participa en undo.
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

interface SeleccionState {
  seleccion: string[]; // ids de elementos seleccionados
  hoverId: string | null; // id bajo el cursor, o null
  seleccionar(ids: string[]): void;
  alternar(id: string): void; // anade/quita un id de la seleccion
  limpiar(): void;
  setHover(id: string | null): void;
}

export const seleccionStore = create<SeleccionState>()(
  subscribeWithSelector((set) => ({
    seleccion: [],
    hoverId: null,
    seleccionar: (ids) => set({ seleccion: ids }),
    alternar: (id) =>
      set((estado) => ({
        seleccion: estado.seleccion.includes(id)
          ? estado.seleccion.filter((x) => x !== id)
          : [...estado.seleccion, id],
      })),
    limpiar: () => set({ seleccion: [] }),
    setHover: (id) => set({ hoverId: id }),
  })),
);
