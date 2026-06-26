import { defineConfig, devices } from "@playwright/test";

// E2E del flujo F1 (feature-16). Andamiaje T0.1: dos proyectos Playwright sobre el
// MISMO dev server de Vite. Los specs son Fase 1 (todavia no existen): `--list`
// puede decir "no tests found" y eso es exito para T0.1.
//
// webServer (D8): arranca Vite con VITE_E2E=true para activar la costura
// `window.__concreta` (montaje dinamico gateado en main.tsx; ver T0.2). Un
// `npm run dev` normal NO expone la costura ni en el bundle de produccion.
//
// E2E contra el DEV server (D3): el bundle de produccion y el base path
// `/concreta-FEM/` NO se ejercitan aqui (los cubre el build de deploy).
//
// Aislamiento (D6/#14): Playwright crea un browser context FRESCO por test por
// defecto (cookies/storage/IndexedDB nuevos). NO lo desactivamos: ese aislamiento
// resetea IndexedDB y los singletons de modulo (par, calculoEnVuelo, undo stack)
// entre specs. La limpieza explicita de IndexedDB ANTES de `goto` la hace el
// fixture `abrirApp` via addInitScript (e2e/fixtures.ts).
export default defineConfig({
  testDir: "./e2e",
  // Cada test corre en su propio worker/context: paralelo seguro (no comparten DB).
  fullyParallel: true,
  // En CI, `test.only` olvidado debe fallar el run, no pasar en silencio.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    // Traza solo al reintentar: barata en verde, util para diagnosticar el flake.
    trace: "on-first-retry",
  },
  // Un unico dev server compartido por ambos proyectos. VITE_E2E activa la costura.
  webServer: {
    command: "cross-env VITE_E2E=true vite",
    port: 5173,
    // En local reutiliza un `vite` ya abierto; en CI arranca uno limpio.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      // Mayoria de specs: solver MOCKEADO (determinista, sin Pyodide). El humo de
      // worker real (F1.worker-smoke) se excluye aqui para no arrancar PyNite.
      name: "e2e-mock",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /F1\.worker-smoke\.spec\.ts/,
    },
    {
      // Humo de integracion del worker real (Pyodide+PyNite en Chromium): lento.
      // Solo casa ese spec; cada test con timeout amplio. Se dispara con
      // `npm run e2e:real` (cross-env E2E_REAL=1); el propio spec hace
      // test.skip(!process.env.E2E_REAL) por si se lanza el proyecto a mano.
      name: "e2e-real",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /F1\.worker-smoke\.spec\.ts/,
      // Timeout del TEST completo (no de un paso): la primera instanciacion de
      // Pyodide (WASM + numpy/scipy + micropip de PyNite) mas la resolucion del
      // motor pueden acercarse al minuto y medio en frio; se da margen amplio para
      // que el humo no parpadee por arranque lento (las esperas internas del spec
      // usan TIMEOUT_MOTOR=90 s por paso).
      timeout: 180_000,
    },
  ],
});
