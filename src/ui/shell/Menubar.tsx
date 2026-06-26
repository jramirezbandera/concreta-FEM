import * as Popover from "@radix-ui/react-popover";
import {
  vistaStore,
  modeloStore,
  seleccionStore,
  calculoStore,
  eliminarPilar,
  eliminarViga,
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

// Menubar (Spec Diseno UI §2 / §3.2): menus contextuales que cambian con la
// pestana activa (criterio de aceptacion de feature-9). Cada menu abre un
// Popover (Radix, accesible). Los items pueden ser placeholders (string, sin
// accion) o accionables (objeto con `accion`); estos ultimos disparan un
// handler y cierran el Popover. Vocabulario CYPECAD.

// Borra el elemento seleccionado desde el menu "Edición". En F11/F12 los elementos
// borrables son pilar y viga: se exige EXACTAMENTE uno seleccionado y que sea un
// pilar o una viga del modelo. Se lee el modelo con getModelo() JUSTO antes de
// construir el comando (invariante del `base`, CLAUDE.md §10). Si no aplica, no-op
// silencioso. Se exporta como costura de test (el clic real pasa por un Popover de
// Radix, inestable en jsdom); mismo patron que clicSeleccionPilar en GeometriaModelo.
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
  activarHerramientaPilar: () => vistaStore.getState().setHerramienta("pilar"),
  activarHerramientaViga: () => vistaStore.getState().setHerramienta("viga"),
  borrarSeleccion,
  // El calculo es asincrono (CLAUDE.md §7): el menu lanza el pipeline y NO espera la promesa
  // (`void` la descarta deliberadamente). No es un "disparar y olvidar" ciego: `calcularObra()`
  // alimenta el `calculoStore`, asi que el progreso/errores quedan reflejados en cualquier
  // consumidor del store (boton del panel y brandbar), sin que el menu pase ningun sink.
  calcular: () => void calcularObra(),
};

// Etiqueta visible de un item, sea string inerte u objeto accionable. Sirve de
// key estable y de texto del boton/fila.
function etiquetaDe(item: MenuItemDef): string {
  return typeof item === "string" ? item : item.etiqueta;
}

// Disponibilidad del item "Calcular obra" segun el estado del calculo (calculoStore,
// fuente unica). Mismo criterio que el boton del panel (BotonCalcular): solo se admite
// lanzar el calculo con el motor "listo" (o "error", para reintentar) y sin un calculo en
// curso. Mientras se prepara el motor o se calcula, el item del menu queda deshabilitado.
// Hook minimo y local: solo el item "calcular" se suscribe al store; los placeholders no.
function useCalcularDeshabilitado(): boolean {
  return calculoStore(
    (s) =>
      s.calculando || !(s.estadoMotor === "listo" || s.estadoMotor === "error"),
  );
}

// Un item del desplegable. String -> fila inerte (placeholder, como en F9).
// Objeto -> boton accionable que dispara el handler y cierra el Popover. Se
// envuelve en Popover.Close (asChild) para que Radix gestione el cierre y el
// foco de forma accesible sin estado controlado manual.
function Item({ item }: { item: MenuItemDef }) {
  // Se lee SIEMPRE (Reglas de Hooks); solo el item "calcular" lo usa para deshabilitarse.
  // El resto de items accionables/placeholders ignoran este flag (no se ven afectados).
  const calcularDeshabilitado = useCalcularDeshabilitado();
  if (typeof item === "string") {
    return (
      <div className="cx-menu-empty" role="menuitem">
        {item}
      </div>
    );
  }
  // El item "Calcular obra" se deshabilita mientras se prepara el motor o hay un calculo en
  // curso (mismo criterio que el boton del panel). Deshabilitado: ni dispara la accion ni
  // cierra el Popover (Radix respeta el `disabled` del boton envuelto en Popover.Close).
  const deshabilitado = item.accion === "calcular" && calcularDeshabilitado;
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
