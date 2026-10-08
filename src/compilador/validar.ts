/**
 * Paso 1 del compilador: esquema, referencias y cotas del modelo físico. Todo defecto es un
 * diagnóstico que nombra el objeto físico por su `id`; nada lanza, ni con datos basura (la
 * entrada puede venir de un fichero). Si hay errores, la compilación no sigue.
 */
import type { MultiplicadoresLamina } from "../elementos/lamina.ts";
import { Diagnosticos } from "../motor/diagnosticos.ts";
import { cotasPlantas } from "./cotas.ts";
import type { ApoyoFisico, ApoyoLineal, Banda, CargaFisica, CasoFisico, Losa, Material, ModeloFisico, Muro, OpcionesResueltas, PanoUnidireccional, Pilar, Planta, Seccion, Vec2, Viga } from "./fisico.ts";
import { areaConSigno, areaInterseccionRegiones, defectoPoligono, distanciaEntreSegmentos, puntoEnPoligono, type Region } from "./poligonos.ts";
import { multiplicadoresReticular, volumenReticular } from "./reticular.ts";
import { compilarSeccion, materialElastico, type SeccionCompilada } from "./secciones.ts";

/** Una losa ya comprobada, con su material de lámina y su peso propio. */
export interface LosaCompilada {
  losa: Losa;
  region: Region;
  /** Material de las láminas (E en kN/m², ν, espesor en m); en un reticular, el de los ábacos. */
  material: { E: number; nu: number; t: number };
  /** Peso propio, kN/m² (H24, C2-g); en un reticular, el de la zona aligerada (C4-i). */
  pp: number;
  /** Peso específico del material, kN/m³. */
  gamma: number;
  /** Forjado reticular (C4): la zona aligerada y sus ábacos. */
  reticular?: ReticularCompilado;
}

/** Un reticular ya comprobado (C4-h, C4-i). */
export interface ReticularCompilado {
  /** Multiplicadores de las láminas de la zona aligerada. */
  multiplicadores: MultiplicadoresLamina;
  /** ν de las láminas de la zona aligerada: 0 con los multiplicadores calculados, el del material con los dados. */
  nu: number;
  /** ¿Los ha dado el usuario? */
  dados: boolean;
  /** Peso propio de la zona aligerada y de los ábacos, kN/m². */
  ppAligerada: number;
  ppAbaco: number;
  /** Ábacos en orden canónico (por su vértice menor). */
  abacos: Vec2[][];
}

/** Un paño unidireccional ya comprobado (C4). */
export interface PanoCompilado {
  pano: PanoUnidireccional;
  region: Region;
  /** Planta (índice). */
  k: number;
  seccion: SeccionCompilada;
  /** Dirección de las viguetas (unitaria, exacta en los múltiplos de 90°) y su normal (d girada 90°). */
  d: Vec2;
  n: Vec2;
}

/** Dirección de un ángulo en planta (grados desde +X): exacta en los múltiplos de 90°. */
export function direccionGrados(grados: number): Vec2 {
  const g = (((grados % 360) + 360) % 360) / 90;
  const ejes: Vec2[] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  if (Number.isInteger(g)) return ejes[g]!;
  return [Math.cos((grados * Math.PI) / 180), Math.sin((grados * Math.PI) / 180)];
}

/** Orden canónico de unos polígonos: por su vértice menor (x, y) y, si empatan, por sus vértices. */
export function ordenarPoligonos(ps: readonly (readonly Vec2[])[]): Vec2[][] {
  const menor = (p: readonly Vec2[]) => p.reduce((m, q) => (q[0] < m[0] || (q[0] === m[0] && q[1] < m[1]) ? q : m), p[0]!);
  const cmp = (a: readonly Vec2[], b: readonly Vec2[]) => {
    const [ma, mb] = [menor(a), menor(b)];
    if (ma[0] !== mb[0]) return ma[0] - mb[0];
    if (ma[1] !== mb[1]) return ma[1] - mb[1];
    const [sa, sb] = [JSON.stringify(a), JSON.stringify(b)];
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  };
  return [...ps].sort(cmp).map((p) => p.map((q) => [q[0], q[1]] as Vec2));
}

/** Un muro ya comprobado (C3), con su material de lámina y la geometría de sus tramos. */
export interface MuroCompilado {
  muro: Muro;
  /** Material de las láminas (E en kN/m², ν, espesor en m). */
  material: { E: number; nu: number; t: number };
  /** Peso específico del material, kN/m³. */
  gamma: number;
  /** Plantas de la base y de la cabeza (índices, de arriba abajo: kh < kb). */
  kb: number;
  kh: number;
  /** Estación del primer punto de cada tramo y su longitud. */
  s0: number[];
  largo: number[];
  /** Huecos, con el tramo en el que caen. */
  huecos: { tramo: number; desde: number; hasta: number; z0: number; z1: number }[];
}

