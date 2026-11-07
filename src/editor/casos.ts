/**
 * GE2 (`docs/fem3d/gestores.md` §3.4): los casos de carga típicos del CTE con su acción, ψ,
 * dirección y signo ya puestos, y el juego de «Hipótesis típicas» que los crea de una vez. Como
 * las secciones de GE1, un caso que ya está con la misma acción se reutiliza en vez de duplicarlo.
 *
 * - Los ψ van por su nombre (A-2): `psiDe` les da los números de la tabla 4.2 del DB SE.
 * - El viento en sus cuatro direcciones es una familia excluyente (`"W"`): entra uno por combinación.
 *   El sismo X e Y no: el generador los combina al 100/30 (`docs/fem3d/combinaciones.md`).
 * - El peso propio va, como mucho, a un caso: el típico de permanentes reutiliza el que ya lo lleve.
 *
 * Puro: sin IO.
 */
import type { AccionCaso, CasoFisico, ModeloFisico } from "../compilador/fisico.ts";
import { psiDe, type CategoriaUso, type PsiNombrado } from "../combinaciones/psi.ts";
import { idMaterialLibre } from "./gestores.ts";
import type { Operacion } from "./operaciones.ts";
import type { Objeto } from "./referencias.ts";
import { idCarga } from "./tablas.ts";

/** Un caso típico: el caso que se crea (con su id propuesto) y cómo se presenta. */
export interface CasoTipico {
  clave: string;
  grupo: "Permanentes" | "Uso" | "Nieve" | "Viento" | "Sismo";
  caso: CasoFisico;
}

const USOS: readonly [CategoriaUso, string][] = [
  ["A", "residencial"],
  ["B", "administrativo"],
  ["C", "público"],
  ["D", "comercial"],
  ["E", "tráfico ligero"],
  ["G", "cubierta de mantenimiento"],
];

const viento = (direccion: "X" | "Y", signo: 1 | -1): CasoTipico => {
  const d = `${signo > 0 ? "+" : "-"}${direccion}`;
  return { clave: `W${d}`, grupo: "Viento", caso: { id: `W${d}`, nombre: `Viento ${d}`, accion: { tipo: "W", psi: "viento", familia: "W", direccion, signo } } };
};

/** Los típicos, en el orden en que se ofrecen. */
export const CASOS_TIPICOS: readonly CasoTipico[] = [
  { clave: "G", grupo: "Permanentes", caso: { id: "G", nombre: "Peso propio", pesoPropio: true, accion: { tipo: "G" } } },
  { clave: "CM", grupo: "Permanentes", caso: { id: "CM", nombre: "Cargas muertas", accion: { tipo: "G" } } },
  ...USOS.map(([c, nombre]): CasoTipico => ({ clave: `Q${c}`, grupo: "Uso", caso: { id: `Q${c}`, nombre: `Uso ${c} · ${nombre}`, accion: { tipo: "Q", psi: `uso-${c}` as PsiNombrado } } })),
  { clave: "S", grupo: "Nieve", caso: { id: "S", nombre: "Nieve", accion: { tipo: "S", psi: "nieve-hasta-1000" } } },
  { clave: "S1000", grupo: "Nieve", caso: { id: "S", nombre: "Nieve (más de 1000 m)", accion: { tipo: "S", psi: "nieve-mas-de-1000", duracion: "media" } } },
  viento("X", 1),
  viento("X", -1),
  viento("Y", 1),
  viento("Y", -1),
  { clave: "EX", grupo: "Sismo", caso: { id: "EX", nombre: "Sismo X", accion: { tipo: "E", direccion: "X" } } },
  { clave: "EY", grupo: "Sismo", caso: { id: "EY", nombre: "Sismo Y", accion: { tipo: "E", direccion: "Y" } } },
];

export const casoTipico = (clave: string): CasoTipico | undefined => CASOS_TIPICOS.find((t) => t.clave === clave);

/** Lo que se pide en «Hipótesis típicas». */
export interface JuegoCasos {
  /** El caso del peso propio (G). */
  permanentes: boolean;
  /** Las cargas muertas en un caso aparte (CM). */
  cargasMuertas: boolean;
  uso: CategoriaUso | null;
  /** Por la altitud del emplazamiento. */
  nieve: "hasta-1000" | "mas-de-1000" | null;
  /** En sus cuatro direcciones. */
  viento: boolean;
  /** X e Y. */
  sismo: boolean;
}

