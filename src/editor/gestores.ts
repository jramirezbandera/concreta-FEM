/**
 * Los gestores de secciones y materiales (fase GE, `docs/fem3d/gestores.md`): crear una sección o
 * un material de los tipos típicos sin ir a la tabla, con su id propuesto (GE-c), lo que es cada uno
 * en pocas palabras (para los desplegables) y quién lo usa (GE-f). La interfaz sólo pinta lo de aquí.
 *
 * - Una sección o un material nuevo es una lista de operaciones (`crear`), que quien la pide junta
 *   en un `lote` con su asignación: crear y elegir se deshacen de una vez.
 * - Un material típico que aún no está en el proyecto (HA-30, S275…) se crea con la sección que lo usa.
 * - Si ya hay una sección con los mismos datos, se reutiliza en vez de crear otra (GE-c).
 *
 * Puro: sin IO.
 */
import type { Material, ModeloFisico, Seccion } from "../compilador/fisico.ts";
import { compilarSeccion, materialElastico, type SeccionCompilada } from "../compilador/secciones.ts";
import { enCatalogo } from "../secciones/perfiles.ts";
import type { Operacion } from "./operaciones.ts";
import { indiceIds, usos, type Coleccion, type Objeto } from "./referencias.ts";

type SinId<T> = T extends unknown ? Omit<T, "id"> : never;
/** Una sección sin su id: lo que se rellena en el gestor. */
export type DatosSeccion = SinId<Seccion>;
export type FormaSeccion = Seccion["forma"];

/** Para qué se crea una sección: da la letra de su id y lo que se propone. */
export type UsoSeccion = "pilar" | "viga" | "vigueta";

/** La familia de material que pide cada forma por defecto. */
export type FamiliaMaterial = "hormigon" | "acero";
export const FAMILIA_FORMA: Record<FormaSeccion, FamiliaMaterial | null> = { rectangular: "hormigon", circular: "hormigon", T: "hormigon", I: "acero", general: null };

/**
 * Los materiales típicos (GE-e): hormigones del Código Estructural y aceros S. Del acero, el grado
 * sólo va en el nombre: el cálculo es elástico y su E es el mismo (210 000 MPa).
 */
export const MATERIALES_TIPICOS: readonly Material[] = [
  ...[25, 30, 35, 40, 45, 50].map((fck): Material => ({ id: `HA-${fck}`, tipo: "hormigon", fck })),
  ...["S235", "S275", "S355"].map((id): Material => ({ id, tipo: "acero" })),
];
const TIPICO_FAMILIA: Record<FamiliaMaterial, string> = { hormigon: "HA-30", acero: "S275" };

/** Lo que se propone al crear una sección para un uso, en m. */
export function seccionPropuesta(forma: FormaSeccion, uso: UsoSeccion | null, material: string): DatosSeccion {
  switch (forma) {
    case "rectangular":
      return uso === "pilar" ? { material, forma, b: 0.3, h: 0.3 } : { material, forma, b: 0.3, h: 0.5 };
    case "circular":
      return { material, forma, D: 0.4 };
    case "T":
      // La vigueta de un unidireccional: la T bruta de 70 cm de intereje, 25 + 5
      return uso === "vigueta" ? { material, forma, bf: 0.7, hf: 0.05, bw: 0.12, h: 0.3 } : { material, forma, bf: 0.6, hf: 0.15, bw: 0.3, h: 0.5 };
    case "I":
      // IPE 300 (catálogo)
      return { material, forma, perfil: { A: 53.8, Iy: 8356, Iz: 603.8, It: 20.1, h: 300, b: 150, tf: 10.7, tw: 7.1 } };
    case "general":
      return { material, forma, A: 0.09, Iy: 0.000675, Iz: 0.000675, J: 0.00114 };
  }
}

/** La forma que se propone para un uso. */
export const formaPropuesta = (uso: UsoSeccion | null): FormaSeccion => (uso === "vigueta" ? "T" : "rectangular");

// ─── Textos ─────────────────────────────────────────────────────────────────────────────────────

