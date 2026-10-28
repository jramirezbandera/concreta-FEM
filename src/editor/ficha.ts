/**
 * Lo que el inspector enseña de una fila además de sus celdas: qué campos son obligatorios, qué vale
 * uno vacío y, en Forjados, los datos de su croquis (la planta y la sección con sus cotas), leídos
 * tal como están escritos para que el dibujo siga a lo que se teclea, y la rigidez del aligerado de
 * un reticular (los ocho multiplicadores con su nombre y su valor).
 *
 * Lo obligatorio no se declara aparte: se prueba leyendo la fila con el campo vacío (si la tabla dice
 * «falta el dato», lo es), así que no puede separarse de lo que la tabla acepta. `DefTabla.obligatoria`
 * añade lo que la tabla deja pasar y el compilador no.
 *
 * Puro: sin IO.
 */
import { flexionUniforme, multiplicadoresReticular, volumenReticular } from "../compilador/reticular.ts";
import { materialElastico } from "../compilador/secciones.ts";
import type { Seccion, Vec2 } from "../compilador/fisico.ts";
import type { MultiplicadoresLamina } from "../elementos/lamina.ts";
import { Lector, leerNumero, textoClaves, type Fila } from "./celdas.ts";
import type { Objeto } from "./referencias.ts";
import { TIPOS_FORJADO, type Contexto, type DefTabla, type TipoForjado } from "./tablas.ts";

export interface EstadoCampo {
  obligatorio: boolean;
  /** Lo que vale vacío, si no es obligatorio y la columna lo dice (`Columna.defecto`). */
  defecto?: string;
}

/** Cada columna de la fila: si es obligatoria y lo que vale si se deja vacía. */
export function estadoCampos(def: DefTabla, f: Fila, ctx: Contexto, base?: Objeto): Record<string, EstadoCampo> {
  const r: Record<string, EstadoCampo> = {};
  for (const c of def.columnas) {
    if (c.calculada) {
      r[c.clave] = { obligatorio: false };
      continue;
    }
    const l = def.objeto({ ...f, [c.clave]: "" }, ctx, base);
    const obligatorio = (!l.ok && l.errores.some((e) => e.columna === c.clave && e.mensaje === "falta el dato")) || !!def.obligatoria?.(c.clave, f, ctx);
    const defecto = obligatorio ? undefined : c.defecto?.(f, ctx);
    r[c.clave] = defecto === undefined ? { obligatorio } : { obligatorio, defecto };
  }
  return r;
}

// ─── El croquis de un forjado ───────────────────────────────────────────────────────────────────

export interface CroquisForjado {
  tipo: TipoForjado;
  /** El contorno, si se lee (al menos 3 puntos). */
  contorno: Vec2[] | null;
  huecos: Vec2[][];
  abacos: Vec2[][];
  /** Área del contorno sin los huecos, m². */
  area: number | null;
  /** La caja del contorno: [xmin, ymin, xmax, ymax]. */
  caja: [number, number, number, number] | null;
  /** Grados desde +X: el eje 1, los nervios o las viguetas. */
  direccion: number;
  canto?: number;
  intereje?: number;
  nervio?: number;
  capa?: number;
  caseton: "perdido" | "recuperable";
  /** Unidireccional: la sección de su vigueta, si está en el modelo. */
  vigueta?: Seccion;
  /** Reticular: hormigón por m² de lo aligerado, m³/m² (`volumenReticular`). */
  volumen?: number;
}

const positivo = (f: Fila, c: string): number | undefined => {
  const v = leerNumero(f[c] ?? "");
  return typeof v === "number" && v > 0 ? v : undefined;
};

