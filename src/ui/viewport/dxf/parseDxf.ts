// parseDxf: parser PURO de DXF a entidades de plantilla (feature-15).
//
//   texto DXF  ->  { entidades, bbox, noSoportadas }
//
// PURO: texto -> datos. Sin three.js, sin React, sin stores. La libreria
// `dxf-parser` (JS puro) se carga con import() DINAMICO para no inflar el bundle
// inicial (mismo patron lazy que Plotly en F14). Por eso parseDxf es async.
//
// UNIDADES (CLAUDE.md §14): el sistema interno es METROS. Las coordenadas del DXF
// vienen en las unidades del dibujo, indicadas por el header $INSUNITS; aqui se
// convierten a metros UNA sola vez (borde de importacion). Si $INSUNITS no esta o
// es desconocido, se asume que el dibujo ya esta en metros y se deja un aviso.
//
// DEFENSIVO: un DXF corrupto o sin entidades NO lanza; devuelve listas vacias y, si
// procede, lo refleja en `noSoportadas`/bbox degenerada. La validacion Zod del
// borde (PlantillaSchema) la aplica el consumidor (persistencia/UI), no este modulo.
import type {
  EntidadDxf,
  Bbox,
  PuntoXY,
} from "./tiposDxf";

// Resultado del parseo. `noSoportadas` lista (sin duplicados) los tipos de entidad
// DXF encontrados que no convertimos (p.ej. ["SPLINE","TEXT"]), para avisar al
// usuario. `avisos` recoge incidencias del borde (p.ej. unidades desconocidas).
export interface ResultadoParseDxf {
  entidades: EntidadDxf[];
  bbox: Bbox;
  noSoportadas: string[];
  avisos: string[];
}

// Metros por unidad de dibujo segun $INSUNITS (codigos AutoCAD). Solo mapeamos los
// casos habituales en arquitectura; el resto cae al aviso de "unidades desconocidas".
//   1=pulgadas, 4=mm, 5=cm, 6=m, 14=dm. (0=sin unidad => se trata como metros.)
const METROS_POR_UNIDAD: Record<number, number> = {
  1: 0.0254, // pulgadas
  4: 0.001, // milimetros
  5: 0.01, // centimetros
  6: 1, // metros
  14: 0.1, // decimetros
};

// Factor de escala a metros a partir del header. Devuelve tambien un aviso si las
// unidades no se reconocen (se asume metros: factor 1).
function factorAMetros(insunits: number | undefined): {
  factor: number;
  aviso?: string;
} {
  if (insunits === undefined || insunits === 0) {
    return {
      factor: 1,
      aviso:
        "El DXF no declara unidades ($INSUNITS); se asume que el dibujo esta en metros.",
    };
  }
  const factor = METROS_POR_UNIDAD[insunits];
  if (factor === undefined) {
    return {
      factor: 1,
      aviso: `Unidades del DXF no reconocidas (codigo $INSUNITS=${insunits}); se asume metros.`,
    };
  }
  return { factor };
}

// Bbox vacia/degenerada: cuando no hay ninguna entidad soportada. Se usa min>max
// como senal explicita de "sin geometria" (el consumidor decide como encajar).
function bboxVacia(): Bbox {
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

// Acumula puntos en una bbox mutable. Trabaja con un acumulador de extremos para
// no recorrer dos veces las entidades.
interface AcumBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  tienePunto: boolean;
}

function acumular(acc: AcumBbox, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  acc.minX = Math.min(acc.minX, x);
  acc.minY = Math.min(acc.minY, y);
  acc.maxX = Math.max(acc.maxX, x);
  acc.maxY = Math.max(acc.maxY, y);
  acc.tienePunto = true;
}

// Acumula la bbox de una entidad ya convertida (en metros). Para arcos/circulos
// usamos la caja del circulo completo: suficiente para encajar a vista (no se
// busca el bbox ajustado del sector, que requeriria mas matematica sin beneficio).
function acumularEntidad(acc: AcumBbox, e: EntidadDxf): void {
  switch (e.tipo) {
    case "linea":
      acumular(acc, e.x1, e.y1);
      acumular(acc, e.x2, e.y2);
      break;
    case "polilinea":
      for (const p of e.puntos) acumular(acc, p.x, p.y);
      break;
    case "punto":
      acumular(acc, e.x, e.y);
      break;
    case "circulo":
    case "arco":
      acumular(acc, e.cx - e.r, e.cy - e.r);
      acumular(acc, e.cx + e.r, e.cy + e.r);
      break;
  }
}

