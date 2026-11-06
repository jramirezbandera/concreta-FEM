/**
 * Firmas del modelo analítico (`firmaModelo`, `src/agente/resultados.ts`) de un juego fijo de modelos,
 * para comprobar que Bun (JavaScriptCore) y Node (V8) firman igual el mismo proyecto: la CLI guarda
 * resultados con Bun y el visor los usa en Chrome. Incluye plantas giradas y pilares girados, cuyos
 * senos y cosenos difieren en 1 ulp entre los dos motores (COM-12), y un reticular.
 *
 * Los modelos físicos se generan una vez (en Node) y Bun compila esos mismos, leídos por la entrada
 * estándar: los generadores de `src/pruebas/` calculan los vértices con senos y cosenos, así que en
 * cada motor darían otra entrada (FR-2, `docs/fem3d/firma-resultados.md`). Con la misma entrada, los
 * nudos y las cargas salen idénticos byte a byte; las secciones y algún `vz`, a 1–2 ulp.
 * `src/agente/firma.test.ts` ejecuta este script con Bun y compara su salida con lo de Node.
 *
 *   bun validacion/firma/firmas.ts < fisicos.json      → JSON por la salida estándar
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { firmaModelo, type FirmaModelo } from "../../src/agente/resultados.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../../src/pruebas/forjadosAleatorios.ts";
import { edificioGeometria } from "../../src/pruebas/geometrias.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { reticulaConNucleo } from "../c3/modelos.ts";

export interface FirmaDe {
  nombre: string;
  firma: FirmaModelo;
  /** sha256 del texto de los nudos y de los casos de carga del modelo analítico. */
  nudos: string;
  cargas: string;
}

export function fisicos(): { nombre: string; f: ModeloFisico }[] {
  return [
    { nombre: "retícula con núcleo", f: reticulaConNucleo() },
    { nombre: "rombo girado 23°", f: edificioGeometria("rombo", { giro: 23 }) },
    { nombre: "circular con pilares circulares", f: edificioGeometria("circular", { circulares: true }) },
    { nombre: "al azar 4 con losas", f: conLosasAleatorias(fisicoAleatorio(4), 4) },
    { nombre: "al azar 6, reticular", f: conForjadosAleatorios(fisicoAleatorio(6), 6, { tipo: "reticular" }) },
  ];
}

const sha = (x: unknown): string => createHash("sha256").update(JSON.stringify(x)).digest("hex");

export function firmas(modelos: { nombre: string; f: ModeloFisico }[]): FirmaDe[] {
  return modelos.map(({ nombre, f }) => {
    const c = compilar(f);
    if (!c.valido) throw new Error(`${nombre} no compila`);
    return { nombre, firma: firmaModelo(c.modelo), nudos: sha(c.modelo.nudos), cargas: sha(c.modelo.casos) };
  });
}

if (import.meta.main) process.stdout.write(JSON.stringify(firmas(JSON.parse(readFileSync(0, "utf8")))));
