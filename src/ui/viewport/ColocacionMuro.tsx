// ColocacionMuro: introduccion grafica de un MURO/pantalla por DOS clics del EJE en
// planta (F3, muros). Espejo de ColocacionPano (esquina A -> opuesta) pero el feedback
// elastico es una LINEA con ORTO FORZADO (el muro de este corte es paralelo a los ejes;
// el segundo punto se proyecta SIEMPRE — colocacionMuroLogica, no el orto opcional de
// la viga). El tramo vertical (plantaInicial->final) lo fija `tramoColocable` (misma
// regla que el pilar: de la planta mas baja a la mas alta del edificio).
//
// RENDIMIENTO (memoria feature-9, regla #11): getState() justo antes del comando; cero
// setState por frame (marcador y linea mutan refs + invalidate()).
import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { invalidate, type ThreeEvent } from "@react-three/fiber";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  LineSegments,
} from "three";
import { modeloStore, vistaStore, seleccionStore, crearMuro } from "../../estado";
import { colorToken } from "./colores";
import { snapARejilla } from "./snap";
import { tramoColocable } from "./tramoPilar";
import {
  procesarClicMuro,
  proyectarOrtoMuro,
  type PuntoMuro,
} from "./colocacionMuroLogica";
import { debeIgnorarEscColocacion } from "./escColocacion";
import { resolverPuntoEntrada } from "./entradaNumerica";
import { emitirCota, limpiarCota } from "./hooks/cotaBus";
import { emitirAviso } from "./hooks/avisoBus";
import { suscribirEntrada } from "./hooks/entradaBus";
import { useAltSuprime } from "./hooks/useAltSuprime";
import { formatearLongitud } from "./formateo";

// Semibrazo de la cruz del marcador (m) y elevacion sobre la cota (anti z-fight).
const MARCA_R = 0.18;
const MARCA_Z = 0.02;

// True solo en modo "muro". subscribeWithSelector: re-render SOLO al conmutar.
function useHerramientaMuro(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.herramienta, cb),
    () => vistaStore.getState().herramienta === "muro",
    () => vistaStore.getState().herramienta === "muro",
  );
}

// True solo en vista planta (la introduccion grafica es 2D, F2c decision #3).
function useEnPlanta(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modoVista, cb),
    () => vistaStore.getState().modoVista === "planta",
    () => vistaStore.getState().modoVista === "planta",
  );
}

function crearGeoCruz(): BufferGeometry {
  const g = new BufferGeometry();
  const v = new Float32Array([
    -MARCA_R, 0, 0, MARCA_R, 0, 0,
    0, -MARCA_R, 0, 0, MARCA_R, 0,
  ]);
  g.setAttribute("position", new Float32BufferAttribute(v, 3));
  return g;
}

