// GuiasOverlay: overlay reutilizable de las guias de alineacion (UX-2.4) para las
// herramientas de colocacion. Un LineSegments preasignado (hasta 2 segmentos:
// alineacion vertical + horizontal) cuyos vertices se MUTAN por ref en cada move
// (regla #11: cero setState por frame). LineBasicMaterial con opacidad baja en vez
// de LineDashedMaterial (exigiria computeLineDistances en cada mutacion).
//
// Uso (dentro de una Colocacion*):
//   const guias = useGuiasOverlay();
//   ... en onPointerMove: guias.pintar(resultado, cx, cy, z) / guias.ocultar();
//   ... en el JSX: {guias.nodo}
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { BufferGeometry, Float32BufferAttribute, LineSegments } from "three";
import { colorToken } from "./colores";
import type { ResultadoGuias } from "./guiasAlineacion";

// Elevacion sobre la cota (anti z-fight), misma que los marcadores de colocacion.
const GUIA_Z = 0.02;

export interface ControlGuias {
  // Dibuja las guias activas hasta el cursor (cx,cy) a la cota z; null u objeto sin
  // alineaciones las oculta.
  pintar(r: ResultadoGuias | null, cx: number, cy: number, z: number): void;
  ocultar(): void;
  // Nodo R3F a montar en el JSX de la herramienta.
  nodo: ReactNode;
}

export function useGuiasOverlay(): ControlGuias {
  const ref = useRef<LineSegments>(null);
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array(12), 3),
    );
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const color = useMemo(() => colorToken("accentLine"), []);

  const pintar = (
    r: ResultadoGuias | null,
    cx: number,
    cy: number,
    z: number,
  ): void => {
    const ls = ref.current;
    if (!ls) return;
    if (r === null || (r.guiaX === null && r.guiaY === null)) {
      ls.visible = false;
      return;
    }
    const attr = geo.getAttribute("position") as Float32BufferAttribute;
    const arr = attr.array as Float32Array;
    let n = 0;
    if (r.guiaX !== null) {
      const o = n * 6;
      arr[o] = r.guiaX.valor;
      arr[o + 1] = r.guiaX.origen.y;
      arr[o + 2] = z + GUIA_Z;
      arr[o + 3] = r.guiaX.valor;
      arr[o + 4] = cy;
      arr[o + 5] = z + GUIA_Z;
      n++;
    }
    if (r.guiaY !== null) {
      const o = n * 6;
      arr[o] = r.guiaY.origen.x;
      arr[o + 1] = r.guiaY.valor;
      arr[o + 2] = z + GUIA_Z;
      arr[o + 3] = cx;
      arr[o + 4] = r.guiaY.valor;
      arr[o + 5] = z + GUIA_Z;
      n++;
    }
    geo.setDrawRange(0, n * 2);
    attr.needsUpdate = true;
    ls.visible = true;
  };

  const ocultar = (): void => {
    if (ref.current) ref.current.visible = false;
  };

  const nodo = (
    <lineSegments ref={ref} geometry={geo} visible={false} renderOrder={8}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={0.45}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );

  return { pintar, ocultar, nodo };
}
