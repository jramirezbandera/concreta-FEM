import * as Popover from "@radix-ui/react-popover";
import {
  vistaStore,
  modeloStore,
  seleccionStore,
  eliminarPilar,
} from "../../estado";
import {
  MENUS_POR_PESTANA,
  type AccionMenu,
  type MenuDef,
  type MenuItem as MenuItemDef,
} from "./menus";

// Menubar (Spec Diseno UI §2 / §3.2): menus contextuales que cambian con la
// pestana activa (criterio de aceptacion de feature-9). Cada menu abre un
// Popover (Radix, accesible). Los items pueden ser placeholders (string, sin
// accion) o accionables (objeto con `accion`); estos ultimos disparan un
// handler y cierran el Popover. Vocabulario CYPECAD.

// Borra el elemento seleccionado desde el menu "Edición". En F11 el unico
// elemento borrable es un pilar: se exige EXACTAMENTE uno seleccionado y que sea
// un pilar del modelo. Se lee el modelo con getModelo() JUSTO antes de construir
// el comando (invariante del `base`, CLAUDE.md §10). Si no aplica, no-op silencioso.
// Se exporta como costura de test (el clic real pasa por un Popover de Radix,
// inestable en jsdom); mismo patron que clicSeleccionPilar en GeometriaModelo.
// eslint-disable-next-line react-refresh/only-export-components
export function borrarSeleccion(): void {
  const ids = seleccionStore.getState().seleccion;
  if (ids.length !== 1) return;
  const base = modeloStore.getState().getModelo();
  const pilarId = ids[0]!;
  if (!base.pilares.some((p) => p.id === pilarId)) return;
  modeloStore.getState().ejecutar(eliminarPilar(base, pilarId));
  seleccionStore.getState().limpiar();
}

// Mapa accion -> handler. Centralizado para no hardcodear el dispatch inline y
// para que crezca de forma ordenada al activarse mas menus (F11..F15). Exportado
// como costura de test (ver borrarSeleccion).
// eslint-disable-next-line react-refresh/only-export-components
export const DISPATCH: Record<AccionMenu, () => void> = {
  abrirGruposPlantas: () => vistaStore.getState().abrirDialogo("gruposPlantas"),
  activarHerramientaPilar: () => vistaStore.getState().setHerramienta("pilar"),
  borrarSeleccion,
};

// Etiqueta visible de un item, sea string inerte u objeto accionable. Sirve de
// key estable y de texto del boton/fila.
function etiquetaDe(item: MenuItemDef): string {
  return typeof item === "string" ? item : item.etiqueta;
}

// Un item del desplegable. String -> fila inerte (placeholder, como en F9).
// Objeto -> boton accionable que dispara el handler y cierra el Popover. Se
// envuelve en Popover.Close (asChild) para que Radix gestione el cierre y el
// foco de forma accesible sin estado controlado manual.
function Item({ item }: { item: MenuItemDef }) {
  if (typeof item === "string") {
    return (
      <div className="cx-menu-empty" role="menuitem">
        {item}
      </div>
    );
  }
  return (
    <Popover.Close asChild>
      <button
        type="button"
        role="menuitem"
        className="cx-menu-item"
        onClick={DISPATCH[item.accion]}
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
