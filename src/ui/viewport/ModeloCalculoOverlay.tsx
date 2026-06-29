// ModeloCalculoOverlay: dibuja la Capa 2 (modelo de calculo) semitransparente sobre la
// obra (F2c, "Ver modelo de calculo"). Overlay R3F ESTATICO (sin useFrame: el modelo de
// calculo no vibra) inyectado por sceneOverlays. Espejo del patron de CentroMasaOverlay:
// useSyncExternalStore + useMemo (derivacion pura) + invalidate() (frameloop="demand").
//
// VISIBILIDAD: solo con el toggle `mostrarModeloCalculo` encendido Y en vista pleno
// (3D o mosaico, `!== "planta"`: el modelo de calculo se aprecia sobre el edificio
// completo; en planta se descuadraria). Mismo criterio que el control y el gating de App.
// La fuente del ModeloFEM (resultados vigentes o discretizar puro) la decide
// useFuenteModeloCalculo, que SOLO discretiza cuando el overlay esta activo.
//
// COLORES/FORMAS: barras en --barra-calc (las que tienen release, en --release-calc);
// nudos como puntos; apoyos y releases como GLIFOS distinguidos por FORMA ademas de
// color (colorblind-safe). Vista simplificada de apoyos (Issue 7-B): empotrado=cuadrado,
// articulado=triangulo, otro=circulo. Semitransparente + depthWrite=false: no z-fightea
// con la obra.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invalidate } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { BufferGeometry, Float32BufferAttribute, type Color } from "three";
import { vistaStore } from "../../estado";
import { colorToken, hexToken } from "./colores";
import { useFuenteModeloCalculo } from "./modeloCalculoFuente";
import {
  modeloCalculoGeometria,
  type TipoApoyo,
} from "./modeloCalculoGeometria";
import { buffersBarras, buffersNudos, type RGB } from "./modeloCalculoBuffers";
import type { Vec3Escena } from "./ejesEscena";

// Tamanos de los glifos (m) y opacidades del overlay.
const GLIFO_R = 0.22;
const OPACIDAD_BARRA = 0.6;
const OPACIDAD_GLIFO = 0.85;
const PUNTO_PX = 5;

// Visible: toggle encendido Y vista 3D. useSyncExternalStore (re-render solo al cambiar
// el toggle o el modo, nunca por frame).
function useModeloCalculoVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const offT = vistaStore.subscribe((s) => s.mostrarModeloCalculo, cb);
      const offM = vistaStore.subscribe((s) => s.modoVista, cb);
      return () => {
        offT();
        offM();
      };
    },
    () => {
      const s = vistaStore.getState();
      // "pleno" = cualquier vista que NO sea planta (3D y mosaico comparten la escena
      // 3D); mismo criterio que el control y el gating de App, para que mosaico no quede
      // como un 3D-pleno sin overlay.
      return s.mostrarModeloCalculo && s.modoVista !== "planta";
    },
    () => false,
  );
}

const rgb = (c: Color): RGB => [c.r, c.g, c.b];

// Glifos de apoyo (en el plano XY local, centrados en el origen; los posiciona el group).
function puntosGlifoApoyo(tipo: TipoApoyo): [number, number, number][] {
  const r = GLIFO_R;
  if (tipo === "empotrado") {
    return [
      [-r, -r, 0],
      [r, -r, 0],
      [r, r, 0],
      [-r, r, 0],
      [-r, -r, 0],
    ];
  }
  if (tipo === "articulado") {
    const h = r * 0.87;
    return [
      [0, r, 0],
      [h, -r * 0.5, 0],
      [-h, -r * 0.5, 0],
      [0, r, 0],
    ];
  }
  return puntosCirculo(r); // "otro": circulo
}

function puntosCirculo(r: number, seg = 20): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r, 0]);
  }
  return pts;
}

export function ModeloCalculoOverlay() {
  const visible = useModeloCalculoVisible();
  // La fuente solo discretiza cuando `visible` (activo): no rediscretiza con el toggle off.
  const fuente = useFuenteModeloCalculo(visible);
  const modeloFEM = fuente.estado === "ok" ? fuente.modeloFEM : null;

  const colBarra = useMemo(() => colorToken("barraCalc"), []);
  const colRelease = useMemo(() => colorToken("releaseCalc"), []);
  const hexNodo = useMemo(() => hexToken("nodoCalc"), []);
  const hexApoyo = useMemo(() => hexToken("apoyoCalc"), []);
  const hexRelease = useMemo(() => hexToken("releaseCalc"), []);
  const circuloRelease = useMemo(() => puntosCirculo(GLIFO_R * 0.7), []);

  const geo = useMemo(() => modeloCalculoGeometria(modeloFEM), [modeloFEM]);

  const geomBarras = useMemo(() => {
    const g = new BufferGeometry();
    const { posiciones, colores } = buffersBarras(geo.barras, rgb(colBarra), rgb(colRelease));
    g.setAttribute("position", new Float32BufferAttribute(posiciones, 3));
    g.setAttribute("color", new Float32BufferAttribute(colores, 3));
    return g;
  }, [geo, colBarra, colRelease]);

  const geomNudos = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(buffersNudos(geo.nudos), 3));
    return g;
  }, [geo]);

  // Pinta un frame al cambiar (frameloop="demand"); libera las geometrias al reemplazarlas.
  useEffect(() => {
    invalidate();
    return () => {
      geomBarras.dispose();
      geomNudos.dispose();
    };
  }, [geomBarras, geomNudos]);

  if (!visible || fuente.estado !== "ok") return null;

  return (
    <group>
      {geo.barras.length > 0 && (
        <lineSegments geometry={geomBarras}>
          <lineBasicMaterial
            vertexColors
            transparent
            opacity={OPACIDAD_BARRA}
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>
      )}
      {geo.nudos.length > 0 && (
        <points geometry={geomNudos}>
          <pointsMaterial
            color={hexNodo}
            size={PUNTO_PX}
            sizeAttenuation={false}
            transparent
            opacity={OPACIDAD_GLIFO}
            depthWrite={false}
            toneMapped={false}
          />
        </points>
      )}
      {geo.apoyos.map((a, i) => (
        <GlifoEnPunto
          key={`apoyo-${i}`}
          p={a.p}
          puntos={puntosGlifoApoyo(a.tipo)}
          color={hexApoyo}
        />
      ))}
      {geo.releases.map((p, i) => (
        <GlifoEnPunto key={`rel-${i}`} p={p} puntos={circuloRelease} color={hexRelease} />
      ))}
    </group>
  );
}

// Un glifo (polilinea) posicionado en un punto de escena.
function GlifoEnPunto({
  p,
  puntos,
  color,
}: {
  p: Vec3Escena;
  puntos: [number, number, number][];
  color: string;
}) {
  return (
    <group position={p}>
      <Line points={puntos} color={color} lineWidth={1.5} transparent opacity={OPACIDAD_GLIFO} />
    </group>
  );
}
