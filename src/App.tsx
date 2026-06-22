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
import { Shell } from "./ui/shell";
import { Viewport } from "./ui/viewport";
import { suscribirCoords, leerCoords } from "./ui/viewport";
import { ColocacionPilar } from "./ui/viewport/ColocacionPilar";
import { tramoColocable } from "./ui/viewport/tramoPilar";
import { InspectorPilar, PanelHerramientaPilar } from "./ui/entradaPilares";
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
// de verdad para decidir si la colocacion es posible.
function usePuedeColocarPilar(): boolean {
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
  const pestana = usePestanaActiva();
  const herramienta = useHerramienta();
  const snapActivo = useSnapActivo();
  const puedeColocar = usePuedeColocarPilar();
  const coords = useCoordsThrottled();

  // Introduccion grafica de pilares: solo tiene sentido en la pestana de pilares.
  // Aunque los overlays se autoocultan (ColocacionPilar/PanelHerramientaPilar
  // solo actuan en modo "pilar"; InspectorPilar solo con un pilar seleccionado),
  // montarlos solo aqui mantiene limpia la composicion de las demas pestanas.
  const enPilares = pestana === "entradaPilares";

  // El mensaje de la herramienta activa prioriza sobre el de la pestana. Si la
  // herramienta esta activa pero no hay donde colocar, se guia a crear/elegir planta
  // (en vez de dejar que el clic falle en silencio).
  const mensaje =
    enPilares && herramienta === "pilar"
      ? puedeColocar
        ? MENSAJE_HERRAMIENTA_PILAR
        : MENSAJE_PILAR_SIN_TRAMO
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
              sceneOverlays: <ColocacionPilar />,
              hudOverlays: (
                <>
                  <InspectorPilar />
                  <PanelHerramientaPilar />
                </>
              ),
            }
          : {})}
      />
    </Shell>
  );
}
