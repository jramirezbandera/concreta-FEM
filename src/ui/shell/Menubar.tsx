import * as Popover from "@radix-ui/react-popover";
import {
  vistaStore,
  modeloStore,
  seleccionStore,
  calculoStore,
  eliminarPilar,
  eliminarViga,
  eliminarPano,
} from "../../estado";
import {
  MENUS_POR_PESTANA,
  type AccionMenu,
  type MenuDef,
  type MenuItem as MenuItemDef,
} from "./menus";
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

// Menubar (Spec Diseno UI §2 / §3.2): menus contextuales que cambian con la
// pestana activa (criterio de aceptacion de feature-9). Cada menu abre un
// Popover (Radix, accesible). Los items pueden ser placeholders (string, sin
// accion) o accionables (objeto con `accion`); estos ultimos disparan un
// handler y cierran el Popover. Vocabulario CYPECAD.

// Borra el elemento seleccionado desde el menu "Edición". Los elementos borrables son
// pilar, viga y PAÑO (F3): se exige EXACTAMENTE uno seleccionado y que sea uno de esos
// tipos del modelo. Se lee el modelo con getModelo() JUSTO antes de construir el comando
// (invariante del `base`, CLAUDE.md §10). Si no aplica, no-op silencioso. Se exporta como
// costura de test (el clic real pasa por un Popover de Radix, inestable en jsdom).
// eslint-disable-next-line react-refresh/only-export-components
export function borrarSeleccion(): void {
  const ids = seleccionStore.getState().seleccion;
  if (ids.length !== 1) return;
  const base = modeloStore.getState().getModelo();
  const id = ids[0]!;
  if (base.pilares.some((p) => p.id === id)) {
    modeloStore.getState().ejecutar(eliminarPilar(base, id));
  } else if (base.vigas.some((v) => v.id === id)) {
    modeloStore.getState().ejecutar(eliminarViga(base, id));
  } else if (base.panos.some((pa) => pa.id === id)) {
    modeloStore.getState().ejecutar(eliminarPano(base, id));
  } else {
    return;
  }
  seleccionStore.getState().limpiar();
}

// Mapa accion -> handler. Centralizado para no hardcodear el dispatch inline y
// para que crezca de forma ordenada al activarse mas menus (F11..F15). Exportado
// como costura de test (ver borrarSeleccion).
// eslint-disable-next-line react-refresh/only-export-components
export const DISPATCH: Record<AccionMenu, () => void> = {
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

// Un item del desplegable. String -> placeholder (accion aun no cableada): se pinta
// como boton DESHABILITADO con title "próximamente", NO como un div inerte con clic
// muerto (auditoria UX-A1). Objeto -> boton accionable que dispara el handler y cierra
// el Popover (Popover.Close gestiona cierre y foco accesibles).
function Item({ item }: { item: MenuItemDef }) {
  // Se leen SIEMPRE (Reglas de Hooks); solo los items correspondientes los usan.
  const calcularDeshabilitado = useCalcularDeshabilitado();
  const puedeDeshacer = usePuedeDeshacer();
  const puedeRehacer = usePuedeRehacer();
  if (typeof item === "string") {
    // Placeholder: boton deshabilitado (afordancia clara de "aun no", cursor not-allowed
    // via .cx-menu-item:disabled). aria-disabled para lectores; sin onClick.
    return (
      <button
        type="button"
        className="cx-menu-item cx-menu-item--placeholder"
        disabled
        aria-disabled="true"
        title={PROXIMAMENTE}
      >
        {item}
      </button>
    );
  }
  // Items que dependen del estado: los del motor ("Calcular obra"/"Calcular modos") se
  // deshabilitan mientras se prepara el motor o hay un calculo en curso; "Deshacer"/
  // "Rehacer" segun la pila de undo. Deshabilitado: ni dispara la accion ni cierra el
  // Popover (Radix respeta el `disabled` del boton en Popover.Close).
  const deshabilitado =
    ((item.accion === "calcular" || item.accion === "calcularModos") &&
      calcularDeshabilitado) ||
    (item.accion === "deshacer" && !puedeDeshacer) ||
    (item.accion === "rehacer" && !puedeRehacer);
  return (
    <Popover.Close asChild>
      <button
        type="button"
        role="menuitem"
        className="cx-menu-item"
        onClick={DISPATCH[item.accion]}
        disabled={deshabilitado}
      >
        {item.etiqueta}
      </button>
    </Popover.Close>
  );
}

function MenuItem({ def }: { def: MenuDef }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={["cx-menu", def.strong && "cx-menu--strong"]
            .filter(Boolean)
            .join(" ")}
        >
          {def.etiqueta}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="cx-menu-content"
          align="start"
          sideOffset={4}
        >
          {def.items.length === 0 ? (
            <div className="cx-menu-empty">Sin acciones</div>
          ) : (
            def.items.map((item) => <Item key={etiquetaDe(item)} item={item} />)
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function Menubar() {
  const pestana = vistaStore((s) => s.pestanaActiva);
  const menus = MENUS_POR_PESTANA[pestana];

  return (
    <nav className="cx-menubar" aria-label="Menú principal">
      {menus.map((def) => (
        <MenuItem key={def.etiqueta} def={def} />
      ))}
    </nav>
  );
}
