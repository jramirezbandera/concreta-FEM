// App: ensamblaje de la interfaz (feature-9, Fase 2). Monta el Shell (cromo:
// brandbar/menubar/sidebar/work/tools/status/tabs) con el Viewport como work
// canvas. El Shell ocupa el alto completo (#root y body ya estan a height:100%
// en index.css), el Viewport llena el work canvas via su propio CSS.
//
// NO inventa geometria de obra: el modelo arranca vacio (crearModeloVacio) y el
// render de obra real llega en F11/12. Aqui solo se asegura que, SI existen
// grupos/plantas, el grupo y la planta activos sean coherentes (no quedar en
// null cuando hay algo que seleccionar, ni quedar apuntando a un grupo/planta de
// una obra anterior tras restaurar autosave o cambiar de proyecto).
import { useEffect, useState, useSyncExternalStore } from "react";
import { Shell, useArranquePersistencia } from "./ui/shell";
import { Viewport } from "./ui/viewport";
import { suscribirCoords, leerCoords } from "./ui/viewport";
import { ColocacionPilar } from "./ui/viewport/ColocacionPilar";
import { ColocacionViga } from "./ui/viewport/ColocacionViga";
import { OverlayPlantillas } from "./ui/viewport/OverlayPlantillas";
import { PanelPlantillas } from "./ui/plantillas";
import { tramoColocable } from "./ui/viewport/tramoPilar";
import { plantaColocableViga } from "./ui/viewport/tramoViga";
import { InspectorPilar, PanelHerramientaPilar } from "./ui/entradaPilares";
import { InspectorViga, PanelHerramientaViga } from "./ui/entradaVigas";
import {
  DeformadaOverlay,
  BotonCalcular,
  ComboSelector,
  TablaReacciones,
  PanelDiagramas,
  LeyendaEscala,
  usePrecargaMotor,
} from "./ui/resultados";
import {
  modeloStore,
  vistaStore,
  type Pestana,
  type Herramienta,
} from "./estado";
import { resolverVistaActiva } from "./ui/shell/resolverVistaActiva";

// Aplica resolverVistaActiva al estado actual, escribiendo en vistaStore solo si
// cambia algo (evita notificaciones espurias; mantiene la idempotencia).
function sincronizarVistaActiva(): void {
  const vista = vistaStore.getState();
  const modelo = modeloStore.getState().modelo;
  const resuelta = resolverVistaActiva(modelo, {
    grupoActivoId: vista.grupoActivoId,
    plantaActivaId: vista.plantaActivaId,
  });
  if (resuelta.grupoActivoId !== vista.grupoActivoId) {
    vista.setGrupoActivo(resuelta.grupoActivoId);
  }
  if (resuelta.plantaActivaId !== vista.plantaActivaId) {
    vista.setPlantaActiva(resuelta.plantaActivaId);
  }
}

// Mantiene grupo/planta activos coherentes con el modelo: al montar (modelo ya
// cargado, p. ej. autosave restaurado en F8) y ante cada cambio de obra.
function useInicializarVistaActiva(): void {
  useEffect(() => {
    sincronizarVistaActiva();
    // Resincroniza al cambiar de obra (cargarModelo): si los ids activos quedan
    // obsoletos, resolverVistaActiva los repara.
    const unsub = modeloStore.subscribe((s) => s.modelo, sincronizarVistaActiva);
    return unsub;
  }, []);
}

// --- T-D1 · Guia contextual por pestana ---------------------------------------

// Mensaje de la barra de estado segun la pestana activa. Lenguaje de obra,
// nunca jerga FEM (CLAUDE.md §17).
const MENSAJE_PESTANA: Record<Pestana, string> = {
  entradaPilares: "Introduce pilares haciendo clic en la planta",
  entradaVigas: "Une nudos para introducir vigas en la planta",
  resultados: "Selecciona una barra para ver sus esfuerzos",
  isovalores: "Elige un mapa de isovalores para revisar el paño",
};

// Guia contextual mientras la herramienta "pilar" esta activa (prioriza sobre el
// mensaje de pestana). Lenguaje de obra, sin jerga FEM.
const MENSAJE_HERRAMIENTA_PILAR =
  "Haz clic en la planta para colocar un pilar (Esc termina)";

// Cuando la herramienta esta activa pero NO hay donde colocar (sin grupo con plantas
// ni planta activa), la barra avisa ANTES de que el clic caiga en vacio (el clic
// seria un no-op silencioso). Endurecimiento del review de ingenieria.
const MENSAJE_PILAR_SIN_TRAMO =
  "Crea o selecciona una planta para colocar pilares";

// Guia contextual mientras la herramienta "viga" esta activa (prioriza sobre el
// mensaje de pestana). Una viga se tiende entre dos puntos: dos clics. Lenguaje
// de obra, sin jerga FEM.
const MENSAJE_HERRAMIENTA_VIGA =
  "Haz clic en dos puntos para tender una viga (Esc termina)";

