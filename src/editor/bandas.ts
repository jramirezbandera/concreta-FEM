/**
 * «Proponer bandas» en el editor (V2b, `docs/fem3d/visor.md` §7.4 b): las bandas del Anejo I que
 * propone el compilador (`proponerBandas`, C5.1) para unas plantas, sin perder las del usuario.
 *
 * - Sustituye las bandas de origen «propuesta» de esas plantas por la propuesta nueva.
 * - Las del usuario (origen «usuario» o sin origen) se quedan. Una propuesta que se solapa con una
 *   del usuario en la misma dirección no se añade, y se dice cuál y con cuál.
 * - Proponer dos veces seguidas no cambia nada.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { proponerBandas } from "../compilador/bandas.ts";
import type { Banda, ModeloFisico, OpcionesCompilacion, Vec2 } from "../compilador/fisico.ts";
import { areaConSigno, areaInterseccionRegiones } from "../compilador/poligonos.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { indiceIds } from "./referencias.ts";

export interface PropuestaBandasEditor {
  /** Las plantas en las que se propone (las pedidas, o todas). */
  plantas: string[];
  /** Ids de las bandas propuestas que se quitan. */
  quitar: string[];
  /** Las bandas nuevas, en el orden de la propuesta. */
  anadir: Banda[];
  /** Las propuestas que no entran porque se solapan con una del usuario. */
  omitidas: { banda: Banda; solapa: string }[];
  /** Los avisos de la propuesta (una losa sin alineaciones, una banda que se sale…) o, si el modelo no vale, sus errores. */
  diagnosticos: Diagnostico[];
}

/** Rectángulo de una banda. */
function rectangulo(b: Banda): Vec2[] {
  const dx = b.hasta[0] - b.desde[0];
  const dy = b.hasta[1] - b.desde[1];
  const L = Math.hypot(dx, dy);
  const m: Vec2 = [(-dy / L) * (b.ancho / 2), (dx / L) * (b.ancho / 2)];
  return [
    [b.desde[0] - m[0], b.desde[1] - m[1]],
    [b.hasta[0] - m[0], b.hasta[1] - m[1]],
    [b.hasta[0] + m[0], b.hasta[1] + m[1]],
    [b.desde[0] + m[0], b.desde[1] + m[1]],
  ];
}

/** Fracción del área de la menor que comparten dos bandas para que se solapen. */
const FRACCION_SOLAPE = 1e-3;

/** Si dos bandas de la misma planta van en la misma dirección y comparten área. */
export function solapan(a: Banda, b: Banda): boolean {
  if (a.planta !== b.planta) return false;
  const ua: Vec2 = [a.hasta[0] - a.desde[0], a.hasta[1] - a.desde[1]];
  const ub: Vec2 = [b.hasta[0] - b.desde[0], b.hasta[1] - b.desde[1]];
  const sen = Math.abs(ua[0] * ub[1] - ua[1] * ub[0]) / (Math.hypot(...ua) * Math.hypot(...ub));
  if (sen > 1e-6) return false;
  const ra = rectangulo(a);
  const rb = rectangulo(b);
  const comun = areaInterseccionRegiones({ contorno: ra, huecos: [] }, { contorno: rb, huecos: [] });
  return comun > FRACCION_SOLAPE * Math.min(Math.abs(areaConSigno(ra)), Math.abs(areaConSigno(rb)));
}

const esPropuesta = (b: Banda) => b.origen === "propuesta";

/** Lo que cambia «Proponer bandas» en las plantas `plantas` (todas, si no se dan). */
export function propuestaBandas(m: ModeloFisico, plantas?: readonly string[], opciones: OpcionesCompilacion = {}): PropuestaBandasEditor {
  const en = new Set(plantas ?? m.plantas.map((p) => p.id));
  const { bandas, diagnosticos } = proponerBandas(m, opciones);
  const nada = { plantas: [...en], quitar: [], anadir: [], omitidas: [], diagnosticos };
  if (diagnosticos.some((d) => d.severidad === "error")) return nada;
  const actuales = m.bandas ?? [];
  const quitar = actuales.filter((b) => en.has(b.planta) && esPropuesta(b)).map((b) => b.id);
  const delUsuario = actuales.filter((b) => en.has(b.planta) && !esPropuesta(b));
  // Ids que quedan ocupados: los de todo el modelo menos los que se quitan
  const quitados = new Set(quitar);
  const ocupados = new Set([...indiceIds(m).keys()].filter((id) => !quitados.has(id)));
  const anadir: Banda[] = [];
  const omitidas: { banda: Banda; solapa: string }[] = [];
  for (const b of bandas) {
    if (!en.has(b.planta)) continue;
    const u = delUsuario.find((x) => solapan(x, b));
    if (u) {
      omitidas.push({ banda: b, solapa: u.id });
      continue;
    }
    let id = b.id;
    for (let i = 2; ocupados.has(id); i++) id = `${b.id}-${i}`;
    ocupados.add(id);
    anadir.push(id === b.id ? b : { ...b, id });
  }
  return { plantas: [...en], quitar, anadir, omitidas, diagnosticos: diagnosticos.filter((d) => !d.ids?.length || d.ids.some((id) => (m.losas ?? []).some((l) => l.id === id && en.has(l.planta)))) };
}

/**
 * Las bandas del modelo con la propuesta aplicada: las que se quitan, fuera, y las nuevas de cada
 * planta donde estaban las propuestas que sustituyen (o al final, si no había), para que proponer
 * otra vez dé las mismas listas.
 */
export function conPropuestaBandas(m: ModeloFisico, p: PropuestaBandasEditor): ModeloFisico {
  const quitar = new Set(p.quitar);
  const actuales = m.bandas ?? [];
  const r: Banda[] = [];
  const puestas = new Set<string>();
  for (const b of actuales) {
    if (quitar.has(b.id)) {
      // En el sitio de la primera propuesta quitada de su planta, las nuevas de esa planta
      if (!puestas.has(b.planta)) {
        r.push(...p.anadir.filter((x) => x.planta === b.planta));
        puestas.add(b.planta);
      }
      continue;
    }
    r.push(b);
  }
  for (const x of p.anadir) if (!puestas.has(x.planta)) r.push(x);
  const { bandas: _b, ...resto } = m;
  return r.length ? { ...resto, bandas: r } : (resto as ModeloFisico);
}
