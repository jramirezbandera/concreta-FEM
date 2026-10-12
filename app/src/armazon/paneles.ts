/**
 * Cómo están los paneles de cada espacio (y modo) de trabajo: el navegador y las propiedades,
 * abiertos o plegados, y el panel inferior, plegado o abierto en una pestaña y con su altura
 * (`docs/fem3d/interfaz.md` §13). Se recuerda en el navegador: es una comodidad de quien mira, no un
 * dato del proyecto, y si el almacenamiento no está (ventana privada) todo sigue funcionando.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export interface EstadoPaneles {
  nav: boolean;
  props: boolean;
  dock: boolean;
  /** Pestaña del panel inferior. */
  pestana: string | null;
  /** Altura del panel inferior abierto, px. */
  alto: number;
}

export const ALTO_DOCK = 280;
const CLAVE = "fem-paneles";

type Mapa = Record<string, Partial<EstadoPaneles>>;

function leer(): Mapa {
  try {
    const t = localStorage.getItem(CLAVE);
    const m = t ? (JSON.parse(t) as unknown) : null;
    return m && typeof m === "object" ? (m as Mapa) : {};
  } catch {
    return {};
  }
}

function escribir(m: Mapa) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(m));
  } catch {
    // sin almacenamiento: sólo se pierde el recuerdo
  }
}

export interface AlmacenPaneles {
  mapa: Mapa;
  cambiar: (clave: string, c: Partial<EstadoPaneles>) => void;
  /** Cómo están ahora (lo recordado o el defecto de su espacio): para la paleta, que los abre o los pliega. */
  vivos: Map<string, EstadoPaneles>;
}

export function useAlmacenPaneles(): AlmacenPaneles {
  const [mapa, setMapa] = useState<Mapa>(leer);
  const [vivos] = useState(() => new Map<string, EstadoPaneles>());
  const cambiar = useCallback((clave: string, c: Partial<EstadoPaneles>) => {
    setMapa((m) => {
      const n = { ...m, [clave]: { ...m[clave], ...c } };
      escribir(n);
      return n;
    });
  }, []);
  return useMemo(() => ({ mapa, cambiar, vivos }), [mapa, cambiar, vivos]);
}

export const ContextoPaneles = createContext<AlmacenPaneles | null>(null);

export interface Paneles extends EstadoPaneles {
  clave: string;
  poner: (c: Partial<EstadoPaneles>) => void;
  /** Abre el panel inferior en una pestaña. */
  abrirPestana: (p: string) => void;
}

/** Los paneles de un espacio: lo recordado o, si no hay, `defecto`. */
export function usePaneles(clave: string, defecto: Partial<EstadoPaneles>): Paneles {
  const a = useContext(ContextoPaneles);
  if (!a) throw new Error("usePaneles fuera de <ContextoPaneles>");
  const r = a.mapa[clave];
  const e: EstadoPaneles = {
    nav: r?.nav ?? defecto.nav ?? true,
    props: r?.props ?? defecto.props ?? true,
    dock: r?.dock ?? defecto.dock ?? false,
    pestana: r?.pestana ?? defecto.pestana ?? null,
    alto: r?.alto ?? defecto.alto ?? ALTO_DOCK,
  };
  a.vivos.set(clave, e);
  const { cambiar } = a;
  const poner = useCallback((c: Partial<EstadoPaneles>) => cambiar(clave, c), [cambiar, clave]);
  const abrirPestana = useCallback((p: string) => cambiar(clave, { dock: true, pestana: p }), [cambiar, clave]);
  return { ...e, clave, poner, abrirPestana };
}

/** Abre las propiedades del espacio que se ve (al elegir un objeto). */
export function useAbrirPropiedades(): (clave: string) => void {
  const a = useContext(ContextoPaneles);
  return useCallback((clave: string) => a?.cambiar(clave, { props: true }), [a]);
}
