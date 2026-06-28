// vistaStore: estado de la vista (pestana activa, grupo/planta activos, modo de
// vista, combinacion activa, plantillas/capturas). Estado de UI, no de obra: NO
// participa en undo. subscribeWithSelector por coherencia (el shell/viewport se
// suscriben a campos sueltos sin re-render global).
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
// Plantilla DXF (feature-15): ayuda de dibujo (calco), NO Capa 1. Vive en este
// store de UI; su contrato de datos puro esta en el modulo viewport/dxf.
import type { Plantilla, TransformPlantilla } from "../ui/viewport/dxf/tiposDxf";

// Parche de actualizacion de plantilla. Es `Partial<Plantilla>` pero con `transform`
// relajado a parcial: la UI puede mandar solo { transform: { escala } } (un solo
// control) sin reenviar x/y/rotacion/opacidad. Un parche con transform COMPLETO
// (que es Partial valido) sigue encajando, asi que no rompe a ningun llamador.
export type ParchePlantilla = Partial<Omit<Plantilla, "transform">> & {
  transform?: Partial<TransformPlantilla>;
};

// Las 4 pestanas CYPECAD (CLAUDE.md §11). Identificadores en ingles tecnico;
// las etiquetas visibles ("Entrada de pilares"...) las pone la UI.
export type Pestana =
  | "entradaPilares"
  | "entradaVigas"
  | "resultados"
  | "isovalores";

export type ModoVista = "planta" | "3d" | "mosaico";

// Dialogos modales de la app: Plantas y grupos (feature-10), Hipotesis
// (feature-13) y Opciones de analisis (F2.4). La introduccion de CARGAS no necesita
// dialogo propio: vive en el Inspector del elemento. Los siguientes (biblioteca de
// secciones...) se anaden aqui.
export type DialogoActivo = "gruposPlantas" | "hipotesis" | "opcionesAnalisis";

// Herramienta activa de introduccion grafica (feature-11/12). "seleccion" es el
// modo por defecto (picking/edicion); "pilar" coloca pilares con clic; "viga"
// coloca vigas con clic. Estado de UI.
export type Herramienta = "seleccion" | "pilar" | "viga";

// Magnitud que pinta el diagrama por barra en la pestana Resultados (feature-14).
// Mapea a los `*_array()` de PyNite: axil N, cortante Vy, flector Mz, flecha dy.
// Identificadores en ingles tecnico; las etiquetas visibles las pone la UI.
export type MagnitudDiagrama = "axil" | "cortante" | "momento" | "flecha";

// Valores por defecto del pilar que se introduce con la herramienta "pilar". La UI
// los preselecciona (seccion/material elegidos en el panel) y los aplica a cada
// pilar nuevo. No es estado de obra: viaja en vistaStore, no en undo.
export interface DefaultsPilar {
  seccionId: string | null;
  materialId: string | null;
  arranque: "empotrado" | "articulado" | "elastico";
  vinculacionExterior: boolean;
  angulo: number;
}

// Valores por defecto de la viga que se introduce con la herramienta "viga"
// (feature-12). Espejo de DefaultsPilar: la UI los preselecciona (seccion/material
// y vinculos de extremos) y los aplica a cada viga nueva. No es estado de obra.
export interface DefaultsViga {
  seccionId: string | null;
  materialId: string | null;
  extremoI: "empotrado" | "articulado";
  extremoJ: "empotrado" | "articulado";
  tirante: boolean;
}

// Valores por defecto de la carga que se introduce desde el Inspector del elemento
// (feature-13). Espejo de DefaultsPilar/DefaultsViga: la UI los preselecciona (tipo,
// valor e hipotesis elegidos) y los aplica a cada carga nueva. No es estado de obra:
// viaja en vistaStore, no en undo.
export interface DefaultsCarga {
  tipo: "lineal" | "puntual";
  valor: number;
  hipotesisId: string | null;
}