// Cuando la herramienta "viga" esta activa pero NO se puede colocar (sin planta
// donde caer, o sin seccion/material por defecto elegidos en el panel), la barra
// avisa ANTES de que el clic caiga en vacio (seria un no-op silencioso). Espejo
// del aviso de pilares; cubre las dos causas con un mensaje en lenguaje de obra.
const MENSAJE_VIGA_SIN_TRAMO =
  "Crea o selecciona una planta y elige sección y material para tender vigas";

function usePestanaActiva(): Pestana {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.pestanaActiva, cb),
    () => vistaStore.getState().pestanaActiva,
    () => vistaStore.getState().pestanaActiva,
  );
}

function useHerramienta(): Herramienta {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.herramienta, cb),
    () => vistaStore.getState().herramienta,
    () => vistaStore.getState().herramienta,
  );
}

function useSnapActivo(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.snapActivo, cb),
    () => vistaStore.getState().snapActivo,
    () => vistaStore.getState().snapActivo,
  );
}

// Hay un tramo donde colocar pilares (grupo activo con plantas, o planta activa).
// Reacciona a cambios del modelo y del ambito activo. Reusa el helper PURO
// tramoColocable (misma logica que ColocacionPilar usa al colocar): una sola fuente
// de verdad para decidir si la colocacion es posible. Exportado como costura de test
// (la reactividad merece red; mismo patron que borrarSeleccion en Menubar).
// eslint-disable-next-line react-refresh/only-export-components
export function usePuedeColocarPilar(): boolean {
  const calcular = () =>
    tramoColocable(
      modeloStore.getState().getModelo(),
      vistaStore.getState().grupoActivoId,
      vistaStore.getState().plantaActivaId,
    ) !== null;
  const [puede, setPuede] = useState(calcular);
  useEffect(() => {
    const recompute = () => setPuede(calcular());
    const desuscribir = [
      modeloStore.subscribe((s) => s.modelo, recompute),
      vistaStore.subscribe((s) => s.grupoActivoId, recompute),
      vistaStore.subscribe((s) => s.plantaActivaId, recompute),
    ];
    recompute();
    return () => desuscribir.forEach((u) => u());
    // calcular solo lee getState(); las suscripciones se montan una vez (deps vacias)
    // y disparan recompute en cada cambio relevante del modelo o del ambito activo.
  }, []);
  return puede;
}

// Se puede tender una viga: hay planta donde caer (plantaColocableViga !== null) Y
// hay seccion/material por defecto elegidos en el panel. Mismas DOS condiciones que
// ColocacionViga comprueba antes de crear la viga (una sola fuente de verdad para la
// luz verde): si falta alguna, la barra guia en vez de dejar fallar el clic en
// silencio. Reacciona al modelo, al ambito activo y a los defaults de viga.
// Exportado como costura de test (la reactividad merece red; espejo de
// usePuedeColocarPilar).
// eslint-disable-next-line react-refresh/only-export-components
export function usePuedeColocarViga(): boolean {
  const calcular = () => {
    const { grupoActivoId, plantaActivaId, defaultsViga } = vistaStore.getState();
    return (
      plantaColocableViga(
        modeloStore.getState().getModelo(),
        grupoActivoId,
        plantaActivaId,
      ) !== null &&
      defaultsViga.seccionId !== null &&
      defaultsViga.materialId !== null
    );
  };
  const [puede, setPuede] = useState(calcular);
  useEffect(() => {
    const recompute = () => setPuede(calcular());
    const desuscribir = [
      modeloStore.subscribe((s) => s.modelo, recompute),
      vistaStore.subscribe((s) => s.grupoActivoId, recompute),
      vistaStore.subscribe((s) => s.plantaActivaId, recompute),
      vistaStore.subscribe((s) => s.defaultsViga, recompute),
    ];
    recompute();
    return () => desuscribir.forEach((u) => u());
    // calcular solo lee getState(); las suscripciones se montan una vez (deps vacias)
    // y disparan recompute en cada cambio relevante del modelo, del ambito o de los
    // defaults de viga (seccion/material).
  }, []);
  return puede;
}

// --- T-D1 · Coords vivas viewport -> barra de estado (throttle rAF) -----------

// Se suscribe al coordsBus y refresca el estado local a lo sumo una vez por
// frame (rAF), NUNCA en cada pointermove. El viewport emite por el bus mutando
// nada del ciclo reactivo; aqui se materializa el ultimo valor en cada frame.
// Esto reproduce el patron del zoomBus (regla #11: cero setState por frame de
// render; el throttle limita el re-render a ~1/frame solo cuando el cursor se
// mueve).
function useCoordsThrottled(): { x: number; y: number } | null {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(() =>
    leerCoords(),
  );
  useEffect(() => {
    let frame = 0;
    let pendiente: { x: number; y: number } | null = null;
    const volcar = () => {
      frame = 0;
      if (pendiente) setCoords(pendiente);
    };
    const unsub = suscribirCoords((c) => {
      pendiente = c;
      if (frame === 0) frame = requestAnimationFrame(volcar);
    });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      unsub();
    };
  }, []);
  return coords;
}

