// Visor de sólo lectura (V1, docs/fem3d/visor.md). Misma pila que Concreta
// (concreta-v2/vite.config.ts): React con el React Compiler y Tailwind 4.
// Importa el motor de ../src (por eso `fs.allow`); el worker de sesión va en
// módulo ES, como el de Pyodide de Concreta.
import { defineConfig } from "vitest/config";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  server: { port: 5180, strictPort: true, fs: { allow: [".."] } },
  preview: { port: 5181, strictPort: true },
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    testTimeout: 120_000,
  },
});
