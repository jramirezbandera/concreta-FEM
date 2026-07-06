// Escena: contenido R3F dentro del <Canvas>. Camara orto (planta) / perspectiva
// (3D) con makeDefault; controles re-anclados al conmutar; rejilla, ejes, gizmo;
// geometria del modelo; punto de inyeccion de overlays de F11/12/14.
//
// RE-ANCLAJE DE CONTROLES (correccion de verificacion): al cambiar de modo se
// monta SOLO la camara del modo activo (con makeDefault) y SOLO sus controles, y
// se les pone una `key` distinta por modo. Eso fuerza el remount de la camara y de
// los controles, que vuelven a anclarse a la nueva camara default. Asi no quedan
// controles apuntando a una camara que ya no es la activa.
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
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
import { MOUSE, OrthographicCamera as OrthoCam, Vector3 } from "three";
import { vistaStore, type ModoVista, type Vista3D } from "../../estado";
import { colorToken, hexToken } from "./colores";
import { GeometriaModelo } from "./GeometriaModelo";
import { AjusteCamara3D } from "./AjusteCamara3D";
import { AjusteCamaraAlzado } from "./AjusteCamaraAlzado";
import type { DireccionAlzado } from "./encuadreVistas";
import { suscribirZoom } from "./hooks/zoomBus";
import { emitirCoords } from "./hooks/coordsBus";
import { suscribirCaptura } from "./hooks/capturaBus";
import { descargarPng } from "./capturarPng";

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

// Camara ortografica de ALZADO de consulta (UX-1.5): mira al edificio desde -Y
// (frontal) o desde +X (lateral), con Z-up. Posicion/zoom iniciales nominales:
// AjusteCamaraAlzado encuadra a los bounds reales del edificio al montar.
function CamaraAlzado({ dir }: { dir: DireccionAlzado }) {
  return (
    <OrthographicCamera
      key={`cam-alzado-${dir}`}
      makeDefault
      position={dir === "frontal" ? [0, -50, 0] : [50, 0, 0]}
      zoom={40}
      up={[0, 0, 1]}
      near={0.1}
      far={1000}
    />
  );
}

// Rejilla en el plano XY (suelo), paso configurable (UX-2.1: vistaStore.pasoRejilla,
// default 0.5 m — Spec §4.1). La linea mayor cada 10 celdas (major/minor legible a
// cualquier paso). Pasiva: no raycastea (no estorba al picking). drei <Grid> usa un
// shader propio.
function Rejilla({ paso }: { paso: number }) {
  return (
    <Grid
      // Plano XY: rotar el grid (por defecto en XZ) para que quede en el suelo Z=0.
      rotation={[Math.PI / 2, 0, 0]}
      args={[200, 200]}
      cellSize={paso}
      cellThickness={0.6}
      cellColor={hexToken("canvasGrid")}
      sectionSize={paso * 10}
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

// Ejes de replanteo X/Y en el origen (2 m). El axesHelper nativo colorea X rojo /
// Y verde, que colisionan con la semantica del Spec (danger/success): en su lugar
// dibujamos dos segmentos con el token --canvas-axis (mismo tono neutro que la
// rejilla). Pasivos: <line> no raycastea, no estorban al picking.
const PUNTOS_EJE_X = new Float32Array([0, 0, 0, 2, 0, 0]);
const PUNTOS_EJE_Y = new Float32Array([0, 0, 0, 0, 2, 0]);

function Ejes() {
  const color = useMemo(() => colorToken("canvasAxis"), []);
  return (
    <>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[PUNTOS_EJE_X, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </line>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[PUNTOS_EJE_Y, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} />
      </line>
    </>
  );
}

// Aplica los eventos de zoom del HUD a la camara activa mutando refs (no
// setState): en orto se ajusta `zoom`; en perspectiva se hace dolly moviendo la
// camara hacia/desde el origen. invalidate() pinta el frame (frameloop demand).
function ControlZoom() {
  const camera = useThree((s) => s.camera);
  // Controles activos (OrbitControls en 3D via makeDefault): el dolly es RELATIVO a su
  // target, no al origen (ver abajo). null en planta o antes de montar los controles.
  const controls = useThree((s) => s.controls) as
    | { target: Vector3; update?: () => void }
    | null;
  useEffect(() => {
    const FACTOR = 1.2;
    return suscribirZoom((dir) => {
      if (camera instanceof OrthoCam) {
        camera.zoom *= dir === "in" ? FACTOR : 1 / FACTOR;
        camera.updateProjectionMatrix();
      } else {
        // Dolly RELATIVO al target de los controles (no al origen): tras el encuadre
        // (AjusteCamara3D) el target se recentra en el edificio; escalar la posicion
        // respecto al origen desviaria la vista. Acercamos/alejamos la camara al target.
        const target = controls?.target ?? new Vector3(0, 0, 0);
        const offset = camera.position.clone().sub(target);
        offset.multiplyScalar(dir === "in" ? 1 / FACTOR : FACTOR);
        camera.position.copy(target).add(offset);
        controls?.update?.();
      }
      invalidate();
    });
  }, [camera, controls]);
  return null;
}

// Ejecuta la captura PNG del viewport al recibir el evento del capturaBus. Con
// frameloop="demand" la escena no pinta cada frame, asi que leer el canvas sin un
// render reciente da una imagen vacia/negra. Por eso forzamos un render explicito
// (gl.render) justo antes de toDataURL; el Canvas lleva preserveDrawingBuffer para
// que el framebuffer siga legible tras pintar. Mismo patron que ControlZoom.
function ControlCaptura() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    return suscribirCaptura((nombre) => {
      try {
        gl.render(scene, camera);
        const dataUrl = gl.domElement.toDataURL("image/png");
        // toDataURL puede devolver "data:," con un canvas vacio: no descargar nada.
        if (dataUrl && dataUrl !== "data:,") descargarPng(dataUrl, nombre);
      } catch (e) {
        // toDataURL es sincrono y puede LANZAR (canvas "tainted", contexto WebGL
        // perdido, OOM al asignar el base64). No rompemos la escena: log defensivo.
        if (import.meta.env.DEV) {
          console.error("[captura] fallo al generar PNG:", e);
        }
      }
    });
  }, [gl, scene, camera]);
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

// Visibilidad de la rejilla desde vistaStore (toggle del ToolsRail). Suscripcion fina:
// el toggle es esporadico (accion manual del usuario), NO alta frecuencia, asi que un
// re-render de la Escena al conmutarlo es aceptable (mismo caracter que modoVista).
function useRejillaVisible(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.rejillaVisible, cb),
    () => vistaStore.getState().rejillaVisible,
    () => vistaStore.getState().rejillaVisible,
  );
}

