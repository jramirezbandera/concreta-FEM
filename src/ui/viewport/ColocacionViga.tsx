// ColocacionViga: introduccion grafica de vigas por DOS clics en planta (feature-12,
// Tarea 2.3). Espejo de ColocacionPilar pero de dos puntos (extremo I -> extremo J).
// Objeto R3F que se inyecta DENTRO de la escena via `sceneOverlays` del Viewport (el
// montaje real lo cablea la Fase 3; aqui solo se crea y exporta).
//
// COMPORTAMIENTO (Spec §4, decisiones de producto F12):
//  - Activo SOLO cuando vistaStore.herramienta === "viga". Fuera de ese modo no
//    monta plano ni marcadores ni listeners (no estorba al picking de seleccion).
//  - Plano invisible en Z=0 (gemelo de PlanoCoords) que capta onPointerMove (mover
//    el marcador fantasma del cursor y, si hay extremo I pendiente, estirar una
//    linea elastica desde I hasta el cursor) y onClick.
//  - PRIMER clic: resuelve el extremo I con el iman (resolverPunto) y lo guarda en
//    una ref; ademas fija el marcador "ancla" en su posicion resuelta. SEGUNDO clic:
//    resuelve el extremo J igual; si coincide con I (mismo nudo o misma posicion) se
//    ignora (no se crea viga degenerada); si no, se despacha crearViga y se resetea
//    el extremo I pendiente para encadenar la siguiente viga (la herramienta sigue
//    activa).
//  - Esc: si hay extremo I pendiente, lo cancela (sin salir de la herramienta); si
//    no hay, sale -> setHerramienta("seleccion").
//
// EJE VERTICAL: la escena usa Z = cota (ver useGeometriaModelo: las vigas se dibujan
// a `z = cota de su planta`, no a Y). El plano de captura vive en Z=0 (las coords del
// clic son planas), pero los marcadores/linea elastica se dibujan a `z = cota de la
// planta colocable`, donde realmente vivira la viga.
//
// RENDIMIENTO (memoria feature-9, regla #11): el modelo se lee con getState() JUSTO
// antes de construir el comando; nada de useFrame; CERO setState por frame (los
// marcadores y la linea elastica se mueven mutando refs + invalidate()). El unico
// re-render React ocurre al cambiar de herramienta (raro) o al fijar/soltar el
// extremo I (un clic puntual), nunca por frame.
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
import {
  modeloStore,
  vistaStore,
  seleccionStore,
  crearViga,
  type ExtremoViga,
} from "../../estado";
import { colorToken } from "./colores";
import { resolverPunto } from "./imanViga";
import { puntosSnapDePlantillas } from "./dxf/snapDxf";
import type { Plantilla, PuntoXY } from "./dxf/tiposDxf";
import { plantaColocableViga } from "./tramoViga";
// Logica pura del flujo de dos clics en su propio modulo (este fichero solo
// exporta componentes -> react-refresh/only-export-components).
import { posicionExtremo, procesarClicViga } from "./colocacionVigaLogica";

// Semibrazo de la cruz / medio lado del cuadrado del marcador (m). Z (sobre la cota)
// ligeramente elevado para no z-fightear con la rejilla y la propia viga.
const MARCA_R = 0.18;
const MARCA_Z = 0.02;

// --- Suscripcion al modo de herramienta (fuera del bucle de render) -----------

// True solo en modo "viga". useSyncExternalStore + subscribeWithSelector: re-render
// SOLO cuando cambia este campo (cambio de herramienta), nunca por frame.
function useHerramientaViga(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.herramienta, cb),
    () => vistaStore.getState().herramienta === "viga",
    () => vistaStore.getState().herramienta === "viga",
  );
}

// --- Marcador fantasma (cursor) y ancla (extremo I fijado) --------------------

// Geometria de la cruz (dos segmentos cruzados), creada una vez.
function crearGeoCruz(): BufferGeometry {
  const g = new BufferGeometry();
  const v = new Float32Array([
    -MARCA_R, 0, 0, MARCA_R, 0, 0, // horizontal
    0, -MARCA_R, 0, 0, MARCA_R, 0, // vertical
  ]);
  g.setAttribute("position", new Float32BufferAttribute(v, 3));
  return g;
}

