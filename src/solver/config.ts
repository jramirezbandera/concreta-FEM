// =============================================================================
// Configuracion del motor FEM (Pyodide + PyNiteFEA) — fuente unica de verdad
// del par de versiones y del plan de instalacion. AISLADO en /src/solver: nadie
// fuera de esta carpeta debe importar este modulo (CLAUDE.md §8, §17).
//
// Cierra el placeholder del CLAUDE.md §18 ("Version Pyodide <-> PyNiteFEA
// compatible, a fijar empiricamente al montar el worker").
// =============================================================================

// -----------------------------------------------------------------------------
// PAR DE VERSIONES COMPATIBLE (pinear EXACTAS, nunca "latest") — hallazgos #1/#2
// -----------------------------------------------------------------------------
//
// Par CONFIRMADO empiricamente por el smoke test (src/solver/smoke.test.ts), que
// arranca Pyodide+PyNite reales y resuelve una biapoyada UDL con error 0.00%:
//   Pyodide      0.28.3   (runtime CPython+WASM autohospedado en /pyodide/)
//   PyNiteFEA    2.0.2    (Python puro, via micropip con deps:false)
//   numpy        2.2.5    (build WASM que trae Pyodide 0.28.x)  <- CONFIRMADO
//   scipy        1.14.1   (build WASM que trae Pyodide 0.28.x)  <- CONFIRMADO
//   Python       3.13.2   (interprete de Pyodide 0.28.x)        <- CONFIRMADO
//
// POR QUE ESTE PAR:
//  - PyNiteFEA 2.0.2 es la ultima version SIN el pin `numpy>=2.4.0`. Ese pin
//    aparece en PyNite >=2.1.0 (incl. 3.0.0) y SOLO lo satisface Pyodide 314
//    (numpy 2.4). Instalar "la ultima" PyNite sobre Pyodide <314 hace FALLAR la
//    resolucion de dependencias de micropip (hallazgo #2, guia §12.2).
//  - Por eso instalamos con deps:false (ver INSTALL abajo) y nos quedamos en el
//    par estable 0.28.3 + 2.0.2. Migrar a Pyodide 314 + PyNite 3.0.0 solo
//    cuando estabilice el ABI (revisar en 2026, hallazgo #2).
//
// VERIFICADO (cierra la decision abierta CLAUDE.md §18): el smoke test imprime el
// par real del runtime y comprueba que PyNiteFEA 2.0.2 resuelve correctamente
// sobre numpy 2.2.5 pese al pin conservador `numpy>=2.4`. feature-6 (golden)
// debe re-asertar estas versiones al arrancar por si Pyodide se actualiza.
export const VERSIONES = {
  pyodide: "0.28.3",
  pyniteFEA: "2.0.2",
  // Confirmados contra el runtime real (smoke test):
  numpy: "2.2.5",
  scipy: "1.14.1",
  python: "3.13.2",
} as const;

// -----------------------------------------------------------------------------
// RUNTIME AUTOHOSPEDADO (NO CDN — decision cerrada del proyecto)
// -----------------------------------------------------------------------------
//
// Los assets de Pyodide (pyodide.js/.mjs, .wasm, pyodide-lock.json y los wheels
// de numpy/scipy/micropip) se copian de node_modules/pyodide a public/pyodide/
// por scripts/copy-pyodide-assets.mjs (postinstall + buildStart de Vite). Vite
// sirve public/ en la raiz, asi que el indexURL en runtime es "/pyodide/".
//
// Pyodide resuelve los wheels de loadPackage()/micropip con rutas RELATIVAS a
// este indexURL, por eso debe terminar en "/".
export const INDEX_URL = "/pyodide/";

// -----------------------------------------------------------------------------
// PLAN DE INSTALACION (hallazgo #10 — sin matplotlib/vtk/pyvista/pdfkit)
// -----------------------------------------------------------------------------
//
// Secuencia exacta que ejecutara worker.ts (TODO desde rutas LOCALES, sin red):
//   1) loadPackage(["numpy", "scipy"])  -> builds WASM nativas de Pyodide (local).
//   2) micropip.install(<URL local prettytable.whl>)  -> dep pura-Python de
//        PyNite; con deps para resolver wcwidth (que tambien es wheel local).
//   3) micropip.install(<URL local pynitefea.whl>, { deps:false })
//        deps:false evita que micropip intente resolver/instalar numpy/scipy
//        (ya cargados) y matplotlib. PyNite declara matplotlib en
//        install_requires (NO es extra), por eso hay que excluirlo a mano.
//        VERIFICADO por el smoke test: `from Pynite import FEModel3D` importa
//        limpio sin matplotlib. El bloqueante real NO era matplotlib sino que
//        `Pynite/__init__.py` 2.0.2 hace `from pip._vendor import pkg_resources`
//        a nivel de modulo y Pyodide no trae `pip`: pynite_glue.py inyecta un
//        stub de pip._vendor.pkg_resources antes del import. NUNCA PyNiteFEA[all].
//
// OFFLINE: ambos wheels (PyNiteFEA, PrettyTable) estan VENDORIZADOS en
// vendor/wheels/ y se sirven bajo /pyodide/ (ver WHEELS_VENDOR). Se acabo la
// descarga de PyPI en runtime (cierra el riesgo "matplotlib/red", regla de oro #9).
//
// micropip necesita cargarse como paquete; en 0.28.x viene incluido y se obtiene
// con pyodide.pyimport("micropip") tras loadPyodide().