export async function parseDxf(texto: string): Promise<ResultadoParseDxf> {
  const avisos: string[] = [];

  // import() dinamico: la libreria NO entra en el bundle inicial.
  const mod = await import("dxf-parser");
  const DxfParser = mod.default;

  // El parser puede lanzar con entradas malformadas: lo aislamos para nunca romper
  // la app (un .dxf corrupto debe dar error en lenguaje de obra, no crash).
  let dxf: ReturnType<InstanceType<typeof DxfParser>["parseSync"]> = null;
  try {
    dxf = new DxfParser().parseSync(texto);
  } catch {
    dxf = null;
  }

  if (dxf === null) {
    return {
      entidades: [],
      bbox: bboxVacia(),
      noSoportadas: [],
      avisos: ["El fichero DXF no se pudo interpretar (formato no valido)."],
    };
  }

  // Factor de unidades del header. $INSUNITS llega como number en el header.
  const insunitsRaw = dxf.header?.["$INSUNITS"];
  const insunits =
    typeof insunitsRaw === "number" ? insunitsRaw : undefined;
  const { factor, aviso } = factorAMetros(insunits);
  if (aviso) avisos.push(aviso);
  const m = (v: number) => v * factor;

  const entidades: EntidadDxf[] = [];
  const noSoportadas = new Set<string>();
  // Las polilineas DXF pueden traer `bulge` por vertice (arco entre vertices). No
  // teselamos el bulge en v1: se dibuja recto. Si aparece, avisamos UNA vez para no
  // mentir (la curva no se ve donde el CAD la dibujo). Tesela completa = TODO.
  let bulgeDetectado = false;
  const acc: AcumBbox = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    tienePunto: false,
  };

  const entrada = Array.isArray(dxf.entities) ? dxf.entities : [];
  for (const ent of entrada) {
    // El parser tipa las entidades por su union; accedemos a campos especificos
    // tras discriminar por `type`. Usamos `any` local acotado por el switch para no
    // arrastrar los ~16 tipos de la libreria (cada rama valida lo que lee).
    const tipo = ent.type;
    switch (tipo) {
      case "LINE": {
        const v = (ent as { vertices?: { x: number; y: number }[] }).vertices;
        if (v && v.length >= 2) {
          entidades.push({
            tipo: "linea",
            x1: m(v[0]!.x),
            y1: m(v[0]!.y),
            x2: m(v[1]!.x),
            y2: m(v[1]!.y),
          });
        }
        break;
      }
      case "LWPOLYLINE":
      case "POLYLINE": {
        const v = (
          ent as { vertices?: { x: number; y: number; bulge?: number }[] }
        ).vertices;
        const cerrada = Boolean((ent as { shape?: boolean }).shape);
        if (v && v.length >= 2) {
          // bulge != 0 => tramo curvo; lo dibujamos recto (v1) pero lo registramos.
          if (v.some((p) => typeof p.bulge === "number" && p.bulge !== 0)) {
            bulgeDetectado = true;
          }
          const puntos: PuntoXY[] = v.map((p) => ({ x: m(p.x), y: m(p.y) }));
          entidades.push({ tipo: "polilinea", puntos, cerrada });
        }
        break;
      }
      case "POINT": {
        const p = (ent as { position?: { x: number; y: number } }).position;
        if (p) entidades.push({ tipo: "punto", x: m(p.x), y: m(p.y) });
        break;
      }
      case "CIRCLE": {
        const c = ent as {
          center?: { x: number; y: number };
          radius?: number;
        };
        if (c.center && typeof c.radius === "number") {
          entidades.push({
            tipo: "circulo",
            cx: m(c.center.x),
            cy: m(c.center.y),
            r: m(c.radius),
          });
        }
        break;
      }
      case "ARC": {
        const a = ent as {
          center?: { x: number; y: number };
          radius?: number;
          startAngle?: number;
          endAngle?: number;
        };
        // dxf-parser ya entrega los angulos en RADIANES.
        if (
          a.center &&
          typeof a.radius === "number" &&
          typeof a.startAngle === "number" &&
          typeof a.endAngle === "number"
        ) {
          entidades.push({
            tipo: "arco",
            cx: m(a.center.x),
            cy: m(a.center.y),
            r: m(a.radius),
            anguloInicio: a.startAngle,
            anguloFin: a.endAngle,
          });
        }
        break;
      }
      default:
        // Tipo no soportado en v1: lo registramos para avisar (sin duplicados).
        if (typeof tipo === "string" && tipo.length > 0) noSoportadas.add(tipo);
        break;
    }
  }

  if (bulgeDetectado) {
    avisos.push("Algunas curvas de polilínea se han aproximado como rectas.");
  }

  // Bbox de las entidades soportadas (ya en metros). Si no hubo ninguna, degenerada.
  for (const e of entidades) acumularEntidad(acc, e);
  const bbox: Bbox = acc.tienePunto
    ? { minX: acc.minX, minY: acc.minY, maxX: acc.maxX, maxY: acc.maxY }
    : bboxVacia();

  return {
    entidades,
    bbox,
    noSoportadas: Array.from(noSoportadas).sort(),
    avisos,
  };
}
