/** El visor 3D en React: lo monta en un div y lo alimenta por efectos (H41). */
import { useEffect, useRef } from "react";
import { Maximize } from "lucide-react";
import type { Geometria3D } from "../../../src/visor/datos.ts";
import { useTheme } from "../tema/useTheme.ts";
import { Visor3D, type Colores3D } from "./Visor3D.ts";

const COLORES: Record<"light" | "dark", Colores3D> = {
  light: { fondo: "#ffffff", losa: "#c9d6e3", muro: "#9aa5b1", pilar: "#1e293b", viga: "#64748b", vigueta: "#a08a5e", activa: "#0369a1", original: "#94a3b8" },
  dark: { fondo: "#0c0c0e", losa: "#33414f", muro: "#5b6573", pilar: "#d4d6db", viga: "#9aa3ae", vigueta: "#b49a68", activa: "#38bdf8", original: "#5b6575" },
};

interface Props {
  geometria: Geometria3D | null;
  plantaActiva?: string | null;
  deformada?: { u: Float32Array; escala: number } | null;
  titulo: string;
}

export function Vista3D({ geometria, plantaActiva, deformada, titulo }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const visor = useRef<Visor3D | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const v = new Visor3D(el.current!, COLORES[theme]);
    visor.current = v;
    return () => {
      v.destruir();
      visor.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el tema se cambia abajo sin rehacer el visor
  }, []);

  useEffect(() => {
    visor.current?.ponerColores(COLORES[theme]);
  }, [theme]);

  useEffect(() => {
    if (geometria) visor.current?.ponerGeometria(geometria);
  }, [geometria]);

  useEffect(() => {
    const i = plantaActiva && geometria ? geometria.plantas.indexOf(plantaActiva) : -1;
    visor.current?.ponerPlantaActiva(i >= 0 ? i : null);
  }, [plantaActiva, geometria]);

  useEffect(() => {
    visor.current?.ponerDeformada(deformada?.u ?? null, deformada?.escala ?? 1);
  }, [deformada]);

  return (
    <div className="lienzo" role="img" aria-label={titulo}>
      <div ref={el} className="absolute inset-0" />
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded border border-border-main bg-bg-primary/95 px-2 py-0.5 font-mono text-[11px] text-text-secondary">arrastrar: girar · botón derecho: desplazar · rueda: zoom</div>
      <button type="button" className="btn absolute bottom-3 right-3 z-10" onClick={() => visor.current?.encuadrar()} title="Encuadrar el edificio">
        <Maximize size={14} /> Encuadrar
      </button>
    </div>
  );
}
