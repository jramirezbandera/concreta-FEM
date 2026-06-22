// modeloStore: el Modelo (Capa 1). UNICO origen de la obra y unico store en la
// pila de undo (CLAUDE.md §10). Middleware immer (mutaciones via draft) +
// subscribeWithSelector (transient updates fuera del ciclo de render, los consume
// el viewport en feature-9). Integra una PilaUndo y, tras CUALQUIER mutacion del
// modelo, invalida resultadosStore (los resultados dejan de ser vigentes al editar).
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { subscribeWithSelector } from "zustand/middleware";
import type { Modelo } from "../dominio";
import { crearModeloVacio } from "../dominio";
import { PilaUndo } from "./comandos/pilaUndo";
import { applyPatches } from "./comandos/comando";
import type { Comando, AplicadorParches } from "./comandos/comando";
import { resultadosStore } from "./resultadosStore";

// Una sola pila para toda la vida del store (modulo, no estado React): el
// historial es infraestructura, no dato serializable de la obra.
const pila = new PilaUndo();

interface ModeloState {
  modelo: Modelo;
  getModelo(): Modelo;
  cargarModelo(m: Modelo): void;
  ejecutar(comando: Comando): void;
  deshacer(): void;
  rehacer(): void;
  // Habilitacion de undo/redo como ESTADO reactivo derivado de la PilaUndo: la
  // pila sigue siendo la fuente, estos campos son su reflejo en el store para que
  // la UI (Brandbar) se suscriba directamente sin trucos (CLAUDE.md §9: explicito
  // sobre ingenioso). Se actualizan tras CADA operacion que cambia la pila.
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
}

export const modeloStore = create<ModeloState>()(
  subscribeWithSelector(
    immer((set, get) => {
      // Aplicador inyectado a los comandos: muta el `modelo` del store con los
      // parches Immer del delta, dentro de un producer immer. Es el unico punto
      // donde los parches tocan el store.
      const aplicador: AplicadorParches = (patches) =>
        set((estado) => {
          estado.modelo = applyPatches(estado.modelo, patches);
        });

      // Editar el modelo invalida los resultados (deformada/esfuerzos dejan de ser
      // vigentes hasta recalcular) pero los CONSERVA: limpiar() solo baja la bandera
      // (F14 los muestra obsoletos en gris). Cambiar de obra usa descartar() (reset
      // total). Import unidireccional modeloStore->resultadosStore.
      const invalidarResultados = () => resultadosStore.getState().limpiar();

      // Refleja en el store el estado de la pila tras cualquier cambio de
      // historial. Mantener juntos modelo y banderas evita estados intermedios
      // incoherentes en una suscripcion.
      const sincronizarPila = () =>
        set((estado) => {
          estado.puedeDeshacer = pila.puedeDeshacer();
          estado.puedeRehacer = pila.puedeRehacer();
        });

      return {
        modelo: crearModeloVacio(),
        getModelo: () => get().modelo,
        // Pila vacia al arrancar: ambos false.
        puedeDeshacer: false,
        puedeRehacer: false,

        cargarModelo: (m) => {
          // Reemplazo total de la obra: el historial previo no aplica y los
          // resultados de la obra anterior se descartan del todo (no en gris).
          pila.limpiar();
          set((estado) => {
            estado.modelo = m;
          });
          sincronizarPila();
          resultadosStore.getState().descartar();
        },

        ejecutar: (comando) => {
          // Guard de dev del invariante de `base` (ver comando.ts): los parches del
          // comando se construyeron contra un `base` que debe ser el modelo actual.
          // Si no coincide, los indices absolutos caerian mal. import.meta.env.DEV
          // viene tipado por vite/client (src/vite-env.d.ts).
          if (
            import.meta.env.DEV &&
            comando.base !== undefined &&
            comando.base !== get().modelo
          ) {
            throw new Error(
              "Comando construido sobre un modelo distinto al actual; " +
                "reconstruyelo con getModelo() antes de ejecutar.",
            );
          }
          pila.ejecutar(comando, aplicador);
          sincronizarPila();
          invalidarResultados();
        },

        deshacer: () => {
          pila.deshacer(aplicador);
          sincronizarPila();
          invalidarResultados();
        },

        rehacer: () => {
          pila.rehacer(aplicador);
          sincronizarPila();
          invalidarResultados();
        },
      };
    }),
  ),
);
