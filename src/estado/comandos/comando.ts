// Nucleo del patron Command para undo/redo (CLAUDE.md §10). Cada edicion de obra
// es un comando reversible que guarda el DELTA (no un snapshot del modelo): los
// parches de Immer. Esto cumple el antipatron §17 (nada de snapshots completos
// salvo acciones masivas) y mantiene la pila de undo barata en memoria.
import { enablePatches, produceWithPatches, applyPatches } from "immer";
import type { Patch } from "immer";
import type { Modelo } from "../../dominio";

// Immer exige activar el soporte de parches UNA vez antes de usar
// produceWithPatches/applyPatches; sin esto ambos lanzan en runtime. Se llama a
// nivel de modulo (efecto idempotente) para que cualquier import del nucleo de
// comandos lo garantice.
enablePatches();

// DISENO: como el Comando aplica/revierte SOBRE el store.
// El Comando NO conoce el store (evita el ciclo estado<->comando y lo hace
// testeable aislado). Guarda solo los parches (delta) y, al ejecutarse, recibe
// del modeloStore un "aplicador" que sabe mutar el Modelo del store con esos
// parches. Asi `aplicar(ap)` reproduce el cambio y `revertir(ap)` lo deshace,
// ambos como deltas puros. Tras ejecutar+deshacer, el Modelo es deep-equal al
// previo; rehacer (aplicar de nuevo) vuelve al estado con el cambio.
export type AplicadorParches = (patches: Patch[]) => void;

// INVARIANTE: un Comando captura sus parches (indices absolutos: "pilares/3",
// "add"...) contra el `base` con el que se construyo. El modeloStore los aplica
// sobre get().modelo, asi que base DEBE ser el modelo actual: construye el comando
// desde getModelo() y despachalo de inmediato (no lo retengas entre ediciones).
export interface Comando {
  // El modeloStore inyecta su aplicador de parches al ejecutar el comando.
  aplicar(aplicador: AplicadorParches): void;
  revertir(aplicador: AplicadorParches): void;
  // Texto en lenguaje de obra para la UI (p.ej. menu Edicion / tooltip de undo).
  etiqueta: string;
  // Si dos comandos consecutivos comparten coalesceKey, la PilaUndo los fusiona
  // en un solo paso de undo (rafagas de arrastre). undefined => no coalesce.
  coalesceKey?: string;
  // Solo en dev: referencia al `base` para vigilar el invariante (modeloStore lanza
  // si base !== modelo actual). NO se retiene en produccion: sigue siendo delta, no
  // snapshot (no rompe el principio "delta no snapshot" de CLAUDE.md §10/§17).
  base?: Modelo;
}

// Receta Immer: muta el borrador del Modelo para describir el cambio. Es pura
// respecto al store (opera sobre un draft), igual que el dominio.
export type RecetaModelo = (borrador: Modelo) => void;

// Construye un Comando a partir de una receta. Captura patches/inversePatches con
// produceWithPatches y devuelve tambien el `siguiente` Modelo ya producido (util
// para tests o para conocer el resultado sin volver a aplicar). El Comando aplica
// el delta hacia delante (patches) y lo revierte con inversePatches.
// INVARIANTE (ver interface Comando): los parches usan indices absolutos contra
// `base`; ese `base` debe ser el modelo actual del store al ejecutar.
export function crearComandoParches(
  base: Modelo,
  etiqueta: string,
  receta: RecetaModelo,
  coalesceKey?: string,
): { comando: Comando; siguiente: Modelo } {
  const [siguiente, patches, inversePatches] = produceWithPatches(base, receta);

  const comando: Comando = {
    etiqueta,
    coalesceKey,
    aplicar(aplicador) {
      aplicador(patches);
    },
    revertir(aplicador) {
      aplicador(inversePatches);
    },
  };

  // Solo en dev: adjuntamos `base` para que modeloStore vigile el invariante. En
  // prod no se retiene (delta, no snapshot). import.meta.env.DEV viene tipado por
  // vite/client (src/vite-env.d.ts).
  if (import.meta.env.DEV) comando.base = base;

  return { comando, siguiente };
}

// Re-export del aplicador real de Immer: el modeloStore lo usa para construir su
// AplicadorParches (applyPatches(borrador, patches) dentro del producer Immer).
export { applyPatches };
export type { Patch };
