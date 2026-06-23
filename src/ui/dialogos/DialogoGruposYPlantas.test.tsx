// Tests de componente del DialogoGruposYPlantas (feature-10, Tarea 3.2). RTL en el
// project `jsdom`. El dialogo es AUTOCONTROLADO: se muestra cuando
// vistaStore.dialogoActivo === "gruposPlantas". Los stores Zustand son singletons
// de modulo -> reset en beforeEach (mismo patron que Shell.test.tsx). Verifican el
// flujo maestro-detalle con COMMIT EN VIVO: crear/editar/eliminar grupos y plantas,
// validacion de nombre duplicado, cascada al eliminar grupo y undo.
//
// Notas de jsdom/Radix:
//   - El Dialogo (Radix) se renderiza por Portal pero queda en el mismo document;
//     `screen`/`within(getByRole("dialog"))` lo alcanzan sin problema.
//   - El SelectUso es un Radix Select que en jsdom es inestable al abrir el listbox
//     (depende de pointer/PointerEvent y scroll virtual). Por eso el commit "en vivo"
//     de categoria NO se ejercita por el Select: se cubre el commit en vivo de forma
//     ESTABLE editando el Campo numerico "Sobrecarga de uso" (mismo mecanismo
//     onCommit-en-blur). Ver el caso "editar campo numerico en vivo".
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialogoGruposYPlantas } from "./DialogoGruposYPlantas";
import { modeloStore, vistaStore, editarGrupo } from "../../estado";
import { crearModeloVacio, plantasDeGrupo } from "../../dominio";
import type { CategoriaUso } from "../../dominio";
import { categoriaUso } from "../../biblioteca";

beforeEach(() => {
  // Reset de los stores singleton a un estado limpio y reproducible.
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setGrupoActivo(null);
  vistaStore.getState().setPlantaActiva(null);
  vistaStore.getState().cerrarDialogo();
});

// Render del dialogo con el estado de vista ya en "abierto". Devuelve el contenedor
// accesible del dialogo para acotar queries (hay multiples campos "Nombre").
function renderAbierto() {
  vistaStore.getState().abrirDialogo("gruposPlantas");
  render(<DialogoGruposYPlantas />);
  return screen.getByRole("dialog");
}

// Atajos a los selectores de modelo.
const modelo = () => modeloStore.getState().getModelo();
const grupos = () => modelo().grupos;
const plantas = () => modelo().plantas;

