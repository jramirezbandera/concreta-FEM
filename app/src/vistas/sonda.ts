/**
 * El valor bajo el cursor en un 3D (I4, `docs/fem3d/interfaz.md` §15): la vista dice qué hay debajo
 * del cursor quieto (`Objetivo3D`), la pantalla pide su consulta y la sonda enseña lo que contesta.
 * Una respuesta que llega cuando el cursor ya está en otra cosa, o cuando lo que se ve cambió
 * (`clave`), no se enseña.
 */
import { useCallback, useRef, useState } from "react";
import type { Objetivo3D, Sonda } from "./vista3d.ts";

export function useSonda(texto: ((o: Objetivo3D) => Promise<string[] | null> | string[] | null) | null, clave: string): { alPasar: (o: Objetivo3D | null) => void; sonda: Sonda | null } {
  const [sonda, setSonda] = useState<{ s: Sonda; clave: string } | null>(null);
  const turno = useRef(0);
  const actual = useRef({ texto, clave });
  actual.current = { texto, clave };
  const alPasar = useCallback((o: Objetivo3D | null) => {
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

/** «envolvente de ELU (24)» o la combinación: lo que se ve, para la cabecera de una vista. */
export function queCombinaciones(c: { descripcion: string; n: number } | undefined, una?: string | null): string {
  if (!c) return "…";
  return c.n > 1 ? `envolvente de ${c.descripcion} (${c.n})` : (una ?? c.descripcion);
}
