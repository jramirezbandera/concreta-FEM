/**
 * Fase CO5 (`docs/fem3d/comprobaciones.md` §8.9): proponer la zapata aislada de un pilar.
 *
 * Como en lo demás, proponer es elegir de unas tablas y el juez es la comprobación
 * (`comprobarZapata`: el módulo de zapatas de Concreta). Determinista. La posición (linderos, vigas
 * centradoras), el hormigón y las tierras son del ingeniero y no se tocan; se proponen el lado, el
 * canto y las parrillas:
 *
 *  1. Se empieza por lo más pequeño de cada tabla: el lado, el primero que deja 15 cm de vuelo a cada
 *     lado del pilar (`VUELO_MINIMO`); el canto, el primero (`CANTOS`); las parrillas inferiores, las
 *     de menos acero; sin parrilla superior.
 *  2. Mientras falle una fila, sube un puesto lo que la arregla (su `grupo`): el lado si es del terreno
 *     (presión, vuelco, deslizamiento), el canto si es el punzonamiento, el cortante o una sección
 *     sobrearmada, la parrilla de su dirección si es la flexión, la biela y tirante, el anclaje o una
 *     regla de armado; y pone la parrilla superior si la pide el despegue. Lo del terreno va primero.
 *  3. Al final, se intenta bajar cada cosa un puesto, mientras siga cumpliendo: lo propuesto cumple, y
 *     con cualquiera de sus puestos uno menos, no.
 *
 * Las tablas (CO5-h): zapatas cuadradas, de 0,80 a 8,00 m cada 5 cm; cantos de 0,40 a 2,00 m cada
 * 5 cm; parrillas de Ø12 a Ø25 cada 300 a 100 mm (múltiplos de 25), de menos a más acero por metro (a
 * igual acero, la de menor diámetro, que ancla mejor).
 */
import { areaBarra, type BarrasZapata, type ParrillaZapata, type Zapata } from "../armado.ts";
import { comprobarZapata, type ComprobacionZapata, type DatosZapata, type GrupoZapata, type OtroPilar, type ZapataCompleta } from "../comprobar/zapatas.ts";
import type { DemandasZapata } from "../demandas/zapatas.ts";

/** El vuelo más pequeño que se propone a cada lado del pilar, m. */
export const VUELO_MINIMO = 0.15;
const redondo = (k: number, paso: number, desde: number) => Math.round((desde + k * paso) * 100) / 100;
export const LADOS: readonly number[] = Array.from({ length: Math.round((8 - 0.8) / 0.05) + 1 }, (_, k) => redondo(k, 0.05, 0.8));
export const CANTOS: readonly number[] = Array.from({ length: Math.round((2 - 0.4) / 0.05) + 1 }, (_, k) => redondo(k, 0.05, 0.4));
export const DIAMETROS_ZAPATA = [12, 16, 20, 25] as const;
export const SEPARACIONES_ZAPATA = [300, 275, 250, 225, 200, 175, 150, 125, 100] as const;

export function tablaBarrasZapata(): BarrasZapata[] {
  return DIAMETROS_ZAPATA.flatMap((diametro) => SEPARACIONES_ZAPATA.map((separacion) => ({ diametro, separacion })))
    .map((b, i) => ({ b, i, a: areaBarra(b.diametro) / b.separacion }))
    .sort((p, q) => p.a - q.a || p.b.diametro - q.b.diametro || p.i - q.i)
    .map((x) => x.b);
}

export interface PropuestaZapata {
  /** null: no hay propuesta (`motivo`). */
  zapata: ZapataCompleta | null;
  /** La comprobación con lo propuesto (o con lo último que se probó). */
  comprobacion: ComprobacionZapata;
  /** Zapatas probadas. */
  probados: number;
  motivo?: string;
}

interface Estado {
  lado: number;
  canto: number;
  ix: number;
  iy: number;
  /** -1: sin parrilla superior. */
  sx: number;
  sy: number;
}

const CLAVES: Record<GrupoZapata, keyof Estado> = { planta: "lado", canto: "canto", "inferior-x": "ix", "inferior-y": "iy", "superior-x": "sx", "superior-y": "sy" };
/** El orden en que se arregla lo que falla: el terreno, el canto y las parrillas. */
const PRIORIDAD: readonly GrupoZapata[] = ["planta", "canto", "inferior-x", "inferior-y", "superior-x", "superior-y"];

