/**
 * Fase LC, criterio 3 (`docs/fem3d/losa-cimentacion.md` §6): el oráculo externo. Escribe en
 * `validacion/lc/opensees-lc.json` el modelo analítico de una losa de cimentación con pilares (los
 * nudos, las láminas, los muelles, los apoyos y los enlaces de la compilación) con sus cargas nodales,
 * para que `oraculo_balasto.py` lo monte en OpenSeesPy (ASDShellQ4 y muelles `zeroLength`) y escriba
 * el asiento de los nudos con muelle y las reacciones en `src/compilador/__fixtures__/opensees-lc.json`.
 * La prueba es `src/compilador/oraculo-lc.test.ts`.
 *
 * Uso: bun validacion/lc/oraculo.ts && .venv312/Scripts/python.exe validacion/lc/oraculo_balasto.py
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";

/** Una losa de 10 × 6 m y 0,6 m sobre k = 40 000 con tres pilares de 30 × 30 cargados en cabeza, sin peso (sólo cargas nodales) y sin diafragma. */
export function modeloOraculo(): ModeloFisico {
  return {
    plantas: [
      { id: "N1", altura: null, diafragma: "ninguno" },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 30, peso: 0 }],
    secciones: [{ id: "p30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 }],
    losas: [
      {
        id: "L",
        planta: "C",
        contorno: [
          [0, 0],
          [10, 0],
          [10, 6],
          [0, 6],
        ],
        espesor: 0.6,
        material: "H",
        cimentacion: { balasto: 40000 },
      },
    ],
    pilares: [
      { id: "A1", x: 2, y: 3, desde: "C", hasta: "N1", seccion: "p30" },
      { id: "A2", x: 8, y: 3, desde: "C", hasta: "N1", seccion: "p30" },
      { id: "A3", x: 5, y: 1, desde: "C", hasta: "N1", seccion: "p30" },
    ],
    casos: [{ id: "G" }, { id: "W" }],
    cargas: [
      { tipo: "puntual", id: "F1", caso: "G", planta: "N1", x: 2, y: 3, F: [0, 0, -800] },
      { tipo: "puntual", id: "F2", caso: "G", planta: "N1", x: 8, y: 3, F: [0, 0, -500] },
      { tipo: "puntual", id: "F3", caso: "G", planta: "N1", x: 5, y: 1, F: [0, 0, -300] },
      { tipo: "puntual", id: "H1", caso: "W", planta: "N1", x: 2, y: 3, F: [30, 10, 0] },
    ],
  };
}

/** Sin empotramiento parcial (OpenSees no lo tiene) ni cortante en las barras: Euler–Bernoulli. */
export const OPCIONES_ORACULO: OpcionesCompilacion = { empotramientoCabeza: 1, cortante: false };

if (import.meta.main) {
  const c = compilar(modeloOraculo(), OPCIONES_ORACULO);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  writeFileSync(join(import.meta.dirname, "opensees-lc.json"), JSON.stringify({ modelo: c.modelo, cimentacion: c.mapeo.cimentacion }));
  console.log(`escrito validacion/lc/opensees-lc.json: ${c.modelo.nudos.length} nudos, ${c.modelo.laminas!.length} láminas, ${c.modelo.muelles!.length} muelles`);
}