interface VistaState {
  pestanaActiva: Pestana;
  grupoActivoId: string | null;
  plantaActivaId: string | null;
  modoVista: ModoVista;
  combinacionActiva: string | null;
  // Dialogo modal abierto, o null si ninguno. Estado de UI puro: NO participa en
  // undo (coherente con el resto de vistaStore; ver cabecera del fichero).
  dialogoActivo: DialogoActivo | null;
  // Plantillas DXF importadas (feature-15): ayuda de dibujo (calco), fuera de
  // Capa 1 y fuera del undo. La persistencia-referencia (Dexie) las hidrata via
  // setPlantillas al abrir proyecto; la edicion (mover/escalar/ocultar) es set directo.
  plantillas: Plantilla[];
  // Plantilla seleccionada en el panel F4 (la que reciben los controles de
  // transform), o null si ninguna. No afecta a que plantillas se dibujan (eso lo
  // gobierna `visible` + planta activa), solo a cual se esta editando.
  plantillaActivaId: string | null;
  // Apertura del panel flotante de plantillas (herramienta F4). El boton F4 del
  // ToolsRail (T4.1) lo conmuta; el PanelPlantillas se muestra/oculta segun este
  // flag. Estado de UI puro: NO participa en undo.
  panelPlantillasAbierto: boolean;
  // Hidratacion de la persistencia completa (feature-15, T3). false hasta que
  // useArranquePersistencia termina de cargar Modelo + plantillas (o decide no
  // persistir). La importacion de DXF se gatea con esto: importar antes de que la
  // hidratacion asincrona resuelva podria perder el import (setPlantillas lo pisaria).
  persistenciaLista: boolean;
  // Slot de capturas; la captura PNG (T3.2) no necesita estado por ahora.
  capturas: unknown[];
  // Introduccion grafica de pilares (feature-11). El pilar seleccionado NO vive
  // aqui: es seleccionStore.seleccion[0]; aqui solo el modo y los defaults.
  herramienta: Herramienta;
  defaultsPilar: DefaultsPilar;
  defaultsViga: DefaultsViga;
  defaultsCarga: DefaultsCarga;
  snapActivo: boolean;
  // Overlay de CENTRO DE MASAS (F2.4, D-diseño-1). Toggle de ayuda de modelado:
  // dibuja el marcador ⊕ del CM de la planta activa + un panel HUD con coords/peso.
  // Apagado por defecto (regla de subtraccion: nunca siempre-visible). Disponible en
  // vista PLANTA tanto en pestanas de entrada como en Resultados; el CM se calcula
  // puro (sin solver), asi que es valido aunque no haya resultados. Estado de UI: NO
  // participa en undo (coherente con el resto de vistaStore).
  mostrarCentroMasa: boolean;
  // Visualizacion de resultados (feature-14). Estado de UI puro: NO participa en
  // undo. La inicializacion de `combinacionActiva` a la primera combo al fijar
  // resultados la hace el hook useCalcular; aqui solo viven los controles de vista.
  // Factor de amplificacion de la deformada (la real es imperceptible: m sobre m).
  deformadaEscala: number;
  // true mientras se anima la deformada (oscilacion 0->1->0). Lo conmuta la UI.
  animando: boolean;
  // Magnitud que pinta el diagrama por barra seleccionada.
  magnitudDiagrama: MagnitudDiagrama;
  setPestanaActiva(p: Pestana): void;
  setGrupoActivo(id: string | null): void;
  setPlantaActiva(id: string | null): void;
  setModoVista(m: ModoVista): void;
  setCombinacionActiva(c: string | null): void;
  abrirDialogo(d: DialogoActivo): void;
  cerrarDialogo(): void;
  setHerramienta(h: Herramienta): void;
  setDefaultsPilar(p: Partial<DefaultsPilar>): void; // merge superficial
  setDefaultsViga(p: Partial<DefaultsViga>): void; // merge superficial
  setDefaultsCarga(p: Partial<DefaultsCarga>): void; // merge superficial
  setSnapActivo(b: boolean): void;
  setMostrarCentroMasa(b: boolean): void;
  toggleCentroMasa(): void;
  setDeformadaEscala(e: number): void;
  setAnimando(b: boolean): void;
  setMagnitudDiagrama(m: MagnitudDiagrama): void;
  // --- Plantillas DXF (feature-15) ---
  setPlantillas(p: Plantilla[]): void;
  addPlantilla(p: Plantilla): void;
  quitarPlantilla(id: string): void;
  // Merge superficial sobre la plantilla con ese id; si `parche.transform` viene,
  // se mergea tambien superficialmente (la UI manda solo { transform: { escala } }).
  actualizarPlantilla(id: string, parche: ParchePlantilla): void;
  setPlantillaActiva(id: string | null): void;
  setPanelPlantillas(b: boolean): void;
  togglePanelPlantillas(): void;
  setPersistenciaLista(b: boolean): void;
}