/** m → cm, sin el ruido de la coma flotante (0,3 · 100 = 30,000000000000004). */
const enCm = (v: number): number => Number((v * 100).toPrecision(12));
/** Un número como en las tablas: con coma decimal. */
const coma = (v: number): string => String(v).replace(".", ",");
/** Un número para un id: con punto (la coma separa en algunas listas). */
const punto = (v: number): string => String(v);

/** Una sección en pocas palabras, sin su id: «rect. 30 × 50 · HA-30», «IPE300 · S275». */
export function describirSeccion(s: DatosSeccion): string {
  const cm = (v: number) => coma(enCm(v));
  const forma = (() => {
    switch (s.forma) {
      case "rectangular":
        return `rect. ${cm(s.b)} × ${cm(s.h)}`;
      case "circular":
        return `circ. Ø ${cm(s.D)}`;
      case "T":
        return `T ${cm(s.bf)} × ${cm(s.h)}, alma ${cm(s.bw)}`;
      case "I": {
        const c = enCatalogo(s.perfil);
        return c ? `${c.serie} ${c.tamano}` : `perfil I ${coma(s.perfil.h)} × ${coma(s.perfil.b)} mm`;
      }
      case "general":
        return `general, A ${coma(Number(s.A.toPrecision(4)))} m²`;
    }
  })();
  return `${forma} · ${s.material}`;
}

/** Un material en pocas palabras: «hormigón, fck 30», «acero», «general, E 3e7». */
export function describirMaterial(m: Material): string {
  switch (m.tipo) {
    case "hormigon":
      return `hormigón, fck ${coma(m.fck)}`;
    case "acero":
      return m.E === undefined ? "acero" : `acero, E ${coma(m.E)} MPa`;
    case "general":
      return `general, E ${coma(m.E)} kN/m²`;
  }
}

/** La parte de un id que dice lo que es (sin el «-2» de los repetidos). */
function raizId(d: DatosSeccion, uso: UsoSeccion | null): string | null {
  const cm = (v: number) => punto(enCm(v));
  switch (d.forma) {
    case "rectangular":
      return `${uso === "pilar" ? "P" : "V"}${cm(d.b)}x${cm(d.h)}`;
    case "circular":
      return `C${cm(d.D)}`;
    case "T":
      return `T${cm(d.bf)}x${cm(d.h)}`;
    case "I":
      return enCatalogo(d.perfil)?.id ?? `I${punto(d.perfil.h)}x${punto(d.perfil.b)}`;
    case "general":
      return null;
  }
}

/**
 * El id que se propone para una sección nueva (GE-c): «P30x30», «V30x50», «C40», «T60x50»,
 * «IPE300» o «S<n>»; si ya está ocupado por otra cosa, con «-2», «-3»…
 */
export function idSeccion(m: ModeloFisico, d: DatosSeccion, uso: UsoSeccion | null): string {
  const ocupados = indiceIds(m);
  const raiz = raizId(d, uso);
  if (raiz === null) {
    for (let i = 1; ; i++) if (!ocupados.has(`S${i}`)) return `S${i}`;
  }
  if (!ocupados.has(raiz)) return raiz;
  for (let i = 2; ; i++) if (!ocupados.has(`${raiz}-${i}`)) return `${raiz}-${i}`;
}

// ─── Igualdad y búsqueda ────────────────────────────────────────────────────────────────────────

/** El objeto sin su id, con las claves ordenadas: dos secciones con los mismos datos dan el mismo texto. */
function firma(o: object): string {
  const ordenar = (v: unknown): unknown => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k, x]) => k !== "id" && x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, ordenar(x)])) : v);
  return JSON.stringify(ordenar(o));
}

/** La sección del proyecto con estos mismos datos (también el material), o undefined. */
export function seccionIgual(m: ModeloFisico, d: DatosSeccion): Seccion | undefined {
  const f = firma(d);
  return m.secciones.find((s) => firma(s) === f);
}

