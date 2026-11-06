/**
 * VS3, criterio 6 (`docs/fem3d/viento-sismo.md` §5): ninguna consulta mezcla un caso de un modo con
 * los factores de una combinación sin pasar por el caso compuesto.
 *
 * Con el sismo del programa, los factores de una combinación son los de los casos lógicos y los
 * valores «por caso», los de los casos base (los modos detrás): aplicar un factor a un valor por su
 * índice (`f[k] * valor[k]`) suma un modo como si fuera un caso estático, o deja fuera el sismo, y da
 * un número creíble. Aquí se busca en el código quién lo hace a mano. Lo que combina es
 * `Superposicion` (`src/motor/espectral.ts`), por `Consultas.combinar`, `Consultas.sup` y
 * `Consultas.diagramaBarra`; lo demás recibe de ella la parte lineal (`partes.lineal`, que por
 * convenio se llama `fl`) y lo de los casos del sismo (`deEspectrales`).
 *
 * La otra mitad del criterio es dinámica: `Superposicion` y `combinar` lanzan si el vector no tiene
 * un caso por factor, y las pruebas con un edificio con sismo (`agente/sismoEspectral.test.ts`: 8
 * casos lógicos y 13 base) pasan por todas las consultas y comparan cada una con la regla a mano.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "..", "..");

function ficheros(dir: string): string[] {
  const r: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "node_modules" && n !== "pkg" && n !== "test" && n !== "pruebas" && n !== "dist") r.push(...ficheros(p));
    } else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) r.push(p);
  }
  return r;
}

/** El fuente sin comentarios de línea ni de bloque (basta para buscar código: los literales no llevan estos patrones). */
const sinComentarios = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const FUENTES = [...ficheros(join(RAIZ, "src")), ...ficheros(join(RAIZ, "cli")), ...ficheros(join(RAIZ, "app", "src"))].map((p) => ({ ruta: relative(RAIZ, p).split(sep).join("/"), texto: sinComentarios(readFileSync(p, "utf8")) }));

interface Regla {
  que: string;
  patron: RegExp;
  /** Ficheros en los que es lo que tiene que haber. */
  admitidos: readonly string[];
}

const REGLAS: readonly Regla[] = [
  {
    que: "un factor de una combinación aplicado a mano por su índice de caso (f[k] * …)",
    // un vector de factores (f, fa, fs, factores) indexado por un contador de casos y multiplicado
    patron: /\b(?:f|fa|fs|factores)\[(?:k|j|kc|c|caso)\]!?\s*\*|\*\s*(?:f|fa|fs|factores)\[(?:k|j|kc|c|caso)\]/,
    admitidos: [
      // la superposición: quien aplica los factores
      "src/motor/espectral.ts",
      // la combinación lineal de siempre (exige un caso por factor) y la de los diagramas de casos base
      "src/compilador/envolventes.ts",
      "src/elementos/cargasBarra.ts",
    ],
  },
  {
    que: "la combinación lineal de `envolventes.ts` importada en lugar de `Consultas.combinar`",
    patron: /import\s*\{[^}]*\b(?:combinar|envolvente|factoresCaso)\b[^}]*\}\s*from\s*"[./\w-]*envolventes\.ts"/,
    admitidos: [
      // la toman por defecto (sin `Consultas`, en los modelos de validación sin sismo) y reciben la de `Consultas`
      "src/compilador/esfuerzosBandas.ts",
      "src/compilador/esfuerzosFranjas.ts",
      "src/compilador/index.ts",
    ],
  },
  {
    que: "diagramas de casos combinados a mano en lugar de `Consultas.diagramaBarra`",
    patron: /DiagramaBarra\.combinar\(/,
    admitidos: [
      "src/compilador/consultas.ts",
      "src/elementos/cargasBarra.ts",
      // la barra de empotramiento parcial: mezcla de dos diagramas del mismo caso, no una combinación
      "src/motor/barras.ts",
    ],
  },
  {
    que: "los resultados de los casos de `Consultas` indexados con los factores de una combinación",
    // q.casos[k] junto a un factor: los casos de las consultas son los base
    patron: /(?:f|fa|factores)\[(\w+)\]!?\s*\*\s*[\w.!]*casos\[\1\]/,
    admitidos: ["src/motor/espectral.ts"],
  },
];

describe("VS3, criterio 6: nadie aplica a mano los factores de una combinación", () => {
  it.each(REGLAS.map((r) => [r.que, r] as const))("no hay %s", (_q, regla) => {
    const hallados: string[] = [];
    for (const f of FUENTES) {
      if (regla.admitidos.includes(f.ruta)) continue;
      f.texto.split("\n").forEach((linea, i) => {
        if (regla.patron.test(linea)) hallados.push(`${f.ruta}:${i + 1}: ${linea.trim().slice(0, 140)}`);
      });
    }
    expect(hallados, `Con los casos del sismo del programa hay que combinar con Consultas.combinar, Consultas.sup o Consultas.diagramaBarra:\n${hallados.join("\n")}`).toEqual([]);
  });

  it("los ficheros admitidos existen y llevan lo suyo (si no, la regla no mira nada)", () => {
    for (const regla of REGLAS)
      for (const ruta of regla.admitidos) {
        const f = FUENTES.find((x) => x.ruta === ruta);
        expect(f, ruta).toBeDefined();
      }
    // y los patrones encuentran lo que buscan
    expect(REGLAS[0]!.patron.test("for (let k = 0; k < nc; k++) if (f[k]) v += f[k]! * e[6 * k]!;")).toBe(true);
    expect(REGLAS[0]!.patron.test("s += valores[k] * factores[k];")).toBe(true);
    expect(REGLAS[0]!.patron.test("for (let k = 0; k < fl.length; k++) if (fl[k]) s += fl[k]! * x[k]!;")).toBe(false);
    expect(REGLAS[1]!.patron.test('import { combinar } from "../compilador/envolventes.ts";')).toBe(true);
    expect(REGLAS[2]!.patron.test("return DiagramaBarra.combinar(ks.map((k) => ep.diagrama(b, k)), ks.map((k) => f[k]!));")).toBe(true);
    expect(REGLAS[3]!.patron.test("v += f[j]! * this.casos[j]!.u[6 * n + c]!;")).toBe(true);
    expect(FUENTES.length).toBeGreaterThan(200);
    expect(FUENTES.some((x) => x.ruta.startsWith("app/src/"))).toBe(true);
  });
});
