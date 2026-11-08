/**
 * DO (`docs/fem3d/datos-obra.md` §3.2): aplicar los datos de la obra desde su pantalla. Elegir un
 * material típico que aún no está lo crea en el mismo paso, y, si se pide, las piezas que ya hay de
 * un tipo pasan al material nuevo (DO-c, como al cambiar el hormigón de los pilares en los datos
 * generales de CYPECAD).
 *
 * Qué piezas son de cada tipo, y cuáles cambian: las de ese tipo con un material de su familia
 * (hormigón, o acero en los perfiles) distinto del nuevo.
 * - forjados: las losas, los paños (su vigueta) y las vigas de hormigón;
 * - pilares: los pilares de hormigón (su sección y la de cada tramo);
 * - muros: los muros;
 * - perfiles: los pilares, vigas y barras de acero.
 *
 * El material va en la sección, y una sección puede ser de piezas de dos tipos (un pilar y una
 * viga de 30 × 30): si sólo la usan piezas del tipo, cambia de material; si no, se copia con el
 * material nuevo (o se toma una igual que ya haya) y las piezas del tipo pasan a la copia. Las de
 * los otros tipos no se tocan.
 *
 * Puro: sin IO.
 */
import { FAMILIA_OBRA, TIPOS_OBRA, type ObraProyecto, type TipoObra } from "../agente/obra.ts";
import type { Proyecto } from "../agente/proyecto.ts";
import type { Material, ModeloFisico, Seccion } from "../compilador/fisico.ts";
import { idSeccion, materialPorId, seccionIgual, type UsoSeccion } from "./gestores.ts";
import type { Operacion } from "./operaciones.ts";
import type { Coleccion, Objeto } from "./referencias.ts";

/** Una pieza que lleva sección: su colección, el objeto y los campos de sección que tiene. */
type ConSeccion = { coleccion: "pilares" | "vigas" | "barras" | "panos"; o: Objeto };

const piezasConSeccion = (m: ModeloFisico): ConSeccion[] => [
  ...(m.pilares ?? []).map((o) => ({ coleccion: "pilares" as const, o: o as unknown as Objeto })),
  ...(m.vigas ?? []).map((o) => ({ coleccion: "vigas" as const, o: o as unknown as Objeto })),
  ...(m.barras ?? []).map((o) => ({ coleccion: "barras" as const, o: o as unknown as Objeto })),
  ...(m.panos ?? []).map((o) => ({ coleccion: "panos" as const, o: o as unknown as Objeto })),
];

/** Las secciones que usa una pieza (la suya y, en un pilar, las de sus tramos). */
function seccionesDe(p: ConSeccion): string[] {
  const r = [p.o.seccion as string];
  if (p.coleccion === "pilares") for (const t of (p.o.tramos as { seccion: string }[] | undefined) ?? []) r.push(t.seccion);
  return r;
}

/** La familia de un material del modelo o típico. */
function familiaDe(m: ModeloFisico, id: string): Material["tipo"] | undefined {
  return materialPorId(m, id)?.material.tipo;
}

/** ¿Es la pieza `p` del tipo `t`, con su sección `s`? (un pilar con un tramo de acero es de los dos tipos por tramos). */
function deTipo(m: ModeloFisico, t: TipoObra, coleccion: ConSeccion["coleccion"], s: Seccion | undefined): boolean {
  if (!s) return false;
  const f = familiaDe(m, s.material);
  switch (t) {
    case "pilares":
      return coleccion === "pilares" && f === "hormigon";
    case "forjados":
      return (coleccion === "vigas" || coleccion === "panos") && f === "hormigon";
    case "perfiles":
      return coleccion !== "panos" && f === "acero";
    case "muros":
      return false;
  }
}

/** Las piezas de un tipo que no llevan el material `nuevo` (con un material de su familia): las que cambiaría «Cambiar también las existentes». */
export function piezasACambiar(m: ModeloFisico, tipo: TipoObra, nuevo: string): string[] {
  const familia = FAMILIA_OBRA[tipo];
  const secciones = new Map(m.secciones.map((s) => [s.id, s] as const));
  const r: string[] = [];
  const otro = (mat: string) => mat !== nuevo && familiaDe(m, mat) === familia;
  if (tipo === "forjados") for (const l of m.losas ?? []) if (otro(l.material)) r.push(l.id);
  if (tipo === "muros") for (const w of m.muros ?? []) if (otro(w.material)) r.push(w.id);
  for (const p of piezasConSeccion(m))
    if (seccionesDe(p).some((id) => { const s = secciones.get(id); return deTipo(m, tipo, p.coleccion, s) && otro(s!.material); })) r.push(p.o.id);
  return r;
}

export type AplicacionObra = { ok: true; operaciones: Operacion[]; piezas: number; secciones: number; copias: number } | { ok: false; mensaje: string };

/**
 * Las operaciones que aplican los datos de la obra `obra` al proyecto `p`, en un `lote` de un paso:
 * los materiales típicos elegidos que aún no están, las piezas de los tipos de `existentes` pasadas
 * a su material nuevo y, al final, la operación `obra`.
 */
