import type { Page, JSHandle } from "@playwright/test";
import type { ConcretaE2E } from "./global";

// Helpers compartidos por los specs E2E (feature-16, T0.1). Solo-lectura para Fase 1:
// los specs nuevos importan de aqui pero NO editan este modulo (helpers locales por
// spec). No importa NADA de src/**: solo usa globals de runtime (window.__concreta,
// window.__E2E_MOCK) que monta la costura bajo VITE_E2E (T0.2/T0.4).

/** Señal de hidratacion: data-testid que la app expone cuando persistenciaLista=true
 *  (vistaStore, via T0.2/T0.3). `abrirApp` espera por ella antes de devolver. */
export const APP_READY = "app-ready" as const;

export interface OpcionesAbrirApp {
  // Por defecto true: instala el mock del solver en el arranque (el worker real nunca
  // arranca). Ponlo a false solo en el humo de integracion (e2e-real), que quiere PyNite.
  mock?: boolean;
}

/**
 * Abre la app en estado limpio y determinista (D6 + Codex #6):
 *  1. addInitScript ANTES de navegar — corre antes de que el bundle arranque:
 *     (a) borra cualquier IndexedDB existente (aisla de specs previos / runs locales);
 *     (b) fija window.__E2E_MOCK para que la app instale el mock antes de usePrecargaMotor.
 *  2. goto('/') y espera la señal app-ready (persistencia hidratada).
 *
 * El borrado de IndexedDB va ANTES de goto (no despues): si se hace despues, el bundle
 * ya habria abierto/escrito la DB y el autosave podria pisar el estado del test.
 */
export async function abrirApp(page: Page, opts: OpcionesAbrirApp = {}): Promise<void> {
  const mock = opts.mock ?? true;

  await page.addInitScript((mockFlag: boolean) => {
    // (a) Borrar todas las IndexedDB antes de que el bundle hidrate. databases() no
    // existe en todos los navegadores: con fallback al nombre conocido de la app.
    try {
      const idb = indexedDB as IDBFactory & {
        databases?: () => Promise<{ name?: string }[]>;
      };
      if (typeof idb.databases === "function") {
        idb
          .databases()
          .then((dbs) => {
            for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name);
          })
          .catch(() => {
            indexedDB.deleteDatabase("concreta-estructuras");
          });
      } else {
        indexedDB.deleteDatabase("concreta-estructuras");
      }
    } catch {
      // Almacenamiento bloqueado (modo privado): el test seguira; la app degrada sola.
    }

    // (b) Flag leido por la app en el arranque para instalar el mock del solver (D2).
    if (mockFlag) {
      (window as Window).__E2E_MOCK = true;
    }
  }, mock);

  await page.goto("/");
  // El nodo app-ready se pinta con el atributo `hidden` (no afecta al layout): por eso
  // esperamos a que este ADJUNTO al DOM, no "visible" (un elemento hidden nunca lo es).
  await page.getByTestId(APP_READY).waitFor({ state: "attached" });
}

/**
 * Navega a una pestaña de BottomTabs por su NOMBRE ACCESIBLE. Radix Tabs.Trigger NO
 * emite `value=` como atributo DOM (solo role="tab" + texto, con un prefijo numerico:
 * p.ej. "3 Resultados"), asi que localizar por `[value=...]` no funciona: se localiza
 * por rol+nombre con un patron sobre la etiqueta. Claves del dominio F1 abajo.
 */
const ETIQUETA_PESTANA: Record<string, RegExp> = {
  pilares: /Entrada de pilares/,
  vigas: /Entrada de vigas/,
  resultados: /Resultados/,
  isovalores: /Isovalores/,
};

export async function irAPestana(
  page: Page,
  clave: keyof typeof ETIQUETA_PESTANA | string,
): Promise<void> {
  const patron = ETIQUETA_PESTANA[clave] ?? new RegExp(clave);
  await page.getByRole("tab", { name: patron }).click();
}

/**
 * Handle tipado a la costura `window.__concreta` para usar dentro de page.evaluate.
 * Uso:
 *   const id = await (await bridge(page)).evaluate((c, p) => c.crearPilar(p), { ... });
 * Lanza si la costura no esta montada (VITE_E2E ausente o bridge no inyectado todavia).
 */
export async function bridge(page: Page): Promise<JSHandle<ConcretaE2E>> {
  return page.evaluateHandle(() => {
    const c = (window as Window).__concreta;
    if (!c) {
      throw new Error(
        "window.__concreta no esta montado: arranca el dev server con VITE_E2E=true " +
          "(lo hace el webServer de playwright.config.ts) y espera a app-ready.",
      );
    }
    return c;
  });
}
