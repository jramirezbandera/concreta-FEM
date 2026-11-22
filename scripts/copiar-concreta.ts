/**
 * Fase CO (`docs/fem3d/comprobaciones.md` §4.1, CO-a y CO-d): copia de los módulos de comprobación de
 * Concreta a `src/comprobaciones/concreta/`, a un commit fijo y sin tocarlos.
 *
 *   bun scripts/copiar-concreta.ts [--clon <ruta>]   copia desde el clon y escribe el manifiesto
 *   bun scripts/copiar-concreta.ts --verificar       comprueba los sha256 del manifiesto (sin el clon)
 *
 * - Lee cada fichero de los objetos de git del clon en `COMMIT` (`git show`), no de su árbol de
 *   trabajo: da igual en qué rama esté el clon o lo que tenga sin guardar.
 * - Copia las `ENTRADAS` y todo lo que importan con rutas relativas, con la misma estructura de
 *   carpetas que en `src/` de Concreta, para que sus importaciones valgan sin cambiarlas.
 * - El código, tal cual, con un solo cambio mecánico: las importaciones relativas llevan su
 *   extensión (`'./types'` → `'./types.ts'`), porque Node la exige y Concreta, con su empaquetador,
 *   no la escribe. El manifiesto guarda el sha256 del original, y `verificar` comprueba que
 *   quitando esas extensiones sale ese mismo original. Lo que a un módulo le falte va en el adaptador (`../comprobar/`) o, si no se
 *   puede, en `PARCHES`, que se listan en el manifiesto y se piensan para subirlos a Concreta.
 * - Lo que haya en la carpeta y no esté en la copia se borra: no se edita a mano.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DESTINO = "src/comprobaciones/concreta";
const MANIFIESTO = "manifiesto.json";
const LEEME = "LEEME.md";

const REPOSITORIO = "https://github.com/wh0am1-dev/concreta";
/** El commit fijado (CO-d): release 261113.0, 2026-11-13. */
const COMMIT = "6fdc7e782113ddc00c67cb29b7978383ca0269f2";

/** Los módulos y sus pruebas, por tramos de CO. Las rutas, las de Concreta. */
const ENTRADAS: readonly string[] = [
  // CO1, pilares
  "src/lib/calculations/rcColumns.ts",
  "src/test/calc/rcColumns.test.ts",
  "src/test/calc/rcColumnsCircular.test.ts",
  // El cortante (`calcRcShear`) y la flexión compuesta de vigas: los usa ya CO1, y son los de CO2
  "src/lib/calculations/rcBeams.ts",
  "src/lib/calculations/rcBeamMN.ts",
  "src/lib/calculations/rcBeamsDetalle.ts",
  "src/test/calc/rcBeams.test.ts",
  "src/test/calc/rcBeamsSection.test.ts",
  "src/test/calc/rcBeamMN.test.ts",
  "src/test/calc/rcBeamsDetalle.test.ts",
  "src/test/calc/crackedDeflection.test.ts",
  "src/test/calc/cuantiaMinima.test.ts",
  // CO3, forjados (losa maciza por metro y nervio de reticular)
  "src/lib/calculations/rcSlabs.ts",
  "src/test/calc/rcSlabs.test.ts",
  // CO4, punzonamiento
  "src/lib/calculations/punching.ts",
  "src/test/calc/punching.test.ts",
  // CO5, zapatas aisladas
  "src/lib/calculations/isolatedFooting.ts",
  "src/test/calc/isolatedFooting.test.ts",
  "src/test/calc/isolatedFootingMedianera.test.ts",
];

/**
 * Ficheros de Concreta que no se copian: en su sitio va uno propio, con lo que las copias le piden.
 * No se sigue lo que importa el original.
 */
const SUSTITUCIONES: readonly { fichero: string; motivo: string; contenido: string }[] = [
  {
    fichero: "src/lib/frame-core/sections.ts",
    motivo:
      "rcElasticModulusMPa es en Concreta el E de la EHE-08 (8500·∛(fck + 8)), el de su solver; aquí, el Ecm del Código Estructural con el que calcula este motor (CY-a), para que la flecha fisurada parta del mismo E",
    contenido: [
      "// Fichero propio de Concreta FEM, no de Concreta: lo escribe `scripts/copiar-concreta.ts` en el",
      "// sitio de `src/lib/frame-core/sections.ts` (véase `manifiesto.json`, `sustituciones`).",
      "//",
      "// Las copias sólo le piden el módulo elástico del hormigón con el que se calculó la estructura.",
      "// En Concreta es el de la EHE-08; en este motor, el Ecm del Código Estructural (CY-a).",
      'import { hormigon } from "../../../../secciones/seccion3D.ts";',
      "",
      "/** E del hormigón del cálculo, MPa: el de `hormigon(fck)` (kN/m² → MPa). */",
      "export function rcElasticModulusMPa(fck: number): number {",
      "  return hormigon(fck).E / 1e3;",
      "}",
      "",
    ].join("\n"),
  },
];

