/**
 * Revisión de un proyecto calculado (A3, regla A3 de `docs/fem3d/agente.md`): las comprobaciones de
 * sensatez (`sensatez.ts`, `sensatezResultados.ts`) y el informe (`informe.ts`).
 *
 * No hay firma (decisión del usuario, 2026-11-05): el informe es la revisión de sensatez del modelo
 * y de sus resultados, no algo que se firme. Va ligado a la huella: si el proyecto cambia, se rehace.
 *
 * Puro: la CLI escribe los ficheros.
 */
import type { ResultadoCompilacion } from "../compilador/compilar.ts";
import type { Consultas } from "../compilador/consultas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { resumen, type Resumen } from "./consultas.ts";
import { documentoInforme, html, markdown, type Bloque, type ReaccionBase } from "./informe.ts";
import type { Proyecto } from "./proyecto.ts";
import { sensatezModelo, type Comprobacion, type DesglosePesoPropio, type PesoCalculado } from "./sensatez.ts";
import { conjuntosSensatez, sensatezResultados, type SensatezResultados, type TramoComparado } from "./sensatezResultados.ts";
import { escenaASvg } from "./render/svg.ts";
import { vistaModelo } from "./render/modelo.ts";
import { ResultadosRender, vistaCampo } from "./render/resultados.ts";

export interface Revision {
  comprobaciones: Comprobacion[];
  pesoPropio: DesglosePesoPropio | null;
  tributaria: TramoComparado[];
  /** Los avisos de sensatez, en el orden de las comprobaciones. */
  avisos: Diagnostico[];
  documento: Bloque[];
  markdown: string;
  html: string;
}

type DatosRevisar = { motor: string; diagnosticos: readonly Diagnostico[]; equilibrio: readonly { id: string; fuerzas: number; momentos: number }[]; resumen?: Resumen };

/** Lo que una revisión necesita de los resultados (lo que más cuesta), para componerla una o más veces. */
export interface RevisionPreparada {
  res: Resumen;
  resultados: SensatezResultados;
  figuras: { titulo: string; svg: string }[];
  cimentacion: ReaccionBase[];
  otros: Omit<DatosRevisar, "resumen">;
}

/**
 * Comprueba y arma el informe. `q`: las consultas del cálculo de `c`; `diagnosticos`, los avisos de
 * la compilación y del cálculo; `equilibrio`, el de cada caso; `resumen`, el de `c` si ya se tiene
 * (el visor lo hace al compilar; en el edificio objetivo, ~0,5 s).
 */
export function revisar(p: Proyecto, c: Extract<ResultadoCompilacion, { valido: true }>, q: Consultas, datos: DatosRevisar): Revision {
  return componerRevision(p, c, prepararRevision(p, c, q, datos));
}

/** La parte de `revisar` que sale de los resultados: la sensatez de los resultados, las figuras y la cimentación. */
export function prepararRevision(p: Proyecto, c: Extract<ResultadoCompilacion, { valido: true }>, q: Consultas, datos: DatosRevisar): RevisionPreparada {
  const { resumen: dado, ...otros } = datos;
  const res = dado ? { valido: true as const, valor: dado } : resumen(p, c);
  if (!res.valido) throw new Error("revisar: el resumen de un modelo compilado no puede fallar");
  return { res: res.valor, resultados: sensatezResultados(q, res.valor, p.opciones), figuras: figurasInforme(p, c, q, res.valor), cimentacion: cimentacion(q), otros };
}

/**
 * El informe de una revisión preparada, con la sensatez del modelo. `pesoCalculado`: sin darlo, el
 * peso propio calculado se compila (como `revisar`, el mismo informe byte a byte); `"pendiente"`, la
 * revisión sale antes, con esa comprobación pendiente (la Revisión de la app la enseña así y luego
 * pide la final).
 */
export function componerRevision(p: Proyecto, c: Extract<ResultadoCompilacion, { valido: true }>, prep: RevisionPreparada, pesoCalculado?: PesoCalculado): Revision {
  const { res, resultados, figuras } = prep;
  const modelo = sensatezModelo(p.modelo, p.opciones, res, pesoCalculado);
  const documento = documentoInforme({ proyecto: p, huella: c.huella, resumen: res, hipotesis: c.hipotesis, modelo, resultados, cimentacion: prep.cimentacion, figuras, ...prep.otros });
  const comprobaciones = [...modelo.comprobaciones, ...resultados.comprobaciones];
  return {
    comprobaciones,
    pesoPropio: modelo.pesoPropio,
    tributaria: resultados.tributaria,
    avisos: comprobaciones.flatMap((x) => x.avisos),
    documento,
    markdown: markdown(documento),
    html: html(documento),
  };
}

/**
 * Figuras del informe (A4, criterio 5): por cada planta con losas o paños, su vista `modelo` y, si
 * tiene losas, la `uz` en las combinaciones de las flechas de A3 (la que gobierna en la planta).
 */
export function figurasInforme(p: Proyecto, c: Extract<ResultadoCompilacion, { valido: true }>, q: Consultas, res: Resumen): { titulo: string; svg: string }[] {
  const f = p.modelo;
  const cj = conjuntosSensatez(q, res).flechas;
  const rr = new ResultadosRender(q, c);
  const d = { nombre: p.nombre, huella: c.huella };
  const r: { titulo: string; svg: string }[] = [];
  for (const pl of f.plantas) {
    const losas = (f.losas ?? []).some((l) => l.planta === pl.id);
    if (!losas && !(f.panos ?? []).some((x) => x.planta === pl.id)) continue;
    r.push({ titulo: `Planta ${pl.id}: modelo`, svg: escenaASvg(vistaModelo(f, pl.id, d)).svg });
    if (losas && cj) {
      // La flecha: con varias combinaciones, su envolvente mínima en cada nudo (UI-1)
      const e = vistaCampo(rr, pl.id, "uz", cj, d, {}, "min");
      r.push({ titulo: `Planta ${pl.id}: uz (mm), ${cj.factores.length > 1 ? `envolvente mínima de ${cj.descripcion}` : (cj.nombres[0] ?? cj.descripcion)}`, svg: escenaASvg(e).svg });
    }
  }
  return r;
}

/** Reacciones de cada pilar, muro y apoyo con base, en el orden del modelo (las cargas en cimentación del informe). */
export function cimentacion(q: Consultas): ReaccionBase[] {
  const f = q.fisico;
  const objetos: [string, ReaccionBase["tipo"]][] = [
    ...(f.pilares ?? []).filter((x) => x.base !== "ninguno").map((x) => [x.id, "pilar"] as [string, ReaccionBase["tipo"]]),
    ...(f.muros ?? []).filter((x) => x.base !== "ninguno").map((x) => [x.id, "muro"] as [string, ReaccionBase["tipo"]]),
    ...(f.apoyos ?? []).map((x) => [x.id, "apoyo"] as [string, ReaccionBase["tipo"]]),
    ...(f.apoyosLineales ?? []).map((x) => [x.id, "apoyo lineal"] as [string, ReaccionBase["tipo"]]),
  ];
  const r: ReaccionBase[] = [];
  for (const [id, tipo] of objetos) {
    const x = q.reacciones(id);
    if (x.valido && x.valor.nudos) r.push({ id, tipo, punto: x.valor.punto, R: x.valor.resultante });
  }
  return r;
}
