import * as Menubar_ from "@radix-ui/react-menubar";
import {
  vistaStore,
  modeloStore,
  calculoStore,
} from "../../estado";
import {
  MENUS_POR_PESTANA,
  type AccionMenu,
  type MenuDef,
  type MenuItem as MenuItemDef,
} from "./menus";
// [D23] borrarSeleccion vive ahora en un helper compartido (mismo flujo para el menú
// Edición y el atajo Supr/Delete). Se re-exporta desde aquí para no romper la costura de
// test existente (Menubar.test.tsx importa `borrarSeleccion` de `./Menubar`).
import { borrarSeleccion } from "./borrarSeleccion";
// La accion "calcular" del menu necesita la orquestacion del calculo, pero el DISPATCH es
// un mapa IMPERATIVO (no es un componente, no puede usar hooks). Igual que `borrarSeleccion`
// (funcion plana que habla con los stores/servicios), se importa `calcularObra()`: la MISMA
// logica de calculo que usa el hook `useCalcular`, factorizada SIN hooks. `calcularObra()`
// vuelca SIEMPRE el progreso/errores al `calculoStore` por su sink por defecto, asi que el
// estado del menu queda reflejado en cualquier consumidor del store (boton del panel y
// brandbar) sin que aqui haga falta sink alguno. Boton y menu disparan el mismo corte
// vertical y convergen en el mismo estado.
import { calcularObra } from "../resultados/useCalcular";
// "Calcular modos" (F2b): dispara el camino MODAL. Espejo de calcularObra() pero sin
// hooks (DISPATCH es un mapa imperativo): lee el nº de modos del vistaStore y vuelca el
// estado al calculoStore (igual ciclo de vida del motor que el estatico).
import { calcularModos } from "../resultados/useSolicitarModos";
import { calculoHabilitado } from "../resultados/estadoMotorUI";

// Menubar (Spec Diseno UI §2 / §3.2): menus contextuales que cambian con la pestana activa
// (criterio de aceptacion de feature-9). [D12] Migrada de Popover a **Radix Menubar**: gana
// roles ARIA correctos (menubar/menu/menuitem), navegación con flechas y typeahead, sin
// reimplementar nada. Los items pueden ser placeholders (string, sin acción -> disabled) o
// accionables (objeto con `accion`); estos últimos disparan su handler vía onSelect y Radix
// cierra el menú. El DISPATCH y `borrarSeleccion` NO cambian (contratos de acción estables;
// costura de test intacta). Vocabulario CYPECAD.

// Se re-exporta la costura de test existente (Menubar.test.tsx importa `borrarSeleccion`
// de `./Menubar`); la lógica vive en el helper compartido (D23).
// eslint-disable-next-line react-refresh/only-export-components
export { borrarSeleccion };

// Mapa accion -> handler. Centralizado para no hardcodear el dispatch inline y
// para que crezca de forma ordenada al activarse mas menus (F11..F15). Exportado
// como costura de test (ver borrarSeleccion).
// eslint-disable-next-line react-refresh/only-export-components
export const DISPATCH: Record<AccionMenu, () => void> = {
  abrirDatosGenerales: () => vistaStore.getState().abrirDialogo("datosGenerales"),
  abrirGruposPlantas: () => vistaStore.getState().abrirDialogo("gruposPlantas"),
  abrirHipotesis: () => vistaStore.getState().abrirDialogo("hipotesis"),
  abrirOpcionesAnalisis: () =>
    vistaStore.getState().abrirDialogo("opcionesAnalisis"),
  activarHerramientaPilar: () => vistaStore.getState().setHerramienta("pilar"),
  activarHerramientaViga: () => vistaStore.getState().setHerramienta("viga"),
  activarHerramientaPano: () => vistaStore.getState().setHerramienta("pano"),
  borrarSeleccion,
  // El calculo es asincrono (CLAUDE.md §7): el menu lanza el pipeline y NO espera la promesa
  // (`void` la descarta deliberadamente). No es un "disparar y olvidar" ciego: `calcularObra()`
  // alimenta el `calculoStore`, asi que el progreso/errores quedan reflejados en cualquier
  // consumidor del store (boton del panel y brandbar), sin que el menu pase ningun sink.
  calcular: () => void calcularObra(),
  // "Calcular modos" (F2b): camino MODAL independiente. Lee el nº de modos del vistaStore
  // (transitorio, default 6; lo ajusta el PanelFrecuencias) y dispara calcularModos(),
  // que vuelca el progreso al calculoStore como hace calcularObra. Asincrono: `void`.
  calcularModos: () =>
    void calcularModos(vistaStore.getState().numModos),
  // Undo/redo del modeloStore (misma logica que el Brandbar). El menu los deshabilita
  // segun puedeDeshacer/puedeRehacer, asi que aqui solo se invoca la accion.
  deshacer: () => modeloStore.getState().deshacer(),
  rehacer: () => modeloStore.getState().rehacer(),
};