/**
 * El ejemplo de §3.4: G + Q de uso A + viento en las cuatro direcciones, y las cargas muertas en CM:
 * el caso del peso propio es del programa (2026-11-05), así que lo que mete el usuario va aparte.
 */
export const JUEGO_DEFECTO: JuegoCasos = { permanentes: true, cargasMuertas: true, uso: "A", nieve: null, viento: true, sismo: false };

/** Los típicos de un juego, en orden. */
export function casosDelJuego(j: JuegoCasos): CasoTipico[] {
  const claves = [
    ...(j.permanentes ? ["G"] : []),
    ...(j.cargasMuertas ? ["CM"] : []),
    ...(j.uso ? [`Q${j.uso}`] : []),
    ...(j.nieve === "hasta-1000" ? ["S"] : j.nieve === "mas-de-1000" ? ["S1000"] : []),
    ...(j.viento ? ["W+X", "W-X", "W+Y", "W-Y"] : []),
    ...(j.sismo ? ["EX", "EY"] : []),
  ];
  return claves.map((k) => casoTipico(k)!);
}

/** Una acción con sus claves en orden, para compararla. */
function clave(a: AccionCaso | undefined): string {
  if (!a) return "";
  return JSON.stringify(Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined).sort(([x], [y]) => x.localeCompare(y))));
}

/** El caso del proyecto que ya es este típico: el del peso propio, o uno con la misma acción. */
export function casoIgual(m: ModeloFisico, c: CasoFisico): CasoFisico | undefined {
  const casos = m.casos ?? [];
  if (c.pesoPropio) return casos.find((x) => x.pesoPropio);
  return casos.find((x) => !x.pesoPropio && clave(x.accion) === clave(c.accion));
}

export type CreacionCasos = { ok: true; ids: string[]; operaciones: Operacion[]; nuevos: string[]; reutilizados: string[] } | { ok: false; mensaje: string };

/**
 * Las operaciones que crean unos típicos (o los dados, con su id), con su id libre, sin los que ya
 * están. `ids` va en el orden pedido, con el reutilizado en lugar del nuevo.
 */
export function crearCasos(m: ModeloFisico, casos: readonly CasoFisico[]): CreacionCasos {
  const operaciones: Operacion[] = [];
  const ids: string[] = [];
  const nuevos: string[] = [];
  const reutilizados: string[] = [];
  let mm = m;
  for (const c of casos) {
    const ya = casoIgual(mm, c);
    if (ya) {
      ids.push(ya.id);
      if (!reutilizados.includes(ya.id) && !nuevos.includes(ya.id)) reutilizados.push(ya.id);
      continue;
    }
    const id = c.id.trim() ? idMaterialLibre(mm, c.id.trim()) : "";
    if (!id) return { ok: false, mensaje: "El caso necesita un id." };
    const objeto: CasoFisico = { ...c, id };
    operaciones.push({ op: "crear", coleccion: "casos", objeto: objeto as unknown as Objeto });
    mm = { ...mm, casos: [...(mm.casos ?? []), objeto] };
    ids.push(id);
    nuevos.push(id);
  }
  return { ok: true, ids, operaciones, nuevos, reutilizados };
}

// ─── El caso del peso propio, sólo del programa ─────────────────────────────────────────────────

/** El caso que lleva el peso propio (como mucho uno). */
export const casoPesoPropio = (m: ModeloFisico): CasoFisico | undefined => (m.casos ?? []).find((c) => c.pesoPropio);

/** Las cargas del usuario en el caso del peso propio: se mezclan con lo que calcula el programa (aviso `sensatez/cargas-en-peso-propio`). */
export function cargasEnPesoPropio(m: ModeloFisico): string[] {
  const pp = casoPesoPropio(m);
  return pp ? (m.cargas ?? []).filter((c) => c.caso === pp.id).map((c) => c.id) : [];
}

