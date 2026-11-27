/**
 * Las escalas de la interfaz (`auditoria-ui-2.md`, UI2-16): cinco tamaños de letra y cinco radios.
 * UI-49 fijó los tamaños y, sin una prueba, volvieron a ser doce. Aquí se leen las hojas de estilo
 * y las clases de tamaño de los `.tsx` de `app/src`, y cualquier otro valor falla.
 *
 * Lo que se dibuja en un SVG (el despiece, el alzado de «Situación», los croquis) no entra: sus
 * tamaños van con la escala de cada dibujo.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(import.meta.dirname, "..", "..", "app", "src");
/** px: pie y notas, texto secundario, base (I-h), títulos de panel y títulos de diálogo. */
export const LETRA = [11, 12, 13, 15, 18];
/** px: marcas, insignias y teclas, controles, lo que flota, diálogos; y la píldora. */
export const RADIO = [0, 2, 4, 6, 8, 12, 999];
const DIBUJO = /\btext\b|\.sit-|\.despiece|svg|\.dp-|espectro|croquis/;

function ficheros(dir: string, ext: RegExp): string[] {
  const r: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "test") r.push(...ficheros(p, ext));
    } else if (ext.test(n) && !/\.test\./.test(n)) r.push(p);
  }
  return r;
}

const donde = (p: string, i: number) => `${relative(APP, p).replace(/\\/g, "/")}:${i + 1}`;

describe("escalas de la interfaz", () => {
  const hojas = ficheros(APP, /\.css$/);

  it("las hojas de estilo sólo usan los cinco tamaños de letra", () => {
    const fuera: string[] = [];
    for (const p of hojas) {
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((linea, i) => {
          if (DIBUJO.test(linea.split("{")[0]!)) return;
          for (const m of linea.matchAll(/font-size:\s*([\d.]+)px|font:\s*(?:normal |italic )?(?:\d00 )?([\d.]+)px/g)) {
            const v = Number(m[1] ?? m[2]);
            if (!LETRA.includes(v)) fuera.push(`${donde(p, i)} → ${v}px`);
          }
        });
    }
    expect(fuera).toEqual([]);
  });

  it("los .tsx sólo usan los cinco tamaños de letra", () => {
    const fuera: string[] = [];
    for (const p of ficheros(APP, /\.tsx$/)) {
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((linea, i) => {
          for (const m of linea.matchAll(/text-\[([\d.]+)px\]|fontSize:\s*([\d.]+)/g)) {
            const v = Number(m[1] ?? m[2]);
            if (!LETRA.includes(v)) fuera.push(`${donde(p, i)} → ${v}px`);
          }
        });
    }
    expect(fuera).toEqual([]);
  });

  it("los radios son los de la escala", () => {
    const fuera: string[] = [];
    for (const p of hojas) {
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((linea, i) => {
          for (const m of linea.matchAll(/border(?:-[a-z]+){0,2}-radius:\s*([^;]+)/g)) {
            for (const n of m[1]!.matchAll(/(?<![\d.])([\d.]+)px/g)) {
              if (!RADIO.includes(Number(n[1]))) fuera.push(`${donde(p, i)} → ${n[1]}px`);
            }
          }
        });
    }
    expect(fuera).toEqual([]);
  });
});
