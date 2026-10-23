// Visor de sólo lectura (V1, docs/fem3d/visor.md). Misma pila que Concreta
// (concreta-v2/vite.config.ts): React con el React Compiler y Tailwind 4.
// Importa el motor de ../src (por eso `fs.allow`); el worker de sesión va en
// módulo ES, como el de Pyodide de Concreta.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Versión de esta build: el commit en GitHub Actions, la hora en una build local. Va dentro del
// código (__VERSION_APP__) y en dist/version.json; la app compara las dos para avisar de una
// versión nueva (src/armazon/AvisoVersion.tsx) donde no hay service worker. Desde AL2 el aviso sale
// sobre todo del service worker en espera, como en Concreta.
const VERSION_APP = process.env.GITHUB_SHA ?? `local-${new Date().toISOString()}`;

const versionJson = (): Plugin => ({
  name: "version-json",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: VERSION_APP }) });
  },
});

export default defineConfig({
  base: "./",
  define: { __VERSION_APP__: JSON.stringify(VERSION_APP) },
  worker: { format: "es" },
  server: { port: 5180, strictPort: true, fs: { allow: [".."] } },
  preview: { port: 5181, strictPort: true },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    versionJson(),
    // AL2 (docs/fem3d/almacen-local.md §4): la app como PWA, con la configuración de Concreta
    // (concreta-v2/vite.config.ts). «prompt» e injectRegister: false: el service worker se registra
    // desde React (AvisoVersion.tsx) y una versión nueva espera a que se pulse «Actualizar», nunca
    // se aplica sola.
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      devOptions: { enabled: false },
      workbox: {
        // Todo dist/, con el núcleo WASM, las fuentes y los ejemplos (van en trozos de JS): la app
        // abre y calcula sin conexión desde la segunda visita. version.json no: es lo que se pregunta.
        globPatterns: ["**/*.{js,css,html,wasm,woff2,png,svg,txt}"],
        cleanupOutdatedCaches: true,
        // El trozo principal pasa de los 2 MiB de Workbox por defecto
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Cualquier navegación (?local=…, ?ejemplo=…) abre la app de la caché; lo demás que no está en
        // el precache (el proyecto del servidor local, .fem/) va a la red tal cual.
        navigateFallback: "index.html",
      },
      manifest: {
        name: "Concreta FEM 3D",
        short_name: "FEM 3D",
        description: "Modelar, calcular y revisar estructuras con el motor FEM 3D de Concreta",
        lang: "es",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        // Relativos: en GitHub Pages la app vive en /concreta-FEM/
        start_url: "./",
        scope: "./",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // El módulo virtual de vite-plugin-pwa no existe en las pruebas (AL2)
    alias: { "virtual:pwa-register/react": fileURLToPath(new URL("./src/test/pwaRegistro.ts", import.meta.url)) },
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 120_000,
  },
});