// Etiqueta visible de un item, sea string inerte u objeto accionable. Sirve de
// key estable y de texto del boton/fila.
function etiquetaDe(item: MenuItemDef): string {
  return typeof item === "string" ? item : item.etiqueta;
}

// Copy unico para los items de menu sin destino todavia (placeholders). Honesto: la
// accion llegara; hoy no hace nada, asi que el item se pinta DESHABILITADO en vez de
// como un clic muerto que no cierra el popover (auditoria UX-A1).
const PROXIMAMENTE = "Disponible próximamente";

// Disponibilidad del item "Calcular obra" segun el estado del calculo (calculoStore,
// fuente unica). Mismo criterio que el boton del panel y la brandbar: el helper
// compartido `calculoHabilitado` (estadoMotorUI.ts) decide; aqui solo se invierte para
// obtener "deshabilitado". Hook minimo y local: solo el item "calcular" se suscribe al
// store; los placeholders no.
function useCalcularDeshabilitado(): boolean {
  return calculoStore((s) => !calculoHabilitado(s.estadoMotor, s.calculando));
}

// Disponibilidad de undo/redo (patron del Brandbar): se leen SIEMPRE (Reglas de Hooks),
// pero solo los items "deshacer"/"rehacer" los consumen. La pila del modeloStore es la
// fuente unica; cualquier cambio de historial re-evalua estos booleanos.
function usePuedeDeshacer(): boolean {
  return modeloStore((s) => s.puedeDeshacer);
}
function usePuedeRehacer(): boolean {
  return modeloStore((s) => s.puedeRehacer);
}

// Un item del desplegable (Radix Menubar.Item). String -> placeholder (acción aún no
// cableada): Item DESHABILITADO con title "próximamente", NO un clic muerto (auditoría
// UX-A1). Objeto -> Item accionable que dispara su handler vía onSelect (Radix cierra el
// menú y gestiona el foco). Radix da role="menuitem", flechas y typeahead sin código extra.
function Item({ item }: { item: MenuItemDef }) {
  // Se leen SIEMPRE (Reglas de Hooks); solo los items correspondientes los usan.
  const calcularDeshabilitado = useCalcularDeshabilitado();
  const puedeDeshacer = usePuedeDeshacer();
  const puedeRehacer = usePuedeRehacer();
  if (typeof item === "string") {
    // Placeholder: Item deshabilitado (afordancia clara de "aún no"). Radix marca
    // data-disabled y aria-disabled; el copy "próximamente" va en el title.
    return (
      <Menubar_.Item
        className="cx-menu-item cx-menu-item--placeholder"
        disabled
        title={PROXIMAMENTE}
      >
        {item}
      </Menubar_.Item>
    );
  }
  // Items que dependen del estado: los del motor ("Calcular obra"/"Calcular modos") se
  // deshabilitan mientras se prepara el motor o hay un cálculo en curso; "Deshacer"/
  // "Rehacer" según la pila de undo. Radix no dispara onSelect en un Item disabled.
  const deshabilitado =
    ((item.accion === "calcular" || item.accion === "calcularModos") &&
      calcularDeshabilitado) ||
    (item.accion === "deshacer" && !puedeDeshacer) ||
    (item.accion === "rehacer" && !puedeRehacer);
  return (
    <Menubar_.Item
      className="cx-menu-item"
      disabled={deshabilitado}
      onSelect={DISPATCH[item.accion]}
    >
      {item.etiqueta}
    </Menubar_.Item>
  );
}

function MenuItem({ def }: { def: MenuDef }) {
  return (
    <Menubar_.Menu>
      <Menubar_.Trigger
        className={["cx-menu", def.strong && "cx-menu--strong"]
          .filter(Boolean)
          .join(" ")}
      >
        {def.etiqueta}
      </Menubar_.Trigger>
      <Menubar_.Portal>
        <Menubar_.Content
          className="cx-menu-content"
          align="start"
          sideOffset={4}
        >
          {def.items.length === 0 ? (
            <div className="cx-menu-empty">Sin acciones</div>
          ) : (
            def.items.map((item) => <Item key={etiquetaDe(item)} item={item} />)
          )}
        </Menubar_.Content>
      </Menubar_.Portal>
    </Menubar_.Menu>
  );
}

export function Menubar() {
  const pestana = vistaStore((s) => s.pestanaActiva);
  const menus = MENUS_POR_PESTANA[pestana];

  // El <nav aria-label="Menú principal"> se conserva como LANDMARK de navegación del Shell
  // (Shell.test lo localiza por ese role/nombre). Dentro, Radix Menubar.Root aporta
  // role="menubar" + navegación entre menús con flechas/typeahead. Un nav que envuelve un
  // menubar es válido: dos afordancias (landmark de página + widget de menú).
  return (
    <nav className="cx-menubar-nav" aria-label="Menú principal">
      <Menubar_.Root className="cx-menubar">
        {menus.map((def) => (
          <MenuItem key={def.etiqueta} def={def} />
        ))}
      </Menubar_.Root>
    </nav>
  );
}
