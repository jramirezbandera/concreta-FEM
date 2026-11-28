/**
 * El valor bajo el cursor en un 3D (I4, `docs/fem3d/interfaz.md` §15): la vista dice qué hay debajo
 * del cursor quieto (`Objetivo3D`), la pantalla pide su consulta y la sonda enseña lo que contesta.
 * Una respuesta que llega cuando el cursor ya está en otra cosa, o cuando lo que se ve cambió
 * (`clave`), no se enseña.
 */
import { useCallback, useRef, useState } from "react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { Objetivo3D, Sonda } from "./vista3d.ts";

export function useSonda(texto: ((o: Objetivo3D) => Promise<string[] | null> | string[] | null) | null, clave: string): { alPasar: (o: Objetivo3D | null) => void; sonda: Sonda | null } {
  return useSondaDe(texto, clave);
}

/**
 * VC5: lo mismo con cualquier cosa que tenga un punto: el `Objetivo3D` del 3D o el punto de una vista
 * plana (`useSonda2D`).
 */
export function useSondaDe<O extends { p: P }, P>(texto: ((o: O) => Promise<string[] | null> | string[] | null) | null, clave: string): { alPasar: (o: O | null) => void; sonda: { p: P; lineas: string[] } | null } {
  type S = { p: P; lineas: string[] };
  const [sonda, setSonda] = useState<{ s: S; clave: string } | null>(null);
  const turno = useRef(0);
  const actual = useRef({ texto, clave });
  actual.current = { texto, clave };
  const alPasar = useCallback((o: O | null) => {
    const t = ++turno.current;
    const { texto: f, clave: k } = actual.current;
    if (!o || !f) return setSonda(null);
    void Promise.resolve(f(o)).then(
      (lineas) => {
        if (t !== turno.current) return;
        setSonda(lineas?.length ? { s: { p: o.p, lineas }, clave: k } : null);
      },
      () => t === turno.current && setSonda(null),
    );
  }, []);
  return { alPasar, sonda: sonda && sonda.clave === clave ? sonda.s : null };
}

/** El punto bajo el cursor quieto de una vista plana (m) y la tolerancia de elegir (m). */
export interface PuntoSonda {
  p: Vec2;
  radio: number;
}

/** VC5: la sonda de una vista plana: quien la usa dice las líneas de un punto. */
export function useSonda2D(texto: ((o: PuntoSonda) => Promise<string[] | null> | string[] | null) | null, clave: string): { alPasar: (o: PuntoSonda | null) => void; sonda: { p: Vec2; lineas: string[] } | null } {
  return useSondaDe<PuntoSonda, Vec2>(texto, clave);
}

/** «envolvente de ELU (24)» o la combinación: lo que se ve, para la cabecera de una vista. */
export function queCombinaciones(c: { descripcion: string; n: number } | undefined, una?: string | null): string {
  if (!c) return "…";
  return c.n > 1 ? `envolvente de ${c.descripcion} (${c.n})` : (una ?? c.descripcion);
}