/** El modelo físico ya comprobado, con sus índices. Las listas de objetos van ordenadas por `id`. */
export interface Contexto {
  op: OpcionesResueltas;
  plantas: readonly Planta[];
  /** Cota de cada planta (de arriba abajo); NaN si no se puede saber y nadie la usa. */
  cotas: readonly number[];
  planta: ReadonlyMap<string, number>;
  /** Planta más baja (la última de la lista). */
  plantaBaja: number;
  secciones: ReadonlyMap<string, SeccionCompilada>;
  pilares: readonly Pilar[];
  vigas: readonly Viga[];
  apoyos: readonly ApoyoFisico[];
  /** En el orden del modelo físico (es el de los resultados). */
  casos: readonly CasoFisico[];
  caso: ReadonlyMap<string, number>;
  cargas: readonly CargaFisica[];
  pilarDe: ReadonlyMap<string, Pilar>;
  vigaDe: ReadonlyMap<string, Viga>;
  /** C2: losas (por id), apoyos lineales y bandas. */
  losas: readonly LosaCompilada[];
  losaDe: ReadonlyMap<string, LosaCompilada>;
  apoyosLineales: readonly ApoyoLineal[];
  bandas: readonly Banda[];
  /** C3: muros (por id). */
  muros: readonly MuroCompilado[];
  muroDe: ReadonlyMap<string, MuroCompilado>;
  /** C4: paños unidireccionales (por id). */
  panos: readonly PanoCompilado[];
  panoDe: ReadonlyMap<string, PanoCompilado>;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;
const vec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(num);
const vec2 = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(num);
const seis = (v: unknown): boolean => Array.isArray(v) && v.length === 6 && v.every((x) => typeof x === "boolean");
const porId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Qué falla en los modificadores de rigidez de las opciones, o null si están bien. */
function modificadoresNoValidos(m: unknown): string | null {
  if (!esObjeto(m)) return "no son un objeto";
  for (const [pieza, g] of Object.entries(m)) {
    if (g === undefined) continue;
    if (pieza !== "pilares" && pieza !== "vigas" && pieza !== "viguetas") return `pieza desconocida «${pieza}»`;
    if (!esObjeto(g)) return `${pieza} no es un objeto`;
    for (const [mat, mods] of Object.entries(g)) {
      if (mods === undefined) continue;
      if (!["todos", "hormigon", "acero", "general"].includes(mat)) return `material desconocido «${mat}» en ${pieza}`;
      if (!esObjeto(mods)) return `${pieza}.${mat} no es un objeto`;
      for (const [k, x] of Object.entries(mods)) {
        if (x === undefined) continue;
        if (!["A", "Avy", "Avz", "J", "Iy", "Iz"].includes(k)) return `propiedad desconocida «${k}» en ${pieza}.${mat}`;
        if (!(num(x) && x > 0 && x <= 100)) return `${pieza}.${mat}.${k} = ${String(x)}`;
      }
    }
  }
  return null;
}

/** Qué le falta a un polígono de la entrada (forma y simplicidad), o null. */
function poligonoNoValido(p: unknown): string | null {
  if (!Array.isArray(p) || !p.every(vec2)) return "tiene que ser una lista de pares [x, y] de números";
  const d = defectoPoligono(p as Vec2[], 1e-9);
  return d ? `no es un polígono simple: ${d}` : null;
}

/** Qué le falta a una polilínea de la entrada, o null. */
function polilineaNoValida(p: unknown): string | null {
  if (!Array.isArray(p) || p.length < 2 || !p.every(vec2)) return "los puntos tienen que ser una lista de al menos dos pares [x, y] de números";
  for (let k = 1; k < p.length; k++) {
    const [a, b] = [p[k - 1] as Vec2, p[k] as Vec2];
    if (!(Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) > 1e-9)) return `los puntos ${k} y ${k + 1} coinciden`;
  }
  return null;
}

/** ¿Se tocan o se cortan los lados de dos polígonos? */
function tocan(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) if (distanciaEntreSegmentos(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!) <= 1e-9) return true;
  return false;
}

