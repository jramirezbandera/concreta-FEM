// Compila el núcleo Rust (kernel/) a WASM y lo deja versionado en src/nucleo/pkg/ con su sha256.
//
//   bun scripts/compilar-nucleo.mjs              compila y actualiza src/nucleo/pkg/ y MANIFIESTO.json
//   bun scripts/compilar-nucleo.mjs --verificar  compila en una carpeta temporal y comprueba que el
//                                                 resultado es idéntico byte a byte al versionado (CI)
//
// Cadena: cargo (wasm32-unknown-unknown, SIMD128) → wasm-bindgen (--target web) → wasm-opt -O3.
// Las versiones están fijadas: rustc en kernel/rust-toolchain.toml, faer y wasm-bindgen en
// kernel/Cargo.toml (con Cargo.lock), y wasm-bindgen-cli y wasm-opt aquí abajo.
//
// Reproducibilidad: los mensajes de pánico llevan rutas de origen; se reescriben con
// --remap-path-prefix para que no dependan del usuario ni de la carpeta del repo. Las barras
// siguen siendo las del sistema operativo, así que la verificación se hace en Windows.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const WASM_BINDGEN = "0.2.129";
const WASM_OPT = "133";
const VERSION_API = 1;

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kernel = join(raiz, "kernel");
const destino = join(raiz, "src", "nucleo", "pkg");
const verificar = process.argv.includes("--verificar");

const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
const binaryen = process.env.BINARYEN_BIN ?? join(homedir(), ".local", `binaryen-version_${WASM_OPT}`, "bin");
const env = {
  ...process.env,
  PATH: [join(cargoHome, "bin"), binaryen, process.env.PATH].join(delimiter),
  // Sustituye a target.wasm32-unknown-unknown.rustflags de kernel/.cargo/config.toml.
  CARGO_ENCODED_RUSTFLAGS: [
    "-Ctarget-feature=+simd128",
    `--remap-path-prefix=${join(cargoHome, "registry", "src")}=/cargo`,
    `--remap-path-prefix=${kernel}=/kernel`,
  ].join("\x1f"),
};

function ejecutar(cmd, args, cwd = raiz) {
  return execFileSync(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
}

function version(cmd, args, patron) {
  const salida = ejecutar(cmd, args);
  const m = salida.match(patron);
  if (!m) throw new Error(`no se reconoce la versión de ${cmd}: ${salida}`);
  return m[1];
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// 1. Herramientas
const rustc = version("rustc", ["--version"], /rustc (\S+)/);
const bindgen = version("wasm-bindgen", ["--version"], /wasm-bindgen (\S+)/);
const opt = version("wasm-opt", ["--version"], /version (\d+)/);
if (bindgen !== WASM_BINDGEN) throw new Error(`wasm-bindgen-cli ${bindgen}; hace falta ${WASM_BINDGEN}`);
if (opt !== WASM_OPT) throw new Error(`wasm-opt ${opt}; hace falta ${WASM_OPT}`);

// 2. Compilación (al verificar, desde cero en un target temporal: prueba que es determinista)
const t0 = performance.now();
const tmp = mkdtempSync(join(tmpdir(), "nucleo-"));
const target = verificar ? join(tmp, "target") : join(kernel, "target");
try {
  ejecutar("cargo", ["build", "--release", "--locked", "--target", "wasm32-unknown-unknown", "--target-dir", target], kernel);
  const wasmCrudo = join(target, "wasm32-unknown-unknown", "release", "concreta_fem_kernel.wasm");

  ejecutar("wasm-bindgen", ["--target", "web", "--out-dir", tmp, "--out-name", "nucleo", wasmCrudo]);
  const wasm = join(tmp, "nucleo_bg.wasm");
  ejecutar("wasm-opt", [
    "-O3",
    "--enable-bulk-memory", "--enable-nontrapping-float-to-int", "--enable-simd", "--enable-sign-ext",
    "--enable-mutable-globals", "--enable-reference-types", "--enable-multivalue",
    wasm, "-o", wasm,
  ]);

  // 3. Ficheros finales (LF, como los deja git con .gitattributes) y comprobaciones
  const ficheros = ["nucleo.js", "nucleo.d.ts", "nucleo_bg.wasm", "nucleo_bg.wasm.d.ts"];
  const contenido = Object.fromEntries(
    ficheros.map((f) => {
      const b = readFileSync(join(tmp, f));
      return [f, f.endsWith(".wasm") ? b : Buffer.from(b.toString("utf8").replace(/\r\n/g, "\n"))];
    }),
  );
  const binario = contenido["nucleo_bg.wasm"].toString("latin1");
  for (const fuga of [homedir(), raiz, cargoHome, `${sep}registry${sep}src${sep}index.crates.io`]) {
    if (binario.includes(fuga) && fuga !== `${sep}registry${sep}src${sep}index.crates.io`) {
      throw new Error(`el .wasm contiene una ruta de esta máquina: ${fuga}`);
    }
  }

  const manifiesto = {
    versionApi: VERSION_API,
    herramientas: { rustc, wasmBindgen: bindgen, wasmOpt: opt },
    simd128: true,
    bytes: contenido["nucleo_bg.wasm"].length,
    bytesGzip: gzipSync(contenido["nucleo_bg.wasm"], { level: 9 }).length,
    sha256: Object.fromEntries(ficheros.map((f) => [f, sha256(contenido[f])])),
  };

  if (verificar) {
    const ruta = join(destino, "MANIFIESTO.json");
    if (!existsSync(ruta)) throw new Error("no hay src/nucleo/pkg/MANIFIESTO.json");
    const versionado = JSON.parse(readFileSync(ruta, "utf8"));
    const distintos = ficheros.filter((f) => versionado.sha256[f] !== manifiesto.sha256[f]);
    if (distintos.length) {
      console.error(`El núcleo compilado no coincide con el versionado: ${distintos.join(", ")}`);
      console.error(JSON.stringify({ versionado: versionado.sha256, compilado: manifiesto.sha256 }, null, 2));
      process.exit(1);
    }
    console.log(`Núcleo verificado: ${manifiesto.bytes} B (${manifiesto.bytesGzip} B gzip), sha256 ${manifiesto.sha256["nucleo_bg.wasm"]}`);
  } else {
    mkdirSync(destino, { recursive: true });
    for (const f of ficheros) writeFileSync(join(destino, f), contenido[f]);
    writeFileSync(join(destino, "MANIFIESTO.json"), JSON.stringify(manifiesto, null, 2) + "\n");
    console.log(`Núcleo compilado en ${((performance.now() - t0) / 1000).toFixed(1)} s: ${manifiesto.bytes} B (${manifiesto.bytesGzip} B gzip)`);
    console.log(`sha256 nucleo_bg.wasm = ${manifiesto.sha256["nucleo_bg.wasm"]}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
