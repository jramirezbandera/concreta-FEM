// ColocacionPano: introduccion grafica de un paño LOSA rectangular por DOS clics en
// planta (F3 corte 1). Espejo de ColocacionViga (esquina A -> esquina opuesta), pero el
// feedback elastico es un RECTANGULO (no una linea) y el resultado son CUATRO nudos
// PROPIOS (la malla es AISLADA en corte 1: no se comparte con el portico). Objeto R3F
// inyectado en la escena via `sceneOverlays` del Viewport.
//
// COMPORTAMIENTO (espejo de ColocacionViga):
//  - Activo SOLO cuando vistaStore.herramienta === "pano" Y en vista planta.
//  - Plano invisible en Z=0 que capta onPointerMove (mueve el marcador del cursor y, si
//    hay esquina A pendiente, estira el rectangulo de previsualizacion) y onClick.
//  - PRIMER clic: fija la esquina A. SEGUNDO clic: define la esquina opuesta; si el
//    rectangulo tiene area se despacha crearPano y se resetea para encadenar; si no
//    (clics demasiado proximos) se ignora.
//  - Esc: si hay esquina A pendiente, la cancela; si no, sale a "seleccion".
//
// EJE VERTICAL: la escena usa Z = cota. El paño vive a `z = cota de su planta`; el plano
// de captura vive en Z=0 (coords planas) y el rectangulo se dibuja a z = cota.
//
// RENDIMIENTO (memoria feature-9, regla #11): el modelo se lee con getState() justo antes
// de construir el comando; nada de useFrame; CERO setState por frame (marcadores y
// rectangulo se mueven mutando refs + invalidate()). El unico re-render React ocurre al
// cambiar de herramienta o al fijar/soltar la esquina A (clics puntuales), nunca por frame.
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
import { modeloStore, vistaStore, seleccionStore, crearPano } from "../../estado";
import { colorToken } from "./colores";
import { snapARejilla } from "./snap";
import { plantaColocableViga } from "./tramoViga";
import { procesarClicPano, type PuntoPano } from "./colocacionPanoLogica";
import { debeIgnorarEscColocacion } from "./escColocacion";
import { resolverPuntoEntrada } from "./entradaNumerica";
import { emitirCota, limpiarCota } from "./hooks/cotaBus";
import { emitirAviso } from "./hooks/avisoBus";
import { suscribirEntrada } from "./hooks/entradaBus";
import { useAltSuprime } from "./hooks/useAltSuprime";
import { cotaRectangulo } from "./formateo";

// Semibrazo de la cruz del marcador (m) y elevacion sobre la cota (anti z-fight).
const MARCA_R = 0.18;
const MARCA_Z = 0.02;

// --- Suscripcion al modo de herramienta (fuera del bucle de render) -----------

// True solo en modo "pano". subscribeWithSelector: re-render SOLO al conmutar.
function useHerramientaPano(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.herramienta, cb),
    () => vistaStore.getState().herramienta === "pano",
    () => vistaStore.getState().herramienta === "pano",
  );
}

// True solo en vista planta. La introduccion grafica es 2D (F2c, decision #3).
function useEnPlanta(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modoVista, cb),
    () => vistaStore.getState().modoVista === "planta",
    () => vistaStore.getState().modoVista === "planta",
  );
}

// --- Marcador fantasma (cursor) y ancla (esquina A fijada) --------------------