export function validar(fisico: ModeloFisico, op: OpcionesResueltas, diag: Diagnosticos): Contexto | null {
  const f = fisico as unknown as Record<string, unknown>;
  if (!esObjeto(f)) {
    diag.error("fisico/no-valido", "El modelo físico no es un objeto.");
    return null;
  }
  if (!(num(op.epsGeom) && op.epsGeom > 0 && num(op.epsSnap) && op.epsSnap >= op.epsGeom && num(op.factorZonaRigida) && op.factorZonaRigida >= 0 && op.factorZonaRigida <= 1)) {
    diag.error("opciones/no-validas", "Las opciones no son válidas: hace falta 0 < ε_geom ≤ ε_snap y un factor de zona rígida en [0, 1].");
    return null;
  }
  if (!(num(op.tamanoMalla) && op.tamanoMalla >= 2 * op.epsSnap)) {
    diag.error("opciones/no-validas", `El tamaño de malla tiene que ser un número de al menos 2·ε_snap (${2 * op.epsSnap} m).`);
    return null;
  }
  if (typeof op.rejilla !== "boolean") {
    diag.error("opciones/no-validas", "La opción rejilla tiene que ser true o false.");
    return null;
  }
  if (typeof op.torsionEquilibrio !== "boolean") {
    diag.error("opciones/no-validas", "La opción torsionEquilibrio tiene que ser true o false.");
    return null;
  }
  const malMod = modificadoresNoValidos(op.modificadores);
  if (malMod) {
    diag.error(
      "opciones/no-validas",
      `Los modificadores de rigidez no son válidos (${malMod}): van por pilares, vigas y viguetas, para todos o por material (hormigon, acero, general), y cada uno de A, Avy, Avz, J, Iy o Iz tiene que estar en (0, 100] (uno mayor es una penalización, E6-1).`,
    );
    return null;
  }
  const lista = (clave: string, obligatoria: boolean): Record<string, unknown>[] => {
    const v = f[clave];
    if (v === undefined && !obligatoria) return [];
    if (!Array.isArray(v)) {
      diag.error("fisico/no-valido", `El modelo físico no tiene la lista «${clave}».`);
      return [];
    }
    const r: Record<string, unknown>[] = [];
    v.forEach((x, i) => {
      if (esObjeto(x) && typeof x.id === "string" && x.id !== "") r.push(x);
      else diag.error("fisico/sin-id", `El elemento ${i + 1} de «${clave}» no es un objeto con un id de texto no vacío.`);
    });
    return r;
  };
  const plantas = lista("plantas", true) as unknown as Planta[];
  const materiales = lista("materiales", true) as unknown as Material[];
  const secciones = lista("secciones", true) as unknown as Seccion[];
  const pilares = (lista("pilares", false) as unknown as Pilar[]).sort(porId);
  const vigas = (lista("vigas", false) as unknown as Viga[]).sort(porId);
  const apoyos = (lista("apoyos", false) as unknown as ApoyoFisico[]).sort(porId);
  const casos = lista("casos", true) as unknown as CasoFisico[];
  const cargas = (lista("cargas", false) as unknown as CargaFisica[]).sort(porId);
  const losas = (lista("losas", false) as unknown as Losa[]).sort(porId);
  const apoyosLineales = (lista("apoyosLineales", false) as unknown as ApoyoLineal[]).sort(porId);
  const bandas = (lista("bandas", false) as unknown as Banda[]).sort(porId);
  const muros = (lista("muros", false) as unknown as Muro[]).sort(porId);
  const panos = (lista("panos", false) as unknown as PanoUnidireccional[]).sort(porId);
  if (diag.hayErrores) return null;

  // Ids únicos en todo el modelo
  const vistos = new Map<string, string>();
  for (const [clave, objs] of [
    ["plantas", plantas],
    ["materiales", materiales],
    ["secciones", secciones],
    ["pilares", pilares],
    ["vigas", vigas],
    ["apoyos", apoyos],
    ["casos", casos],
    ["cargas", cargas],
    ["losas", losas],
    ["apoyosLineales", apoyosLineales],
    ["bandas", bandas],
    ["muros", muros],
    ["panos", panos],
  ] as const) {
    for (const o of objs) {
      const antes = vistos.get(o.id);
      if (antes) diag.error("fisico/id-duplicado", `El id «${o.id}» está repetido (en ${antes} y en ${clave}): los ids tienen que ser únicos en todo el modelo.`, [o.id]);
      else vistos.set(o.id, clave);
    }
  }
  if (plantas.length === 0) diag.error("fisico/sin-plantas", "El modelo no tiene plantas.");
  if (casos.length === 0) diag.error("fisico/sin-casos", "El modelo no tiene casos de carga.");
  if (diag.hayErrores) return null;

  const mal = (id: string, que: string) => diag.error("fisico/valor-no-valido", `${id}: ${que}.`, [id]);

  // Plantas
  const planta = new Map<string, number>();
  plantas.forEach((p, i) => {
    planta.set(p.id, i);
    if (p.tipo !== undefined && p.tipo !== "cubierta" && p.tipo !== "planta" && p.tipo !== "sotano") mal(p.id, "el tipo de planta tiene que ser cubierta, planta o sotano");
    if (p.altura !== null && !(num(p.altura) && p.altura >= 0)) mal(p.id, "la altura tiene que ser un número ≥ 0 (o null si falta)");
    if (p.diafragma !== undefined && p.diafragma !== "rigido" && p.diafragma !== "ninguno") mal(p.id, "el diafragma tiene que ser rigido o ninguno");
  });

  // Materiales
  const material = new Map<string, Material>();
  for (const m of materiales) {
    material.set(m.id, m);
    const r = m as unknown as Record<string, unknown>;
    if (m.tipo === "hormigon") {
      if (!pos(r.fck)) mal(m.id, "fck tiene que ser un número > 0 (MPa)");
      if (r.nu !== undefined && !(num(r.nu) && (r.nu as number) > -1 && (r.nu as number) < 0.5)) mal(m.id, "ν tiene que estar en (−1, 0,5)");
      if (r.peso !== undefined && !(num(r.peso) && (r.peso as number) >= 0)) mal(m.id, "el peso específico tiene que ser ≥ 0");
    } else if (m.tipo === "acero") {
      if (r.E !== undefined && !pos(r.E)) mal(m.id, "E tiene que ser un número > 0 (MPa)");
      if (r.peso !== undefined && !(num(r.peso) && (r.peso as number) >= 0)) mal(m.id, "el peso específico tiene que ser ≥ 0");
    } else if (m.tipo === "general") {
      if (!pos(r.E) || !pos(r.G)) mal(m.id, "E y G tienen que ser números > 0 (kN/m²)");
      if (!(num(r.peso) && (r.peso as number) >= 0)) mal(m.id, "el peso específico tiene que ser un número ≥ 0 (kN/m³)");
    } else mal((m as { id: string }).id, "el tipo de material tiene que ser hormigon, acero o general");
  }

  // Secciones
  const seccionFisica = new Map<string, Seccion>();
  for (const s of secciones) {
    seccionFisica.set(s.id, s);
    const r = s as unknown as Record<string, unknown>;
    if (typeof r.material !== "string" || !material.has(r.material)) diag.error("fisico/referencia", `${s.id}: el material «${String(r.material)}» no existe.`, [s.id]);
    switch (s.forma) {
      case "rectangular":
        if (!pos(r.b) || !pos(r.h)) mal(s.id, "b y h tienen que ser números > 0 (m)");
        break;
      case "circular":
        if (!pos(r.D)) mal(s.id, "D tiene que ser un número > 0 (m)");
        break;
      case "I": {
        const p = r.perfil as Record<string, unknown> | undefined;
        if (!esObjeto(p) || !["A", "Iy", "Iz", "It", "h", "b", "tf", "tw"].every((k) => pos(p[k]))) mal(s.id, "el perfil necesita A, Iy, Iz, It, h, b, tf y tw > 0 (cm², cm⁴ y mm)");
        break;
      }
      case "T":
        if (![r.bf, r.hf, r.bw, r.h].every(pos)) mal(s.id, "bf, hf, bw y h tienen que ser números > 0 (m)");
        else if (!((r.hf as number) < (r.h as number) && (r.bw as number) <= (r.bf as number))) mal(s.id, "la T necesita hf < h y bw ≤ bf");
        break;
      case "general":
        if (![r.A, r.Iy, r.Iz, r.J].every(pos)) mal(s.id, "A, Iy, Iz y J tienen que ser números > 0");
        for (const k of ["Avy", "Avz", "b", "h"]) if (r[k] !== undefined && !pos(r[k])) mal(s.id, `${k} tiene que ser un número > 0`);
        break;
      default:
        mal((s as { id: string }).id, "la forma tiene que ser rectangular, circular, I, T o general");
    }
  }
  const usaSeccion = (id: string, s: unknown) => {
    if (typeof s !== "string" || !seccionFisica.has(s)) diag.error("fisico/referencia", `${id}: la sección «${String(s)}» no existe.`, [id]);
  };
  const usaPlanta = (id: string, p: unknown, que = "la planta") => {
    if (typeof p !== "string" || !planta.has(p)) {
      diag.error("fisico/referencia", `${id}: ${que} «${String(p)}» no existe.`, [id]);
      return false;
    }
    return true;
  };
  const liberaciones = (id: string, l: unknown, claves: readonly string[]) => {
    if (l === undefined) return;
    if (!esObjeto(l) || Object.keys(l).some((k) => !claves.includes(k)) || claves.some((k) => l[k] !== undefined && !seis(l[k])))
      mal(id, `las liberaciones tienen que ser { ${claves.join(", ")} } con 6 booleanos cada una ([N, Vy, Vz, T, My, Mz])`);
  };

  // Pilares
  for (const p of pilares) {
    if (!num(p.x) || !num(p.y)) mal(p.id, "x e y tienen que ser números (m)");
    const okD = usaPlanta(p.id, p.desde, "la planta de arranque");
    const okH = usaPlanta(p.id, p.hasta, "la planta de cabeza");
    if (okD && okH && !(planta.get(p.desde)! > planta.get(p.hasta)!)) mal(p.id, "la planta de arranque tiene que estar por debajo de la de cabeza");
    usaSeccion(p.id, p.seccion);
    if (p.tramos !== undefined) {
      if (!Array.isArray(p.tramos)) mal(p.id, "los tramos tienen que ser una lista de { planta, seccion }");
      else {
        const vistas = new Set<string>();
        for (const t of p.tramos) {
          if (!esObjeto(t)) {
            mal(p.id, "cada tramo tiene que ser { planta, seccion }");
            continue;
          }
          usaSeccion(p.id, t.seccion);
          if (!usaPlanta(p.id, t.planta, "la planta del tramo")) continue;
          const k = planta.get(t.planta as string)!;
          if (okD && okH && !(k >= planta.get(p.hasta)! && k < planta.get(p.desde)!)) mal(p.id, `el tramo con cabeza en ${String(t.planta)} no está entre su arranque y su cabeza`);
          if (vistas.has(t.planta as string)) mal(p.id, `el tramo con cabeza en ${String(t.planta)} está repetido`);
          vistas.add(t.planta as string);
        }
      }
    }
    if (p.giro !== undefined && !num(p.giro)) mal(p.id, "el giro tiene que ser un número (grados)");
    if (p.base !== undefined && p.base !== "empotrado" && p.base !== "articulado" && p.base !== "ninguno") mal(p.id, "la base tiene que ser empotrado, articulado o ninguno");
    liberaciones(p.id, p.liberaciones, ["base", "cabeza"]);
  }

  // Vigas
  for (const v of vigas) {
    usaPlanta(v.id, v.planta);
    usaSeccion(v.id, v.seccion);
    liberaciones(v.id, v.liberaciones, ["inicio", "fin"]);
    if (v.insercion !== undefined && v.insercion !== "plano" && v.insercion !== "superior") mal(v.id, "la inserción tiene que ser plano o superior");
    if (!Array.isArray(v.puntos) || v.puntos.length < 2 || !v.puntos.every(vec2)) {
      mal(v.id, "los puntos tienen que ser una lista de al menos dos pares [x, y] de números");
      continue;
    }
    for (let k = 1; k < v.puntos.length; k++) {
      const [a, b] = [v.puntos[k - 1]!, v.puntos[k]!];
      if (!(Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) > op.epsGeom)) {
        mal(v.id, `los puntos ${k} y ${k + 1} coinciden`);
        break;
      }
      if (k >= 2) {
        const c = v.puntos[k - 2]!;
        const u = [a[0] - c[0], a[1] - c[1]];
        const w = [b[0] - a[0], b[1] - a[1]];
        const cruz = u[0]! * w[1]! - u[1]! * w[0]!;
        const prod = u[0]! * w[0]! + u[1]! * w[1]!;
        if (prod < 0 && Math.abs(cruz) <= 1e-9 * Math.abs(prod)) {
          mal(v.id, `la polilínea vuelve sobre sí misma en el punto ${k}`);
          break;
        }
      }
    }
  }

  // Apoyos
  for (const a of apoyos) {
    usaPlanta(a.id, a.planta);
    if (!num(a.x) || !num(a.y)) mal(a.id, "x e y tienen que ser números (m)");
    if (!seis(a.coartados) || !a.coartados.some(Boolean)) mal(a.id, "coartados tienen que ser 6 booleanos, con alguno verdadero");
  }

  // Casos y cargas
  const caso = new Map<string, number>();
  casos.forEach((c, i) => caso.set(c.id, i));
  const conPeso = casos.filter((c) => c.pesoPropio === true);
  if (conPeso.length > 1)
    diag.error(
      "caso/peso-propio-repetido",
      `Hay ${conPeso.length} casos con el peso propio (${conPeso.map((c) => c.id).join(", ")}); como mucho, uno.`,
      conPeso.map((c) => c.id),
    );
  const pilarDe = new Map(pilares.map((p) => [p.id, p] as const));
  const vigaDe = new Map(vigas.map((v) => [v.id, v] as const));
  for (const c of cargas) {
    const r = c as unknown as Record<string, unknown>;
    if (typeof r.caso !== "string" || !caso.has(r.caso)) diag.error("fisico/referencia", `${c.id}: el caso «${String(r.caso)}» no existe.`, [c.id]);
    if (c.tipo === "puntual") {
      usaPlanta(c.id, c.planta);
      if (!num(c.x) || !num(c.y)) mal(c.id, "x e y tienen que ser números (m)");
      if ((c.F !== undefined && !vec3(c.F)) || (c.M !== undefined && !vec3(c.M)) || (c.F === undefined && c.M === undefined)) mal(c.id, "la carga puntual necesita F o M, vectores de 3 números");
    } else if (c.tipo === "viga" || c.tipo === "pilar") {
      const destino = c.tipo === "viga" ? r.viga : r.pilar;
      if (typeof destino !== "string" || !(c.tipo === "viga" ? vigaDe : pilarDe).has(destino)) diag.error("fisico/referencia", `${c.id}: ${c.tipo === "viga" ? "la viga" : "el pilar"} «${String(destino)}» no existe.`, [c.id]);
      if (c.ejes !== "global" && c.ejes !== "local") mal(c.id, "los ejes tienen que ser global o local");
      if (!vec3(c.q) || (c.qb !== undefined && !vec3(c.qb))) mal(c.id, "q (y qb) tienen que ser vectores de 3 números (kN/m)");
      if ((c.desde !== undefined && !num(c.desde)) || (c.hasta !== undefined && !num(c.hasta))) mal(c.id, "desde y hasta tienen que ser números (m)");
      else if (c.desde !== undefined && c.hasta !== undefined && !(c.hasta > c.desde)) mal(c.id, "hasta tiene que ser mayor que desde");
    } else if (c.tipo === "superficie") {
      usaPlanta(c.id, c.planta);
      if (!vec3(c.q)) mal(c.id, "q tiene que ser un vector de 3 números (kN/m²)");
      if (c.losa === undefined && c.pano === undefined && c.zona === undefined) mal(c.id, "la carga de superficie necesita una losa, un paño o una zona (o la losa o el paño con una zona)");
      if (c.losa !== undefined && c.pano !== undefined) mal(c.id, "la carga de superficie va sobre una losa o sobre un paño, no sobre los dos");
      if (c.losa !== undefined) {
        const l = losas.find((x) => x.id === c.losa);
        if (!l) diag.error("fisico/referencia", `${c.id}: la losa «${String(c.losa)}» no existe.`, [c.id]);
        else if (l.planta !== c.planta) mal(c.id, `la losa ${l.id} no está en la planta ${String(c.planta)}`);
      }
      if (c.pano !== undefined) {
        const p = panos.find((x) => x.id === c.pano);
        if (!p) diag.error("fisico/referencia", `${c.id}: el paño «${String(c.pano)}» no existe.`, [c.id]);
        else if (p.planta !== c.planta) mal(c.id, `el paño ${p.id} no está en la planta ${String(c.planta)}`);
      }
      if (c.zona !== undefined) {
        const d = poligonoNoValido(c.zona);
        if (d) mal(c.id, `la zona ${d}`);
      }
    } else if (c.tipo === "lineal") {
      usaPlanta(c.id, c.planta);
      if (!vec3(c.q)) mal(c.id, "q tiene que ser un vector de 3 números (kN/m)");
      const d = polilineaNoValida(c.puntos);
      if (d) mal(c.id, d);
    } else if (c.tipo === "empuje") {
      if (typeof r.muro !== "string" || !muros.some((m) => m.id === r.muro)) diag.error("fisico/referencia", `${c.id}: el muro «${String(r.muro)}» no existe.`, [c.id]);
      if (c.lado !== "izquierdo" && c.lado !== "derecho") mal(c.id, "el lado tiene que ser izquierdo o derecho");
      if (![c.z0, c.z1, c.p0, c.p1].every(num)) mal(c.id, "z0, z1, p0 y p1 tienen que ser números (m y kN/m²)");
      else if (!(c.z1 > c.z0)) mal(c.id, "z1 tiene que ser mayor que z0");
    } else mal((c as { id: string }).id, "el tipo de carga tiene que ser puntual, viga, pilar, superficie, lineal o empuje");
  }

  // Losas, apoyos lineales y bandas (C2)
  const losasC: LosaCompilada[] = [];
  for (const l of losas) {
    usaPlanta(l.id, l.planta);
    if (!pos(l.espesor)) mal(l.id, "el espesor tiene que ser un número > 0 (m)");
    if (l.pp !== undefined && !(num(l.pp) && l.pp >= 0)) mal(l.id, "el peso propio pp tiene que ser un número ≥ 0 (kN/m²)");
    if (l.eje1 !== undefined && !num(l.eje1)) mal(l.id, "el eje 1 tiene que ser un número (grados)");
    const m = typeof l.material === "string" ? material.get(l.material) : undefined;
    if (!m) diag.error("fisico/referencia", `${l.id}: el material «${String(l.material)}» no existe.`, [l.id]);
    else if (m.tipo === "acero") mal(l.id, "el material de una losa tiene que ser hormigón o general");
    const dc = poligonoNoValido(l.contorno);
    if (dc) {
      mal(l.id, `el contorno ${dc}`);
      continue;
    }
    if (l.huecos !== undefined && !Array.isArray(l.huecos)) {
      mal(l.id, "los huecos tienen que ser una lista de polígonos");
      continue;
    }
    const huecos = (l.huecos ?? []) as readonly (readonly Vec2[])[];
    let huecosBien = true;
    huecos.forEach((h, i) => {
      const dh = poligonoNoValido(h);
      if (dh) {
        mal(l.id, `el hueco ${i + 1} ${dh}`);
        huecosBien = false;
      } else if (!h.every((q) => puntoEnPoligono(q, l.contorno)) || tocan(h, l.contorno)) {
        mal(l.id, `el hueco ${i + 1} no está dentro del contorno (o lo toca)`);
        huecosBien = false;
      }
    });
    for (let i = 0; i < huecos.length && huecosBien; i++)
      for (let j = i + 1; j < huecos.length; j++)
        if (tocan(huecos[i]!, huecos[j]!) || huecos[i]!.some((q) => puntoEnPoligono(q, huecos[j]!)) || huecos[j]!.some((q) => puntoEnPoligono(q, huecos[i]!))) {
          mal(l.id, `los huecos ${i + 1} y ${j + 1} se solapan o se tocan`);
          huecosBien = false;
        }
    const region: Region = { contorno: l.contorno, huecos };
    const reticular = l.reticular !== undefined && huecosBien ? validarReticular(l, region, mal, op, diag) : undefined;
    if (!huecosBien || !m || m.tipo === "acero" || !pos(l.espesor) || reticular === null) continue;
    const { elastico, peso } = materialElastico(m);
    const nu = elastico.E / (2 * elastico.G) - 1;
    if (!(nu > -1 && nu < 0.5)) {
      mal(l.id, `el material ${m.id} da ν = ${nu.toPrecision(4)} (con E y G), fuera de (−1, 0,5)`);
      continue;
    }
    if (!reticular) {
      losasC.push({ losa: l, region, material: { E: elastico.E, nu, t: l.espesor }, pp: l.pp ?? peso * l.espesor, gamma: peso });
      continue;
    }
    // C4-h y C4-i: multiplicadores (los calculados, con ν = 0; los dados, con el del material) y pesos
    const r = l.reticular!;
    const g = { h: l.espesor, hf: r.capa, bw: r.nervio, s: r.intereje };
    const dados = r.multiplicadores !== undefined;
    const ppAligerada = l.pp ?? peso * volumenReticular(g);
    losasC.push({
      losa: l,
      region,
      material: { E: elastico.E, nu, t: l.espesor },
      pp: ppAligerada,
      gamma: peso,
      reticular: {
        multiplicadores: dados ? { ...r.multiplicadores } : multiplicadoresReticular(g, nu),
        nu: dados ? nu : 0,
        dados,
        ppAligerada,
        ppAbaco: l.pp ?? peso * l.espesor,
        abacos: reticular.abacos,
      },
    });
  }
  // Losas solapadas en una planta
  for (let i = 0; i < losasC.length; i++) {
    for (let j = i + 1; j < losasC.length; j++) {
      const [a, b] = [losasC[i]!, losasC[j]!];
      if (a.losa.planta !== b.losa.planta) continue;
      const A = areaInterseccionRegiones(a.region, b.region);
      if (A > op.epsSnap * op.epsSnap)
        diag.error("losa/solapadas", `Las losas ${a.losa.id} y ${b.losa.id} se solapan en ${A.toPrecision(3)} m² en la planta ${a.losa.planta}.`, [a.losa.id, b.losa.id]);
    }
  }
  // Paños unidireccionales (C4)
  const panosC: PanoCompilado[] = [];
  for (const p of panos) {
    const okP = usaPlanta(p.id, p.planta);
    usaSeccion(p.id, p.seccion);
    const okDir = num(p.direccion);
    const okS = num(p.intereje) && p.intereje > 2 * op.epsSnap;
    const okPp = num(p.pp) && p.pp >= 0;
    if (!okDir) mal(p.id, "la dirección de las viguetas tiene que ser un número (grados)");
    if (!okS) mal(p.id, `el intereje tiene que ser un número mayor que 2·ε_snap (${2 * op.epsSnap} m)`);
    if (!okPp) mal(p.id, "el peso propio pp tiene que ser un número ≥ 0 (kN/m²): incluye las bovedillas, que la sección de la vigueta no conoce");
    const dc = poligonoNoValido(p.contorno);
    if (dc) {
      mal(p.id, `el contorno ${dc}`);
      continue;
    }
    if (p.huecos !== undefined && !Array.isArray(p.huecos)) {
      mal(p.id, "los huecos tienen que ser una lista de polígonos");
      continue;
    }
    const huecos = (p.huecos ?? []) as readonly (readonly Vec2[])[];
    if (!huecosValidos(p.id, p.contorno, huecos, mal)) continue;
    if (!okP || !okDir || !okS || !okPp || typeof p.seccion !== "string" || !seccionFisica.has(p.seccion)) continue;
    const d = direccionGrados(p.direccion);
    panosC.push({ pano: p, region: { contorno: p.contorno, huecos }, k: planta.get(p.planta)!, seccion: null as unknown as SeccionCompilada, d, n: [-d[1], d[0]] });
  }
  // Paños solapados entre sí o con una losa de su planta
  for (let i = 0; i < panosC.length; i++) {
    const a = panosC[i]!;
    for (let j = i + 1; j < panosC.length; j++) {
      const b = panosC[j]!;
      if (a.pano.planta !== b.pano.planta) continue;
      const A = areaInterseccionRegiones(a.region, b.region);
      if (A > op.epsSnap * op.epsSnap) diag.error("pano/solapados", `Los paños ${a.pano.id} y ${b.pano.id} se solapan en ${A.toPrecision(3)} m² en la planta ${a.pano.planta}.`, [a.pano.id, b.pano.id]);
    }
    for (const l of losasC) {
      if (l.losa.planta !== a.pano.planta) continue;
      const A = areaInterseccionRegiones(a.region, l.region);
      if (A > op.epsSnap * op.epsSnap) diag.error("pano/solapado-con-losa", `El paño ${a.pano.id} y la losa ${l.losa.id} se solapan en ${A.toPrecision(3)} m² en la planta ${a.pano.planta}.`, [a.pano.id, l.losa.id]);
    }
  }
  for (const a of apoyosLineales) {
    usaPlanta(a.id, a.planta);
    const d = polilineaNoValida(a.puntos);
    if (d) mal(a.id, d);
    if (!seis(a.coartados) || !a.coartados.some(Boolean)) mal(a.id, "coartados tienen que ser 6 booleanos, con alguno verdadero");
  }
  for (const b of bandas) {
    usaPlanta(b.id, b.planta);
    if (!vec2(b.desde) || !vec2(b.hasta)) mal(b.id, "desde y hasta tienen que ser pares [x, y] de números");
    else if (!(Math.sqrt((b.hasta[0] - b.desde[0]) ** 2 + (b.hasta[1] - b.desde[1]) ** 2) > op.epsGeom)) mal(b.id, "desde y hasta coinciden");
    if (!pos(b.ancho)) mal(b.id, "el ancho tiene que ser un número > 0 (m)");
    if (b.tipo !== undefined && b.tipo !== "pilares" && b.tipo !== "central") mal(b.id, "el tipo tiene que ser \"pilares\" o \"central\"");
    if (b.origen !== undefined && b.origen !== "propuesta" && b.origen !== "usuario") mal(b.id, "el origen tiene que ser \"propuesta\" o \"usuario\"");
  }

  // Muros (C3)
  const murosC: MuroCompilado[] = [];
  for (const w of muros) {
    const okD = usaPlanta(w.id, w.desde, "la planta de la base");
    const okH = usaPlanta(w.id, w.hasta, "la planta de la cabeza");
    if (okD && okH && !(planta.get(w.desde)! > planta.get(w.hasta)!)) mal(w.id, "la planta de la base tiene que estar por debajo de la de cabeza");
    if (!pos(w.espesor)) mal(w.id, "el espesor tiene que ser un número > 0 (m)");
    if (w.base !== undefined && w.base !== "empotrado" && w.base !== "articulado" && w.base !== "ninguno") mal(w.id, "la base tiene que ser empotrado, articulado o ninguno");
    const m = typeof w.material === "string" ? material.get(w.material) : undefined;
    if (!m) diag.error("fisico/referencia", `${w.id}: el material «${String(w.material)}» no existe.`, [w.id]);
    else if (m.tipo === "acero") mal(w.id, "el material de un muro tiene que ser hormigón o general");
    const dp = polilineaNoValida(w.puntos);
    if (dp) {
      mal(w.id, dp);
      continue;
    }
    const s0: number[] = [];
    const largo: number[] = [];
    let s = 0;
    let bien = true;
    for (let k = 1; k < w.puntos.length; k++) {
      const [a, b] = [w.puntos[k - 1]!, w.puntos[k]!];
      const L = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
      if (!(L > 2 * op.epsSnap)) {
        mal(w.id, `el tramo ${k} mide ${L.toPrecision(3)} m, y un tramo de muro tiene que medir más de 2·ε_snap (${2 * op.epsSnap} m)`);
        bien = false;
        break;
      }
      if (k >= 2) {
        const c = w.puntos[k - 2]!;
        const u = [a[0] - c[0], a[1] - c[1]];
        const v = [b[0] - a[0], b[1] - a[1]];
        const cruz = u[0]! * v[1]! - u[1]! * v[0]!;
        const prod = u[0]! * v[0]! + u[1]! * v[1]!;
        if (prod < 0 && Math.abs(cruz) <= 1e-9 * Math.abs(prod)) {
          mal(w.id, `la polilínea vuelve sobre sí misma en el punto ${k}`);
          bien = false;
          break;
        }
      }
      s0.push(s);
      largo.push(L);
      s += L;
    }
    if (!bien) continue;
    const huecos: MuroCompilado["huecos"] = [];
    if (w.huecos !== undefined && !Array.isArray(w.huecos)) mal(w.id, "los huecos tienen que ser una lista de { desde, hasta, z0, z1 }");
    else {
      (w.huecos ?? []).forEach((h, i) => {
        const o = h as unknown;
        if (!esObjeto(o) || ![o.desde, o.hasta, o.z0, o.z1].every(num)) {
          mal(w.id, `el hueco ${i + 1} tiene que ser { desde, hasta, z0, z1 } con números (m)`);
          return;
        }
        if (!(h.hasta - h.desde > op.epsSnap && h.z1 - h.z0 > op.epsSnap)) {
          mal(w.id, `el hueco ${i + 1} tiene que medir más de ε_snap (${op.epsSnap} m) de ancho y de alto`);
          return;
        }
        const t = s0.findIndex((a, k) => h.desde >= a - op.epsGeom && h.hasta <= a + largo[k]! + op.epsGeom);
        if (t < 0) {
          mal(w.id, `el hueco ${i + 1} (de ${h.desde} a ${h.hasta} m) no cae entero en un tramo del muro`);
          return;
        }
        if (h.z0 < -op.epsGeom) {
          mal(w.id, `el hueco ${i + 1} empieza por debajo de la base del muro`);
          return;
        }
        huecos.push({ tramo: t, desde: h.desde, hasta: h.hasta, z0: h.z0, z1: h.z1 });
      });
      for (let i = 0; i < huecos.length; i++)
        for (let j = i + 1; j < huecos.length; j++) {
          const [a, b] = [huecos[i]!, huecos[j]!];
          if (a.tramo === b.tramo && Math.min(a.hasta, b.hasta) - Math.max(a.desde, b.desde) > op.epsGeom && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > op.epsGeom)
            mal(w.id, `los huecos ${i + 1} y ${j + 1} se solapan`);
        }
    }
    if (!m || m.tipo === "acero" || !pos(w.espesor) || !okD || !okH) continue;
    const { elastico, peso } = materialElastico(m);
    const nu = elastico.E / (2 * elastico.G) - 1;
    if (!(nu > -1 && nu < 0.5)) {
      mal(w.id, `el material ${m.id} da ν = ${nu.toPrecision(4)} (con E y G), fuera de (−1, 0,5)`);
      continue;
    }
    murosC.push({ muro: w, material: { E: elastico.E, nu, t: w.espesor }, gamma: peso, kb: planta.get(w.desde)!, kh: planta.get(w.hasta)!, s0, largo, huecos });
  }
  // Muros solapados: tramos casi colineales que comparten una planta (de forjado a forjado)
  for (let i = 0; i < murosC.length; i++)
    for (let j = i + 1; j < murosC.length; j++) {
      const [a, b] = [murosC[i]!, murosC[j]!];
      if (!(a.kh < b.kb && b.kh < a.kb)) continue;
      const sol = solapeMuros(a.muro.puntos, b.muro.puntos, op.epsSnap);
      if (sol > op.epsSnap) diag.error("muro/solapados", `Los muros ${a.muro.id} y ${b.muro.id} se solapan a lo largo de ${sol.toPrecision(3)} m en las mismas plantas.`, [a.muro.id, b.muro.id]);
    }
  for (const w of murosC) {
    for (let k = 1; k < w.muro.puntos.length; k++)
      for (let l = k + 2; l < w.muro.puntos.length; l++) {
        const sol = solapeMuros([w.muro.puntos[k - 1]!, w.muro.puntos[k]!], [w.muro.puntos[l - 1]!, w.muro.puntos[l]!], op.epsSnap);
        if (sol > op.epsSnap) diag.error("muro/solapados", `El muro ${w.muro.id} se solapa consigo mismo (tramos ${k} y ${l}).`, [w.muro.id]);
      }
  }
  if (diag.hayErrores) return null;

  // Cotas: las de las plantas que se usan tienen que poder saberse
  const cotas = cotasPlantas(plantas);
  const usadas = new Map<number, string>();
  const usar = (k: number, id: string) => {
    if (!usadas.has(k)) usadas.set(k, id);
  };
  for (const p of pilares) for (let k = planta.get(p.hasta)!; k <= planta.get(p.desde)!; k++) usar(k, p.id);
  for (const v of vigas) usar(planta.get(v.planta)!, v.id);
  for (const a of apoyos) usar(planta.get(a.planta)!, a.id);
  for (const c of cargas) if (c.tipo === "puntual" || c.tipo === "superficie" || c.tipo === "lineal") usar(planta.get(c.planta)!, c.id);
  for (const o of [...losas, ...apoyosLineales, ...bandas, ...panosC.map((p) => p.pano)]) usar(planta.get(o.planta)!, o.id);
  for (const w of murosC) for (let k = w.kh; k <= w.kb; k++) usar(k, w.muro.id);
  for (const [k, id] of [...usadas].sort((a, b) => a[0] - b[0])) {
    if (cotas[k] === null) {
      const p = plantas[k]!;
      diag.error(
        "planta/sin-cota",
        `No se puede saber la cota de la planta ${p.nombre ?? p.id} (la usa ${id}): falta la altura de alguna planta entre ella y la planta sobre rasante más baja.`,
        [p.id, id],
      );
    }
  }
  if (diag.hayErrores) return null;
  for (const p of pilares) {
    for (let k = planta.get(p.hasta)!; k < planta.get(p.desde)!; k++) {
      if (!(cotas[k]! - cotas[k + 1]! > op.epsGeom)) mal(p.id, `el tramo con cabeza en ${plantas[k]!.id} tiene altura nula`);
    }
  }
  for (const w of murosC) {
    for (let k = w.kh; k < w.kb; k++) if (!(cotas[k]! - cotas[k + 1]! > 2 * op.epsSnap)) mal(w.muro.id, `la planta con cabeza en ${plantas[k]!.id} mide menos de 2·ε_snap de alto`);
    const H = cotas[w.kh]! - cotas[w.kb]!;
    w.huecos.forEach((h, i) => {
      if (h.z1 > H + op.epsGeom) mal(w.muro.id, `el hueco ${i + 1} acaba por encima de la cabeza del muro (${H.toPrecision(4)} m)`);
    });
  }
  if (diag.hayErrores) return null;

  const compiladas = new Map<string, SeccionCompilada>();
  for (const s of secciones) compiladas.set(s.id, compilarSeccion(s, material.get(s.material)!, op.cortante));
  for (const p of panosC) p.seccion = compiladas.get(p.pano.seccion)!;
  return {
    op,
    plantas,
    cotas: cotas.map((c) => c ?? Number.NaN),
    planta,
    plantaBaja: plantas.length - 1,
    secciones: compiladas,
    pilares,
    vigas,
    apoyos,
    casos,
    caso,
    cargas,
    pilarDe,
    vigaDe,
    losas: losasC,
    losaDe: new Map(losasC.map((l) => [l.losa.id, l] as const)),
    apoyosLineales,
    bandas,
    muros: murosC,
    muroDe: new Map(murosC.map((w) => [w.muro.id, w] as const)),
    panos: panosC,
    panoDe: new Map(panosC.map((p) => [p.pano.id, p] as const)),
  };
}

