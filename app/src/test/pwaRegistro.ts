/**
 * Sustituto de `virtual:pwa-register/react` en las pruebas (vitest no carga el módulo virtual de
 * vite-plugin-pwa; alias en vite.config.ts). `pwaPrueba` decide si hay un worker en espera y cuenta
 * las activaciones.
 */
import { useState } from "react";

export const pwaPrueba = { enEspera: false, activaciones: 0 };

export function useRegisterSW(_o?: unknown) {
  const needRefresh = useState(pwaPrueba.enEspera);
  const offlineReady = useState(false);
  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: async () => {
      pwaPrueba.activaciones++;
    },
  };
}
