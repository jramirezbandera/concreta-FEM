// Visor de sólo lectura (V1, docs/fem3d/visor.md). Misma pila que Concreta
// (concreta-v2/vite.config.ts): React con el React Compiler y Tailwind 4.
// Importa el motor de ../src (por eso `fs.allow`); el worker de sesión va en
// módulo ES, como el de Pyodide de Concreta.
import { defineConfig } from "vitest/config";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

// Versión de esta build: el commit en GitHub Actions, la hora en una build local. Va dentro del
// código (__VERSION_APP__) y en dist/version.json; la app compara las dos para avisar de una
// versión nueva (src/armazon/AvisoVersion.tsx), como el «Actualizar» de Concreta pero sin service
// worker.
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
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss(), versionJson()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 120_000,
  },
});
