/**
 * Las vistas abiertas (I2, `docs/fem3d/interfaz.md` §5.4 y §14): la disposición (1, 1|1, 1/1 o 2×2)
 * y, de cada una de las cuatro, su tipo, su planta o su eje, su modo y su cámara. No cambian con el
 * espacio de trabajo. Se recuerdan en el navegador, por proyecto: es una comodidad de quien mira,
 * así que sin almacenamiento todo sigue funcionando.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Camara2D } from "./vista2d.ts";
import type { Camara3D, Modo3D, Proyeccion } from "./vista3d.ts";

export type TipoVista = "planta" | "alzado" | "3d";
export type Disposicion = "1" | "1|1" | "1/1" | "2x2";
export type DibujoPlanta = "modelo" | "diagnosticos" | "malla";

export const DISPOSICIONES: { id: Disposicion; nombre: string; vistas: number; atajo: string }[] = [
  { id: "1", nombre: "Una vista", vistas: 1, atajo: "Ctrl 1" },
  { id: "1|1", nombre: "Dos, lado a lado", vistas: 2, atajo: "Ctrl 2" },
  { id: "1/1", nombre: "Dos, una encima de otra", vistas: 2, atajo: "Ctrl 3" },
  { id: "2x2", nombre: "Cuatro", vistas: 4, atajo: "Ctrl 4" },
];

export const vistasDe = (d: Disposicion): number => DISPOSICIONES.find((x) => x.id === d)!.vistas;

export interface EstadoVista {
  tipo: TipoVista;
  /** La planta que se ve (planta) o la que se resalta (3D). */
  planta: string | null;
  /** El eje del alzado. */
  eje: string | null;
  /** Qué dibuja una planta en Modelo. */
  dibujo: DibujoPlanta;
  modo3d: Modo3D;
  proyeccion: Proyeccion;
  /** La cámara de cada tipo (al cambiar de tipo y volver, se recupera). */
  camaras?: { planta?: Camara2D; alzado?: Camara2D; "3d"?: Camara3D };
}

export interface EstadoVistas {
  disposicion: Disposicion;
  vistas: EstadoVista[];
  activa: number;
}

const base = (tipo: TipoVista): EstadoVista => ({ tipo, planta: null, eje: null, dibujo: "modelo", modo3d: "alambrico", proyeccion: "perspectiva" });

/** Por defecto: una planta; con cuatro, la planta, el 3D y dos alzados. */
export const POR_DEFECTO: EstadoVistas = { disposicion: "1", vistas: [base("planta"), base("3d"), base("alzado"), base("alzado")], activa: 0 };

const CLAVE = "fem-vistas";

function leer(proyecto: string): EstadoVistas | null {
  try {
    const t = localStorage.getItem(`${CLAVE}:${proyecto}`);
    const v = t ? (JSON.parse(t) as EstadoVistas) : null;
    if (!v || !Array.isArray(v.vistas) || v.vistas.length !== 4 || !DISPOSICIONES.some((d) => d.id === v.disposicion)) return null;
    return { ...v, activa: Math.max(0, Math.min(vistasDe(v.disposicion) - 1, v.activa | 0)), vistas: v.vistas.map((x) => ({ ...base(x.tipo), ...x })) };
  } catch {
    return null;
  }
}

function escribir(proyecto: string, v: EstadoVistas) {
  try {
    localStorage.setItem(`${CLAVE}:${proyecto}`, JSON.stringify(v));
  } catch {
    // sin almacenamiento: sólo se pierde el recuerdo
  }
}

export interface Vistas extends EstadoVistas {
  poner: (i: number, cambio: Partial<EstadoVista>) => void;
  setDisposicion: (d: Disposicion) => void;
  activar: (i: number) => void;
  /** Lleva la vista activa a un tipo (o, si hay otra de ese tipo, la activa). */
  irATipo: (t: TipoVista) => void;
  /** Abre el alzado de un eje: en la vista de alzado que haya o, si no, en una segunda vista. */
  abrirAlzado: (eje: string) => void;
}

/** El estado de las vistas de un proyecto (`clave`: su nombre o su fichero). */
export function useEstadoVistas(clave: string): Vistas {
  const [e, setE] = useState<EstadoVistas>(() => leer(clave) ?? POR_DEFECTO);
  const [claveE, setClaveE] = useState(clave);
  if (clave !== claveE) {
    setClaveE(clave);
    setE(leer(clave) ?? POR_DEFECTO);
  }
  useEffect(() => escribir(clave, e), [clave, e]);
  const poner = useCallback((i: number, c: Partial<EstadoVista>) => setE((x) => ({ ...x, vistas: x.vistas.map((v, k) => (k === i ? { ...v, ...c } : v)) })), []);
  const setDisposicion = useCallback((d: Disposicion) => setE((x) => ({ ...x, disposicion: d, activa: Math.min(x.activa, vistasDe(d) - 1) })), []);
  const activar = useCallback((i: number) => setE((x) => (x.activa === i ? x : { ...x, activa: i })), []);
  const irATipo = useCallback(
    (t: TipoVista) =>
      setE((x) => {
        if (x.vistas[x.activa]!.tipo === t) return x;
        const n = vistasDe(x.disposicion);
        const otra = x.vistas.slice(0, n).findIndex((v) => v.tipo === t);
        if (otra >= 0 && n > 1) return { ...x, activa: otra };
        return { ...x, vistas: x.vistas.map((v, k) => (k === x.activa ? { ...v, tipo: t } : v)) };
      }),
    [],
  );
  const abrirAlzado = useCallback(
    (eje: string) =>
      setE((x) => {
        const n = vistasDe(x.disposicion);
        let i = x.vistas.slice(0, n).findIndex((v, k) => v.tipo === "alzado" && k !== x.activa);
        let disposicion = x.disposicion;
        if (i < 0) {
          if (n === 1) {
            disposicion = "1|1";
            i = 1;
          } else i = x.activa === n - 1 ? n - 2 : n - 1;
        }
        return { ...x, disposicion, activa: i, vistas: x.vistas.map((v, k) => (k === i ? { ...v, tipo: "alzado", eje } : v)) };
      }),
    [],
  );
  return useMemo(() => ({ ...e, poner, setDisposicion, activar, irATipo, abrirAlzado }), [e, poner, setDisposicion, activar, irATipo, abrirAlzado]);
}

export const ContextoVistas = createContext<Vistas | null>(null);

export function useVistas(): Vistas {
  const v = useContext(ContextoVistas);
  if (!v) throw new Error("useVistas fuera de <ContextoVistas>");
  return v;
}