/** ¿Son válidos los huecos de un contorno? (simples, dentro de él sin tocarlo y disjuntos) */
function huecosValidos(id: string, contorno: readonly Vec2[], huecos: readonly (readonly Vec2[])[], mal: (id: string, que: string) => void): boolean {
  let bien = true;
  huecos.forEach((h, i) => {
    const dh = poligonoNoValido(h);
    if (dh) {
      mal(id, `el hueco ${i + 1} ${dh}`);
      bien = false;
    } else if (!h.every((q) => puntoEnPoligono(q, contorno)) || tocan(h, contorno)) {
      mal(id, `el hueco ${i + 1} no está dentro del contorno (o lo toca)`);
      bien = false;
    }
  });
  for (let i = 0; i < huecos.length && bien; i++)
    for (let j = i + 1; j < huecos.length; j++)
      if (tocan(huecos[i]!, huecos[j]!) || huecos[i]!.some((q) => puntoEnPoligono(q, huecos[j]!)) || huecos[j]!.some((q) => puntoEnPoligono(q, huecos[i]!))) {
        mal(id, `los huecos ${i + 1} y ${j + 1} se solapan o se tocan`);
        bien = false;
      }
  return bien;
}

const MULTIPLICADORES = ["f11", "f22", "f12", "m11", "m22", "m12", "v13", "v23"] as const;