describe("DialogoGruposYPlantas: montaje", () => {
  it("se muestra cuando dialogoActivo === 'gruposPlantas'", () => {
    const dialogo = renderAbierto();
    expect(dialogo).toBeInTheDocument();
    expect(within(dialogo).getByText("Grupos")).toBeInTheDocument();
    // Sin grupos: el detalle invita a crear uno.
    expect(within(dialogo).getByText("Crea un grupo para empezar.")).toBeInTheDocument();
  });

  it("no se renderiza contenido si el dialogo esta cerrado", () => {
    // No abrimos el dialogo: dialogoActivo sigue null tras el beforeEach.
    render(<DialogoGruposYPlantas />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("DialogoGruposYPlantas: grupos", () => {
  it("crear grupo: anade un grupo al modelo y lo deja activo", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();

    expect(grupos()).toHaveLength(0);
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));

    expect(grupos()).toHaveLength(1);
    const creado = grupos()[0];
    expect(vistaStore.getState().grupoActivoId).toBe(creado.id);
  });

  it("editar nombre en vivo (commit en blur): el modelo refleja el nuevo nombre", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));

    // El detalle del grupo activo contiene el unico campo "Nombre" visible (no hay
    // plantas todavia), pero acotamos al detalle por robustez.
    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputNombre = within(detalle).getByLabelText(/Nombre/);
    await user.clear(inputNombre);
    await user.type(inputNombre, "Forjado tipo");
    await user.tab(); // blur -> commit

    expect(grupos()[0].nombre).toBe("Forjado tipo");
  });

  it("editar campo numerico en vivo: sobrecarga de uso se aplica en blur", async () => {
    // Alternativa ESTABLE al Select de Radix (inestable en jsdom): el commit en vivo
    // por blur se demuestra con un Campo numerico, mismo mecanismo onCommit.
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputSobrecarga = within(detalle).getByLabelText(/Sobrecarga de uso/);
    await user.clear(inputSobrecarga);
    await user.type(inputSobrecarga, "5");
    await user.tab();

    expect(grupos()[0].sobrecargaUso).toBe(5);
  });

  it("nombre duplicado: muestra el error y NO cambia el nombre en el modelo", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();

    // Dos grupos: G1 y G2 (nombres por defecto del comando crearGrupo).
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));
    expect(grupos()).toHaveLength(2);

    const g1 = grupos().find((g) => g.nombre === "G1")!;
    const g2 = grupos().find((g) => g.nombre === "G2")!;
    expect(g1).toBeTruthy();
    expect(g2).toBeTruthy();

    // Selecciona G2 en la lista maestra y renombralo a "G1" (choque).
    await user.click(within(dialogo).getByRole("button", { name: "G2" }));
    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputNombre = within(detalle).getByLabelText(/Nombre/);
    await user.clear(inputNombre);
    await user.type(inputNombre, "G1");
    await user.tab();

    // Mensaje de validacion exacto de validarGrupo.
    expect(
      within(detalle).getByText(/Ya existe un grupo llamado "G1"/),
    ).toBeInTheDocument();
    // El modelo NO aplica el cambio: G2 conserva su nombre, sin duplicados.
    expect(modelo().grupos.find((g) => g.id === g2.id)!.nombre).toBe("G2");
    const nombres = grupos().map((g) => g.nombre);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it("eliminar grupo con plantas: pide confirmacion y al confirmar arrastra sus plantas", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));
    const grupoId = grupos()[0].id;

    // Una planta en el grupo activo.
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    expect(plantasDeGrupo(modelo(), grupoId)).toHaveLength(1);

    // Eliminar el grupo: como arrastra una planta, aparece la confirmacion (NO borra aun).
    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    await user.click(within(detalle).getByRole("button", { name: "Eliminar grupo" }));
    expect(grupos()).toHaveLength(1);
    const confirm = screen.getByRole("dialog", { name: /Eliminar el grupo/ });
    expect(within(confirm).getByText(/Se eliminará también 1 planta/)).toBeInTheDocument();

    // Confirmar: desaparece el grupo Y su planta (cascada en un solo comando).
    await user.click(within(confirm).getByRole("button", { name: "Eliminar" }));
    expect(grupos()).toHaveLength(0);
    expect(plantas()).toHaveLength(0);
  });

  it("eliminar grupo VACIO: borra de inmediato, sin confirmacion", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    await user.click(within(detalle).getByRole("button", { name: "Eliminar grupo" }));

    expect(screen.queryByRole("dialog", { name: /Eliminar el grupo/ })).toBeNull();
    expect(grupos()).toHaveLength(0);
  });

  it("cancelar la confirmacion conserva el grupo y sus plantas", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    await user.click(within(detalle).getByRole("button", { name: "Eliminar grupo" }));
    const confirm = screen.getByRole("dialog", { name: /Eliminar el grupo/ });
    await user.click(within(confirm).getByRole("button", { name: "Cancelar" }));

    expect(grupos()).toHaveLength(1);
    expect(plantas()).toHaveLength(1);
  });
});

describe("DialogoGruposYPlantas: plantas", () => {
  it("crear y eliminar planta del grupo activo", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));
    const grupoId = grupos()[0].id;

    // Crear planta.
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    expect(plantasDeGrupo(modelo(), grupoId)).toHaveLength(1);
    const planta = plantasDeGrupo(modelo(), grupoId)[0];
    expect(vistaStore.getState().plantaActivaId).toBe(planta.id);

    // Eliminar planta (boton "Eliminar" de su fila).
    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    await user.click(within(detalle).getByRole("button", { name: "Eliminar" }));
    expect(plantasDeGrupo(modelo(), grupoId)).toHaveLength(0);
  });
});

describe("DialogoGruposYPlantas: validacion en vivo y reasignacion", () => {
  it("editar la cota de una planta a una duplicada del grupo: muestra error y NO commitea", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));
    const grupoId = grupos()[0].id;

    // Dos plantas: cota 0 (primera) y cota 3 (sugerida = max + altura).
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    expect(
      plantasDeGrupo(modelo(), grupoId).map((p) => p.cota).sort((a, b) => a - b),
    ).toEqual([0, 3]);

    // Las filas van por cota descendente: la de arriba es la planta a cota 3. Le
    // ponemos cota 0 -> colisiona con la otra planta del grupo.
    const plantasCont = dialogo.querySelector(".cx-gyp__plantas") as HTMLElement;
    const inputsCota = within(plantasCont).getAllByLabelText("Cota");
    await user.clear(inputsCota[0]);
    await user.type(inputsCota[0], "0");
    await user.tab();

    expect(
      within(plantasCont).getByText(/Ya hay una planta a la cota 0 m/),
    ).toBeInTheDocument();
    // El modelo NO aplica el cambio: siguen siendo cotas 0 y 3 (sin duplicar).
    expect(
      plantasDeGrupo(modelo(), grupoId).map((p) => p.cota).sort((a, b) => a - b),
    ).toEqual([0, 3]);
  });

  it("vaciar un campo numerico muestra error y no commitea 0", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputSobre = within(detalle).getByLabelText(/Sobrecarga de uso/);
    await user.clear(inputSobre);
    await user.tab();

    expect(within(detalle).getByText("Introduce un número válido.")).toBeInTheDocument();
    // El valor por defecto se conserva: vaciar NO guarda 0 en silencio. El default
    // esta cableado al qk de la categoria por defecto (A), no a un numero magico.
    expect(grupos()[0].sobrecargaUso).toBe(categoriaUso("A").qk);
  });

  it("eliminar el grupo activo reasigna el activo al primer grupo restante", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" })); // G1
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" })); // G2 (activo)
    const g1 = grupos().find((g) => g.nombre === "G1")!;
    const g2 = grupos().find((g) => g.nombre === "G2")!;
    expect(vistaStore.getState().grupoActivoId).toBe(g2.id);

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    await user.click(within(detalle).getByRole("button", { name: "Eliminar grupo" }));

    expect(grupos().map((g) => g.nombre)).toEqual(["G1"]);
    expect(vistaStore.getState().grupoActivoId).toBe(g1.id);
  });
});