// Cuadrado translucido + cruz en el plano XY. Color token "viga". El grupo se
// reposiciona por mutacion de ref (no por props reactivas) en onPointerMove/onClick.
function Marcador({
  refGrupo,
  visible,
}: {
  refGrupo: RefObject<Group | null>;
  visible: boolean;
}) {
  const color = useMemo(() => colorToken("viga"), []);
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

// --- Componente activo (montado solo en modo "viga") --------------------------

function ColocacionActiva() {
  const refMarcadorCursor = useRef<Group>(null); // sigue al cursor (snap/iman)
  const refMarcadorAncla = useRef<Group>(null); // extremo I fijado
  const refLinea = useRef<LineSegments>(null); // linea elastica I -> cursor
  const refPlano = useRef<Mesh>(null);

  // Extremo I pendiente entre el primer y el segundo clic. En una ref: no provoca
  // re-render (regla #11); su efecto visual se aplica mutando los refs de la escena.
  const pendienteI = useRef<ExtremoViga | null>(null);

  // Cache de los puntos de snap del calco DXF (feature-15, T6). `puntosSnapDePlantillas`
  // transforma TODAS las entidades de TODAS las plantillas visibles; con un DXF grande
  // eso es caro y se invocaba en CADA pointermove -> cursor a tirones. `plantillas` y
  // `plantaActivaId` (vistaStore) son referencias estables entre ediciones: solo cambian
  // al anadir/quitar/editar una plantilla, lo que rompe el `===` y fuerza recalculo (la
  // memoizacion vive aqui, en el componente; snapDxf sigue puro).
  const cacheSnap = useRef<{
    plantillas: readonly Plantilla[];
    plantaActivaId: string | null;
    puntos: PuntoXY[];
  } | null>(null);

  function puntosSnapMemo(
    plantillas: readonly Plantilla[],
    plantaActivaId: string | null,
  ): PuntoXY[] {
    const c = cacheSnap.current;
    if (
      c !== null &&
      c.plantillas === plantillas &&
      c.plantaActivaId === plantaActivaId
    ) {
      return c.puntos;
    }
    const puntos = puntosSnapDePlantillas(plantillas, plantaActivaId);
    cacheSnap.current = { plantillas, plantaActivaId, puntos };
    return puntos;
  }

  // Geometria de la linea elastica: dos vertices que se mutan en cada move.
  const geoLinea = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array(6), 3),
    );
    return g;
  }, []);
  useEffect(() => () => geoLinea.dispose(), [geoLinea]);
  const colorLinea = useMemo(() => colorToken("vigaLine"), []);

  // Cota (Z) de la planta donde caera la viga; es donde se dibujan marcadores y
  // linea. Se relee en cada interaccion (puede cambiar la planta activa).
  function cotaColocable(): number | null {
    const modelo = modeloStore.getState().getModelo();
    const { grupoActivoId, plantaActivaId } = vistaStore.getState();
    const plantaId = plantaColocableViga(modelo, grupoActivoId, plantaActivaId);
    if (plantaId === null) return null;
    const planta = modelo.plantas.find((p) => p.id === plantaId);
    return planta ? planta.cota : null;
  }

  // Mueve el marcador del cursor a (x,y) a la cota dada mutando su ref.
  function moverCursor(x: number, y: number, z: number): void {
    const g = refMarcadorCursor.current;
    if (!g) return;
    g.position.set(x, y, z);
  }

  // Estira la linea elastica desde el ancla I (ax,ay) hasta el cursor (bx,by) a la
  // cota z, mutando los vertices de la geometria (sin reconstruirla).
  function estirarLinea(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    z: number,
  ): void {
    const attr = geoLinea.getAttribute("position") as Float32BufferAttribute;
    const arr = attr.array as Float32Array;
    arr[0] = ax;
    arr[1] = ay;
    arr[2] = z + MARCA_Z;
    arr[3] = bx;
    arr[4] = by;
    arr[5] = z + MARCA_Z;
    attr.needsUpdate = true;
  }

  // Coloca el ancla (extremo I fijado) en (x,y) a la cota z y la hace visible.
  function fijarAncla(x: number, y: number, z: number): void {
    const g = refMarcadorAncla.current;
    if (!g) return;
    g.position.set(x, y, z);
    g.visible = true;
  }

  // Oculta ancla y linea (al resetear el ciclo o cancelar I).
  function ocultarAnclaYLinea(): void {
    if (refMarcadorAncla.current) refMarcadorAncla.current.visible = false;
    if (refLinea.current) refLinea.current.visible = false;
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const z = cotaColocable();
    if (z === null) return;
    const modelo = modeloStore.getState().getModelo();
    const { grupoActivoId, plantaActivaId, snapActivo, plantillas } =
      vistaStore.getState();
    const plantaId = plantaColocableViga(modelo, grupoActivoId, plantaActivaId);
    if (plantaId === null) return;

    // Puntos notables del calco DXF visible de la planta activa (feature-15): se
    // pasan como candidatos de prioridad media (obra > DXF > rejilla) al iman.
    // Memoizado: solo recalcula si cambian plantillas/plantaActivaId (T6).
    const puntosSnapExtra = puntosSnapMemo(plantillas, plantaActivaId);
    const extremo = resolverPunto(modelo, plantaId, e.point.x, e.point.y, {
      snapRejilla: snapActivo,
      puntosSnapExtra,
    });
    const pos = posicionExtremo(modelo, extremo);
    if (pos === null) return;

    moverCursor(pos.x, pos.y, z);

    // Si hay extremo I pendiente, estira la linea elastica desde el (I) hasta aqui.
    const i = pendienteI.current;
    if (i !== null) {
      const posI = posicionExtremo(modelo, i);
      if (posI !== null) {
        estirarLinea(posI.x, posI.y, pos.x, pos.y, z);
        if (refLinea.current) refLinea.current.visible = true;
      }
    }
    invalidate();
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();

    const modelo = modeloStore.getState().getModelo();
    const { grupoActivoId, plantaActivaId, defaultsViga, snapActivo, plantillas } =
      vistaStore.getState();
    const plantaId = plantaColocableViga(modelo, grupoActivoId, plantaActivaId);

    // Sin planta colocable o sin seccion/material por defecto no se puede crear una
    // viga valida: clic silencioso (la guia de la barra de estado la pone App).
    if (
      plantaId === null ||
      defaultsViga.seccionId === null ||
      defaultsViga.materialId === null
    ) {
      if (import.meta.env.DEV) {
        console.warn(
          "[ColocacionViga] sin planta colocable o sin seccion/material: clic ignorado.",
        );
      }
      return;
    }

    const planta = modelo.plantas.find((p) => p.id === plantaId);
    const z = planta ? planta.cota : 0;

    // Mismos candidatos DXF que en onMove (obra > DXF > rejilla); via la cache.
    const puntosSnapExtra = puntosSnapMemo(plantillas, plantaActivaId);
    const extremo = resolverPunto(modelo, plantaId, e.point.x, e.point.y, {
      snapRejilla: snapActivo,
      puntosSnapExtra,
    });
    const accion = procesarClicViga(
      pendienteI.current,
      extremo,
      plantaId,
      {
        seccionId: defaultsViga.seccionId,
        materialId: defaultsViga.materialId,
        extremoI: defaultsViga.extremoI,
        extremoJ: defaultsViga.extremoJ,
        tirante: defaultsViga.tirante,
      },
      modelo,
    );

    if (accion.tipo === "guardarI") {
      pendienteI.current = accion.i;
      const pos = posicionExtremo(modelo, accion.i);
      if (pos !== null) fijarAncla(pos.x, pos.y, z);
      invalidate();
      return;
    }

    if (accion.tipo === "ignorar") {
      // Segundo clic sobre el mismo punto que I: no se crea viga degenerada. Se
      // mantiene I pendiente para que el usuario reintente el extremo J.
      invalidate();
      return;
    }

    // crearViga: leer el modelo JUSTO antes de construir el comando (invariante del
    // `base`: el comando nace contra el modelo actual del store).
    const base = modeloStore.getState().getModelo();
    const comando = crearViga(base, accion.datos);
    modeloStore.getState().ejecutar(comando);

    // Reset del ciclo: lista para la siguiente viga (la herramienta sigue activa).
    pendienteI.current = null;
    ocultarAnclaYLinea();
    invalidate();
  };

  // Al entrar en la herramienta, limpia la seleccion: el InspectorViga (que se
  // muestra al haber una viga seleccionada) NO debe convivir con la colocacion.
  useEffect(() => {
    seleccionStore.getState().limpiar();
  }, []);

  // Esc: si hay extremo I pendiente, lo cancela (sin salir); si no, sale a seleccion.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (pendienteI.current !== null) {
        pendienteI.current = null;
        ocultarAnclaYLinea();
        invalidate();
        return;
      }
      vistaStore.getState().setHerramienta("seleccion");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <group>
      {/* Plano de captura propio: gemelo de PlanoCoords (Z=0), dedicado a la
          herramienta. En click detiene la propagacion para no caer en seleccion. */}
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

      {/* Linea elastica I -> cursor (oculta hasta que haya extremo I). */}
      <lineSegments ref={refLinea} geometry={geoLinea} visible={false} renderOrder={9}>
        <lineBasicMaterial
          color={colorLinea}
          transparent
          opacity={0.8}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>

      {/* Ancla del extremo I (oculta hasta el primer clic) y marcador del cursor. */}
      <Marcador refGrupo={refMarcadorAncla} visible={false} />
      <Marcador refGrupo={refMarcadorCursor} visible />
    </group>
  );
}

// Raiz: monta la interaccion solo en modo "viga". El cambio de herramienta es el
// unico disparador de (des)montaje; nunca se re-renderiza por frame.
export function ColocacionViga() {
  const activo = useHerramientaViga();
  if (!activo) return null;
  return <ColocacionActiva />;
}
