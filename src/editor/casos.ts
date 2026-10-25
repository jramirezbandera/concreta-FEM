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

/** El ejemplo de §3.4: G + Q de uso A + viento en las cuatro direcciones. */
export const JUEGO_DEFECTO: JuegoCasos = { permanentes: true, cargasMuertas: false, uso: "A", nieve: null, viento: true, sismo: false };

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
