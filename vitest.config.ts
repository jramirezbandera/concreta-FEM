import { defineConfig } from "vitest/config";

// Testing por capas (CLAUDE.md §13, I+D hallazgo #17): test.projects (API vigente
// en Vitest 3+, NO el `workspace` deprecado).
//   - node:         dominio, discretizador y golden tests (sin DOM, sin IndexedDB).
//   - persistencia: módulo F8; necesita IndexedDB (fake-indexeddb/auto) sin contaminar `node`.
//   - jsdom:        componentes de UI.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/golden/**/*.test.ts"],
          // src/persistencia se prueba en su propio project (con IndexedDB); el de
          // golden (`--project node`) debe seguir limpio, sin fake-indexeddb.
          exclude: ["src/ui/**", "src/persistencia/**"],
        },
      },
      {
        test: {
          name: "persistencia",
          environment: "node",
          // fake-indexeddb/auto instala el global `indexedDB` solo aquí.
          setupFiles: ["fake-indexeddb/auto"],
          include: ["src/persistencia/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "jsdom",
          environment: "jsdom",
          // src/ui/** y los componentes raíz (App.tsx y su test). node solo coge
          // *.test.ts, así que los *.test.tsx raíz caen aquí sin doble ejecución.
          include: ["src/ui/**/*.test.{ts,tsx}", "src/*.test.tsx"],
          // Matchers jest-dom + cleanup de RTL (sin test.globals; ver setup-ui.ts).
          setupFiles: ["src/test/setup-ui.ts"],
        },
      },
    ],
  },
});