/** Los materiales que se pueden elegir: los del proyecto y, detrás, los típicos que aún no tiene (`nuevo`). */
export function materialesElegibles(m: ModeloFisico): { material: Material; nuevo: boolean }[] {
  const hay = new Set(m.materiales.map((x) => x.id));
  return [...m.materiales.map((material) => ({ material, nuevo: false })), ...MATERIALES_TIPICOS.filter((x) => !hay.has(x.id)).map((material) => ({ material, nuevo: true }))];
}

/** Un material del proyecto o, si no, uno típico con ese id (que se creará al usarlo). */
export function materialPorId(m: ModeloFisico, id: string): { material: Material; nuevo: boolean } | undefined {
  const x = m.materiales.find((y) => y.id === id);
  if (x) return { material: x, nuevo: false };
  const t = MATERIALES_TIPICOS.find((y) => y.id === id);
  return t ? { material: t, nuevo: true } : undefined;
}

/**
 * El material que se propone para una familia: el más usado de ese tipo por las secciones, las losas
 * y los muros; si no hay ninguno usado, el primero de ese tipo; si no hay, el típico (HA-30, S275).
 * Sin familia (una sección general), el más usado de todos, o el primero.
 */
export function materialPropuesto(m: ModeloFisico, familia: FamiliaMaterial | null): string {
  const n = new Map<string, number>();
  for (const o of [...m.secciones, ...(m.losas ?? []), ...(m.muros ?? [])] as { material?: string }[]) if (o.material) n.set(o.material, (n.get(o.material) ?? 0) + 1);
  const deFamilia = m.materiales.filter((x) => familia === null || x.tipo === familia);
  let mejor: string | undefined;
  for (const x of deFamilia) if ((n.get(x.id) ?? 0) > 0 && (!mejor || n.get(x.id)! > n.get(mejor)!)) mejor = x.id;
  return mejor ?? deFamilia[0]?.id ?? TIPICO_FAMILIA[familia ?? "hormigon"];
}

// ─── Operaciones ────────────────────────────────────────────────────────────────────────────────

export type Creacion = { ok: true; id: string; operaciones: Operacion[]; reutilizada: boolean } | { ok: false; mensaje: string };

/** Las operaciones que hacen falta para que el material `id` esté en el proyecto (crear el típico, si no está). */
function asegurarMaterial(m: ModeloFisico, id: string): Operacion[] | string {
  const x = materialPorId(m, id);
  if (!x) return `No hay ningún material «${id}».`;
  return x.nuevo ? [{ op: "crear", coleccion: "materiales", objeto: x.material as unknown as Objeto }] : [];
}

/**
 * Lo que crea una sección nueva: su material, si es un típico que aún no está, y la sección. Sin
 * `id`, el propuesto; y si ya hay una con los mismos datos, ésa (sin operaciones).
 */
export function crearSeccion(m: ModeloFisico, d: DatosSeccion, o: { id?: string; uso?: UsoSeccion | null } = {}): Creacion {
  const id = o.id?.trim();
  if (!id) {
    const igual = seccionIgual(m, d);
    if (igual) return { ok: true, id: igual.id, operaciones: [], reutilizada: true };
  } else if (indiceIds(m).has(id)) return { ok: false, mensaje: `Ya hay un objeto «${id}» en el proyecto.` };
  const mat = asegurarMaterial(m, d.material);
  if (typeof mat === "string") return { ok: false, mensaje: mat };
  const nuevo = id || idSeccion(m, d, o.uso ?? null);
  return { ok: true, id: nuevo, operaciones: [...mat, { op: "crear", coleccion: "secciones", objeto: { id: nuevo, ...d } as unknown as Objeto }], reutilizada: false };
}

/**
 * Lo que cambia la sección `id` por `d` (con `nuevoId`, también su id: sus referencias lo siguen).
 * Cambia todos los objetos que la usan (GE-f).
 */
export function cambiarSeccion(m: ModeloFisico, id: string, d: DatosSeccion, nuevoId?: string): Creacion {
  if (!m.secciones.some((s) => s.id === id)) return { ok: false, mensaje: `No hay ninguna sección «${id}».` };
  const destino = nuevoId?.trim() || id;
  if (destino !== id && indiceIds(m).has(destino)) return { ok: false, mensaje: `Ya hay un objeto «${destino}» en el proyecto.` };
  const mat = asegurarMaterial(m, d.material);
  if (typeof mat === "string") return { ok: false, mensaje: mat };
  return { ok: true, id: destino, operaciones: [...mat, { op: "cambiar", coleccion: "secciones", id, objeto: { id: destino, ...d } as unknown as Objeto }], reutilizada: false };
}