export function aplicarObra(p: Proyecto, obra: ObraProyecto | null, existentes: readonly TipoObra[] = []): AplicacionObra {
  let m = p.modelo;
  const ops: Operacion[] = [];
  // Los materiales típicos que faltan, una vez cada uno
  for (const t of TIPOS_OBRA) {
    const id = obra?.materiales?.[t];
    if (id === undefined) continue;
    const x = materialPorId(m, id);
    if (!x) return { ok: false, mensaje: `No hay ningún material «${id}».` };
    if (x.material.tipo !== FAMILIA_OBRA[t] && x.material.tipo !== "general")
      return { ok: false, mensaje: `«${id}» no es de ${FAMILIA_OBRA[t] === "acero" ? "acero" : "hormigón"}: no puede ser el material de los ${t}.` };
    if (x.nuevo) {
      ops.push({ op: "crear", coleccion: "materiales", objeto: x.material as unknown as Objeto });
      m = { ...m, materiales: [...m.materiales, x.material] };
    }
  }
  let piezas = 0;
  let nSecciones = 0;
  let copias = 0;
  for (const t of existentes) {
    const nuevo = obra?.materiales?.[t];
    if (nuevo === undefined) continue;
    const r = pasarAMaterial(m, t, nuevo);
    ops.push(...r.operaciones);
    m = r.modelo;
    piezas += r.piezas;
    nSecciones += r.secciones;
    copias += r.copias;
  }
  ops.push({ op: "obra", obra });
  return { ok: true, operaciones: [{ op: "lote", operaciones: ops }], piezas, secciones: nSecciones, copias };
}

/** Pasa las piezas de un tipo al material `nuevo` (ya en el modelo): las operaciones y el modelo que queda. */
function pasarAMaterial(m0: ModeloFisico, tipo: TipoObra, nuevo: string): { operaciones: Operacion[]; modelo: ModeloFisico; piezas: number; secciones: number; copias: number } {
  const familia = FAMILIA_OBRA[tipo];
  const ops: Operacion[] = [];
  let m = m0;
  const cambiar = (coleccion: Coleccion, id: string, objeto: Objeto) => {
    ops.push({ op: "cambiar", coleccion, id, objeto });
    const l = ((m as unknown as Record<string, readonly Objeto[]>)[coleccion] ?? []).map((x) => (x.id === id ? objeto : x));
    m = { ...m, [coleccion]: l } as ModeloFisico;
  };
  const otro = (mat: string) => mat !== nuevo && familiaDe(m0, mat) === familia;
  const afectadas = new Set(piezasACambiar(m0, tipo, nuevo));
  // Losas y muros: el material va en el objeto
  if (tipo === "forjados") for (const l of m0.losas ?? []) if (otro(l.material)) cambiar("losas", l.id, { ...(l as unknown as Objeto), material: nuevo });
  if (tipo === "muros") for (const w of m0.muros ?? []) if (otro(w.material)) cambiar("muros", w.id, { ...(w as unknown as Objeto), material: nuevo });
  // Las secciones de las piezas del tipo: cambia de material si sólo la usan piezas del tipo; si no, una copia
  const secciones = new Map(m0.secciones.map((s) => [s.id, s] as const));
  const delTipo = new Set<string>();
  const deOtros = new Set<string>();
  for (const p of piezasConSeccion(m0))
    for (const id of seccionesDe(p)) {
      const s = secciones.get(id);
      (deTipo(m0, tipo, p.coleccion, s) ? delTipo : deOtros).add(id);
    }
  const destino = new Map<string, string>();
  let nSecciones = 0;
  let copias = 0;
  const uso: UsoSeccion = tipo === "pilares" ? "pilar" : "viga";
  for (const s of m0.secciones) {
    if (!delTipo.has(s.id) || !otro(s.material)) continue;
    const d = { ...s, material: nuevo };
    if (!deOtros.has(s.id)) {
      cambiar("secciones", s.id, d as unknown as Objeto);
      nSecciones++;
      continue;
    }
    const { id: _id, ...datos } = d;
    const igual = seccionIgual(m, datos);
    if (igual) destino.set(s.id, igual.id);
    else {
      const id = idSeccion(m, datos, uso);
      const objeto = { ...datos, id } as unknown as Seccion;
      ops.push({ op: "crear", coleccion: "secciones", objeto: objeto as unknown as Objeto });
      m = { ...m, secciones: [...m.secciones, objeto] };
      destino.set(s.id, id);
      copias++;
    }
  }
  // Las piezas del tipo que usan una sección copiada pasan a la copia (sólo en los campos del tipo)
  if (destino.size)
    for (const p of piezasConSeccion(m0)) {
      const o = p.o;
      const pasa = (id: string) => (deTipo(m0, tipo, p.coleccion, secciones.get(id)) ? (destino.get(id) ?? id) : id);
      const seccion = pasa(o.seccion as string);
      let x: Objeto = seccion === o.seccion ? o : { ...o, seccion };
      if (p.coleccion === "pilares" && Array.isArray(o.tramos)) {
        const tramos = (o.tramos as { planta: string; seccion: string }[]).map((t) => (pasa(t.seccion) === t.seccion ? t : { ...t, seccion: pasa(t.seccion) }));
        if (tramos.some((t, i) => t !== (o.tramos as unknown[])[i])) x = { ...x, tramos };
      }
      if (x !== o) cambiar(p.coleccion, o.id, x);
    }
  return { operaciones: ops, modelo: m, piezas: afectadas.size, secciones: nSecciones, copias };
}