function crearGeoCruz(): BufferGeometry {
  const g = new BufferGeometry();
  const v = new Float32Array([
    -MARCA_R, 0, 0, MARCA_R, 0, 0, // horizontal
    0, -MARCA_R, 0, 0, MARCA_R, 0, // vertical
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
  // Color token "pano" (UX-G12): el overlay de introduccion usa el token DEL ELEMENTO,
  // coherente con pilar/viga (que colocan con su propio token, no con el acento). Antes
  // el paño colocaba en acento -> incoherencia entre herramientas.
  const color = useMemo(() => colorToken("pano"), []);
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

// --- Componente activo (montado solo en modo "pano" + planta) -----------------

function ColocacionActiva() {
  const refMarcadorCursor = useRef<Group>(null);
  const refRectangulo = useRef<LineSegments>(null);
  const refPlano = useRef<Mesh>(null);

  // Esquina A pendiente entre el primer y el segundo clic. En una ref: no provoca
  // re-render (regla #11); su efecto visual se aplica mutando refs.
  const pendienteA = useRef<PuntoPano | null>(null);

  // Geometria del rectangulo elastico: 4 lados = 8 vertices (lineSegments dibuja pares).
  const geoRect = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(24), 3));
    return g;
  }, []);
  useEffect(() => () => geoRect.dispose(), [geoRect]);
  // Contorno elastico en --pano-line (UX-G12): el contorno del elemento paño, no el
  // acento; espejo de la linea elastica de la viga (--viga-line).
  const colorRect = useMemo(() => colorToken("panoLine"), []);

  // Planta donde caera el paño (misma logica que la viga: una sola planta).
  function plantaColocable(): string | null {
    const modelo = modeloStore.getState().getModelo();
    const { plantaActivaId } = vistaStore.getState();
    return plantaColocableViga(modelo, plantaActivaId);
  }

  // Cota (Z) de la planta donde caera el paño; donde se dibujan marcadores y rectangulo.
  function cotaColocable(): number | null {
    const plantaId = plantaColocable();
    if (plantaId === null) return null;
    const planta = modeloStore.getState().getModelo().plantas.find((p) => p.id === plantaId);
    return planta ? planta.cota : null;
  }

  // Resuelve el punto del clic (snap a rejilla si snapActivo; si no, crudo). Corte 1 es
  // AISLADO: NO hay iman a obra (no se comparte nudo con el portico), solo rejilla.
  // Paso configurable (UX-2.1); Alt suprime el snap momentaneamente (D8b).
  function resolverPunto(x: number, y: number, sinAyudas = false): PuntoPano {
    const { snapActivo, pasoRejilla } = vistaStore.getState();
    return snapActivo && !sinAyudas ? snapARejilla(x, y, pasoRejilla) : { x, y };
  }

  function moverCursor(x: number, y: number, z: number): void {
    const g = refMarcadorCursor.current;
    if (!g) return;
    g.position.set(x, y, z);
  }

  // Estira el rectangulo de previsualizacion desde la esquina A (ax,ay) hasta el cursor
  // (bx,by) a la cota z, mutando los vertices (4 lados = 8 vertices). Orden de pares:
  // i-j, j-m, m-n, n-i (mismo rectangulo CCW que rectanguloDesde).
  function estirarRectangulo(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    z: number,
  ): void {
    const xMin = Math.min(ax, bx);
    const xMax = Math.max(ax, bx);
    const yMin = Math.min(ay, by);
    const yMax = Math.max(ay, by);
    const zz = z + MARCA_Z;
    const attr = geoRect.getAttribute("position") as Float32BufferAttribute;
    const arr = attr.array as Float32Array;
    // 4 esquinas i(xMin,yMin) j(xMax,yMin) m(xMax,yMax) n(xMin,yMax).
    const e = [
      [xMin, yMin],
      [xMax, yMin],
      [xMax, yMax],
      [xMin, yMax],
    ];
    let o = 0;
    for (let k = 0; k < 4; k++) {
      const a = e[k]!;
      const b = e[(k + 1) % 4]!;
      arr[o++] = a[0]!; arr[o++] = a[1]!; arr[o++] = zz;
      arr[o++] = b[0]!; arr[o++] = b[1]!; arr[o++] = zz;
    }
    attr.needsUpdate = true;
  }

  function ocultarRectangulo(): void {
    if (refRectangulo.current) refRectangulo.current.visible = false;
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const z = cotaColocable();
    if (z === null) return;
    const punto = resolverPunto(e.point.x, e.point.y, e.nativeEvent.altKey);
    moverCursor(punto.x, punto.y, z);
    const a = pendienteA.current;
    if (a !== null) {
      estirarRectangulo(a.x, a.y, punto.x, punto.y, z);
      if (refRectangulo.current) refRectangulo.current.visible = true;
      // Cota viva del rectangulo (ancho × alto) por cotaBus (D8a), sin setState.
      emitirCota({
        texto: cotaRectangulo(punto.x - a.x, punto.y - a.y),
        px: e.nativeEvent.offsetX,
        py: e.nativeEvent.offsetY,
      });
    }
    invalidate();
  };

  // Nucleo del clic: procesa una esquina YA RESUELTA (del snap del clic o de la
  // entrada numerica, UX-2.5). Unica puerta de commit de la herramienta.
  function confirmarEsquina(punto: PuntoPano): void {
    const plantaId = plantaColocable();
    const { defaultsPano } = vistaStore.getState();

    // Sin planta colocable o sin material por defecto no se puede crear un paño valido:
    // clic silencioso (la guia de la barra de estado la pone App).
    if (plantaId === null || defaultsPano.materialId === null) {
      if (import.meta.env.DEV) {
        console.warn("[ColocacionPano] sin planta colocable o sin material: clic ignorado.");
      }
      return;
    }

    const accion = procesarClicPano(pendienteA.current, punto);

    if (accion.tipo === "guardarA") {
      pendienteA.current = accion.a;
      invalidate();
      return;
    }
    if (accion.tipo === "ignorar") {
      // Segundo clic sin area (esquinas casi coincidentes): no se crea paño degenerado.
      // Se mantiene A pendiente para que el usuario reintente la esquina opuesta. La
      // barra de estado explica el porque (UX-2.0), antes era un silencio total.
      emitirAviso("Las dos esquinas coinciden: pulsa mas lejos para cerrar la losa");
      invalidate();
      return;
    }

    // crearPano: leer el modelo JUSTO antes de construir el comando (invariante del base).
    const base = modeloStore.getState().getModelo();
    const comando = crearPano(base, {
      tipo: "losa",
      plantaId,
      perimetro: accion.perimetro,
      espesor: defaultsPano.espesor,
      materialId: defaultsPano.materialId,
      tamMalla: defaultsPano.tamMalla,
      bordeApoyo: defaultsPano.bordeApoyo,
    });
    modeloStore.getState().ejecutar(comando);

    // Reset del ciclo: listo para el siguiente paño (la herramienta sigue activa).
    pendienteA.current = null;
    ocultarRectangulo();
    limpiarCota(); // rectangulo fijado -> retira la etiqueta viva (D8a)
    invalidate();
  }

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    confirmarEsquina(resolverPunto(e.point.x, e.point.y, e.nativeEvent.altKey));
  };

  // Al entrar en la herramienta, limpia la seleccion (el InspectorPano no debe convivir
  // con la colocacion).
  useEffect(() => {
    seleccionStore.getState().limpiar();
  }, []);

  // Esc: si hay esquina A pendiente, la cancela (sin salir); si no, sale a seleccion.
  // UX-C11: coordina con los dialogos (ver debeIgnorarEscColocacion): ignora el Esc si
  // otro handler ya lo consumio (defaultPrevented) o si hay un dialogo abierto
  // (dialogoActivo), para no cancelar la esquina pendiente ni salir de la herramienta.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (debeIgnorarEscColocacion(ev.defaultPrevented, vistaStore.getState().dialogoActivo))
        return;
      if (pendienteA.current !== null) {
        pendienteA.current = null;
        ocultarRectangulo();
        limpiarCota(); // Esc cancela el rectangulo -> retira la etiqueta viva (D8a)
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

  // Alt mantenido suprime el snap (D8b); el hook evita que Alt dispare el menu del
  // navegador en Windows mientras la herramienta esta activa.
  useAltSuprime();

  // Entrada numerica (UX-2.5): "x,y" absoluto o "@dx,dy"/"d<a" desde la esquina A
  // pendiente. El punto tecleado es EXACTO (sin snap) y entra por el MISMO
  // confirmarEsquina del clic (p. ej. "@6,4" cierra una losa de 6x4 m).
  useEffect(() => {
    return suscribirEntrada((expr) => {
      const r = resolverPuntoEntrada(expr, pendienteA.current);
      if (!r.ok) {
        emitirAviso(r.error);
        return;
      }
      confirmarEsquina({ x: r.x, y: r.y });
    });
    // Deps vacias: el handler cierra sobre refs/stores estables; vive lo que la herramienta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group>
      {/* Plano de captura propio (Z=0); en click detiene la propagacion (no cae en
          seleccion). */}
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

      {/* Rectangulo elastico A -> cursor (oculto hasta que haya esquina A). */}
      <lineSegments ref={refRectangulo} geometry={geoRect} visible={false} renderOrder={9}>
        <lineBasicMaterial
          color={colorRect}
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

// Raiz: monta la interaccion solo en modo "pano" Y vista planta.
export function ColocacionPano() {
  const activo = useHerramientaPano();
  const enPlanta = useEnPlanta();
  if (!activo || !enPlanta) return null;
  return <ColocacionActiva />;
}