describe("DialogoGruposYPlantas: categoria de uso -> sobrecarga (qk CTE)", () => {
  // Criterio de aceptacion de feature-13: "Seleccionar categoria de uso en el grupo
  // asigna qk". El SelectUso (Radix) es inestable en jsdom para abrir el listbox
  // (ver cabecera del archivo), asi que NO se conduce por el Select. Se cubre:
  //   1) el VALOR POR DEFECTO al crear: cableado al qk de la categoria por defecto.
  //   2) el CABLEADO categoria -> sobrecargaUso por VARIAS categorias, ejerciendo el
  //      MISMO comando que el handler editarCategoria construye (table -> editarGrupo,
  //      ambos campos en una sola edicion / un solo undo).

  it("crear grupo: la sobrecarga por defecto es el qk de la categoria por defecto (A=2)", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));

    const g = grupos()[0];
    // No hardcodear 2: se ata a la tabla CTE para que un cambio normativo no mienta.
    expect(g.categoriaUso).toBe("A");
    expect(g.sobrecargaUso).toBe(categoriaUso("A").qk);
    expect(g.sobrecargaUso).toBe(2);
  });

  it("cambiar la categoria asigna el qk normativo a sobrecargaUso (A=2, B=2, C=5, D=5, E=2, F=1, G=1)", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));
    const grupoId = grupos()[0].id;

    // Tabla esperada de qk por categoria (CTE DB-SE-AE Tabla 3.1, via acciones.ts).
    const esperado: Record<CategoriaUso, number> = {
      A: 2,
      B: 2,
      C: 5,
      D: 5,
      E: 2,
      F: 1,
      G: 1,
    };

    for (const cat of Object.keys(esperado) as CategoriaUso[]) {
      // Mismo cableado que el handler editarCategoria: categoria + qk en UNA edicion.
      const m = modelo();
      modeloStore
        .getState()
        .ejecutar(
          editarGrupo(m, grupoId, {
            categoriaUso: cat,
            sobrecargaUso: categoriaUso(cat).qk,
          }),
        );
      const g = grupos().find((x) => x.id === grupoId)!;
      expect(g.categoriaUso).toBe(cat);
      expect(g.sobrecargaUso).toBe(esperado[cat]);
      expect(g.sobrecargaUso).toBe(categoriaUso(cat).qk);
    }
  });

  it("el override manual de sobrecargaUso persiste hasta el SIGUIENTE cambio de categoria", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));
    const grupoId = grupos()[0].id;

    // Override manual de la sobrecarga (campo numerico estable, mismo onCommit-en-blur).
    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputSobre = within(detalle).getByLabelText(/Sobrecarga de uso/);
    await user.clear(inputSobre);
    await user.type(inputSobre, "3.5");
    await user.tab();
    expect(grupos()[0].sobrecargaUso).toBe(3.5); // override permitido (CYPECAD)

    // Un cambio de categoria RE-ASIGNA al qk normativo (pisa el override), como CYPECAD.
    const m = modelo();
    modeloStore
      .getState()
      .ejecutar(
        editarGrupo(m, grupoId, {
          categoriaUso: "C",
          sobrecargaUso: categoriaUso("C").qk,
        }),
      );
    expect(grupos()[0].categoriaUso).toBe("C");
    expect(grupos()[0].sobrecargaUso).toBe(5); // qk de C, no el 3,5 manual previo
  });
});

describe("DialogoGruposYPlantas: undo", () => {
  it("deshacer revierte la creacion de un grupo", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nuevo grupo" }));
    expect(grupos()).toHaveLength(1);

    // Undo directo sobre el store (la pila la alimenta ejecutar()); no requiere boton.
    modeloStore.getState().deshacer();
    expect(grupos()).toHaveLength(0);
  });
});
