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
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Shell, useArranquePersistencia, useAtajosGlobales } from "./ui/shell";
import {
  Viewport,
  Slot,
  CentroMasaOverlay,
  CentroRigidezOverlay,
  ModeloCalculoOverlay,
  CentroMasa,
  CentroRigidez,
  ModeloCalculo,
} from "./ui/viewport";
import { suscribirCoords, leerCoords } from "./ui/viewport";
import { ProveedorModoPanel } from "./ui/primitivas";
import { ColocacionPilar } from "./ui/viewport/ColocacionPilar";
import { ColocacionViga } from "./ui/viewport/ColocacionViga";
import { ColocacionPano } from "./ui/viewport/ColocacionPano";
import { OverlayPlantillas } from "./ui/viewport/OverlayPlantillas";
import { PanelPlantillas } from "./ui/plantillas";
import { tramoColocable } from "./ui/viewport/tramoPilar";
import { plantaColocableViga } from "./ui/viewport/tramoViga";
import { InspectorPilar, PanelHerramientaPilar } from "./ui/entradaPilares";
import { InspectorViga, PanelHerramientaViga } from "./ui/entradaVigas";
import { InspectorPano, PanelHerramientaPano } from "./ui/entradaPanos";
import {
  DeformadaOverlay,
  BotonCalcular,
  ComboSelector,
  TablaReacciones,
  PanelDiagramas,
  LeyendaEscala,
  ModoOverlay,
  PanelFrecuencias,
  IsovaloresOverlay,
  PanelIsovalores,
  usePrecargaMotor,
} from "./ui/resultados";
import {
  modeloStore,
  vistaStore,
  calculoStore,
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
// nunca jerga FEM (CLAUDE.md §17). Para pilares/vigas, este mensaje se muestra con la
// herramienta de SELECCION activa: por eso guia a activar la herramienta de
// introduccion (el clic en la planta NO coloca nada en modo seleccion; el mensaje
// anterior "Introduce pilares..." era engañoso — auditoria UX-N2).
const MENSAJE_PESTANA: Record<Pestana, string> = {
  entradaPilares:
    "Activa Introducción → Pilar para colocar pilares, o selecciona uno para editarlo.",
  entradaVigas:
    "Activa Vigas → Viga para trazar vigas, o selecciona una para editarla.",
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
// de obra, sin jerga FEM (nada de "nudos": eso es Capa 2).
const MENSAJE_HERRAMIENTA_VIGA =
  "Haz clic en dos puntos (pilares o extremos) para tender una viga (Esc termina)";

// Cuando la herramienta "viga" esta activa pero NO se puede colocar (sin planta
// donde caer, o sin seccion/material por defecto elegidos en el panel), la barra
// avisa ANTES de que el clic caiga en vacio (seria un no-op silencioso). Espejo
// del aviso de pilares; cubre las dos causas con un mensaje en lenguaje de obra.
const MENSAJE_VIGA_SIN_TRAMO =
  "Crea o selecciona una planta y elige sección y material para tender vigas";

// Guia contextual mientras la herramienta "pano" esta activa (prioriza sobre el mensaje
// de pestana). Una losa se define por dos esquinas: dos clics. Lenguaje de obra, sin
// jerga FEM (nada de "malla"/"quad": eso es Capa 2).
const MENSAJE_HERRAMIENTA_PANO =
  "Haz clic en dos esquinas para introducir una losa (Esc termina)";

// Cuando la herramienta "pano" esta activa pero NO se puede colocar (sin planta donde
// caer, o sin material por defecto elegido en el panel), la barra avisa ANTES de que el
// clic caiga en vacio. Espejo del aviso de vigas, en lenguaje de obra.
const MENSAJE_PANO_SIN_TRAMO =
  "Crea o selecciona una planta y elige un material para introducir una losa";

// Vista 3D pleno (F2c): la introduccion grafica es solo 2D, asi que el mensaje guia a
// seleccionar/inspeccionar en vez de a colocar. Lenguaje de obra, sin jerga FEM.
const MENSAJE_3D = "Vista 3D del edificio: selecciona un elemento para inspeccionarlo";

// Feedback de calculo en la barra de estado (auditoria UX-L6). Prioriza sobre todo lo
// demas mientras el motor trabaja; al terminar, se restaura el mensaje contextual.
// Lenguaje de obra: nada de "Pyodide"/"solver" (la UI no sabe que existe Python).
// Exportados como costura de test (evita duplicar los literales en el test).
export const MENSAJE_CALCULANDO = "Calculando obra…";
export const MENSAJE_MOTOR_CARGANDO = "Preparando el motor de cálculo…";

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

// Mensaje de calculo activo (auditoria UX-L6), o null si el motor no esta trabajando.
// Devuelve "Calculando obra…" mientras hay un calculo en vuelo, "Preparando el motor…"
// mientras se carga el motor, y null en reposo (para que gane el mensaje contextual).
// Prioridad: calculando > cargando (un calculo en vuelo ya implica el motor listo).
// Exportado como costura de test (mismo patron que usePuedeColocarPilar).
// eslint-disable-next-line react-refresh/only-export-components
export function useMensajeCalculo(): string | null {
  const calculando = calculoStore((s) => s.calculando);
  const cargandoMotor = calculoStore((s) => s.estadoMotor === "cargando");
  if (calculando) return MENSAJE_CALCULANDO;
  if (cargandoMotor) return MENSAJE_MOTOR_CARGANDO;
  return null;
}

// Vista 3D pleno (modoVista distinto de "planta"). Gobierna el gating de la
// introduccion grafica y de las ayudas 2D (calco DXF, paneles de herramienta) en 3D.
function useEnPleno(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modoVista, cb),
    () => vistaStore.getState().modoVista !== "planta",
    () => false,
  );
}