/** Importaciones que no son de Concreta y que este repositorio ya tiene. */
const EXTERNAS = new Set(["vitest"]);

/** Parches mínimos: sustituir `de` (una sola vez) por `a` en `fichero`. Ninguno todavía. */
const PARCHES: readonly { fichero: string; motivo: string; de: string; a: string }[] = [];

/** Una importación relativa: `from '…'`, `import('…')` o `import '…'`. */
const IMPORTACION = /((?:from\s+|import\s*\(\s*|^\s*import\s+)['"])(\.[^'"]*)(['"])/gm;
/** El texto de una copia sin las extensiones que se le añadieron: el de Concreta. */
export const sinExtensiones = (texto: string) => texto.replace(IMPORTACION, (_, a: string, esp: string, c: string) => `${a}${esp.replace(/\.tsx?$/, "")}${c}`);

export interface Manifiesto {
  repositorio: string;
  /** Lo único que se cambia en todas las copias. */
  transformacion: string;
  commit: string;
  licencia: string;
  /** `sha256`, el de la copia; `sha256Origen`, el del fichero de Concreta. */
  ficheros: { origen: string; destino: string; sha256: string; sha256Origen: string }[];
  parches: { fichero: string; motivo: string }[];
  /** Ficheros de Concreta que no se copian y llevan en su sitio uno propio. */
  sustituciones: { fichero: string; destino: string; motivo: string; sha256: string }[];
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const destinoDe = (origen: string) => posix.join(DESTINO, origen.replace(/^src\//, ""));

function ficherosDe(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? ficherosDe(p, base) : [p.slice(base.length + 1).replaceAll("\\", "/")];
  });
}

/** Lo que no casa con el manifiesto: vacío si la copia está entera y sin tocar. */
export function verificar(raiz = RAIZ): string[] {
  const dir = join(raiz, DESTINO);
  const m = JSON.parse(readFileSync(join(dir, MANIFIESTO), "utf8")) as Manifiesto;
  const fallos: string[] = [];
  const previstos = new Set([MANIFIESTO, LEEME]);
  for (const f of m.ficheros) {
    previstos.add(f.destino.slice(DESTINO.length + 1));
    const p = join(raiz, f.destino);
    if (!existsSync(p)) fallos.push(`falta ${f.destino}`);
    else if (sha256(readFileSync(p)) !== f.sha256) fallos.push(`${f.destino} no tiene el sha256 del manifiesto`);
    // Sin parches, la copia sin las extensiones añadidas es el fichero de Concreta
    else if (!m.parches.some((x) => x.fichero === f.origen) && sha256(new TextEncoder().encode(sinExtensiones(readFileSync(p, "utf8")))) !== f.sha256Origen)
      fallos.push(`${f.destino} no es el original de Concreta con las extensiones añadidas`);
  }
  for (const f of m.sustituciones) {
    previstos.add(f.destino.slice(DESTINO.length + 1));
    const p = join(raiz, f.destino);
    if (!existsSync(p)) fallos.push(`falta ${f.destino}`);
    else if (sha256(readFileSync(p)) !== f.sha256) fallos.push(`${f.destino} no tiene el sha256 del manifiesto`);
  }
  for (const f of ficherosDe(dir)) if (!previstos.has(f)) fallos.push(`${DESTINO}/${f} no está en el manifiesto`);
  return fallos;
}

function copiar(clon: string): void {
  const git = (...a: string[]) => execFileSync("git", ["-C", clon, ...a], { maxBuffer: 1 << 28 });
  const arbol = new Set(git("ls-tree", "-r", "--name-only", COMMIT, "src").toString().split("\n").filter(Boolean));
  const leer = (ruta: string) => new Uint8Array(git("show", `${COMMIT}:${ruta}`));

  const sustituidos = new Set(SUSTITUCIONES.map((x) => x.fichero));
  /** Por fichero, la extensión que le falta a cada importación relativa. */
  const extensiones = new Map<string, Map<string, string>>();
  // El cierre de las importaciones relativas.
  const contenido = new Map<string, Uint8Array>();
  const cola = [...ENTRADAS];
  while (cola.length) {
    const ruta = cola.pop()!;
    if (contenido.has(ruta)) continue;
    if (!arbol.has(ruta)) throw new Error(`${ruta} no está en Concreta en ${COMMIT.slice(0, 7)}`);
    const bytes = leer(ruta);
    contenido.set(ruta, bytes);
    const texto = new TextDecoder().decode(bytes);
    if (new TextEncoder().encode(texto).length !== bytes.length) throw new Error(`${ruta} no es UTF-8 limpio`);
    const extension = new Map<string, string>();
    extensiones.set(ruta, extension);
    for (const m of texto.matchAll(/(?:from\s+|import\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)) {
      const esp = m[1]!;
      if (!esp.startsWith(".")) {
        if (!EXTERNAS.has(esp)) throw new Error(`${ruta} importa «${esp}», que no es una ruta relativa ni está en EXTERNAS`);
        continue;
      }
      const base = posix.normalize(posix.join(posix.dirname(ruta), esp));
      const hallado = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((c) => arbol.has(c));
      if (hallado && !hallado.startsWith(base + ".")) throw new Error(`${ruta} importa «${esp}» sin fichero propio (${hallado}): no se le puede poner la extensión`);
      if (hallado) extension.set(esp, hallado.slice(base.length));
      if (hallado && sustituidos.has(hallado)) continue;
      if (!hallado) throw new Error(`${ruta} importa «${esp}», que no se encuentra`);
      cola.push(hallado);
    }
  }

  const dir = join(RAIZ, DESTINO);
  rmSync(dir, { recursive: true, force: true });
  const manifiesto: Manifiesto = {
    repositorio: REPOSITORIO,
    commit: COMMIT,
    licencia: "PolyForm Noncommercial 1.0.0 — Required Notice: Copyright Javier Ramírez Bandera",
    transformacion: "las importaciones relativas, con la extensión de su fichero (.ts), que Node exige; sha256Origen es el del fichero de Concreta",
    ficheros: [],
    parches: PARCHES.map(({ fichero, motivo }) => ({ fichero, motivo })),
    sustituciones: [],
  };
  for (const origen of [...contenido.keys()].sort()) {
    let bytes = contenido.get(origen)!;
    const sha256Origen = sha256(bytes);
    const parches = PARCHES.filter((p) => p.fichero === origen);
    {
      const ext = extensiones.get(origen)!;
      let texto = new TextDecoder().decode(bytes).replace(IMPORTACION, (_, a: string, esp: string, c: string) => `${a}${esp}${ext.get(esp) ?? ""}${c}`);
      if (!parches.length && sinExtensiones(texto) !== new TextDecoder().decode(bytes)) throw new Error(`${origen}: quitar las extensiones no devuelve el original`);
      for (const p of parches) {
        if (texto.split(p.de).length !== 2) throw new Error(`El parche de ${origen} («${p.motivo}») no casa una sola vez`);
        texto = texto.replace(p.de, () => p.a);
      }
      bytes = new TextEncoder().encode(texto);
    }
    const destino = destinoDe(origen);
    mkdirSync(dirname(join(RAIZ, destino)), { recursive: true });
    writeFileSync(join(RAIZ, destino), bytes);
    manifiesto.ficheros.push({ origen, destino, sha256: sha256(bytes), sha256Origen });
  }
  for (const x of SUSTITUCIONES) {
    const destino = destinoDe(x.fichero);
    const bytes = new TextEncoder().encode(x.contenido);
    mkdirSync(dirname(join(RAIZ, destino)), { recursive: true });
    writeFileSync(join(RAIZ, destino), bytes);
    manifiesto.sustituciones.push({ fichero: x.fichero, destino, motivo: x.motivo, sha256: sha256(bytes) });
  }
  writeFileSync(join(dir, MANIFIESTO), JSON.stringify(manifiesto, null, 2) + "\n");
  writeFileSync(
    join(dir, LEEME),
    [
      "# Copias de Concreta",
      "",
      `Módulos de comprobación de [Concreta](${REPOSITORIO}), copiados del commit \`${COMMIT}\``,
      "por `scripts/copiar-concreta.ts` (fase CO, `docs/fem3d/comprobaciones.md` §4.1).",
      "",
      "- **Un solo cambio, mecánico:** las importaciones relativas llevan la extensión `.ts`, que Node",
      "  exige. El manifiesto guarda el sha256 del original de cada fichero.",
      "- **No se editan a mano.** `manifiesto.json` lleva el origen y el sha256 de cada fichero, y",
      "  `src/comprobaciones/copias.test.ts` los comprueba. Para cambiar algo, se cambia el script.",
      "- **Lo único que no es de Concreta** son los ficheros de `sustituciones` del manifiesto, propios",
      "  de este repositorio y con su motivo.",
      "- **Licencia:** PolyForm Noncommercial 1.0.0 (<https://polyformproject.org/licenses/noncommercial/1.0.0>).",
      "",
      "  Required Notice: Copyright Javier Ramírez Bandera",
      "",
      "  Publicadas aquí con el permiso de Carlos Aguilar (2026-11-21, CO-a); véase `NOTICE`.",
      "",
    ].join("\n"),
  );
  console.log(`${manifiesto.ficheros.length} ficheros de Concreta ${COMMIT.slice(0, 7)} en ${DESTINO}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--verificar")) {
    const fallos = verificar();
    for (const f of fallos) console.error(f);
    if (fallos.length) process.exit(1);
    console.log("Las copias de Concreta casan con su manifiesto.");
  } else {
    const i = args.indexOf("--clon");
    copiar(resolve(RAIZ, i >= 0 ? args[i + 1]! : "../Concreta EST/concreta-v2"));
    const fallos = verificar();
    if (fallos.length) throw new Error(fallos.join("\n"));
  }
}