export default function App() {
  useInicializarVistaActiva();
  // Arranque de persistencia (feature-15): rehidrata Modelo + plantillas del proyecto
  // activo desde IndexedDB y arranca ambos autosaves. Defensivo: si no hay IndexedDB,
  // la app sigue en memoria. Cierra el hueco que F9 dejo (autosave sin cablear).
  useArranquePersistencia();
  // Precarga del motor FEM en segundo plano (CLAUDE.md §8): se dispara UNA vez al
  // montar la app (idempotente, no bloquea el hilo), para que "Calcular" este listo
  // cuanto antes mientras el arquitecto modela. No consumimos el estado aqui: el
  // indicador "cargando motor" vive en BotonCalcular (su propio useCalcular).
  usePrecargaMotor();
  const pestana = usePestanaActiva();
  const herramienta = useHerramienta();
  const snapActivo = useSnapActivo();
  const puedeColocar = usePuedeColocarPilar();
  const puedeColocarViga = usePuedeColocarViga();
  const coords = useCoordsThrottled();

  // Introduccion grafica de pilares: solo tiene sentido en la pestana de pilares.
  // Aunque los overlays se autoocultan (ColocacionPilar/PanelHerramientaPilar
  // solo actuan en modo "pilar"; InspectorPilar solo con un pilar seleccionado),
  // montarlos solo aqui mantiene limpia la composicion de las demas pestanas.
  const enPilares = pestana === "entradaPilares";

  // Espejo para vigas: los overlays de viga solo se montan en su pestana (igual que
  // los de pilar). Tambien se autoocultan segun herramienta/seleccion, pero acotar
  // el montaje mantiene limpias las demas pestanas.
  const enVigas = pestana === "entradaVigas";

  // Resultados: monta la deformada (sceneOverlay) y el dock de paneles HUD (calculo,
  // combinacion, reacciones, diagramas, leyenda). Cada panel se autooculta sin
  // resultados; acotar el montaje a su pestana mantiene limpias las demas.
  const enResultados = pestana === "resultados";

  // El mensaje de la herramienta activa prioriza sobre el de la pestana. Si la
  // herramienta esta activa pero no hay donde colocar, se guia a crear/elegir planta
  // (en vez de dejar que el clic falle en silencio). Pilares y vigas siguen el mismo
  // patron; cada pestana solo consulta su propia herramienta.
  const mensaje =
    enPilares && herramienta === "pilar"
      ? puedeColocar
        ? MENSAJE_HERRAMIENTA_PILAR
        : MENSAJE_PILAR_SIN_TRAMO
      : enVigas && herramienta === "viga"
        ? puedeColocarViga
          ? MENSAJE_HERRAMIENTA_VIGA
          : MENSAJE_VIGA_SIN_TRAMO
        : MENSAJE_PESTANA[pestana];

  return (
    <Shell
      nombreObra="Obra sin título"
      status={{
        mensaje,
        snapActivo,
        ...(coords ? { coords } : {}),
      }}
    >
      <Viewport
        {...(enPilares
          ? {
              // OverlayPlantillas (calco DXF de fondo) y PanelPlantillas (F4) van en
              // las pestanas de PLANTA: el calco solo tiene sentido al introducir la
              // obra. Se componen JUNTO a los overlays de herramienta (no los
              // sustituyen): OverlayPlantillas no es interactivo (no estorba al
              // picking) y PanelPlantillas se autooculta si F4 esta cerrado.
              sceneOverlays: (
                <>
                  <OverlayPlantillas />
                  <ColocacionPilar />
                </>
              ),
              hudOverlays: (
                <>
                  <InspectorPilar />
                  <PanelHerramientaPilar />
                  <PanelPlantillas />
                </>
              ),
            }
          : enVigas
            ? {
                sceneOverlays: (
                  <>
                    <OverlayPlantillas />
                    <ColocacionViga />
                  </>
                ),
                hudOverlays: (
                  <>
                    <InspectorViga />
                    <PanelHerramientaViga />
                    <PanelPlantillas />
                  </>
                ),
              }
            : enResultados
              ? {
                  sceneOverlays: <DeformadaOverlay />,
                  hudOverlays: (
                    <>
                      <BotonCalcular />
                      <ComboSelector />
                      <TablaReacciones />
                      <PanelDiagramas />
                      <LeyendaEscala />
                    </>
                  ),
                }
              : {})}
      />
    </Shell>
  );
}
