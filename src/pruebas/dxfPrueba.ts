/**
 * Un DXF ASCII mínimo (AutoCAD 2000) para las pruebas de la plantilla (V2c-4) y de MA6: capas,
 * líneas y polilíneas. `dxfDeModelo` dibuja una planta de un modelo como la dibujaría un arquitecto:
 * los pilares como rectángulos, las vigas y los muros por su eje, los contornos y huecos de las losas,
 * y las jambas de los huecos de los muros como líneas que cruzan su eje.
 *
 * Sólo para las pruebas: no es un exportador.
 */
import { ejeSeccion, huellaSeccion, PlantaFisica } from "../agente/render/modelo.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";

export type EntidadPrueba = { capa: string; linea: [Vec2, Vec2] } | { capa: string; polilinea: Vec2[]; cerrada?: boolean };

export interface OpcionesDxfPrueba {
  /** Unidades por m de lo escrito (1000: mm). */
  escala?: number;
  /** Lo que se suma a cada coordenada ya escalada (el ruido de un plano real). */
  ruido?: number;
  /** El `$INSUNITS` de la cabecera. */
  insunits?: number;
}

export function escribirDxf(es: readonly EntidadPrueba[], o: OpcionesDxfPrueba = {}): Uint8Array {
  const k = o.escala ?? 1;
  const r = o.ruido ?? 0;
  const n = (x: number) => String(x * k + r);
  const l: string[] = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1015", "9", "$DWGCODEPAGE", "3", "ANSI_1252"];
  if (o.insunits !== undefined) l.push("9", "$INSUNITS", "70", String(o.insunits));
  l.push("0", "ENDSEC", "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER");
  for (const c of [...new Set(es.map((e) => e.capa))]) l.push("0", "LAYER", "2", c, "70", "0", "62", "7", "6", "CONTINUOUS");
  l.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  for (const e of es) {
    if ("linea" in e) {
      const [a, b] = e.linea;
      l.push("0", "LINE", "8", e.capa, "10", n(a[0]), "20", n(a[1]), "30", "0", "11", n(b[0]), "21", n(b[1]), "31", "0");
    } else {
      l.push("0", "LWPOLYLINE", "8", e.capa, "90", String(e.polilinea.length), "70", e.cerrada ? "1" : "0");
      for (const p of e.polilinea) l.push("10", n(p[0]), "20", n(p[1]));
    }
  }
  l.push("0", "ENDSEC", "0", "EOF", "");
  return new TextEncoder().encode(l.join("\r\n"));
}

/** Una planta del modelo como entidades de un plano. */
export function dxfDeModelo(m: ModeloFisico, planta: string): EntidadPrueba[] {
  const pl = new PlantaFisica(m, planta);
  const es: EntidadPrueba[] = [];
  for (const { p, seccion } of pl.pilares()) {
    const h = huellaSeccion(p, seccion);
    if (h && "anillo" in h) es.push({ capa: "PILARES", polilinea: h.anillo, cerrada: true });
    else es.push({ capa: "PILARES", linea: [ejeSeccion(p, seccion), ejeSeccion(p, seccion)] });
  }
  for (const v of pl.enPlanta(m.vigas)) for (let i = 1; i < v.puntos.length; i++) es.push({ capa: "VIGAS", linea: [v.puntos[i - 1]!, v.puntos[i]!] });
  for (const { m: w } of pl.muros()) {
    const ps = w.puntos;
    const cerrado = ps.length > 2 && ps[0]![0] === ps.at(-1)![0] && ps[0]![1] === ps.at(-1)![1];
    es.push({ capa: "MUROS", polilinea: cerrado ? ps.slice(0, -1) : [...ps], cerrada: cerrado });
    // Las jambas: una línea de 1 m que cruza el eje en cada borde del hueco (en el primer tramo)
    const [a, b] = [ps[0]!, ps[1]!];
    const largo = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: Vec2 = [(b[0] - a[0]) / largo, (b[1] - a[1]) / largo];
    for (const h of w.huecos ?? [])
      for (const s of [h.desde, h.hasta]) {
        const c: Vec2 = [a[0] + u[0] * s, a[1] + u[1] * s];
        es.push({ capa: "CARPINTERIA", linea: [[c[0] + u[1] * 0.5, c[1] - u[0] * 0.5], [c[0] - u[1] * 0.5, c[1] + u[0] * 0.5]] });
      }
  }
  for (const x of [...pl.enPlanta(m.losas), ...pl.enPlanta(m.panos)]) for (const r of [x.contorno, ...(x.huecos ?? [])]) es.push({ capa: "FORJADOS", polilinea: [...r], cerrada: true });
  return es;
}
