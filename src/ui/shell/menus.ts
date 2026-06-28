// Mapa pestana -> menus de la menubar (Spec Diseno UI §3.2). La menubar es
// dependiente del contexto: el SET de menus cambia con la pestana activa. En F9
// los menus no abren acciones reales (placeholder); lo que importa es que el
// conjunto cambie visiblemente. Vocabulario CYPECAD, etiquetas en espanol.
import type { Pestana } from "../../estado";

// Accion que dispara un item de menu. Union ampliable: a medida que F11..F15
// activen mas menus se anaden valores aqui (p. ej. "abrirCargas", "calcular").
export type AccionMenu =
  | "abrirGruposPlantas"
  | "abrirHipotesis"
  | "abrirOpcionesAnalisis"
  | "activarHerramientaPilar"
  | "activarHerramientaViga"
  | "borrarSeleccion"
  | "calcular"
  | "calcularModos";

// Un item de menu es, o bien un string inerte (placeholder, igual que en F9),
// o bien un item accionable con etiqueta + accion. Retrocompatible: los menus
// que aun no tienen acciones reales siguen usando strings.
export type MenuItem = string | { etiqueta: string; accion: AccionMenu };

export interface MenuDef {
  /** Etiqueta visible del menu (espanol con tildes). */
  etiqueta: string;
  /** Resalta el menu en acento (p. ej. "Calcular"). */
  strong?: boolean;
  /** Items del desplegable. Strings = placeholders; objetos = accionables. */
  items: MenuItem[];
}

// Items comunes (placeholders). Sin jerga FEM (CLAUDE.md §17).
const ARCHIVO: MenuDef = {
  etiqueta: "Archivo",
  items: ["Nueva obra", "Abrir...", "Guardar", "Exportar...", "Importar..."],
};
const OBRA: MenuDef = {
  etiqueta: "Obra",
  items: [
    "Datos generales",
    { etiqueta: "Plantas y grupos", accion: "abrirGruposPlantas" },
    "Materiales",
  ],
};
const EDICION: MenuDef = {
  etiqueta: "Edición",
  // "Eliminar" es accionable: borra el elemento seleccionado (en F11, un pilar).
  // El handler es seguro: no-op si no hay nada borrable, asi que compartir este
  // menu entre pestanas no introduce efectos no deseados.
  items: [
    "Deshacer",
    "Rehacer",
    "Copiar",
    "Pegar",
    { etiqueta: "Eliminar", accion: "borrarSeleccion" },
  ],
};
const GRUPOS: MenuDef = {
  etiqueta: "Grupos",
  // En F10 los tres abren el mismo dialogo de Plantas y grupos. El matiz de
  // "crear directamente" (nuevo grupo/planta sin pasar por el dialogo) se
  // afinara mas adelante.
  items: [
    { etiqueta: "Nuevo grupo", accion: "abrirGruposPlantas" },
    { etiqueta: "Nueva planta", accion: "abrirGruposPlantas" },
    { etiqueta: "Gestionar plantas y grupos", accion: "abrirGruposPlantas" },
  ],
};
const VISTAS: MenuDef = {
  etiqueta: "Vistas",
  items: ["Planta de grupo", "Vista 3D", "Mosaico", "Ajustar a ventana"],
};
const AYUDA: MenuDef = {
  etiqueta: "Ayuda",
  items: ["Manual", "Atajos de teclado", "Acerca de Concreta"],
};

// Mapa canonico. Las etiquetas y el orden replican el prototipo CYPECAD (§3.2).
export const MENUS_POR_PESTANA: Record<Pestana, MenuDef[]> = {
  entradaPilares: [
    ARCHIVO,
    OBRA,
    {
      etiqueta: "Introducción",
      items: [
        { etiqueta: "Pilar", accion: "activarHerramientaPilar" },
        "Arranque",
        "Cambiar sección",
      ],
    },
    EDICION,
    GRUPOS,
    VISTAS,
    AYUDA,
  ],
  entradaVigas: [
    ARCHIVO,
    OBRA,
    {
      etiqueta: "Vigas",
      items: [
        { etiqueta: "Viga", accion: "activarHerramientaViga" },
        "Cambiar sección",
        "Articular extremo",
      ],
    },
    { etiqueta: "Muros", items: ["Muro (disponible en fase posterior)"] },
    { etiqueta: "Paños", items: ["Paño (disponible en fase posterior)"] },
    {
      etiqueta: "Cargas",
      // "Hipótesis…" abre su dialogo (feature-13). La introduccion de cargas en si
      // vive en el Inspector del elemento, no en el menu (de ahi que "Carga lineal"
      // / "Carga superficial" sigan siendo placeholders por ahora).
      items: [
        "Carga lineal",
        "Carga superficial",
        { etiqueta: "Hipótesis…", accion: "abrirHipotesis" },
      ],
    },
    {
      etiqueta: "Calcular",
      strong: true,
      // "Calcular obra" dispara el corte vertical F1 (obra -> discretizar -> solver ->
      // resultados) via la accion "calcular". "Calcular modos" dispara el ANALISIS MODAL
      // (F2b, camino independiente): frecuencias propias + formas de vibracion.
      // "Opciones de cálculo…" abre el dialogo de Opciones de analisis (F2.4, spec §3.2):
      // tipo de analisis, peso propio, comprobar estatica.
      items: [
        { etiqueta: "Calcular obra", accion: "calcular" },
        { etiqueta: "Calcular modos", accion: "calcularModos" },
        { etiqueta: "Opciones de cálculo…", accion: "abrirOpcionesAnalisis" },
      ],
    },
    GRUPOS,
    VISTAS,
    AYUDA,
  ],
  resultados: [
    ARCHIVO,
    OBRA,
    { etiqueta: "Pilares", items: ["Esfuerzos", "Envolventes"] },
    { etiqueta: "Vigas", items: ["Esfuerzos", "Flecha", "Envolventes"] },
    { etiqueta: "Reacciones", items: ["Tabla de reacciones"] },
    { etiqueta: "Envolventes", items: ["Seleccionar combinación", "Animación"] },
    VISTAS,
    AYUDA,
  ],
  isovalores: [ARCHIVO, OBRA, VISTAS, AYUDA],
};
