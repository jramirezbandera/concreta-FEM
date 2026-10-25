/**
 * GE (`docs/fem3d/gestores.md` §3.1): «Nueva…» y «Editar…» en los desplegables que eligen una
 * sección, un material (GE1), un caso (GE2) o una planta (GE3) (el inspector, la hoja y la plantilla
 * de dibujo), y el pedido que abre su gestor desde cualquiera de ellos. El gestor (`Gestores.tsx`) se pinta una vez, en `App`.
 *
 * Quien pide desde un campo da `alElegir`: el gestor le pasa el id elegido o creado y lo que hay que
 * crear para tenerlo (`crear`), y él lo junta en un lote con su asignación (un paso de deshacer).
 */
import { useSyncExternalStore } from "react";
import type { FamiliaMaterial, FormaSeccion, UsoSeccion } from "../../../src/editor/gestores.ts";
import { FAMILIA_FORMA } from "../../../src/editor/gestores.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import type { NombreTabla } from "../../../src/editor/tablas.ts";

export type ColeccionGestor = "secciones" | "materiales" | "casos" | "plantas";

export interface PedidoGestor {
  coleccion: ColeccionGestor;
  /** Abrir con ésta elegida («Editar…»). */
  id?: string;
  /** Abrir en «Nueva». */
  nueva?: boolean;
  /** Para qué es la sección nueva (la letra de su id y lo que se propone). */
  uso?: UsoSeccion;
  /** La familia del material que se propone. */
  familia?: FamiliaMaterial;
  /** GE3: la planta junto a la que se añaden las nuevas. */
  planta?: string;
  /** Lo que se rellena: «la sección de P3», «la plantilla de Pilar». */
  para?: string;
  /** Desde un campo: con lo elegido o creado; devuelve el error o null (y entonces se cierra). */
  alElegir?: (id: string, crear: readonly Operacion[]) => string | null;
}

/** El pedido abierto y cuántos van (la clave del gestor: cada pedido lo empieza de nuevo). */
let actual: { pedido: PedidoGestor | null; n: number } = { pedido: null, n: 0 };
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

export function abrirGestor(p: PedidoGestor): void {
  actual = { pedido: p, n: actual.n + 1 };
  avisar();
}

export function cerrarGestor(): void {
  actual = { pedido: null, n: actual.n };
  avisar();
}

export function useGestor(): { pedido: PedidoGestor | null; n: number } {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f);
      return () => void oyentes.delete(f);
    },
    () => actual,
  );
}

/** Los valores de las dos líneas del final (no son ids: un id no puede empezar por «⟨»). */
export const NUEVA = "⟨nueva⟩";
export const EDITAR = "⟨editar⟩";
export const esDelGestor = (v: string): boolean => v === NUEVA || v === EDITAR;

export const NUEVA_TEXTO: Record<ColeccionGestor, string> = { secciones: "Nueva sección", materiales: "Nuevo material", casos: "Nuevo caso", plantas: "Nuevas plantas" };

/** Lo que se rellena, para «Para …» del gestor: «la sección de P3». */
export const ARTICULO: Record<ColeccionGestor, string> = { secciones: "la sección", materiales: "el material", casos: "el caso", plantas: "la planta" };

/** Las líneas de «Nueva sección…» y «Editar “P30x30”…» al final de un desplegable de referencia. */
export function OpcionesGestor({ coleccion, valor }: { coleccion: ColeccionGestor; valor: string }) {
  return (
    <>
      <option disabled value="⟨separador⟩">────────────</option>
      <option value={NUEVA}>{NUEVA_TEXTO[coleccion]}…</option>
      {valor && <option value={EDITAR}>{`Editar «${valor}»…`}</option>}
    </>
  );
}

/** Para qué es lo que se elige en una columna, según su tabla y su fila (lo que se propone al crear). */
export function contextoCampo(tabla: NombreTabla, clave: string, fila: Readonly<Record<string, string>>, coleccion?: ColeccionGestor): Pick<PedidoGestor, "uso" | "familia" | "planta"> {
  if (coleccion === "casos") return {};
  if (coleccion === "plantas") {
    const planta = fila[clave] || fila.planta || fila.hasta || fila.desde;
    return planta ? { planta } : {};
  }
  if (tabla === "pilares") return { uso: "pilar" };
  if (tabla === "vigas") return { uso: "viga" };
  if (tabla === "forjados" && clave === "seccion") return { uso: "vigueta" };
  if (tabla === "secciones") return { familia: FAMILIA_FORMA[fila.forma as FormaSeccion] ?? undefined };
  return { familia: "hormigon" };
}

/** El pedido de un desplegable de referencia cuando se elige una de sus dos líneas. */
export function pedidoCampo(o: { coleccion: ColeccionGestor; eleccion: string; valor: string; tabla: NombreTabla; clave: string; fila: Readonly<Record<string, string>>; para: string; alElegir: PedidoGestor["alElegir"] }): PedidoGestor {
  return {
    coleccion: o.coleccion,
    ...(o.eleccion === EDITAR && o.valor ? { id: o.valor } : { nueva: true }),
    ...contextoCampo(o.tabla, o.clave, o.fila, o.coleccion),
    para: o.para,
    alElegir: o.alElegir,
  };
}