function Marcador({
  refGrupo,
  visible,
}: {
  refGrupo: RefObject<Group | null>;
  visible: boolean;
}) {
  // Token del ELEMENTO (UX-G12): el muro coloca con --muro, como el paño con --pano.
  const color = useMemo(() => colorToken("muro"), []);
  const geoCruz = useMemo(() => crearGeoCruz(), []);
  useEffect(() => () => geoCruz.dispose(), [geoCruz]);
  return (
    <group ref={refGrupo} renderOrder={10} visible={visible}>
      <mesh position={[0, 0, MARCA_Z]}>
        <planeGeometry args={[MARCA_R * 2, MARCA_R * 2]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.25}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <lineSegments position={[0, 0, MARCA_Z]} geometry={geoCruz}>
        <lineBasicMaterial
          color={color}
          transparent
          opacity={0.9}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}

function ColocacionActiva() {
  const refMarcadorCursor = useRef<Group>(null);
  const refLinea = useRef<LineSegments>(null);
  const refPlano = useRef<Mesh>(null);

  // Extremo A pendiente entre el primer y el segundo clic (ref: sin re-render, #11).
  const pendienteA = useRef<PuntoMuro | null>(null);

  // Linea elastica A -> proyeccion orto del cursor: 2 vertices.
  const geoLinea = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  useEffect(() => () => geoLinea.dispose(), [geoLinea]);
  const colorLinea = useMemo(() => colorToken("muroLine"), []);

  // Cota (Z) donde se dibujan marcadores y linea: la de la planta ACTIVA (el eje se
  // dibuja en el plano de trabajo; el muro real abarca su tramo vertical completo).
  function cotaColocable(): number | null {
    const { plantaActivaId } = vistaStore.getState();
    if (plantaActivaId === null) return null;
    const planta = modeloStore
      .getState()
      .getModelo()
      .plantas.find((p) => p.id === plantaActivaId);
    return planta ? planta.cota : null;
  }

  // Resuelve el punto del clic (snap a rejilla si snapActivo; Alt suprime, D8b).
  function resolverPunto(x: number, y: number, sinAyudas = false): PuntoMuro {
    const { snapActivo, pasoRejilla } = vistaStore.getState();
    return snapActivo && !sinAyudas ? snapARejilla(x, y, pasoRejilla) : { x, y };
  }

  function moverCursor(x: number, y: number, z: number): void {
    const g = refMarcadorCursor.current;
    if (!g) return;
    g.position.set(x, y, z);
  }

  function estirarLinea(a: PuntoMuro, b: PuntoMuro, z: number): void {
    const attr = geoLinea.getAttribute("position") as Float32BufferAttribute;
    const arr = attr.array as Float32Array;
    const zz = z + MARCA_Z;
    arr[0] = a.x; arr[1] = a.y; arr[2] = zz;
    arr[3] = b.x; arr[4] = b.y; arr[5] = zz;
    attr.needsUpdate = true;
  }

  function ocultarLinea(): void {
    if (refLinea.current) refLinea.current.visible = false;
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const z = cotaColocable();
    if (z === null) return;
    const punto = resolverPunto(e.point.x, e.point.y, e.nativeEvent.altKey);
    const a = pendienteA.current;
    if (a !== null) {
      // Orto FORZADO tambien en la previsualizacion (lo dibujado = lo creado).
      const b = proyectarOrtoMuro(a, punto);
      moverCursor(b.x, b.y, z);
      estirarLinea(a, b, z);
      if (refLinea.current) refLinea.current.visible = true;
      // Cota viva de la longitud del eje por cotaBus (D8a), sin setState.
      emitirCota({
        texto: formatearLongitud(Math.hypot(b.x - a.x, b.y - a.y)),
        px: e.nativeEvent.offsetX,
        py: e.nativeEvent.offsetY,
      });
    } else {
      moverCursor(punto.x, punto.y, z);
    }
    invalidate();
  };

  // Nucleo del clic: procesa un extremo YA RESUELTO (del snap del clic o de la
  // entrada numerica). Unica puerta de commit de la herramienta.
  function confirmarExtremo(punto: PuntoMuro): void {
    const modelo = modeloStore.getState().getModelo();
    const { plantaActivaId, defaultsMuro } = vistaStore.getState();
    const tramo = tramoColocable(modelo, plantaActivaId);

    // Sin tramo colocable o sin material por defecto no hay muro valido: clic
    // silencioso (la guia de la barra de estado la pone App).
    if (tramo === null || defaultsMuro.materialId === null) {
      if (import.meta.env.DEV) {
        console.warn("[ColocacionMuro] sin tramo colocable o sin material: clic ignorado.");
      }
      return;
    }

    const accion = procesarClicMuro(pendienteA.current, punto);

    if (accion.tipo === "guardarA") {
      pendienteA.current = accion.a;
      invalidate();
      return;
    }
    if (accion.tipo === "ignorar") {
      emitirAviso("Los dos extremos coinciden: pulsa más lejos para trazar el muro");
      invalidate();
      return;
    }

    // crearMuro: leer el modelo JUSTO antes de construir el comando.
    const base = modeloStore.getState().getModelo();
    const comando = crearMuro(base, {
      x1: accion.a.x,
      y1: accion.a.y,
      x2: accion.b.x,
      y2: accion.b.y,
      plantaInicial: tramo.plantaInicial,
      plantaFinal: tramo.plantaFinal,
      espesor: defaultsMuro.espesor,
      materialId: defaultsMuro.materialId,
      tamMalla: defaultsMuro.tamMalla,
      vinculacionExterior: defaultsMuro.vinculacionExterior,
    });
    modeloStore.getState().ejecutar(comando);

    // Reset del ciclo: listo para el siguiente muro (la herramienta sigue activa).
    pendienteA.current = null;
    ocultarLinea();
    limpiarCota();
    invalidate();
  }

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    confirmarExtremo(resolverPunto(e.point.x, e.point.y, e.nativeEvent.altKey));
  };

  // Al entrar en la herramienta, limpia la seleccion (el InspectorMuro no debe
  // convivir con la colocacion).
  useEffect(() => {
    seleccionStore.getState().limpiar();
  }, []);

  // Esc: si hay extremo A pendiente, lo cancela; si no, sale a seleccion (UX-C11).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (debeIgnorarEscColocacion(ev.defaultPrevented, vistaStore.getState().dialogoActivo))
        return;
      if (pendienteA.current !== null) {
        pendienteA.current = null;
        ocultarLinea();
        limpiarCota();
        invalidate();
        return;
      }
      vistaStore.getState().setHerramienta("seleccion");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Al desmontar la herramienta, retira cualquier cota viva colgada (D8a).
  useEffect(() => () => limpiarCota(), []);

  // Alt mantenido suprime el snap (D8b) sin disparar el menu del navegador.
  useAltSuprime();

  // Entrada numerica (UX-2.5): "x,y" absoluto o "@dx,dy"/"d<a" desde el extremo A.
  // El punto tecleado es EXACTO (sin snap) y entra por el MISMO confirmarExtremo del
  // clic; la proyeccion orto se aplica igual (p. ej. "@6,0" traza un muro de 6 m).
  useEffect(() => {
    return suscribirEntrada((expr) => {
      const r = resolverPuntoEntrada(expr, pendienteA.current);
      if (!r.ok) {
        emitirAviso(r.error);
        return;
      }
      confirmarExtremo({ x: r.x, y: r.y });
    });
    // Deps vacias: el handler cierra sobre refs/stores estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group>
      {/* Plano de captura propio (Z=0); en click detiene la propagacion. */}
      <mesh
        ref={refPlano}
        position={[0, 0, 0]}
        onPointerMove={onMove}
        onClick={onClick}
        renderOrder={5}
      >
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial visible={false} transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Linea elastica A -> cursor proyectado (oculta hasta que haya extremo A). */}
      <lineSegments ref={refLinea} geometry={geoLinea} visible={false} renderOrder={9}>
        <lineBasicMaterial
          color={colorLinea}
          transparent
          opacity={0.9}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>

      <Marcador refGrupo={refMarcadorCursor} visible />
    </group>
  );
}

// Raiz: monta la interaccion solo en modo "muro" Y vista planta.
export function ColocacionMuro() {
  const activo = useHerramientaMuro();
  const enPlanta = useEnPlanta();
  if (!activo || !enPlanta) return null;
  return <ColocacionActiva />;
}
