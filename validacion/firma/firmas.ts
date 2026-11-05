/**
 * Firmas del modelo analítico (`firmaModelo`, `src/agente/resultados.ts`) de un juego fijo de modelos,
 * para comprobar que Bun (JavaScriptCore) y Node (V8) firman igual el mismo proyecto: la CLI guarda
 * resultados con Bun y el visor los usa en Chrome. Incluye plantas giradas y pilares girados, cuyos
 * senos y cosenos difieren en 1 ulp entre los dos motores (COM-12), y un reticular.
 * `src/agente/firma.test.ts` ejecuta este script con Bun y compara su salida con lo que firma Node.
 *
 *   bun validacion/firma/firmas.ts      → JSON por la salida estándar
 */
import { firmaModelo, type FirmaModelo } from "../../src/agente/resultados.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../../src/pruebas/forjadosAleatorios.ts";
import { edificioGeometria } from "../../src/pruebas/geometrias.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { reticulaConNucleo } from "../c3/modelos.ts";

export function firmas(): { nombre: string; firma: FirmaModelo }[] {
  const modelos = [
    { nombre: "retícula con núcleo", f: reticulaConNucleo() },
    { nombre: "rombo girado 23°", f: edificioGeometria("rombo", { giro: 23 }) },
    { nombre: "circular con pilares circulares", f: edificioGeometria("circular", { circulares: true }) },
    { nombre: "al azar 4 con losas", f: conLosasAleatorias(fisicoAleatorio(4), 4) },
    { nombre: "al azar 6, reticular", f: conForjadosAleatorios(fisicoAleatorio(6), 6, { tipo: "reticular" }) },
  ];
  return modelos.map(({ nombre, f }) => {
    const c = compilar(f);
    if (!c.valido) throw new Error(`${nombre} no compila`);
    return { nombre, firma: firmaModelo(c.modelo) };
  });
}

if (import.meta.main) process.stdout.write(JSON.stringify(firmas()));