/** Paquetes WASM nativos que trae Pyodide (via loadPackage). */
export const PAQUETES_WASM = ["numpy", "scipy"] as const;

// -----------------------------------------------------------------------------
// WHEELS VENDORIZADOS (OFFLINE — regla de oro #9, privacidad/offline)
// -----------------------------------------------------------------------------
//
// PyNiteFEA y PrettyTable NO vienen en Pyodide (no son wheels de su catalogo
// WASM). Antes se instalaban con `micropip.install("PyNiteFEA==2.0.2")`, que los
// descargaba de PyPI en RUNTIME -> unica dependencia de red del arranque y riesgo
// de que micropip cayera al CDN (matplotlib/red). Ahora los VENDORIZAMOS en el
// repo (vendor/wheels/, ambos py3-none-any puros) y los instalamos desde una URL
// LOCAL servida bajo /pyodide/ (copy-pyodide-assets.mjs los aterriza alli junto a
// los 15 wheels WASM de node_modules/pyodide). Resultado: arranque 100% offline y
// reproducible, sin red en tests ni en produccion.
//
// wcwidth (unica dep runtime de PrettyTable) YA viene como wheel WASM de Pyodide
// (esta en node_modules/pyodide y se copia a /pyodide/), asi que micropip lo
// resuelve localmente; no hay que vendorizarlo.
//
// IMPORTANTE: los nombres de fichero deben coincidir EXACTAMENTE con los wheels
// de vendor/wheels/ (pip los normaliza a minusculas).

/** Nombre de fichero del wheel vendorizado de PyNiteFEA (vendor/wheels/). */
export const WHEEL_PYNITE = `pynitefea-${VERSIONES.pyniteFEA}-py3-none-any.whl` as const;

/** Version de PrettyTable vendorizada (pura-Python; dep de PyNite via wcwidth). */
export const VERSION_PRETTYTABLE = "3.17.0" as const;

/** Nombre de fichero del wheel vendorizado de PrettyTable (vendor/wheels/). */
export const WHEEL_PRETTYTABLE = `prettytable-${VERSION_PRETTYTABLE}-py3-none-any.whl` as const;

/**
 * Lista canonica de wheels NO-Pyodide que hay que instalar via micropip desde
 * ruta local. Orden = orden de instalacion: PrettyTable primero (con deps, para
 * que micropip resuelva wcwidth localmente), luego PyNiteFEA con deps:false.
 *
 * Fuente UNICA reusada por worker.ts (navegador, URL /pyodide/<wheel>) y por el
 * smoke/golden en Node (file:// a vendor/wheels/<wheel>).
 */
export const WHEELS_VENDOR = [
  { fichero: WHEEL_PRETTYTABLE, deps: true },
  { fichero: WHEEL_PYNITE, deps: false },
] as const;

/**
 * Dependencia pura-Python de PyNite (via micropip, con deps).
 * @deprecated Se instala desde wheel local (WHEEL_PRETTYTABLE); ya no de PyPI.
 */
export const PAQUETE_PRETTYTABLE = "PrettyTable" as const;

/**
 * Spec exacta de PyNite para micropip (deps:false; ver INSTALL_PYNITE_DEPS).
 * @deprecated Se instala desde wheel local (WHEEL_PYNITE); ya no de PyPI.
 */
export const PAQUETE_PYNITE = `PyNiteFEA==${VERSIONES.pyniteFEA}` as const;

/**
 * micropip.install(PyNiteFEA, { deps:false }) — obligatorio: evita el conflicto
 * `numpy>=2.4` y la instalacion de matplotlib. Si algun dia se cambia, revisar
 * los hallazgos #2/#10 antes.
 */
export const INSTALL_PYNITE_DEPS = false as const;

// Nombre del modulo Python de PyNite tras instalar (en 2.x el import es `Pynite`,
// con P mayuscula y resto minuscula). Centralizado para el glue.
export const MODULO_PYNITE = "Pynite" as const;