/** Área con signo (positiva en sentido antihorario). */
export function areaPoligono(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i]!;
    const [x1, y1] = p[(i + 1) % p.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Los datos del croquis de una fila de Forjados; lo que no se lee (a medio escribir) se queda fuera. */
export function croquisForjado(f: Fila, ctx: Contexto): CroquisForjado {
  const t = (f.tipo ?? "").trim().toLowerCase() || "maciza";
  const tipo: TipoForjado = (TIPOS_FORJADO as readonly string[]).includes(t) ? (t as TipoForjado) : "maciza";
  const L = new Lector(f);
  const contorno = L.puntos("contorno", { min: 3 }) ?? null;
  const huecos = L.poligonos("huecos") ?? [];
  const abacos = tipo === "reticular" ? (L.poligonos("abacos") ?? []) : [];
  const dir = leerNumero(f.direccion ?? "");
  const caseton = (f.caseton ?? "").trim().toLowerCase() === "recuperable" ? "recuperable" : "perdido";
  const r: CroquisForjado = {
    tipo,
    contorno,
    huecos,
    abacos,
    area: contorno ? Math.abs(areaPoligono(contorno)) - huecos.reduce((s, h) => s + Math.abs(areaPoligono(h)), 0) : null,
    caja: contorno
      ? [Math.min(...contorno.map((p) => p[0])), Math.min(...contorno.map((p) => p[1])), Math.max(...contorno.map((p) => p[0])), Math.max(...contorno.map((p) => p[1]))]
      : null,
    direccion: typeof dir === "number" ? dir : 0,
    caseton,
  };
  const [h, s, bw, hf] = [positivo(f, "espesor"), positivo(f, "intereje"), positivo(f, "nervio"), positivo(f, "capa")];
  if (tipo !== "unidireccional" && h) r.canto = h;
  if (tipo !== "maciza" && s) r.intereje = s;
  if (tipo === "reticular") {
    if (bw) r.nervio = bw;
    if (hf) r.capa = hf;
    if (h && s && bw && hf && bw < s && hf < h) r.volumen = volumenReticular({ h, hf, bw, s });
  }
  if (tipo === "unidireccional") {
    const v = ctx.modelo.secciones.find((x) => x.id === (f.seccion ?? "").trim());
    if (v) r.vigueta = v;
  }
  return r;
}

// ─── La rigidez del aligerado de un reticular ───────────────────────────────────────────────────

/** Los multiplicadores de lámina, en su orden (H47), con lo que es cada uno en los ejes de la losa (1, el de los nervios de `dirección`). */
export const MULTIPLICADORES: readonly { clave: keyof MultiplicadoresLamina; nombre: string; que: string }[] = [
  { clave: "m11", nombre: "flexión según 1", que: "M11: la losa flectando con los nervios según la dirección (1)" },
  { clave: "m22", nombre: "flexión según 2", que: "M22: la losa flectando con los nervios perpendiculares (2)" },
  { clave: "m12", nombre: "torsión", que: "M12: el momento torsor de la placa" },
  { clave: "f11", nombre: "axil en su plano según 1", que: "F11: tracción o compresión en el plano de la losa, según 1" },
  { clave: "f22", nombre: "axil en su plano según 2", que: "F22: tracción o compresión en el plano de la losa, según 2" },
  { clave: "f12", nombre: "cortante en su plano", que: "F12: el rasante en el plano de la losa (la capa)" },
  { clave: "v13", nombre: "cortante vertical según 1", que: "V13: el cortante de los nervios según 1 (el alma)" },
  { clave: "v23", nombre: "cortante vertical según 2", que: "V23: el cortante de los nervios según 2 (el alma)" },
];

export interface RigidezAligerado {
  /** «calculada» si la fila no tiene multiplicadores; «dada» si tiene alguno. */
  modo: "calculada" | "dada";
  /** Los que se calcularían con los nervios (con la opción `rigidezReticular`). */
  calculados: Required<MultiplicadoresLamina>;
  /** Los que usa el cálculo: los calculados o, con «dada», los escritos (1 los que no). */
  usados: Required<MultiplicadoresLamina>;
  /** Los escritos, con «dada». */
  dados: MultiplicadoresLamina;
  /** El ν del hormigón. Los calculados van con ν = 0 en la lámina (un emparrillado no lo tiene); los dados, con éste. */
  nu: number;
  rigidez: "uniforme" | "bruta";
}

/**
 * La rigidez del aligerado de una fila de Forjados reticular, como la usa el compilador (`validar.ts`,
 * C4-h, CY3): null si no es un reticular o le falta algo para calcularla.
 */
export function rigidezAligerado(f: Fila, ctx: Contexto, rigidez: "uniforme" | "bruta" = "uniforme"): RigidezAligerado | null {
  const c = croquisForjado(f, ctx);
  if (c.tipo !== "reticular" || !c.canto || !c.intereje || !c.nervio || !c.capa || !(c.nervio < c.intereje) || !(c.capa < c.canto)) return null;
  const mat = ctx.modelo.materiales.find((x) => x.id === (f.material ?? "").trim());
  if (!mat || mat.tipo === "acero") return null;
  const { elastico } = materialElastico(mat);
  const nu = elastico.E / (2 * elastico.G) - 1;
  const g = { h: c.canto, hf: c.capa, bw: c.nervio, s: c.intereje };
  const nervios = multiplicadoresReticular(g, nu);
  const calculados = rigidez === "uniforme" ? { ...nervios, ...flexionUniforme(nu) } : nervios;
  const dados = new Lector(f).claves("multiplicadores", MULTIPLICADORES.map((m) => m.clave), { max: 100 });
  if (!dados || !Object.keys(dados).length) return { modo: "calculada", calculados, usados: calculados, dados: {}, nu, rigidez };
  const usados = Object.fromEntries(MULTIPLICADORES.map(({ clave }) => [clave, dados[clave] ?? 1])) as Required<MultiplicadoresLamina>;
  return { modo: "dada", calculados, usados, dados, nu, rigidez };
}

/** Los ocho con 3 cifras significativas, para empezar «la mía» desde los calculados. */
export function textoMultiplicadores(m: MultiplicadoresLamina): string {
  return textoClaves(
    Object.fromEntries(MULTIPLICADORES.flatMap(({ clave }) => (m[clave] === undefined ? [] : [[clave, Number(m[clave]!.toPrecision(3))]]))),
    MULTIPLICADORES.map((x) => x.clave),
  );
}