export const vistaStore = create<VistaState>()(
  subscribeWithSelector((set) => ({
    pestanaActiva: "entradaPilares",
    grupoActivoId: null,
    plantaActivaId: null,
    modoVista: "planta",
    combinacionActiva: null,
    dialogoActivo: null,
    plantillas: [],
    plantillaActivaId: null,
    panelPlantillasAbierto: false,
    persistenciaLista: false,
    capturas: [],
    herramienta: "seleccion",
    defaultsPilar: {
      seccionId: null,
      materialId: null,
      arranque: "empotrado",
      vinculacionExterior: true,
      angulo: 0,
    },
    defaultsViga: {
      seccionId: null,
      materialId: null,
      extremoI: "empotrado",
      extremoJ: "empotrado",
      tirante: false,
    },
    defaultsCarga: {
      tipo: "lineal",
      valor: 0,
      hipotesisId: null,
    },
    snapActivo: true,
    mostrarCentroMasa: false,
    deformadaEscala: 1,
    animando: false,
    magnitudDiagrama: "momento",
    setPestanaActiva: (p) => set({ pestanaActiva: p }),
    setGrupoActivo: (id) => set({ grupoActivoId: id }),
    setPlantaActiva: (id) => set({ plantaActivaId: id }),
    setModoVista: (m) => set({ modoVista: m }),
    setCombinacionActiva: (c) => set({ combinacionActiva: c }),
    abrirDialogo: (d) => set({ dialogoActivo: d }),
    cerrarDialogo: () => set({ dialogoActivo: null }),
    setHerramienta: (h) => set({ herramienta: h }),
    setDefaultsPilar: (p) =>
      set((estado) => ({ defaultsPilar: { ...estado.defaultsPilar, ...p } })),
    setDefaultsViga: (p) =>
      set((estado) => ({ defaultsViga: { ...estado.defaultsViga, ...p } })),
    setDefaultsCarga: (p) =>
      set((estado) => ({ defaultsCarga: { ...estado.defaultsCarga, ...p } })),
    setSnapActivo: (b) => set({ snapActivo: b }),
    setMostrarCentroMasa: (b) => set({ mostrarCentroMasa: b }),
    toggleCentroMasa: () =>
      set((estado) => ({ mostrarCentroMasa: !estado.mostrarCentroMasa })),
    setDeformadaEscala: (e) => set({ deformadaEscala: e }),
    setAnimando: (b) => set({ animando: b }),
    setMagnitudDiagrama: (m) => set({ magnitudDiagrama: m }),
    // --- Plantillas DXF (feature-15). Set directo: fuera del undo, como el resto
    // del store. Sin Immer aqui (vistaStore no usa el middleware): copias nuevas. ---
    setPlantillas: (p) => set({ plantillas: p }),
    addPlantilla: (p) =>
      set((estado) => ({ plantillas: [...estado.plantillas, p] })),
    quitarPlantilla: (id) =>
      set((estado) => ({
        plantillas: estado.plantillas.filter((pl) => pl.id !== id),
        // Si se quita la activa, deja de haber plantilla en edicion.
        plantillaActivaId:
          estado.plantillaActivaId === id ? null : estado.plantillaActivaId,
      })),
    actualizarPlantilla: (id, parche) =>
      set((estado) => ({
        plantillas: estado.plantillas.map((pl) =>
          pl.id === id
            ? {
                ...pl,
                ...parche,
                // `transform` es un objeto anidado: si el parche lo trae, mergea
                // superficialmente (asi la UI puede mandar solo { transform: { escala } }
                // sin tener que reenviar x/y/rotacion/opacidad). Si no, conserva el actual.
                transform: parche.transform
                  ? { ...pl.transform, ...parche.transform }
                  : pl.transform,
              }
            : pl,
        ),
      })),
    setPlantillaActiva: (id) => set({ plantillaActivaId: id }),
    setPanelPlantillas: (b) => set({ panelPlantillasAbierto: b }),
    togglePanelPlantillas: () =>
      set((estado) => ({ panelPlantillasAbierto: !estado.panelPlantillasAbierto })),
    setPersistenciaLista: (b) => set({ persistenciaLista: b }),
  })),
);
