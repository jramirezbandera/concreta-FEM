/// <reference types="vite/client" />

// Variables de entorno de la app expuestas via import.meta.env (feature-16, T0.2).
// VITE_E2E gatea la costura de test `window.__concreta`: solo cuando esta presente
// (la fija el webServer de Playwright con `cross-env VITE_E2E=true vite`) main.tsx
// importa DINAMICAMENTE el e2eBridge. Es un string (Vite expone las env como strings);
// se trata como truthy. En produccion no esta definida -> el import dinamico es dead
// code y Vite hace tree-shake del harness.
interface ImportMetaEnv {
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