/**
 * Comprueba el reticular de una losa (C4): nervios, ábacos y multiplicadores. Devuelve sus ábacos en
 * orden canónico, o null si algo falla.
 */
function validarReticular(l: Losa, region: Region, mal: (id: string, que: string) => void, op: OpcionesResueltas, diag: Diagnosticos): { abacos: Vec2[][] } | null {
  const r = l.reticular as unknown;
  if (!esObjeto(r)) {
    mal(l.id, "el reticular tiene que ser { intereje, nervio, capa, caseton?, abacos?, multiplicadores? }");
    return null;
  }
  let bien = true;
  const no = (que: string) => {
    mal(l.id, que);
    bien = false;
  };
  if (![r.intereje, r.nervio, r.capa].every(pos)) no("el reticular necesita intereje, nervio y capa > 0 (m)");
  else {
    if (!((r.nervio as number) < (r.intereje as number))) no("el nervio del reticular tiene que ser más estrecho que su intereje");
    if (pos(l.espesor) && !((r.capa as number) < l.espesor)) no("la capa de compresión del reticular tiene que ser más delgada que el canto total (el espesor de la losa)");
  }
  if (r.caseton !== undefined && r.caseton !== "perdido" && r.caseton !== "recuperable") no("el casetón del reticular tiene que ser «perdido» o «recuperable»");
  // C4-i: con casetón perdido (por defecto) el peso depende de su material: sólo lo sabe el usuario
  else if ((r.caseton ?? "perdido") === "perdido" && l.pp === undefined)
    diag.error(
      "reticular/sin-pp",
      `${l.id}: un reticular con casetón perdido (el caso por defecto) necesita su peso propio pp, porque depende del material del casetón (C4-i). Dé el pp medio de la losa con los ábacos o, si el casetón es recuperable, ponga caseton: "recuperable" y el peso será el del hormigón.`,
      [l.id],
    );
  if (r.multiplicadores !== undefined) {
    const m = r.multiplicadores;
    if (!esObjeto(m) || Object.keys(m).some((k) => !(MULTIPLICADORES as readonly string[]).includes(k)) || Object.values(m).some((x) => x !== undefined && !(num(x) && x > 0 && x <= 100)))
      no(`los multiplicadores del reticular van por ${MULTIPLICADORES.join(", ")}, cada uno en (0, 100]`);
  }
  const abacos = r.abacos ?? [];
  if (!Array.isArray(abacos)) {
    no("los ábacos tienen que ser una lista de polígonos");
    return null;
  }
  abacos.forEach((a, i) => {
    const d = poligonoNoValido(a);
    if (d) no(`el ábaco ${i + 1} ${d}`);
  });
  if (!bien) return null;
  const ab = abacos as readonly (readonly Vec2[])[];
  for (let i = 0; i < ab.length; i++) {
    const reg: Region = { contorno: ab[i]!, huecos: [] };
    if (!(areaInterseccionRegiones(region, reg) > op.epsSnap * op.epsSnap)) no(`el ábaco ${i + 1} no cae en la losa`);
    for (let j = i + 1; j < ab.length; j++)
      if (areaInterseccionRegiones(reg, { contorno: ab[j]!, huecos: [] }) > op.epsGeom * Math.abs(areaConSigno(ab[i]!))) no(`los ábacos ${i + 1} y ${j + 1} se solapan`);
  }
  return bien ? { abacos: ordenarPoligonos(ab) } : null;
}

/**
 * Longitud que comparten dos polilíneas de muro casi colineales: por cada par de tramos, si los dos
 * extremos de uno están a ≤ ε de la recta del otro, la de sus proyecciones dentro de él.
 */
function solapeMuros(pa: readonly Vec2[], pb: readonly Vec2[], eps: number): number {
  let r = 0;
  for (let i = 1; i < pa.length; i++)
    for (let j = 1; j < pb.length; j++) {
      const [A, B] = [pa[i - 1]!, pa[i]!];
      const L = Math.sqrt((B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2);
      const u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      const pr = (Q: Vec2) => {
        const dx = Q[0] - A[0];
        const dy = Q[1] - A[1];
        return { s: dx * u[0]! + dy * u[1]!, d: Math.abs(dx * u[1]! - dy * u[0]!) };
      };
      const [c, d] = [pr(pb[j - 1]!), pr(pb[j]!)];
      if (c.d > eps || d.d > eps) continue;
      r = Math.max(r, Math.min(L, Math.max(c.s, d.s)) - Math.max(0, Math.min(c.s, d.s)));
    }
  return r;
}
