// vistaStore: estado de la vista (pestana activa, grupo/planta activos, modo de
// vista, combinacion activa, plantillas/capturas). Estado de UI, no de obra: NO
// participa en undo. subscribeWithSelector por coherencia (el shell/viewport se
// suscriben a campos sueltos sin re-render global).
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

// Las 4 pestanas CYPECAD (CLAUDE.md §11). Identificadores en ingles tecnico;
// las etiquetas visibles ("Entrada de pilares"...) las pone la UI.
export type Pestana =
  | "entradaPilares"
  | "entradaVigas"
  | "resultados"
  | "isovalores";

export type ModoVista = "planta" | "3d" | "mosaico";

// Dialogos modales de la app: Plantas y grupos (feature-10) e Hipotesis
// (feature-13). La introduccion de CARGAS no necesita dialogo propio: vive en el
// Inspector del elemento. Los siguientes (biblioteca de secciones...) se anaden aqui.
export type DialogoActivo = "gruposPlantas" | "hipotesis";

// Herramienta activa de introduccion grafica (feature-11/12). "seleccion" es el
// modo por defecto (picking/edicion); "pilar" coloca pilares con clic; "viga"
// coloca vigas con clic. Estado de UI.
export type Herramienta = "seleccion" | "pilar" | "viga";

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
  // Slots de plantillas DXF y capturas; se rellenan en feature-15. Tipos laxos
  // aqui a proposito (la forma la define F15); de momento son listas vacias.
  plantillas: unknown[];
  capturas: unknown[];
  // Introduccion grafica de pilares (feature-11). El pilar seleccionado NO vive
  // aqui: es seleccionStore.seleccion[0]; aqui solo el modo y los defaults.
  herramienta: Herramienta;
  defaultsPilar: DefaultsPilar;
  defaultsViga: DefaultsViga;
  defaultsCarga: DefaultsCarga;
  snapActivo: boolean;
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
  })),
);
