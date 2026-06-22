// Escena: contenido R3F dentro del <Canvas>. Camara orto (planta) / perspectiva
// (3D) con makeDefault; controles re-anclados al conmutar; rejilla, ejes, gizmo;
// geometria del modelo; punto de inyeccion de overlays de F11/12/14.
//
// RE-ANCLAJE DE CONTROLES (correccion de verificacion): al cambiar de modo se
// monta SOLO la camara del modo activo (con makeDefault) y SOLO sus controles, y
// se les pone una `key` distinta por modo. Eso fuerza el remount de la camara y de
// los controles, que vuelven a anclarse a la nueva camara default. Asi no quedan
// controles apuntando a una camara que ya no es la activa.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { Mesh } from "three";
import {
  OrthographicCamera,
  PerspectiveCamera,
  MapControls,
  OrbitControls,
  GizmoHelper,
  GizmoViewport,
  Grid,
} from "@react-three/drei";
import { invalidate, useThree } from "@react-three/fiber";
import { OrthographicCamera as OrthoCam } from "three";
import type { ModoVista } from "../../estado";
import { hexToken } from "./colores";
import { GeometriaModelo } from "./GeometriaModelo";
import { suscribirZoom } from "./hooks/zoomBus";
import { emitirCoords } from "./hooks/coordsBus";

export interface EscenaProps {
  modoVista: ModoVista;
  // Overlays inyectados por features de UI (F11/12/14) DENTRO de la escena 3D,
  // sin tocar el nucleo del viewport. Se renderizan tras la geometria base.
  overlays?: ReactNode;
}

// Camara cenital ortografica para planta (estandar CAD: escala constante,
// medible). Mira hacia -Z desde arriba; up = Y para que el plano XY sea el suelo.
function CamaraPlanta() {
  return (
    <OrthographicCamera
      key="cam-planta"
      makeDefault
      position={[0, 0, 50]}
      zoom={40}
      up={[0, 1, 0]}
      near={0.1}
      far={1000}
    />
  );
}

// Camara perspectiva isometrica para 3D.
function Camara3D() {
  return (
    <PerspectiveCamera
      key="cam-3d"
      makeDefault
      position={[12, -12, 12]}
      up={[0, 0, 1]}
      fov={45}
      near={0.1}
      far={2000}
    />
  );
}

// Rejilla en el plano XY (suelo) con malla cada 0.5 m (Spec §4.1). Pasiva: no
// raycastea (no estorba al picking). drei <Grid> usa un shader propio.
function Rejilla() {
  return (
    <Grid
      // Plano XY: rotar el grid (por defecto en XZ) para que quede en el suelo Z=0.
      rotation={[Math.PI / 2, 0, 0]}
      args={[200, 200]}
      cellSize={0.5}
      cellThickness={0.6}
      cellColor={hexToken("canvasGrid")}
      sectionSize={5}
      sectionThickness={1}
      sectionColor={hexToken("canvasGrid2")}
      infiniteGrid
      fadeDistance={120}
      fadeStrength={1.5}
      followCamera={false}
      raycast={() => null}
    />
  );
}

// Ejes de replanteo X/Y/Z. axesHelper colorea X rojo, Y verde, Z azul; lo
// recoloreamos a tono CAD via material no es directo, asi que dejamos el helper
// nativo a baja escala como referencia de origen.
function Ejes() {
  // 2 m de ejes en el origen. axesHelper es pasivo (no raycastea por defecto).
  return <axesHelper args={[2]} />;
}

// Aplica los eventos de zoom del HUD a la camara activa mutando refs (no
// setState): en orto se ajusta `zoom`; en perspectiva se hace dolly moviendo la
// camara hacia/desde el origen. invalidate() pinta el frame (frameloop demand).
function ControlZoom() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const FACTOR = 1.2;
    return suscribirZoom((dir) => {
      const k = dir === "in" ? FACTOR : 1 / FACTOR;
      if (camera instanceof OrthoCam) {
        camera.zoom *= k;
        camera.updateProjectionMatrix();
      } else {
        // Dolly: acerca/aleja la camara a lo largo de su vector de vista.
        camera.position.multiplyScalar(dir === "in" ? 1 / FACTOR : FACTOR);
      }
      invalidate();
    });
  }, [camera]);
  return null;
}

// Plano de lectura de coordenadas: una superficie invisible en el suelo (Z=0)
// que, en onPointerMove, emite la interseccion cursor->suelo por el coordsBus.
// NO programa setState (regla #11): solo empuja al bus, que el shell throttlea.
// No detiene la propagacion del evento, asi que no estorba al picking de la
// geometria real (que se dibuja encima). Pasivo para el resto: el plano es muy
// grande para cubrir el area visible de pan/zoom habitual en planta.
function PlanoCoords() {
  const ref = useRef<Mesh>(null);
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    // e.point: punto de interseccion en coordenadas de mundo (m). En el suelo,
    // x/y son el replanteo en planta.
    emitirCoords({ x: e.point.x, y: e.point.y });
  };
  return (
    <mesh ref={ref} rotation={[0, 0, 0]} position={[0, 0, 0]} onPointerMove={onMove}>
      <planeGeometry args={[1000, 1000]} />
      <meshBasicMaterial visible={false} transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

export function Escena({ modoVista, overlays }: EscenaProps) {
  const esPlanta = modoVista === "planta";

  // Color de los ejes del gizmo desde tokens.
  const ejeColor = useMemo(
    () =>
      [hexToken("canvasAxis"), hexToken("canvasAxis"), hexToken("canvasAxis")] as [
        string,
        string,
        string,
      ],
    [],
  );

  return (
    <>
      {esPlanta ? <CamaraPlanta /> : <Camara3D />}

      {/* Controles re-anclados por `key` distinta segun modo: MapControls en planta
          (pan + zoom, sin rotar), OrbitControls en 3D (orbita completa). makeDefault
          + onChange->invalidate para que frameloop="demand" pinte al mover. */}
      {esPlanta ? (
        <MapControls
          key="ctrl-planta"
          makeDefault
          enableRotate={false}
          screenSpacePanning
          onChange={() => invalidate()}
        />
      ) : (
        <OrbitControls key="ctrl-3d" makeDefault onChange={() => invalidate()} />
      )}

      <ambientLight intensity={0.9} />
      <directionalLight position={[10, -10, 20]} intensity={0.4} />

      <Rejilla />
      <Ejes />

      <ControlZoom />
      <PlanoCoords />
      <GeometriaModelo />
      {overlays}

      {/* Gizmo de orientacion (cubo/ejes) abajo-derecha dentro del canvas. */}
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport axisColors={ejeColor} labelColor={hexToken("onAccent")} />
      </GizmoHelper>
    </>
  );
}