// Sub-vista de la camara 3D (UX-1.5): orbita o alzado de consulta. Mismo caracter
// esporadico que modoVista (accion manual), re-render de la Escena aceptable.
function useVista3d(): Vista3D {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.vista3d, cb),
    () => vistaStore.getState().vista3d,
    () => vistaStore.getState().vista3d,
  );
}

// Paso de la rejilla (UX-2.1): cambio esporadico (popover del ToolsRail), re-render
// de la Escena aceptable (mismo caracter que rejillaVisible).
function usePasoRejilla(): number {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.pasoRejilla, cb),
    () => vistaStore.getState().pasoRejilla,
    () => vistaStore.getState().pasoRejilla,
  );
}

export function Escena({ modoVista, overlays }: EscenaProps) {
  const esPlanta = modoVista === "planta";
  const rejillaVisible = useRejillaVisible();
  const pasoRejilla = usePasoRejilla();
  // Alzados de consulta (UX-1.5): sub-vista de 3D. En planta se ignora (vale "orbita").
  const vista3d = useVista3d();
  const enAlzado = !esPlanta && vista3d !== "orbita";

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
      {esPlanta ? (
        <CamaraPlanta />
      ) : vista3d !== "orbita" ? (
        <CamaraAlzado dir={vista3d} />
      ) : (
        <Camara3D />
      )}

      {/* Controles re-anclados por `key` distinta segun modo: MapControls en planta
          y alzados (pan + zoom, sin rotar: encuadres fijos), OrbitControls en 3D
          orbita. makeDefault + onChange->invalidate para que frameloop="demand"
          pinte al mover.
          RATON CAD (convencion universal de CAD): boton central = pan en TODOS los
          modos (memoria muscular unica), rueda = zoom AL CURSOR (zoomToCursor de
          three-stdlib, soporta camara orto), izquierdo reservado a herramienta/
          seleccion en planta (antes paneaba: pisaba la convencion). El objeto
          `mouseButtons` REEMPLAZA al default del control (R3F no mergea): se pasa
          completo; omitir LEFT lo deshabilita. */}
      {esPlanta ? (
        <MapControls
          key="ctrl-planta"
          makeDefault
          enableRotate={false}
          screenSpacePanning
          zoomToCursor
          mouseButtons={{ MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }}
          onChange={() => invalidate()}
        />
      ) : vista3d !== "orbita" ? (
        <MapControls
          key={`ctrl-alzado-${vista3d}`}
          makeDefault
          enableRotate={false}
          screenSpacePanning
          zoomToCursor
          // En alzado no se dibuja: el izquierdo tambien panea (comodidad de consulta).
          mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }}
          onChange={() => invalidate()}
        />
      ) : (
        <OrbitControls
          key="ctrl-3d"
          makeDefault
          zoomToCursor
          mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN }}
          onChange={() => invalidate()}
        />
      )}

      {/* Encuadre de la camara al edificio completo (F2c / UX-1.5): perspectiva en
          orbita, ortografico en alzados. Ambos reaccionan al boton "Encuadrar". */}
      {!esPlanta && vista3d === "orbita" && <AjusteCamara3D />}
      {!esPlanta && vista3d !== "orbita" && <AjusteCamaraAlzado dir={vista3d} />}

      <ambientLight intensity={0.9} />
      <directionalLight position={[10, -10, 20]} intensity={0.4} />

      {rejillaVisible && <Rejilla paso={pasoRejilla} />}
      <Ejes />

      <ControlZoom />
      <ControlCaptura />
      <PlanoCoords />
      <GeometriaModelo />
      {overlays}

      {/* Gizmo de orientacion (cubo/ejes) abajo-derecha, SOLO en 3D orbita: en planta
          y en los alzados la orientacion es fija y el gizmo — que ademas GIRA la
          camara al pulsarlo — solo confunde (queja directa del usuario). */}
      {!esPlanta && !enAlzado && (
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport axisColors={ejeColor} labelColor={hexToken("onAccent")} />
        </GizmoHelper>
      )}
    </>
  );
}