// Señal de hidratacion para E2E (feature-16, D6): true cuando useArranquePersistencia
// ha terminado de rehidratar el Modelo desde IndexedDB (o ha decidido no persistir).
// App pinta un nodo data-testid="app-ready" cuando es true; los specs esperan por el
// antes de actuar, asi una creacion temprana no la pisa el autosave inicial.
function usePersistenciaLista(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.persistenciaLista, cb),
    () => vistaStore.getState().persistenciaLista,
    () => vistaStore.getState().persistenciaLista,
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

// Se puede introducir una losa: hay planta donde caer (plantaColocableViga !== null) Y
// hay material por defecto elegido en el panel. Mismas DOS condiciones que ColocacionPano
// comprueba antes de crear el paño (una sola fuente de verdad para la luz verde): si
// falta alguna, la barra guia en vez de dejar fallar el clic en silencio. Reacciona al
// modelo, al ambito activo y a los defaults de paño. Exportado como costura de test
// (espejo de usePuedeColocarViga).
// eslint-disable-next-line react-refresh/only-export-components
export function usePuedeColocarPano(): boolean {
  const calcular = () => {
    const { grupoActivoId, plantaActivaId, defaultsPano } = vistaStore.getState();
    return (
      plantaColocableViga(
        modeloStore.getState().getModelo(),
        grupoActivoId,
        plantaActivaId,
      ) !== null && defaultsPano.materialId !== null
    );
  };
  const [puede, setPuede] = useState(calcular);
  useEffect(() => {
    const recompute = () => setPuede(calcular());
    const desuscribir = [
      modeloStore.subscribe((s) => s.modelo, recompute),
      vistaStore.subscribe((s) => s.grupoActivoId, recompute),
      vistaStore.subscribe((s) => s.plantaActivaId, recompute),
      vistaStore.subscribe((s) => s.defaultsPano, recompute),
    ];
    recompute();
    return () => desuscribir.forEach((u) => u());
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

// --- Composicion por pestana (refactor "dock de paneles", PR1/PR2) ------------

// Lo que App inyecta en el Viewport (sceneOverlays/hudOverlays) y en el Shell (dock)
// para la pestana activa. Tres piezas separadas, una sola fuente de las condiciones:
//  - sceneOverlays: objetos R3F DENTRO de la escena (deformada, modal, CM/CR, modelo
//    de calculo, colocacion, calco DXF). NO cambian.
//  - hudOverlays: controles de LIENZO en glass sobre el canvas (Slot/zonas). Solo queda
//    aqui la leyenda de escala (lee contra los colores del modelo); el resto del Hud
//    persistente (ribbon/modo/zoom) lo monta el propio Viewport.
//  - panelesDock: paneles de DATOS de la pestana (inspector, herramienta, plantillas,
//    reacciones, diagramas, combinacion, frecuencias, isovalores). El call site les
//    aplica cromo PLANO (ProveedorModoPanel) y les añade la seccion "Ayudas" (CM/CR/
//    modelo de calculo) comun a todas las pestanas.
interface ComposicionPestana {
  sceneOverlays: ReactNode;
  hudOverlays: ReactNode;
  panelesDock: ReactNode;
}

// Seccion "Ayudas" del dock (PR2): los CONTROLES de Centro de masas, Centro de rigidez y
// "Ver modelo de cálculo". Comun a TODAS las pestanas (como cuando vivian en el Hud
// persistente). Cada control se autooculta por modo de vista (CM/CR solo en planta,
// modelo de calculo solo en 3D), asi el dock no muestra ayudas sin sentido. Sus
// MARCADORES de escena siguen en sceneOverlays; control y marcador hablan solo por
// vistaStore (mostrarCentroMasa, …).
function AyudasDock() {
  return (
    <>
      <CentroMasa />
      <CentroRigidez />
      <ModeloCalculo />
    </>
  );
}

// Envuelve los paneles de la pestana + las Ayudas en el cromo PLANO del dock
// (ProveedorModoPanel modo="plano"): asi el dock se lee como UN panel con secciones, no
// como una pila de tarjetas glass. Si no hay ningun panel de datos, el call site no monta
// el dock (la region no aparece y el lienzo ocupa todo el ancho).
function dockDePestana(panelesDock: ReactNode): ReactNode {
  return (
    <ProveedorModoPanel modo="plano">
      {panelesDock}
      <AyudasDock />
    </ProveedorModoPanel>
  );
}

// Compone las tres piezas para la pestana activa. PURA: solo depende de `pestana` y
// `enPleno` (3D pleno gatea la introduccion grafica y las ayudas 2D). Cada panel se
// autooculta segun seleccion/resultados; acotar el montaje a su pestana mantiene
// limpias las demas (igual que antes del dock). Sin duplicar condiciones.
function composicionPestana(pestana: Pestana, enPleno: boolean): ComposicionPestana {
  switch (pestana) {
    case "entradaPilares":
      return {
        // OverlayPlantillas (calco DXF de fondo) y la colocacion solo tienen sentido
        // en 2D planta; el overlay del modelo de calculo y los centros van en todas
        // las pestanas con planta (se autoocultan segun modo/datos).
        sceneOverlays: (
          <>
            {!enPleno && <OverlayPlantillas />}
            <CentroMasaOverlay />
            <CentroRigidezOverlay />
            {!enPleno && <ColocacionPilar />}
            <ModeloCalculoOverlay />
          </>
        ),
        hudOverlays: null,
        // Paneles de datos al dock (flujo normal de la region, sin Slot). El inspector
        // permanece tambien en 3D (se selecciona y se edita, F2c); la herramienta y el
        // calco DXF son ayudas 2D y se ocultan en 3D pleno.
        panelesDock: (
          <>
            <InspectorPilar />
            {!enPleno && <PanelHerramientaPilar />}
            {!enPleno && <PanelPlantillas />}
          </>
        ),
      };
    case "entradaVigas":
      return {
        sceneOverlays: (
          <>
            {!enPleno && <OverlayPlantillas />}
            <CentroMasaOverlay />
            <CentroRigidezOverlay />
            {!enPleno && <ColocacionViga />}
            {/* Colocacion de paños (F3): losa rectangular por dos clics. Misma pestana
                que vigas (donde vive el menu "Paños"). Se autooculta salvo herramienta
                "pano" + vista planta. */}
            {!enPleno && <ColocacionPano />}
            <ModeloCalculoOverlay />
          </>
        ),
        hudOverlays: null,
        // Inspectores de viga y de paño comparten la pestana: cada uno se autooculta si
        // la seleccion no es de su tipo (solo uno se muestra a la vez). Herramientas y
        // calco DXF: ayudas 2D, ocultas en 3D pleno.
        panelesDock: (
          <>
            <InspectorViga />
            <InspectorPano />
            {!enPleno && <PanelHerramientaViga />}
            {!enPleno && <PanelHerramientaPano />}
            {!enPleno && <PanelPlantillas />}
          </>
        ),
      };
    case "resultados":
      return {
        sceneOverlays: (
          <>
            <DeformadaOverlay />
            {/* Forma modal (F2b): se autooculta sin modos o fuera de 3D. NO reutiliza
                datos de la deformada (lee del modalStore). */}
            <ModoOverlay />
            <CentroMasaOverlay />
            <CentroRigidezOverlay />
            {/* "Ver modelo de calculo" (F2c): tambien en Resultados (3D). */}
            <ModeloCalculoOverlay />
          </>
        ),
        // La leyenda de escala se QUEDA en el lienzo (control de lienzo: lee contra los
        // colores de la deformada). El resto de paneles de datos van al dock.
        hudOverlays: (
          <Slot zona="bottom-center">
            <LeyendaEscala />
          </Slot>
        ),
        // Calcular + estado del motor, combinacion activa, frecuencias/modos, tabla de
        // reacciones y diagramas: todos paneles de DATOS -> dock (secciones planas, con
        // scroll propio si desbordan).
        panelesDock: (
          <>
            <BotonCalcular />
            <ComboSelector />
            <PanelFrecuencias />
            <TablaReacciones />
            <PanelDiagramas />
          </>
        ),
      };
    case "isovalores":
      return {
        sceneOverlays: (
          <>
            {/* Mapa de color de la losa. Se autooculta sin resultados de placa (quads).
                No necesita la deformada ni el modelo de calculo: los isovalores son la
                lectura propia de F3. */}
            <IsovaloresOverlay />
          </>
        ),
        hudOverlays: null,
        // Calcular y elegir combinacion desde la propia pestana (la losa se calcula con
        // el resto de la obra), el panel de isovalores (selector + leyenda) y el
        // inspector del paño: paneles de datos -> dock.
        panelesDock: (
          <>
            <BotonCalcular />
            <ComboSelector />
            <PanelIsovalores />
            <InspectorPano />
          </>
        ),
      };
  }
}

export default function App() {
  useInicializarVistaActiva();
  // Arranque de persistencia (feature-15): rehidrata Modelo + plantillas del proyecto
  // activo desde IndexedDB y arranca ambos autosaves. Defensivo: si no hay IndexedDB,
  // la app sigue en memoria. Cierra el hueco que F9 dejo (autosave sin cablear). El
  // estado que devuelve alimenta el aviso del Shell (auditoria UX-L1).
  const avisoPersistencia = useArranquePersistencia();
  // Atajos de teclado globales (auditoria UX-A3/UX-A5): Ctrl+Z/Y undo/redo, F3/F4.
  useAtajosGlobales();
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
  const puedeColocarPano = usePuedeColocarPano();
  const coords = useCoordsThrottled();
  const persistenciaLista = usePersistenciaLista();
  // Feedback de calculo (auditoria UX-L6): mientras el motor trabaja, prioriza sobre el
  // mensaje contextual; null en reposo.
  const mensajeCalculo = useMensajeCalculo();
  // En 3D pleno se inhabilita la introduccion grafica y las ayudas 2D (calco DXF,
  // paneles de herramienta): se inspecciona, no se introduce (F2c, decision #3).
  const enPleno = useEnPleno();

  // Introduccion grafica de pilares: solo tiene sentido en la pestana de pilares.
  // Aunque los overlays se autoocultan (ColocacionPilar/PanelHerramientaPilar
  // solo actuan en modo "pilar"; InspectorPilar solo con un pilar seleccionado),
  // montarlos solo aqui mantiene limpia la composicion de las demas pestanas.
  const enPilares = pestana === "entradaPilares";

  // Espejo para vigas: los overlays de viga solo se montan en su pestana (igual que
  // los de pilar). Tambien se autoocultan segun herramienta/seleccion, pero acotar
  // el montaje mantiene limpias las demas pestanas.
  const enVigas = pestana === "entradaVigas";

  // Composicion por pestana (refactor "dock de paneles", PR1/PR2): una sola fuente de las
  // condiciones. Devuelve los overlays de escena/HUD (al Viewport) y los paneles de datos
  // de la pestana; dockDePestana les da cromo plano + añade la seccion "Ayudas" (CM/CR/
  // modelo de calculo) comun, y produce el `dock` que el Shell acopla y empuja el lienzo.
  const { sceneOverlays, hudOverlays, panelesDock } = composicionPestana(pestana, enPleno);
  const dock = dockDePestana(panelesDock);

  // El mensaje de calculo (motor trabajando) gana sobre todo lo demas; al terminar,
  // se restaura el contextual. Luego el mensaje de la herramienta activa prioriza sobre
  // el de la pestana. Si la herramienta esta activa pero no hay donde colocar, se guia a
  // crear/elegir planta (en vez de dejar que el clic falle en silencio). Pilares y vigas
  // siguen el mismo patron; cada pestana solo consulta su propia herramienta.
  const mensaje = mensajeCalculo
    ? mensajeCalculo
    : enPleno
      ? MENSAJE_3D
      : enPilares && herramienta === "pilar"
        ? puedeColocar
          ? MENSAJE_HERRAMIENTA_PILAR
          : MENSAJE_PILAR_SIN_TRAMO
        : enVigas && herramienta === "viga"
          ? puedeColocarViga
            ? MENSAJE_HERRAMIENTA_VIGA
            : MENSAJE_VIGA_SIN_TRAMO
          : enVigas && herramienta === "pano"
            ? puedeColocarPano
              ? MENSAJE_HERRAMIENTA_PANO
              : MENSAJE_PANO_SIN_TRAMO
            : MENSAJE_PESTANA[pestana];

  return (
    <Shell
      nombreObra="Obra sin título"
      status={{
        mensaje,
        snapActivo,
        ...(coords ? { coords } : {}),
      }}
      dock={dock}
      avisoPersistencia={avisoPersistencia}
    >
      {/* Señal de hidratacion (feature-16, D6): aparece cuando la persistencia ha
          rehidratado el Modelo (o decidido no persistir). Los specs E2E esperan por
          este nodo antes de actuar. `hidden`: no afecta al layout ni es visible. */}
      {persistenciaLista && <div data-testid="app-ready" hidden />}
      <Viewport sceneOverlays={sceneOverlays} hudOverlays={hudOverlays} />
    </Shell>
  );
}