/**
 * El caso de cargas muertas al que van las del usuario que no son del peso propio: uno sin
 * `pesoPropio` con la misma acción que el del peso propio (las mismas combinaciones: el CTE toma las
 * permanentes «globalmente», 4.2.2), o el típico CM con esa acción, que se crea. `crear` es la
 * operación que lo crea, si hace falta.
 */
export function casoCargasMuertas(m: ModeloFisico): { id: string; crear: Operacion[] } | null {
  const pp = casoPesoPropio(m);
  if (!pp) return null;
  const tipico = casoTipico("CM")!.caso;
  // De los que tienen su acción, el que se llama de cargas muertas (en el muestrario, CM antes que ET)
  const mismaAccion = (m.casos ?? []).filter((x) => !x.pesoPropio && clave(x.accion) === clave(pp.accion));
  const ya = mismaAccion.find((x) => x.id === tipico.id || /muert/i.test(x.nombre ?? ""));
  if (ya) return { id: ya.id, crear: [] };
  const c = crearCasos(m, [{ ...tipico, ...(pp.accion ? { accion: { ...pp.accion } } : { accion: undefined }) }]);
  if (!c.ok) return null;
  // Sin acción, el caso no lleva el campo (como el del peso propio)
  const crear = c.operaciones.map((o) => (o.op === "crear" && !pp.accion ? { ...o, objeto: Object.fromEntries(Object.entries(o.objeto).filter(([k]) => k !== "accion")) as Objeto } : o));
  return { id: c.ids[0]!, crear };
}

/**
 * «Pasar a Cargas muertas»: las cargas del usuario que están en el caso del peso propio, a su caso de
 * cargas muertas (`casoCargasMuertas`), creándolo si no está; un paso de deshacer. Con la misma
 * acción, las combinaciones dan lo mismo (a la precisión de máquina: se suman los dos casos en vez
 * de uno); los resultados por caso se separan en lo del programa y lo del usuario.
 */
export function separarPesoPropio(m: ModeloFisico): { ok: true; operacion: Operacion; etiqueta: string; destino: string; cargas: string[]; nuevo: boolean } | { ok: false; mensaje: string } {
  const pp = casoPesoPropio(m);
  if (!pp) return { ok: false, mensaje: "Ningún caso lleva el peso propio." };
  const ids = new Set(cargasEnPesoPropio(m));
  if (!ids.size) return { ok: false, mensaje: `El caso ${pp.id} sólo lleva el peso propio: no hay nada que pasar.` };
  const cm = casoCargasMuertas(m);
  if (!cm) return { ok: false, mensaje: "No se ha podido crear el caso de cargas muertas." };
  // Los ids que puso el dibujo por su caso («G-3», UI-2) pasan a los del destino («CM-1»); los demás se quedan
  const automatico = new RegExp(`^${pp.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`);
  const ocupados = new Set<string>();
  const cambios: Operacion[] = (m.cargas ?? [])
    .filter((c) => ids.has(c.id))
    .map((c) => {
      const id = automatico.test(c.id) ? idCarga(m, cm.id, ocupados) : c.id;
      ocupados.add(id);
      return { op: "cambiar", coleccion: "cargas", id: c.id, objeto: { ...c, id, caso: cm.id } as unknown as Objeto };
    });
  // Detrás del caso del peso propio, como en las «Hipótesis típicas»
  const crear = cm.crear.map((o): Operacion => {
    if (o.op !== "crear") return o;
    const i = m.casos.findIndex((c) => c.id === pp.id);
    return { ...o, antesDe: m.casos[i + 1]?.id ?? null };
  });
  const n = ids.size;
  return {
    ok: true,
    operacion: { op: "lote", operaciones: [...crear, ...cambios] },
    etiqueta: `${n} carga${n === 1 ? "" : "s"} de ${pp.id} a ${cm.id}`,
    destino: cm.id,
    cargas: [...ids],
    nuevo: crear.length > 0,
  };
}

const coma = (x: number) => String(x).replace(".", ",");
const DIRECCION = (a: AccionCaso) => `${a.signo === undefined ? "" : a.signo > 0 ? "+" : "-"}${a.direccion ?? ""}`;

