/**
 * Render de la capa de agente (A4, `docs/fem3d/agente.md` §10): las vistas de cada planta como
 * escenas (`escena.ts`) y su SVG (`svg.ts`). La CLI (`fem render`) las pasa a PNG.
 *
 * Puro: sin IO.
 */
import type { Consultas } from "../../compilador/consultas.ts";
import { conjuntoCombinaciones, seleccionPorDefecto, type ConjuntoCombinaciones } from "../combinaciones.ts";
import type { Resumen } from "../consultas.ts";
import { casosGravedad, FACTOR_GRAVEDAD_ELU, gravedad } from "../sensatezResultados.ts";
import { VISTAS_MODELO } from "./modelo.ts";
import { VISTAS_RESULTADOS } from "./resultados.ts";

export * from "./escena.ts";
export { escenaASvg, LADO_MAXIMO } from "./svg.ts";
export { cantoSeccion, planoDeEje, PROFUNDIDAD_ALZADO, vistaAlzado, type PlanoAlzado } from "./alzado.ts";
export { PlantaFisica, vistaCargas, vistaDiagnosticos, vistaModelo, type DatosVista } from "./modelo.ts";
export { CAMPOS, ResultadosRender, vistaAxiles, vistaCampo, vistaDiagramas, vistaMalla, type Campo } from "./resultados.ts";
export { escalaDeTexto, type EscalaMapa } from "./isovalores.ts";

export const VISTAS = [...VISTAS_MODELO, ...VISTAS_RESULTADOS] as const;
export type Vista = (typeof VISTAS)[number];

/** Las vistas del modelo se dibujan sin calcular, también si no compila; las demás necesitan el cálculo. */
export const necesitaCalculo = (v: Vista): boolean => !(VISTAS_MODELO as readonly string[]).includes(v);

/** Qué combinaciones busca cada vista: los desplazamientos (uz) o los esfuerzos. */
export const propositoDe = (v: Vista): "desplazamientos" | "esfuerzos" => (v === "uz" ? "desplazamientos" : "esfuerzos");

/**
 * Combinaciones por defecto de una vista con resultados: las de las consultas de A1 si todos los
 * casos llevan su acción; si no, la «gravedad» de A3 (factor 1 en uz y 1,4 en los esfuerzos) y, sin
 * casos gravitatorios, los casos sueltos.
 */
export function conjuntoPorDefecto(q: Consultas, res: Resumen, proposito: "desplazamientos" | "esfuerzos"): ConjuntoCombinaciones {
  const casos = q.fisico.casos;
  if (casos.length && casos.every((c) => c.accion)) {
    const r = conjuntoCombinaciones(q, seleccionPorDefecto(casos, proposito));
    if (r.valido) return r.valor;
  }
  const grav = casosGravedad(q.fisico, res);
  if (grav.length) return gravedad(q, grav, proposito === "desplazamientos" ? 1 : FACTOR_GRAVEDAD_ELU);
  const r = conjuntoCombinaciones(q, { tipo: "casos" });
  if (!r.valido) throw new Error("conjuntoPorDefecto: los casos sueltos no pueden fallar");
  return r.valor;
}

/** Nombre de fichero de una figura: planta, vista y caso, sin caracteres raros. */
export const nombreFigura = (planta: string, vista: string, caso?: string): string => [planta, vista, ...(caso ? [caso] : [])].map((x) => x.replace(/[^\w.-]+/g, "_")).join("-");