/** Propone la zapata de un pilar: la posición de `previa` (linderos, centradoras, hormigón, tierras), y lado, canto y parrillas de las tablas. */
export function proponerZapata(D: DemandasZapata, previa: Zapata | undefined, d: DatosZapata, otros: readonly OtroPilar[] = []): PropuestaZapata {
  const barras = tablaBarrasZapata();
  const fijo: Zapata = {};
  for (const k of ["linderos", "centradoras", "material", "tierras"] as const) if (previa?.[k] !== undefined) (fijo as Record<string, unknown>)[k] = previa[k];
  const lado0 = Math.max(D.circular ? D.cx : Math.max(D.cx, D.cy), 0) + 2 * VUELO_MINIMO;
  const i0 = LADOS.findIndex((l) => l >= lado0 - 1e-9);
  if (i0 < 0) return { zapata: null, comprobacion: vacia(D), probados: 0, motivo: "el pilar es demasiado grande para la tabla de zapatas" };
  const minimo: Estado = { lado: i0, canto: 0, ix: 0, iy: 0, sx: -1, sy: -1 };
  const largo: Record<keyof Estado, number> = { lado: LADOS.length, canto: CANTOS.length, ix: barras.length, iy: barras.length, sx: barras.length, sy: barras.length };
  const zapata = (e: Estado): ZapataCompleta => {
    const parrilla = (a: number, b: number): ParrillaZapata => ({ x: barras[a]!, y: barras[b]! });
    return { ...fijo, B: LADOS[e.lado]!, L: LADOS[e.lado]!, h: CANTOS[e.canto]!, inferior: parrilla(e.ix, e.iy), ...(e.sx >= 0 || e.sy >= 0 ? { superior: parrilla(Math.max(e.sx, 0), Math.max(e.sy, 0)) } : {}) };
  };
  let probados = 0;
  let primero: ComprobacionZapata["primera"];
  const probar = (e: Estado, parar: boolean) => {
    probados++;
    const c = comprobarZapata(D, zapata(e), d, otros, { parar, ...(primero ? { primero } : {}) });
    if (c.primera) primero = c.primera;
    return c;
  };
  const e: Estado = { ...minimo };
  let c = probar(e, true);
  /** Lo que impide proponer: no el arranque (la zapata se propone con las demás combinaciones, y el arranque queda pendiente). */
  const impide = (x: ComprobacionZapata) => x.pendientes.filter((p) => !p.arranque);
  for (let vuelta = 0; ; vuelta++) {
    if (impide(c).length) return { zapata: null, comprobacion: c, probados, motivo: impide(c).map((p) => p.motivo).join("; ") };
    // Si no falla nada, la comprobación que corta en la primera fila que falla ya es la entera: no
    // ha cortado (con `parar` sólo cambia lo que pasa a partir de una fila que falla)
    if (!c.filas.some((f) => f.estado === "fail")) {
      if (c.filas.length) break;
      return { zapata: null, comprobacion: c, probados, motivo: "no hay combinaciones con las que comprobarla" };
    }
    const g = PRIORIDAD.find((x) => c.filas.some((f) => f.estado === "fail" && f.grupo === x))!;
    const k = CLAVES[g];
    if (e[k] + 1 >= largo[k] || vuelta > 2000) return { zapata: null, comprobacion: c, probados, motivo: sinPropuesta(g) };
    e[k]++;
    c = probar(e, true);
  }
  // Bajar lo que sobre, mientras siga cumpliendo
  for (let cambia = true; cambia; ) {
    cambia = false;
    for (const k of ["lado", "canto", "ix", "iy", "sx", "sy"] as const) {
      if (e[k] <= minimo[k]) continue;
      const f = { ...e, [k]: e[k] - 1 };
      // Sin ninguna fila que falle, la que corta es la entera (arriba)
      const x = probar(f, true);
      if (!impide(x).length && !x.filas.some((r) => r.estado === "fail")) {
        Object.assign(e, f);
        c = x;
        cambia = true;
      }
    }
  }
  return { zapata: zapata(e), comprobacion: c, probados };
}

function sinPropuesta(g: GrupoZapata): string {
  if (g === "planta") return "ninguna zapata de la tabla basta para el terreno (presión, vuelco o deslizamiento): hace falta una combinada, una viga centradora o una losa";
  if (g === "canto") return "ningún canto de la tabla basta (punzonamiento, cortante o flexión)";
  return "ninguna parrilla de la tabla basta";
}

const vacia = (D: DemandasZapata): ComprobacionZapata => ({ pilar: D.pilar, tipo: "centrada", cumple: false, filas: [], pendientes: [], centradoras: [], llamadas: 0 });