/** Lo que es un caso para las combinaciones, en pocas palabras (los desplegables y el gestor). */
export function describirCaso(c: CasoFisico): string {
  const a = c.accion;
  const pp = c.pesoPropio ? "peso propio" : "";
  if (!a) return pp ? `${pp} · sin acción` : "sin acción: fuera de las combinaciones";
  const psi = a.psi === undefined ? "" : typeof a.psi === "string" ? a.psi : `ψ ${coma(a.psi.psi0)}/${coma(a.psi.psi1)}/${coma(a.psi.psi2)}`;
  const partes: string[] = [];
  switch (a.tipo) {
    case "G":
      partes.push(pp || (a.permanente && a.permanente !== "peso" ? `permanente (${a.permanente})` : "permanente"));
      break;
    case "Q":
      partes.push(typeof a.psi === "string" && a.psi.startsWith("uso-") ? `uso ${a.psi.slice(4)}` : "uso");
      break;
    case "S":
      partes.push(a.psi === "nieve-mas-de-1000" ? "nieve > 1000 m" : "nieve");
      break;
    case "W":
      partes.push(`viento ${DIRECCION(a)}`.trim());
      break;
    case "T":
      partes.push("temperatura");
      break;
    case "E":
      partes.push(`sismo ${a.direccion ?? ""}`.trim());
      break;
    case "A":
      partes.push("accidental");
      break;
    case "N":
      partes.push(`nocional ${DIRECCION(a)}${a.derivadoDe ? ` de ${a.derivadoDe}` : ""}`.replace("  ", " "));
      break;
  }
  if (pp && a.tipo !== "G") partes.push(pp);
  if (psi && a.tipo !== "Q" && a.tipo !== "S" && a.tipo !== "W") partes.push(psi);
  if (a.familia) partes.push(`familia ${a.familia}`);
  return `${a.tipo} · ${partes.join(" · ")}`;
}

/** Los ψ de un caso como se usan, «0,7 / 0,5 / 0,3», o null si su acción no los lleva. */
export function psiCaso(c: CasoFisico): string | null {
  const p = c.accion?.psi;
  if (p === undefined) return null;
  const v = psiDe(p);
  return `${coma(v.psi0)} / ${coma(v.psi1)} / ${coma(v.psi2)}`;
}

// ─── El caso de nieve de la obra ────────────────────────────────────────────────────────────────

/**
 * El caso de nieve que pide la altitud de la obra (2026-11-07): si falta, las operaciones que lo
 * crean (el típico «S» o «S1000»); si los de nieve llevan el ψ de la otra altitud, las que se lo
 * cambian (con la duración del típico). null sin altitud, que es la que decide el ψ.
 */
export function propuestaCasoNieve(m: ModeloFisico, psi: "nieve-hasta-1000" | "nieve-mas-de-1000" | null): { estado: "falta" | "ok" | "otro-psi"; casos: string[]; operaciones: Operacion[]; tipico: CasoTipico } | null {
  if (!psi) return null;
  const tipico = casoTipico(psi === "nieve-mas-de-1000" ? "S1000" : "S")!;
  const deNieve = (m.casos ?? []).filter((c) => c.accion?.tipo === "S");
  if (!deNieve.length) {
    const c = crearCasos(m, [tipico.caso]);
    return { estado: "falta", casos: c.ok ? c.nuevos : [], operaciones: c.ok ? c.operaciones : [], tipico };
  }
  const malos = deNieve.filter((c) => (c.accion!.psi === "nieve-hasta-1000" || c.accion!.psi === "nieve-mas-de-1000") && c.accion!.psi !== psi);
  if (!malos.length) return { estado: "ok", casos: deNieve.map((c) => c.id), operaciones: [], tipico };
  const operaciones: Operacion[] = malos.map((c) => {
    const { duracion: _d, ...resto } = c.accion!;
    const accion: AccionCaso = { ...resto, psi, ...(tipico.caso.accion!.duracion ? { duracion: tipico.caso.accion!.duracion } : {}) };
    return { op: "cambiar", coleccion: "casos", id: c.id, objeto: { ...c, accion } as unknown as Objeto };
  });
  return { estado: "otro-psi", casos: malos.map((c) => c.id), operaciones, tipico };
}
