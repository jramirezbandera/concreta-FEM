// PanoRayado: rayado de DIRECCION de las viguetas de un forjado UNIDIRECCIONAL (F3, corte
// "unidireccional"), calcado al patron CYPECAD. Lineas paralelas semitransparentes DENTRO
// del rectangulo del paño, en la direccion `direccionViguetas`, repartidas al intereje
// REAL (s = B/n, mismo criterio que el discretizador). Comunica en que direccion trabaja
// el forjado. Se dibuja junto a la huella (PanoHuella), en planta y en 3D.
//
// RENDIMIENTO (regla #11, igual que PanoHuella):
//  - La geometria (lineSegments) se calcula con `verticesRayado` (modulo PURO) y se
//    MEMOIZA por [contorno, direccion, intereje]; nunca se recomputa por frame.
//  - No participa en el picking: es solo lectura visual de la geometria de obra (el blanco
//    de picking sigue siendo la huella). Sin onPointer*, sin stopPropagation.
//  - frameloop="demand": invalidate() SOLO al construir/reemplazar la geometria.
//
// SIN jerga FEM: no rotula nudos ni members; solo dibuja lineas. El termino de obra es
// "viguetas" (no "member"/"barra").
import { useEffect, useMemo } from "react";
import { invalidate } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { colorToken } from "./colores";
import type { GeometriaModelo as GeoModelo } from "./hooks/useGeometriaModelo";
import { verticesRayado } from "./panoRayadoGeometria";

// Epsilon en Z para que el rayado quede SOBRE la huella (que ya esta en cota+PANO_Z_EPS),
// visible en planta cenital sin z-fightear con el relleno.
const RAYADO_Z_EPS = 0.02;

// Opacidad del rayado: translucido para leerse como huella (la obra se ve a traves).
// Atenuado (UX-1.4): baja aun mas (el paño es contexto, no protagonista de la pestana).
const OPACIDAD_PLENO = 0.5;
const OPACIDAD_ATENUADO = 0.18;

function PanoRayadoUno({
  pano,
  atenuado,
}: {
  pano: GeoModelo["panos"][number];
  atenuado: boolean;
}) {
  // Color del rayado: token propio del paño (--pano-line), la variante de linea del
  // relleno --pano; coherente con el mapa color->elemento (§1.3). Atenuado: gris de
  // rejilla, mismo criterio que la huella/pilares/vigas.
  const colPleno = useMemo(() => colorToken("panoLine"), []);
  const colAtenuado = useMemo(() => colorToken("canvasGrid2"), []);
  const color = atenuado ? colAtenuado : colPleno;
  const opacidad = atenuado ? OPACIDAD_ATENUADO : OPACIDAD_PLENO;

  // Geometria de las lineas (pares consecutivos -> lineSegments). Memoizada por lo que
  // el rayado depende: contorno (bbox), direccion e intereje (regla #11). Si el paño no
  // trae direccion/intereje (no deberia bajo unidireccional, pero el snapshot los marca
  // opcionales), no hay geometria -> no se dibuja.
  const geom = useMemo(() => {
    if (!pano.direccionViguetas || !(pano.intereje && pano.intereje > 0)) return null;
    const v2d = verticesRayado({
      contorno: pano.contorno,
      direccion: pano.direccionViguetas,
      intereje: pano.intereje,
    });
    if (v2d.length === 0) return null;
    // v2d = [x0,y0,x1,y1,...] en planta; a 3D en la cota del paño (Z-up: la planta es XY).
    const pos = new Float32Array((v2d.length / 2) * 3);
    for (let i = 0; i < v2d.length / 2; i++) {
      pos[i * 3] = v2d[i * 2]!;
      pos[i * 3 + 1] = v2d[i * 2 + 1]!;
      pos[i * 3 + 2] = 0; // z relativo 0; el group lleva la cota
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    return g;
  }, [pano.contorno, pano.direccionViguetas, pano.intereje]);

  // Pinta un frame al construir/reemplazar la geometria y la libera al desmontar/cambiar
  // (frameloop="demand": crear geometria no programa frame por si solo).
  useEffect(() => {
    if (geom) invalidate();
    return () => geom?.dispose();
  }, [geom]);

  if (!geom) return null;
  return (
    <lineSegments geometry={geom} position={[0, 0, pano.z + RAYADO_Z_EPS]}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={opacidad}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}

// Rayado de TODOS los paños unidireccionales de la geometria activa. Los paños losa/
// reticular no dibujan rayado (solo huella). Espejo de PanosHuella.
export function PanosRayado({
  panos,
  atenuado,
}: {
  panos: GeoModelo["panos"];
  atenuado: boolean;
}) {
  const unidireccionales = useMemo(
    () => panos.filter((p) => p.tipo === "unidireccional"),
    [panos],
  );
  useEffect(() => {
    invalidate();
  }, [unidireccionales]);
  if (unidireccionales.length === 0) return null;
  return (
    <group>
      {unidireccionales.map((p) => (
        <PanoRayadoUno key={p.id} pano={p} atenuado={atenuado} />
      ))}
    </group>
  );
}
