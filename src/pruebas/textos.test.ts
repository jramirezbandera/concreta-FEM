/**
 * Los textos de la app no nombran software comercial (decisión del usuario; `auditoria-ui.md`, UI-42).
 * En los comentarios y en la documentación sí: aquí se quitan los comentarios y se busca en lo que
 * queda (el código, sus literales y el texto de JSX), en `app/src` y en `src`, sin las pruebas.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "..", "..");
const COMERCIAL = /SAP\s?2000|CYPECAD|\bCYPE\b|ETABS|\bCSI\b/;

function ficheros(dir: string): string[] {
  const r: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "node_modules" && n !== "pkg" && n !== "test" && n !== "pruebas") r.push(...ficheros(p));
    } else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) r.push(p);
  }
  return r;
}

/** El fuente sin comentarios (los de línea, los de bloque y los de JSX); los literales se quedan. */
function sinComentarios(s: string): string {
  let r = "";
  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
    } else if (c === "/" && s[i + 1] === "*") {
      const f = s.indexOf("*/", i + 2);
      i = f < 0 ? s.length : f + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
      r += s.slice(i, j + 1);
      i = j + 1;
    } else {
      r += c;
      i++;
    }
  }
  return r;
}

describe("los textos de la app no nombran software comercial", () => {
  it("quita los comentarios y deja los literales", () => {
    expect(sinComentarios(`a = "x // y"; // SAP2000\n/* ETABS */ b = 'CSI'`)).toBe(`a = "x // y"; \n b = 'CSI'`);
  });

  it("ni en app/src ni en src, fuera de los comentarios", () => {
    const malos: string[] = [];
    for (const f of [...ficheros(join(RAIZ, "app", "src")), ...ficheros(join(RAIZ, "src"))]) {
      for (const l of sinComentarios(readFileSync(f, "utf8")).split("\n")) if (COMERCIAL.test(l)) malos.push(`${relative(RAIZ, f)}: ${l.trim().slice(0, 120)}`);
    }
    expect(malos).toEqual([]);
  });
});
