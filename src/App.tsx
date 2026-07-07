// App: ensamblaje de la interfaz (feature-9, Fase 2). Monta el Shell (cromo:
// brandbar/menubar/sidebar/work/tools/status/tabs) con el Viewport como work
// canvas. El Shell ocupa el alto completo (#root y body ya estan a height:100%
// en index.css), el Viewport llena el work canvas via su propio CSS.
//
// NO inventa geometria de obra: el modelo arranca vacio (crearModeloVacio) y el
// render de obra real llega en F11/12. Aqui solo se asegura que, SI existen
// plantas, la planta activa sea coherente (no quedar en null cuando hay algo que
// seleccionar, ni quedar apuntando a una planta de una obra anterior tras
// restaurar autosave o cambiar de proyecto).
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Shell,
  DockSeccion,
  ArchivoIO,
  useArranquePersistencia,
  useAtajosGlobales,
} from "./ui/shell";
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
import { suscribirAviso } from "./ui/viewport/hooks/avisoBus";
import { suscribirEnganche, leerEnganche } from "./ui/viewport/hooks/imanBus";
import { ProveedorModoPanel } from "./ui/primitivas";
import { ColocacionPilar } from "./ui/viewport/ColocacionPilar";
import { ColocacionViga } from "./ui/viewport/ColocacionViga";
import { ColocacionPano } from "./ui/viewport/ColocacionPano";
import { ColocacionMuro } from "./ui/viewport/ColocacionMuro";
import { OverlayPlantillas } from "./ui/viewport/OverlayPlantillas";
import { PanelPlantillas } from "./ui/plantillas";
import { tramoColocable } from "./ui/viewport/tramoPilar";
import { plantaColocableViga } from "./ui/viewport/tramoViga";
import { InspectorPilar, PanelHerramientaPilar } from "./ui/entradaPilares";
import { InspectorViga, PanelHerramientaViga } from "./ui/entradaVigas";
import { InspectorPano, PanelHerramientaPano } from "./ui/entradaPanos";
import { InspectorMuro, PanelHerramientaMuro } from "./ui/entradaMuros";
import {
  DialogoDatosGenerales,
  DialogoSeccionPersonalizada,
} from "./ui/dialogos";
import {
  DeformadaOverlay,
  EsfuerzosOverlay,
  BotonCalcular,
  ComboSelector,
  TablaReacciones,
  PanelDiagramas,
  LeyendaEscala,
  LeyendaEsfuerzos,
  SelectorOverlayResultados,
  ModoOverlay,
  PanelFrecuencias,
  IsovaloresOverlay,
  PanelIsovalores,
  LeyendaIsovalores,
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
    plantaActivaId: vista.plantaActivaId,
  });
  if (resuelta.plantaActivaId !== vista.plantaActivaId) {
    vista.setPlantaActiva(resuelta.plantaActivaId);
  }
}

// Mantiene la planta activa coherente con el modelo: al montar (modelo ya
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

// Cuando la herramienta esta activa pero NO hay donde colocar (edificio sin
// plantas), la barra avisa ANTES de que el clic caiga en vacio (el clic
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

// Guia contextual mientras la herramienta "muro" esta activa. Un muro se traza por su
// eje: dos clics (orto forzado). Lenguaje de obra, sin jerga FEM.
const MENSAJE_HERRAMIENTA_MURO =
  "Haz clic en dos puntos para trazar el eje de un muro (Esc termina)";

// Cuando la herramienta "muro" esta activa pero NO se puede colocar (sin tramo de
// plantas, o sin material por defecto elegido). Espejo del aviso de losas.
const MENSAJE_MURO_SIN_TRAMO =
  "Crea o selecciona una planta y elige un material para introducir un muro";

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

