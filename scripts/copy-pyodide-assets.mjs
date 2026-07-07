// Copia el runtime de Pyodide AUTOHOSPEDADO desde node_modules/pyodide a
// public/pyodide/ (decision cerrada del proyecto: NO CDN; los .wasm/wheels se
// sirven desde el propio origen para control de version y cache — CLAUDE.md §8,
// PyNite_Guia_Completa.md §12.7).
//
// Se ejecuta en `postinstall` (tras cada npm install) y puede invocarse a mano
// con `npm run copy-pyodide`. Sin dependencias nuevas: solo node:fs.
//
// Por que copiar todo el directorio del paquete: el worker arranca con
// indexURL = "/pyodide/" y Pyodide resuelve numpy/scipy/micropip y demas wheels
// a partir de su `pyodide-lock.json` con rutas RELATIVAS a ese indexURL. Copiar
// el directorio completo garantiza que loadPackage(["numpy","scipy"]) y
// micropip encuentren sus archivos. Filtramos solo lo que es puramente de Node
// (los .d.ts/.ts.map y package.json no estorban, pero los .node nativos y
// ficheros de tooling no aplican en el navegador).

import { cp, rm, access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, sep, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const srcDir = join(projectRoot, "node_modules", "pyodide");
const destDir = join(projectRoot, "public", "pyodide");
// Wheels vendorizados en el repo. Se sirven bajo /pyodide/ para arranque offline
// (regla de oro #9). Son DOS familias, ambas en vendor/wheels/ (fuente versionada):
//   - Instalados por micropip (worker.ts): PyNiteFEA + PrettyTable (no estan en el
//     catalogo WASM de Pyodide). Orden/flags en WHEELS_VENDOR de src/solver/config.ts.
//   - Resueltos por loadPackage via pyodide-lock.json: numpy, scipy, libopenblas,
//     micropip, wcwidth. VAN VENDORIZADOS porque `pyodide` npm 0.28.3 publica SOLO
//     el core (13 ficheros; su package.json `files` NO incluye ningun wheel de
//     paquete). En un `npm ci` limpio node_modules/pyodide NO los trae, asi que
//     copiarlos de ahi dejaba public/pyodide SIN numpy/scipy -> 404 en GitHub Pages
//     -> el motor no arrancaba (el deploy pasaba en verde porque la verificacion de
//     abajo solo miraba core + PyNiteFEA/PrettyTable). Vendorizarlos hace la copia
//     DETERMINISTA e independiente de lo que traiga node_modules.
const vendorWheelsDir = join(projectRoot, "vendor", "wheels");

// -----------------------------------------------------------------------------
// FUENTE DE VERDAD del par pineado: src/solver/config.ts (VERSIONES). Este .mjs
// se ejecuta en `postinstall` con node puro, sin pipeline TS, asi que importar
// el .ts no es practico (requeriria un loader/transpilador en una fase fragil).
// DECISION: duplicamos AQUI la version pineada como constante, con este comentario
// que apunta a la fuente. Si cambia VERSIONES.pyodide en config.ts, actualizar
// tambien esta linea (el smoke/golden re-asertan el par real, asi que un desfase
// se detectaria igualmente en los tests).
const PYODIDE_PINEADA = "0.28.3"; // == src/solver/config.ts VERSIONES.pyodide
// Wheels vendorizados que DEBEN existir en public/pyodide/ tras la copia (sin
// version: el matcher comprueba el prefijo, asi un bump del pin no rompe esto).
// Acoplado a WHEELS_VENDOR de src/solver/config.ts (PyNiteFEA + PrettyTable).
const WHEELS_VENDOR_ESPERADOS = ["pynitefea", "prettytable"];
// Wheels de PAQUETE que loadPackage(numpy,scipy,micropip) resuelve por el
// pyodide-lock.json: cierre transitivo {numpy, scipy(+numpy,libopenblas), micropip,
// wcwidth(dep de PrettyTable)}. `pyodide` npm 0.28.3 NO los publica, asi que van
// vendorizados; verificarlos aqui evita re-desplegar un motor roto en silencio (fue
// el bug del 404 en GitHub Pages). Prefijos (libopenblas es .zip, no .whl).
const PAQUETES_CRITICOS = ["numpy", "scipy", "libopenblas", "micropip", "wcwidth"];
// Assets de runtime CRITICOS sin los cuales el motor del navegador no arranca.
const RUNTIME_CRITICOS = ["pyodide.asm.wasm", "pyodide-lock.json"];

// Aborta el script en rojo (exit 1) con un mensaje claro. Se usa para los fallos
// DUROS: runtime presente pero version equivocada, o assets/wheels ausentes tras
// copiar. En un runtime pineado y offline, dejar esto en verde dejaria `npm
// install` "OK" con el motor roto o cayendo al CDN (FIX A3 eng-review F6).
function abortar(mensaje) {
  console.error(`[copy-pyodide] ERROR: ${mensaje}`);
  process.exit(1);
}

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(srcDir))) {
    // En CI o instalaciones parciales puede no estar todavia; no rompemos el
    // install. El worker fallara con un mensaje claro si faltan los assets.
    console.warn(
      "[copy-pyodide] node_modules/pyodide no existe todavia; se omite la copia.",
    );
    return;
  }

  // GUARDA DE VERSION (FIX A3): el indexURL local debe servir EXACTAMENTE la
  // version pineada (acoplamiento ABI con PyNiteFEA 2.0.2 / numpy 2.2.5). Un
  // runtime PRESENTE pero distinto al pin debe CORTAR el install en rojo: copiar
  // un runtime equivocado deja `npm install` "verde" con el motor del navegador
  // roto (o cayendo al CDN). El caso "node_modules/pyodide no existe" ya se trato
  // arriba (warning+return); aqui el paquete EXISTE, asi que el package.json debe
  // ser legible y la version debe coincidir.
  let versionInstalada;
  try {
    const pkg = JSON.parse(
      await readFile(join(srcDir, "package.json"), "utf8"),
    );
    versionInstalada = pkg.version;
  } catch (e) {
    abortar(
      `node_modules/pyodide existe pero su package.json no es legible ` +
        `(${e?.message ?? e}); no puedo verificar la version pineada.`,
    );
  }
  if (versionInstalada !== PYODIDE_PINEADA) {
    abortar(
      `pyodide instalado es ${versionInstalada}, pero el par compatible ` +
        `pineado es ${PYODIDE_PINEADA} (fuente: src/solver/config.ts ` +
        `VERSIONES.pyodide). Instala la version exacta (package.json pinea ` +
        `"pyodide": "${PYODIDE_PINEADA}") antes de autohospedar el runtime.`,
    );
  }

  // Limpia copia previa para no dejar wheels huerfanos de una version anterior.
  if (await exists(destDir)) {
    await rm(destDir, { recursive: true, force: true });
  }

  await cp(srcDir, destDir, {
    recursive: true,
    filter: (src) => {
      // Excluir artefactos que solo sirven en Node / tooling y nunca se
      // descargan en el navegador (reduce el peso de public/). NUNCA filtrar
      // .whl: numpy/scipy/micropip/wcwidth/... deben aterrizar para el arranque
      // offline (regla de oro #9).
      //
      // CAUSA RAIZ del bug (public/pyodide quedaba SIN wheels): el paquete
      // `pyodide` vive DENTRO de node_modules, asi que su ruta absoluta SIEMPRE
      // contiene "node_modules". Filtrar por la cadena "node_modules" en la ruta
      // ABSOLUTA excluye el propio srcDir (la primera llamada del filtro) y
      // entonces cp NO copia nada. El filtro debe mirar SOLO la ruta RELATIVA a
      // srcDir, para detectar unicamente un node_modules ANIDADO dentro del
      // paquete (que no existe hoy, pero blindamos por si una version lo trae).
      const lower = src.toLowerCase();
      if (lower.endsWith(".d.ts")) return false;
      if (lower.endsWith(".ts")) return false; // fuentes ts del paquete npm
      if (lower.endsWith(".map")) return false;
      const rel = relative(srcDir, src).toLowerCase(); // "" para el propio srcDir
      const partes = rel.split(sep);
      if (partes.includes("node_modules")) return false; // node_modules ANIDADO
      return true;
    },
  });

  // Copiar los wheels vendorizados a public/pyodide/. vendor/wheels/ es la FUENTE
  // versionada de TODO wheel que Pyodide npm no publica: los de micropip (PyNiteFEA,
  // PrettyTable) y los de paquete que loadPackage resuelve (numpy, scipy, libopenblas,
  // micropip, wcwidth). Sin ellos el navegador daria 404 (o caeria a PyPI). FIX A3:
  // si la carpeta no existe en un runtime PRESENTE, es un fallo DURO (no warning).
  // Copiamos TODO fichero (no solo .whl): libopenblas es .zip y numpy/scipy tambien
  // son wheels que deben aterrizar tal cual junto al pyodide-lock.json.
  let vendorCopiados = 0;
  if (await exists(vendorWheelsDir)) {
    const entradas = await readdir(vendorWheelsDir, { withFileTypes: true });
    for (const ent of entradas) {
      if (!ent.isFile()) continue;
      await cp(join(vendorWheelsDir, ent.name), join(destDir, ent.name));
      vendorCopiados += 1;
    }
  } else {
    abortar(
      `${vendorWheelsDir} no existe; faltan los wheels vendorizados (PyNiteFEA/` +
        `PrettyTable + numpy/scipy/micropip/…). El arranque offline es imposible.`,
    );
  }

  // VERIFICACION POST-COPIA (FIX A3): tras copiar, public/pyodide/ DEBE contener
  // los wheels vendorizados esperados y los assets de runtime criticos. Si falta
  // alguno, cortamos en rojo: un `npm install` "verde" con el motor incompleto es
  // peor que un fallo visible (se descubriria solo al abrir el navegador).
  const presentes = await readdir(destDir);
  const presentesLower = presentes.map((n) => n.toLowerCase());

  // 1) Wheels vendorizados: comprobamos por PREFIJO (insensible a la version del
  //    pin, p. ej. "pynitefea-2.0.2-py3-none-any.whl").
  const wheelsFaltan = WHEELS_VENDOR_ESPERADOS.filter(
    (prefijo) =>
      !presentesLower.some((n) => n.startsWith(prefijo) && n.endsWith(".whl")),
  );
  if (wheelsFaltan.length > 0) {
    abortar(
      `tras copiar faltan en ${destDir} estos wheels vendorizados esperados: ` +
        `${wheelsFaltan.join(", ")} (revisa vendor/wheels/ y WHEELS_VENDOR de ` +
        `src/solver/config.ts).`,
    );
  }

  // 1bis) Wheels de PAQUETE (numpy/scipy/libopenblas/micropip/wcwidth): loadPackage
  //    los necesita servidos bajo /pyodide/. Comprobamos por PREFIJO SIN exigir .whl
  //    (libopenblas es .zip). ESTA guarda es la que faltaba: sin ella, un `npm ci`
  //    limpio (node_modules/pyodide core-only) dejaba public/pyodide sin numpy/scipy
  //    y el deploy pasaba en verde -> 404 en GitHub Pages, motor sin arrancar.
  const paquetesFaltan = PAQUETES_CRITICOS.filter(
    (prefijo) => !presentesLower.some((n) => n.startsWith(prefijo)),
  );
  if (paquetesFaltan.length > 0) {
    abortar(
      `tras copiar faltan en ${destDir} estos wheels de paquete criticos: ` +
        `${paquetesFaltan.join(", ")}. Deben estar VENDORIZADOS en vendor/wheels/ ` +
        `(pyodide npm 0.28.3 no los publica; ver PAQUETES_CRITICOS).`,
    );
  }

  // 2) Assets de runtime criticos (pyodide.asm.wasm, pyodide-lock.json): sin
  //    ellos loadPyodide ni siquiera arranca.
  const runtimeFaltan = RUNTIME_CRITICOS.filter(
    (asset) => !presentesLower.includes(asset.toLowerCase()),
  );
  if (runtimeFaltan.length > 0) {
    abortar(
      `tras copiar faltan en ${destDir} estos assets de runtime criticos: ` +
        `${runtimeFaltan.join(", ")} (¿copia incompleta o filtro demasiado agresivo?).`,
    );
  }

  console.log(
    `[copy-pyodide] Runtime copiado a ${destDir} (indexURL: /pyodide/) + ` +
      `${vendorCopiados} wheel(s) vendorizado(s). Verificacion OK ` +
      `(vendor: ${WHEELS_VENDOR_ESPERADOS.join("+")}; paquete: ${PAQUETES_CRITICOS.join("+")}; ` +
      `runtime: ${RUNTIME_CRITICOS.join("+")}).`,
  );
}

main().catch((err) => {
  console.error("[copy-pyodide] Error copiando el runtime de Pyodide:", err);
  process.exit(1);
});
