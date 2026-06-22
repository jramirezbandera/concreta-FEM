import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// Plugin inline (sin dependencias nuevas): garantiza que el runtime de Pyodide
// autohospedado este en public/pyodide/ antes de servir/empaquetar. La copia la
// hace scripts/copy-pyodide-assets.mjs (tambien cableado en postinstall). Aqui
// solo lo re-disparamos en buildStart por si node_modules/pyodide se actualizo
// despues del ultimo install. Vite ya publica public/ -> dist/ tal cual, asi
// que no hace falta copia extra en el build.
function pyodideAssets(): Plugin {
  return {
    name: "concreta-copy-pyodide-assets",
    buildStart() {
      const res = spawnSync(
        process.execPath,
        [resolve(projectRoot, "scripts/copy-pyodide-assets.mjs")],
        { stdio: "inherit" },
      );
      if (res.status !== 0) {
        this.warn(
          "No se pudo copiar el runtime de Pyodide a public/pyodide/. " +
            "Ejecuta `npm run copy-pyodide`.",
        );
      }
    },
  };
}

// Config base (feature-1) + solver (feature-5). El worker de Pyodide/PyNite se
// carga como modulo ESM y el runtime se sirve autohospedado desde /pyodide/.
export default defineConfig(({ command }) => ({
  // GitHub Pages sirve el sitio bajo un subpath con el nombre del repo
  // (https://jramirezbandera.github.io/concreta-FEM/). En build fijamos ese base
  // para que los assets y el runtime de Pyodide resuelvan bien; en dev queda en
  // "/" para no entorpecer el servidor local. INDEX_URL (solver/config.ts) deriva
  // de import.meta.env.BASE_URL, asi que /pyodide/ sigue al base automaticamente.
  base: command === "build" ? "/concreta-FEM/" : "/",
  plugins: [react(), tailwindcss(), pyodideAssets()],
  // El worker del solver es un modulo ES (usa import de Comlink/pyodide).
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // No prebundlear pyodide: trae .wasm y carga assets por URL en runtime; el
    // optimizador de esbuild lo rompe. Se importa tal cual desde el worker.
    exclude: ["pyodide"],
  },
}));