// Hay un tramo donde colocar pilares (edificio con plantas, o planta activa).
// Reacciona a cambios del modelo y del ambito activo. Reusa el helper PURO
// tramoColocable (misma logica que ColocacionPilar usa al colocar): una sola fuente
// de verdad para decidir si la colocacion es posible. Exportado como costura de test
// (la reactividad merece red; mismo patron que borrarSeleccion en Menubar).
// eslint-disable-next-line react-refresh/only-export-components
export function usePuedeColocarPilar(): boolean {
  const calcular = () =>
    tramoColocable(
      modeloStore.getState().getModelo(),
      vistaStore.getState().plantaActivaId,
    ) !== null;
  const [puede, setPuede] = useState(calcular);
  useEffect(() => {
    const recompute = () => setPuede(calcular());
    const desuscribir = [
      modeloStore.subscribe((s) => s.modelo, recompute),
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
    const { plantaActivaId, defaultsViga } = vistaStore.getState();
    return (
      plantaColocableViga(
        modeloStore.getState().getModelo(),
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
    const { plantaActivaId, defaultsPano } = vistaStore.getState();
    return (
      plantaColocableViga(
        modeloStore.getState().getModelo(),
        plantaActivaId,
      ) !== null && defaultsPano.materialId !== null
    );
  };
  const [puede, setPuede] = useState(calcular);
  useEffect(() => {
    const recompute = () => setPuede(calcular());
    const desuscribir = [
      modeloStore.subscribe((s) => s.modelo, recompute),
      vistaStore.subscribe((s) => s.plantaActivaId, recompute),
      vistaStore.subscribe((s) => s.defaultsPano, recompute),
    ];
    recompute();
    return () => desuscribir.forEach((u) => u());
  }, []);
  return puede;
}

// Se puede introducir un muro: hay tramo de plantas donde nace (tramoColocable !== null)
// Y hay material por defecto. Mismas DOS condiciones que ColocacionMuro comprueba antes
// de crear (fuente unica de la luz verde). Espejo de usePuedeColocarPano; el muro nace
// del EDIFICIO (tramoColocable, como el pilar), no de una sola planta.
// eslint-disable-next-line react-refresh/only-export-components
export function usePuedeColocarMuro(): boolean {
  const calcular = () => {
    const { plantaActivaId, defaultsMuro } = vistaStore.getState();
    return (
      tramoColocable(modeloStore.getState().getModelo(), plantaActivaId) !== null &&
      defaultsMuro.materialId !== null
    );
  };
  const [puede, setPuede] = useState(calcular);
  useEffect(() => {
    const recompute = () => setPuede(calcular());
    const desuscribir = [
      modeloStore.subscribe((s) => s.modelo, recompute),
      vistaStore.subscribe((s) => s.plantaActivaId, recompute),
      vistaStore.subscribe((s) => s.defaultsMuro, recompute),
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

// --- Corte UX-2.2 · Enganche del iman -> barra de estado ------------------------

// Etiqueta del enganche actual del iman ("Pilar P3", "Extremo de V2") o null. El bus
// DEDUPLICA (solo notifica al cambiar el enganche real), asi que el setState directo
// es barato aunque la herramienta emita en cada move.
function useEnganche(): string | null {
  const [enganche, setEnganche] = useState<string | null>(() => leerEnganche());
  useEffect(() => suscribirEnganche(setEnganche), []);
  return enganche;
}

// --- Corte UX-2.0 · Avisos puntuales de las herramientas -> barra de estado ----

// Duracion del aviso en pantalla (ms): suficiente para leerlo, corto para que no se
// enquiste sobre el mensaje contextual.
const AVISO_MS = 4000;

// Ultimo aviso emitido por una herramienta (avisoBus), o null. setState directo (los
// avisos son esporadicos: un clic que no creo nada, no alta frecuencia) con
// autolimpieza. Prioriza sobre el mensaje contextual, NO sobre el de calculo.
function useAvisoTransitorio(): string | null {
  const [aviso, setAviso] = useState<string | null>(null);
  useEffect(() => {
    let timer = 0;
    const off = suscribirAviso((texto) => {
      setAviso(texto);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAviso(null), AVISO_MS);
    });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, []);
  return aviso;
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
  // [D14 · PR3] Cabecera PINNED del dock (anatomía C): controles que quedan FIJOS arriba
  // del dock y NO scrollean ni colapsan (Resultados: Cálculo + Combinación). null si la
  // pestaña no tiene cabecera pinned.
  dockFijo: ReactNode;
  // Secciones COLAPSABLES del dock (scroll debajo de la cabecera pinned). Cada una envuelta
  // en DockSeccion (cablea el colapso a DockUIState).
  panelesDock: ReactNode;
}

// Seccion "Ayudas" del dock (PR2/PR3): los CONTROLES de Centro de masas, Centro de rigidez
// y "Ver modelo de cálculo". Comun a TODAS las pestanas. Cada uno es una sección colapsable
// propia (DockSeccion); ya no hacen return null fuera de su vista (D11/K-2), así que la
// sección persiste y el colapso guardado no se pierde al cambiar de vista.
function AyudasDock({ pestana }: { pestana: Pestana }) {
  return (
    <>
      <DockSeccion pestana={pestana} seccion="centroMasa">
        <CentroMasa />
      </DockSeccion>
      <DockSeccion pestana={pestana} seccion="centroRigidez">
        <CentroRigidez />
      </DockSeccion>
      <DockSeccion pestana={pestana} seccion="modeloCalculo">
        <ModeloCalculo />
      </DockSeccion>
    </>
  );
}

// Envuelve un panel del dock en una sección COLAPSABLE (DockSeccion). Azúcar para no repetir
// pestaña+clave en cada panel de la composición.
function Sec({
  pestana,
  seccion,
  children,
}: {
  pestana: Pestana;
  seccion: string;
  children: ReactNode;
}): ReactNode {
  return (
    <DockSeccion pestana={pestana} seccion={seccion}>
      {children}
    </DockSeccion>
  );
}

// Compone las cuatro piezas para la pestana activa. PURA: solo depende de `pestana` y
// `enPleno` (3D pleno gatea la introduccion grafica y las ayudas 2D). Cada panel se
// autooculta segun seleccion/resultados; acotar el montaje a su pestana mantiene
// limpias las demas. Sin duplicar condiciones.
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
        dockFijo: null,
        // Paneles de datos al dock, cada uno como SECCIÓN COLAPSABLE. El inspector
        // permanece tambien en 3D (se selecciona y se edita, F2c); la herramienta y el
        // calco DXF son ayudas 2D y se ocultan en 3D pleno.
        panelesDock: (
          <>
            <Sec pestana={pestana} seccion="herramienta">
              {!enPleno && <PanelHerramientaPilar />}
            </Sec>
            <Sec pestana={pestana} seccion="inspector">
              <InspectorPilar />
            </Sec>
            <Sec pestana={pestana} seccion="plantillas">
              {!enPleno && <PanelPlantillas />}
            </Sec>
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
            {/* Colocacion de muros (F3, muros): eje por dos clics (orto forzado). Menu
                "Muros" de esta pestana. Se autooculta salvo herramienta "muro" + planta. */}
            {!enPleno && <ColocacionMuro />}
            <ModeloCalculoOverlay />
          </>
        ),
        hudOverlays: null,
        dockFijo: null,
        // Inspectores de viga, paño y muro comparten la pestana: cada uno se autooculta
        // si la seleccion no es de su tipo (solo uno se muestra a la vez). Herramientas
        // y calco DXF: ayudas 2D, ocultas en 3D pleno.
        panelesDock: (
          <>
            <Sec pestana={pestana} seccion="herramienta">
              {!enPleno && <PanelHerramientaViga />}
            </Sec>
            <Sec pestana={pestana} seccion="herramientaPano">
              {!enPleno && <PanelHerramientaPano />}
            </Sec>
            <Sec pestana={pestana} seccion="herramientaMuro">
              {!enPleno && <PanelHerramientaMuro />}
            </Sec>
            <Sec pestana={pestana} seccion="inspector">
              <InspectorViga />
            </Sec>
            <Sec pestana={pestana} seccion="inspectorPano">
              <InspectorPano />
            </Sec>
            <Sec pestana={pestana} seccion="inspectorMuro">
              <InspectorMuro />
            </Sec>
            <Sec pestana={pestana} seccion="plantillas">
              {!enPleno && <PanelPlantillas />}
            </Sec>
          </>
        ),
      };
    case "resultados":
      return {
        sceneOverlays: (
          <>
            <DeformadaOverlay />
            {/* Diagramas de esfuerzos N/V/M sobre las barras: se autooculta salvo con
                el overlay "esfuerzos" activo (D9) y fuera de planta. */}
            <EsfuerzosOverlay />
            {/* Forma modal (F2b): se autooculta sin modos o fuera de 3D. NO reutiliza
                datos de la deformada (lee del modalStore). */}
            <ModoOverlay />
            <CentroMasaOverlay />
            <CentroRigidezOverlay />
            {/* "Ver modelo de calculo" (F2c): tambien en Resultados (3D). */}
            <ModeloCalculoOverlay />
          </>
        ),
        // Los controles de LIENZO se quedan en glass (leen contra los colores de la
        // escena); el resto de paneles de datos van al dock. [D10] Anclados a la DERECHA
        // (Slot mid-right, vertical): conmutador Deformada|Esfuerzos arriba y, debajo, la
        // leyenda del overlay activo (cada una se autooculta si no es el suyo, D9).
        hudOverlays: (
          <Slot zona="mid-right">
            <SelectorOverlayResultados />
            <LeyendaEscala />
            <LeyendaEsfuerzos />
          </Slot>
        ),
        // [D14 · PR3] Anatomía C: "Cálculo" (BotonCalcular) + "Combinación" (ComboSelector)
        // van PINNED arriba del dock (no colapsan ni scrollean). El resto scrollea debajo.
        dockFijo: (
          <>
            <BotonCalcular />
            <ComboSelector />
          </>
        ),
        // Frecuencias/modos, tabla de reacciones y diagramas: secciones colapsables.
        panelesDock: (
          <>
            <Sec pestana={pestana} seccion="frecuencias">
              <PanelFrecuencias />
            </Sec>
            <Sec pestana={pestana} seccion="reacciones">
              <TablaReacciones />
            </Sec>
            <Sec pestana={pestana} seccion="diagramas">
              <PanelDiagramas />
            </Sec>
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
        // [D10] La RAMPA de color de los isovalores va en glass junto al lienzo (Slot
        // mid-right, vertical): misma ubicacion/orientacion que la leyenda de la deformada.
        // Se autooculta sin resultados de placa.
        hudOverlays: (
          <Slot zona="mid-right">
            <LeyendaIsovalores />
          </Slot>
        ),
        // Calcular + Combinación PINNED (como en Resultados: la losa se calcula con el resto
        // de la obra). El panel de isovalores y el inspector del paño: secciones colapsables.
        dockFijo: (
          <>
            <BotonCalcular />
            <ComboSelector />
          </>
        ),
        panelesDock: (
          <>
            <Sec pestana={pestana} seccion="isovalores">
              <PanelIsovalores />
            </Sec>
            <Sec pestana={pestana} seccion="inspectorPano">
              <InspectorPano />
            </Sec>
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
  // [D13] Devuelve además el nombre real del proyecto activo (para el Brandbar), el id
  // activo (para el diálogo Datos generales) y `refrescarNombre` (relee el nombre tras
  // renombrar). El nombre es metadato de persistencia (NO Capa 1, NO undo).
  const { aviso, nombreObra, proyectoActivoId, refrescarNombre } =
    useArranquePersistencia();
  // Atajos de teclado globales (auditoria UX-A3/UX-A5 + D23): Ctrl+Z/Y undo/redo, F3/F4,
  // Supr/Delete borrar selección, 1-4 cambiar de pestaña.
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
  const puedeColocarMuro = usePuedeColocarMuro();
  const coords = useCoordsThrottled();
  const persistenciaLista = usePersistenciaLista();
  // Feedback de calculo (auditoria UX-L6): mientras el motor trabaja, prioriza sobre el
  // mensaje contextual; null en reposo.
  const mensajeCalculo = useMensajeCalculo();
  // Aviso puntual de una herramienta (UX-2.0): prioriza sobre el contextual unos segundos.
  const avisoHerramienta = useAvisoTransitorio();
  // Enganche del iman (UX-2.2): "Pilar P3" / "Extremo de V2" mientras el cursor engancha.
  const enganche = useEnganche();
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

  // Composicion por pestana (refactor "dock de paneles", PR1/PR2/PR3): una sola fuente de
  // las condiciones. Devuelve los overlays de escena/HUD (al Viewport) y las piezas del dock
  // de la pestana. [D14 · PR3] El dock se estructura en dos regiones: una cabecera PINNED
  // (dockFijo, anatomía C: Cálculo + Combinación en Resultados/Isovalores) que no scrollea,
  // y las secciones COLAPSABLES (panelesDock + Ayudas comunes) que scrollean debajo. Todo en
  // cromo PLANO (ProveedorModoPanel). El Shell acopla el dock y empuja el lienzo.
  const { sceneOverlays, hudOverlays, dockFijo, panelesDock } = composicionPestana(
    pestana,
    enPleno,
  );
  const dock = (
    <ProveedorModoPanel modo="plano">
      {dockFijo != null && dockFijo !== false && (
        <div className="cx-dock__fijo">{dockFijo}</div>
      )}
      <div className="cx-dock__scroll">
        {panelesDock}
        <AyudasDock pestana={pestana} />
      </div>
    </ProveedorModoPanel>
  );

  // El mensaje de calculo (motor trabajando) gana sobre todo lo demas; al terminar,
  // se restaura el contextual. Luego el mensaje de la herramienta activa prioriza sobre
  // el de la pestana. Si la herramienta esta activa pero no hay donde colocar, se guia a
  // crear/elegir planta (en vez de dejar que el clic falle en silencio). Pilares y vigas
  // siguen el mismo patron; cada pestana solo consulta su propia herramienta.
  const mensaje = mensajeCalculo
    ? mensajeCalculo
    : avisoHerramienta
      ? avisoHerramienta
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
              : enVigas && herramienta === "muro"
                ? puedeColocarMuro
                  ? MENSAJE_HERRAMIENTA_MURO
                  : MENSAJE_MURO_SIN_TRAMO
                : MENSAJE_PESTANA[pestana];

  return (
    <Shell
      nombreObra={nombreObra}
      status={{
        mensaje,
        snapActivo,
        enganche,
        ...(coords ? { coords } : {}),
      }}
      dock={dock}
      avisoPersistencia={aviso}
    >
      {/* Señal de hidratacion (feature-16, D6): aparece cuando la persistencia ha
          rehidratado el Modelo (o decidido no persistir). Los specs E2E esperan por
          este nodo antes de actuar. `hidden`: no afecta al layout ni es visible. */}
      {persistenciaLista && <div data-testid="app-ready" hidden />}
      <Viewport sceneOverlays={sceneOverlays} hudOverlays={hudOverlays} />
      {/* [D13d] Diálogos montados una vez (auto-gateados por dialogoActivo). Radix Dialog
          portalea a body, así que su ubicación en el árbol no afecta al layout. Datos
          generales recibe el id/nombre del proyecto activo (metadato de persistencia) y el
          refresco del Brandbar tras renombrar. Sección personalizada (D3, otro agente) se
          monta aquí porque su fichero ya existe. */}
      <DialogoDatosGenerales
        proyectoActivoId={proyectoActivoId}
        nombreActual={nombreObra}
        onRenombrado={refrescarNombre}
      />
      {/* D2 · Importar del menú Archivo: file picker + confirmación + aviso de error.
          Recibe el nombre de la obra actual (texto de la confirmación) y refresca el
          Brandbar tras importar (el proyecto activo pasa a ser el importado). */}
      <ArchivoIO nombreObraActual={nombreObra} onImportado={refrescarNombre} />
      <DialogoSeccionPersonalizada />
    </Shell>
  );
}
