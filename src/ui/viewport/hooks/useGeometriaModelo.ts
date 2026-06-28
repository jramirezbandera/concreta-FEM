// useGeometriaModelo: deriva la geometria dibujable del Modelo (Capa 1) para el
// grupo/planta activos, FUERA del bucle de render por frame (regla #11 / #2).
//
// El Modelo NO entra como prop reactiva que se recomputa cada frame: se LEE con
// modeloStore.getState() y se RECONSTRUYE solo cuando cambian `modelo`,
// `grupoActivoId` o `plantaActivaId`. Eso se logra con suscripciones transient
// (subscribeWithSelector) que bumpean un contador de version; el componente que
// usa el hook recalcula el useMemo cuando cambia esa version, no por frame.
//
// El viewport SOLO LEE el modelo; no muta obra (CLAUDE.md §17). Aqui no hay
// logica de dominio/calculo: solo proyeccion geometrica m -> escena.
import { useMemo, useSyncExternalStore } from "react";
import { modeloStore, vistaStore } from "../../../estado";
import type { ModoVista } from "../../../estado";
import type { Modelo, Grupo, Planta, Seccion } from "../../../dominio";

// Un pilar listo para instanciar: centro del tramo (x, y, z) en metros, alto del
// tramo y giro. Mantiene el id de dominio para el picking (instanceId -> id).
export interface PilarDibujo {
  id: string;
  cx: number; // x en planta (m)
  cy: number; // y en planta (m)
  cz: number; // cota del centro del tramo (m)
  alto: number; // longitud vertical del tramo (m)
  lado: number; // lado de la seccion proyectada en planta (m), para la caja
  angulo: number; // giro en grados
}

// Una viga lista para dibujar como segmento entre sus dos nudos, a la cota de su
// planta. Mantiene el id de dominio para el picking.
export interface VigaDibujo {
  id: string;
  ax: number; // nudo I (m)
  ay: number;
  bx: number; // nudo J (m)
  by: number;
  z: number; // cota de la planta de la viga (m)
}

export interface GeometriaModelo {
  pilares: PilarDibujo[];
  vigas: VigaDibujo[];
}

// Lado por defecto de la caja de un pilar cuando la seccion no aporta dimensiones
// directas (perfil metalico o generico). 0.3 m es un cuadrado legible en planta.
const LADO_PILAR_DEFECTO = 0.3;

// Lado proyectado en planta a partir de una seccion ya resuelta (m). 0.3 m por
// defecto si no hay seccion o no aporta dimensiones directas (perfil/generico).
function ladoSeccion(sec: Seccion | undefined): number {
  if (!sec) return LADO_PILAR_DEFECTO;
  if (sec.tipo === "hormigonRectangular") return Math.max(sec.b, sec.h);
  if (sec.tipo === "hormigonCircular") return sec.d;
  return LADO_PILAR_DEFECTO;
}

// Cota base de una planta (m) a partir del Map id->cota. El tramo de pilar va de la
// cota de su plantaInicial a la de su plantaFinal; la viga vive en la de su planta.
function cotaPlanta(plantaId: string, cotaPorPlanta: Map<string, number>): number {
  return cotaPorPlanta.get(plantaId) ?? 0;
}

// Plantas pertenecientes al grupo activo (si lo hay). Si no hay grupo activo, se
// consideran todas (vista 3D del edificio completo). plantaActivaId filtra ademas
// la vista 2D a una sola planta.
function plantasVisibles(
  modelo: Modelo,
  grupoActivoId: string | null,
): Planta[] {
  if (!grupoActivoId) return modelo.plantas;
  return modelo.plantas.filter((p) => p.grupoId === grupoActivoId);
}

// Proyecta el Modelo a geometria dibujable. PURA respecto a stores: recibe los
// snapshots ya leidos. Pilares filtrados por grupo (su tramo toca alguna planta
// visible); vigas filtradas por planta activa si esta fijada, si no por grupo.
//
// Exportada (named export) para poder testearla en `node` sin WebGL/React; el hook
// la sigue usando internamente (las suscripciones transient viven en el hook).
export function derivar(
  modelo: Modelo,
  grupoActivoId: string | null,
  plantaActivaId: string | null,
): GeometriaModelo {
  const plantas = plantasVisibles(modelo, grupoActivoId);
  const idsVisibles = new Set(plantas.map((p) => p.id));

  // Maps construidos UNA sola vez (DRY/perf): evitan find() anidado por pilar/viga
  // (antes O(P×S) y O(N×plantas)). Misma fuente: modelo.secciones y modelo.plantas.
  const seccionPorId = new Map(modelo.secciones.map((s) => [s.id, s]));
  const cotaPorPlanta = new Map(modelo.plantas.map((p) => [p.id, p.cota]));

  // Pilares: un tramo es visible si su plantaInicial o plantaFinal cae en el grupo.
  const pilares: PilarDibujo[] = [];
  for (const pilar of modelo.pilares) {
    const tocaGrupo =
      idsVisibles.has(pilar.plantaInicial) || idsVisibles.has(pilar.plantaFinal);
    if (grupoActivoId && !tocaGrupo) continue;
    const z0 = cotaPlanta(pilar.plantaInicial, cotaPorPlanta);
    const z1 = cotaPlanta(pilar.plantaFinal, cotaPorPlanta);
    const zMin = Math.min(z0, z1);
    const zMax = Math.max(z0, z1);
    const alto = Math.max(zMax - zMin, 0.01); // evita caja degenerada
    pilares.push({
      id: pilar.id,
      cx: pilar.x,
      cy: pilar.y,
      cz: zMin + alto / 2,
      alto,
      lado: ladoSeccion(seccionPorId.get(pilar.seccionId)),
      angulo: pilar.angulo,
    });
  }

  // Vigas: en planta solo las de la planta activa; en grupo, las de plantas del
  // grupo. Cada extremo busca su nudo por id.
  const nudoPorId = new Map(modelo.nudos.map((n) => [n.id, n]));
  const vigas: VigaDibujo[] = [];
  for (const viga of modelo.vigas) {
    if (plantaActivaId) {
      if (viga.plantaId !== plantaActivaId) continue;
    } else if (grupoActivoId && !idsVisibles.has(viga.plantaId)) {
      continue;
    }
    const ni = nudoPorId.get(viga.nudoI);
    const nj = nudoPorId.get(viga.nudoJ);
    if (!ni || !nj) continue; // referencia rota: la valida feature-4, aqui se omite
    vigas.push({
      id: viga.id,
      ax: ni.x,
      ay: ni.y,
      bx: nj.x,
      by: nj.y,
      z: cotaPlanta(viga.plantaId, cotaPorPlanta),
    });
  }

  return { pilares, vigas };
}