/** Lo que crea un material nuevo (el id, el suyo si está libre). */
export function crearMaterial(m: ModeloFisico, mat: Material): Creacion {
  const id = mat.id.trim();
  if (!id) return { ok: false, mensaje: "Falta el id." };
  if (indiceIds(m).has(id)) return { ok: false, mensaje: `Ya hay un objeto «${id}» en el proyecto.` };
  return { ok: true, id, operaciones: [{ op: "crear", coleccion: "materiales", objeto: { ...mat, id } as unknown as Objeto }], reutilizada: false };
}

/** Un id libre para un material típico que ya está: «HA-30-2». */
export function idMaterialLibre(m: ModeloFisico, base: string): string {
  const ocupados = indiceIds(m);
  if (!ocupados.has(base)) return base;
  for (let i = 2; ; i++) if (!ocupados.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Una lista de operaciones como una sola (sin lote si es una). */
export const comoUna = (ops: readonly Operacion[]): Operacion => (ops.length === 1 ? ops[0]! : { op: "lote", operaciones: ops });

// ─── Usos y propiedades ─────────────────────────────────────────────────────────────────────────

const PLURAL: Partial<Record<Coleccion, [string, string]>> = {
  pilares: ["pilar", "pilares"],
  vigas: ["viga", "vigas"],
  losas: ["losa", "losas"],
  panos: ["paño", "paños"],
  muros: ["muro", "muros"],
  secciones: ["sección", "secciones"],
  materiales: ["material", "materiales"],
  // GE2 y GE3: lo que usa un caso o una planta
  casos: ["caso", "casos"],
  cargas: ["carga", "cargas"],
  apoyos: ["apoyo", "apoyos"],
  apoyosLineales: ["apoyo lineal", "apoyos lineales"],
  bandas: ["banda", "bandas"],
};

/** Quién usa un objeto, por colección: [{ coleccion, n }], en el orden de las colecciones. */
export function usosDe(m: ModeloFisico, id: string): { coleccion: Coleccion; n: number }[] {
  const n = new Map<Coleccion, Set<string>>();
  for (const u of usos(m, new Set([id]))) {
    if (!n.has(u.coleccion)) n.set(u.coleccion, new Set());
    n.get(u.coleccion)!.add(u.id);
  }
  return [...n].map(([coleccion, s]) => ({ coleccion, n: s.size }));
}

/** «24 pilares y 3 vigas»; «ningún objeto» si no lo usa nadie. */
export function textoUsos(u: readonly { coleccion: Coleccion; n: number }[]): string {
  if (!u.length) return "ningún objeto";
  const partes = u.map(({ coleccion, n }) => {
    const [uno, varios] = PLURAL[coleccion] ?? [coleccion, coleccion];
    return `${n} ${n === 1 ? uno : varios}`;
  });
  return partes.length === 1 ? partes[0]! : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}

/**
 * Las propiedades de una sección como las usa el compilador (`compilarSeccion`, con las áreas de
 * cortante), o null si su material no está ni es típico o los datos no valen.
 */
export function propiedadesSeccion(m: ModeloFisico, d: DatosSeccion): SeccionCompilada | null {
  const mat = materialPorId(m, d.material);
  if (!mat) return null;
  try {
    const r = compilarSeccion({ id: "", ...d } as Seccion, mat.material, true);
    return Object.values(r.barra).every((v) => Number.isFinite(v)) ? r : null;
  } catch {
    return null;
  }
}

/** E y G del material (kN/m²) y su peso específico, como los usa el compilador (el Ecm de CY-a). */
export const propiedadesMaterial = (mat: Material): { E: number; G: number; peso: number } => {
  const { elastico, peso } = materialElastico(mat);
  return { E: elastico.E, G: elastico.G, peso };
};