// Suscripcion transient que bumpea un "tick" cuando cambia cualquiera de las entradas
// relevantes. useSyncExternalStore re-renderiza el componente SOLO ante un cambio del
// snapshot (no por frame), y entonces el useMemo recomputa la geometria. Se suscribe
// tambien a `modoVista`: conmutar planta<->3D cambia los ids EFECTIVOS (ver abajo).
function suscribirEntradas(cb: () => void): () => void {
  const offModelo = modeloStore.subscribe((s) => s.modelo, cb);
  const offGrupo = vistaStore.subscribe((s) => s.grupoActivoId, cb);
  const offPlanta = vistaStore.subscribe((s) => s.plantaActivaId, cb);
  const offModo = vistaStore.subscribe((s) => s.modoVista, cb);
  return () => {
    offModelo();
    offGrupo();
    offPlanta();
    offModo();
  };
}

// Snapshot estable: una tupla [modelo, grupoEfectivo, plantaEfectivo]. Los ids son los
// EFECTIVOS (F2c): en cualquier vista que NO sea "planta" (3D y mosaico, que comparten
// la escena 3D del Viewport) se colapsan a null para mostrar TODO el edificio reusando
// la rama "sin filtro" de `derivar`. Esto ademas BLINDA el anti-bucle: al pickear en 3D
// se sincroniza grupo/planta activos (F1.3), pero como aqui ya valen null, el snapshot
// no cambia de referencia -> ni re-render ni recompute de geometria. modoVista NO entra
// en la tupla: el colapso ya lo codifica (conmutar de modo SI cambia los ids efectivos).
// Ids EFECTIVOS para la geometria segun el modo de vista (PURA, exportada para test):
// en "planta" se respetan grupo/planta activos; en cualquier otra vista (3D/mosaico)
// se colapsan a null para mostrar todo el edificio.
export function idsEfectivos(
  modoVista: ModoVista,
  grupoActivoId: string | null,
  plantaActivaId: string | null,
): readonly [string | null, string | null] {
  if (modoVista !== "planta") return [null, null];
  return [grupoActivoId, plantaActivaId];
}

function leerSnapshot(): readonly [Modelo, string | null, string | null] {
  const { grupoActivoId, plantaActivaId, modoVista } = vistaStore.getState();
  const [g, p] = idsEfectivos(modoVista, grupoActivoId, plantaActivaId);
  return [modeloStore.getState().modelo, g, p] as const;
}

// Cache de la tupla para que getSnapshot devuelva una referencia estable mientras
// las entradas efectivas no cambien (requisito de useSyncExternalStore).
let snapCache = leerSnapshot();
function getSnapshotEstable(): readonly [Modelo, string | null, string | null] {
  const actual = leerSnapshot();
  if (
    actual[0] === snapCache[0] &&
    actual[1] === snapCache[1] &&
    actual[2] === snapCache[2]
  ) {
    return snapCache;
  }
  snapCache = actual;
  return actual;
}

export function useGeometriaModelo(): GeometriaModelo {
  const [modelo, grupoEfectivo, plantaEfectivo] = useSyncExternalStore(
    suscribirEntradas,
    getSnapshotEstable,
    getSnapshotEstable,
  );
  return useMemo(
    () => derivar(modelo, grupoEfectivo, plantaEfectivo),
    [modelo, grupoEfectivo, plantaEfectivo],
  );
}

// Helpers expuestos para el HUD (GroupRibbon): grupo y plantas activos.
export function grupoActivo(): Grupo | null {
  const { grupoActivoId } = vistaStore.getState();
  if (!grupoActivoId) return null;
  return modeloStore.getState().modelo.grupos.find((g) => g.id === grupoActivoId) ?? null;
}

export function plantasDeGrupo(grupoId: string | null): Planta[] {
  if (!grupoId) return [];
  return modeloStore
    .getState()
    .modelo.plantas.filter((p) => p.grupoId === grupoId)
    .slice()
    .sort((a, b) => a.cota - b.cota);
}
