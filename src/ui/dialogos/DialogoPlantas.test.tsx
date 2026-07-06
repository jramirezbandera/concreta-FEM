// Tests de componente del DialogoPlantas (feature-10, portado a F3.4 "plantas sin
// grupos"; sustituye a DialogoGruposYPlantas.test.tsx). RTL en el project `jsdom`. El
// dialogo es AUTOCONTROLADO: se muestra cuando vistaStore.dialogoActivo === "plantas".
// Los stores Zustand son singletons de modulo -> reset en beforeEach (mismo patron
// que Shell.test.tsx). Verifican el flujo maestro-detalle con COMMIT EN VIVO:
// crear/editar/eliminar plantas, validacion de nombre y cota duplicados, cascada al
// eliminar planta con dependientes, notas de honestidad y undo.
//
// Notas de jsdom/Radix:
//   - El Dialogo (Radix) se renderiza por Portal pero queda en el mismo document;
//     `screen`/`within(getByRole("dialog"))` lo alcanzan sin problema.
//   - El SelectUso es un Radix Select que en jsdom es inestable al abrir el listbox
//     (depende de pointer/PointerEvent y scroll virtual). Por eso el commit "en vivo"
//     de categoria NO se ejercita por el Select: se cubre el CABLEADO categoria->qk
//     ejerciendo el MISMO comando que el handler editarCategoria construye, y el
//     commit en vivo por blur con el Campo numerico "Sobrecarga de uso".
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DialogoPlantas } from "./DialogoPlantas";
import { modeloStore, vistaStore, editarPlanta } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { CategoriaUso, Modelo } from "../../dominio";
import { categoriaUso } from "../../biblioteca";

beforeEach(() => {
  // Reset de los stores singleton a un estado limpio y reproducible.
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setPlantaActiva(null);
  vistaStore.getState().cerrarDialogo();
});

// Render del dialogo con el estado de vista ya en "abierto". Devuelve el contenedor
// accesible del dialogo para acotar queries.
function renderAbierto(): HTMLElement {
  vistaStore.getState().abrirDialogo("plantas");
  render(<DialogoPlantas />);
  return screen.getByRole("dialog");
}

// Atajos a los selectores de modelo.
const modelo = () => modeloStore.getState().getModelo();
const plantas = () => modelo().plantas;

// Boton del maestro que representa una planta con ese nombre (su accessible name
// incluye nombre + cota, p.ej. "Planta 1 0 m"): lo localiza por regex del nombre.
function botonPlanta(dialogo: HTMLElement, nombre: string): HTMLElement {
  return within(dialogo).getByRole("button", {
    name: new RegExp(`^${nombre}\\b`),
  });
}

describe("DialogoPlantas: montaje", () => {
  it("se muestra cuando dialogoActivo === 'plantas'", () => {
    const dialogo = renderAbierto();
    expect(dialogo).toBeInTheDocument();
    // Titulo del dialogo (getByRole dialog tiene name = titulo).
    expect(dialogo).toHaveAccessibleName("Plantas");
    // Sin plantas: el detalle invita a crear una.
    expect(
      within(dialogo).getByText("Crea una planta para empezar."),
    ).toBeInTheDocument();
  });

  it("no se renderiza contenido si el dialogo esta cerrado", () => {
    // No abrimos el dialogo: dialogoActivo sigue null tras el beforeEach.
    render(<DialogoPlantas />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("DialogoPlantas: crear plantas", () => {
  it("crear planta: anade una planta al modelo y la deja activa", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();

    expect(plantas()).toHaveLength(0);
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));

    expect(plantas()).toHaveLength(1);
    const creada = plantas()[0];
    expect(vistaStore.getState().plantaActivaId).toBe(creada.id);
  });

  it("la primera planta arranca a cota 0; la segunda a la cabeza de la mas alta", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    // 1a planta: cota 0, altura 3.
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    // 2a planta: cota sugerida = cota(0) + altura(3) = 3.
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    const cotas = plantas()
      .map((p) => p.cota)
      .sort((a, b) => a - b);
    expect(cotas).toEqual([0, 3]);
  });

  it("defaults de la planta nueva: categoria A, SU = qk(A) = 2, CM = 1", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));

    const p = plantas()[0];
    expect(p.categoriaUso).toBe("A");
    // No hardcodear 2: se ata a la tabla CTE para que un cambio normativo no mienta.
    expect(p.sobrecargaUso).toBe(categoriaUso("A").qk);
    expect(p.sobrecargaUso).toBe(2);
    expect(p.cargasMuertas).toBe(1);
  });
});

describe("DialogoPlantas: editar en vivo (commit en blur)", () => {
  it("editar nombre en vivo: el modelo refleja el nuevo nombre", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputNombre = within(detalle).getByLabelText(/Nombre/);
    await user.clear(inputNombre);
    await user.type(inputNombre, "Forjado tipo");
    await user.tab(); // blur -> commit

    expect(plantas()[0].nombre).toBe("Forjado tipo");
  });

  it("editar campo numerico en vivo: sobrecarga de uso se aplica en blur", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputSobrecarga = within(detalle).getByLabelText(/Sobrecarga de uso/);
    await user.clear(inputSobrecarga);
    await user.type(inputSobrecarga, "5");
    await user.tab();

    expect(plantas()[0].sobrecargaUso).toBe(5);
  });

  it("nombre duplicado: muestra el error y NO cambia el nombre en el modelo", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();

    // Dos plantas: "Planta 1" y "Planta 2" (nombres por defecto del comando).
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    expect(plantas()).toHaveLength(2);

    const p1 = plantas().find((p) => p.nombre === "Planta 1")!;
    const p2 = plantas().find((p) => p.nombre === "Planta 2")!;
    expect(p1).toBeTruthy();
    expect(p2).toBeTruthy();

    // Selecciona "Planta 2" en la lista maestra y renombrala a "Planta 1" (choque).
    await user.click(botonPlanta(dialogo, "Planta 2"));
    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputNombre = within(detalle).getByLabelText(/Nombre/);
    await user.clear(inputNombre);
    await user.type(inputNombre, "Planta 1");
    await user.tab();

    // Mensaje de validacion de validarPlanta.
    expect(
      within(detalle).getByText(/Ya existe una planta llamada "Planta 1"/),
    ).toBeInTheDocument();
    // El modelo NO aplica el cambio: "Planta 2" conserva su nombre, sin duplicados.
    expect(modelo().plantas.find((p) => p.id === p2.id)!.nombre).toBe("Planta 2");
    const nombres = plantas().map((p) => p.nombre);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it("editar la cota a una duplicada del edificio: muestra error y NO commitea", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();

    // Dos plantas: cota 0 (primera) y cota 3 (sugerida = max + altura).
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    expect(
      plantas()
        .map((p) => p.cota)
        .sort((a, b) => a - b),
    ).toEqual([0, 3]);

    // La planta activa es la ultima creada (cota 3). Le ponemos cota 0 -> colisiona.
    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputCota = within(detalle).getByLabelText("Cota");
    await user.clear(inputCota);
    await user.type(inputCota, "0");
    await user.tab();

    expect(
      within(detalle).getByText(/Ya hay una planta a la cota 0 m/),
    ).toBeInTheDocument();
    // El modelo NO aplica el cambio: siguen siendo cotas 0 y 3 (sin duplicar).
    expect(
      plantas()
        .map((p) => p.cota)
        .sort((a, b) => a - b),
    ).toEqual([0, 3]);
  });

  it("vaciar un campo numerico muestra error y no commitea 0", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputSobre = within(detalle).getByLabelText(/Sobrecarga de uso/);
    await user.clear(inputSobre);
    await user.tab();

    expect(
      within(detalle).getByText("Introduce un número válido."),
    ).toBeInTheDocument();
    // El valor por defecto (qk de la categoria A) se conserva: vaciar NO guarda 0.
    expect(plantas()[0].sobrecargaUso).toBe(categoriaUso("A").qk);
  });
});

describe("DialogoPlantas: eliminar plantas", () => {
  it("eliminar planta VACIA: borra de inmediato, sin confirmacion", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    await user.click(within(detalle).getByRole("button", { name: "Eliminar planta" }));

    expect(screen.queryByRole("dialog", { name: /Eliminar/ })).toBeNull();
    expect(plantas()).toHaveLength(0);
  });

  it("eliminar planta con dependientes: pide confirmacion (incluye paños) y arrastra en cascada", async () => {
    const user = userEvent.setup();
    // Modelo con una planta que arrastra un pilar, una viga y un paño.
    const m: Modelo = {
      ...crearModeloVacio(),
      plantas: [
        {
          id: "p1", nombre: "Planta 1", cota: 0, altura: 3,
          categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0,
        },
      ],
      nudos: [
        { id: "n1", x: 0, y: 0 },
        { id: "n2", x: 5, y: 0 },
        { id: "n3", x: 5, y: 5 },
        { id: "n4", x: 0, y: 5 },
      ],
      pilares: [
        {
          id: "pil1", nombre: "P1", x: 0, y: 0,
          plantaInicial: "p1", plantaFinal: "p1",
          seccionId: "s1", materialId: "m1", angulo: 0,
          vinculacionExterior: true, arranque: "empotrado",
        },
      ],
      vigas: [
        {
          id: "vg1", nombre: "V1", plantaId: "p1", nudoI: "n1", nudoJ: "n2",
          seccionId: "s1", materialId: "m1",
          extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
        },
      ],
      panos: [
        {
          id: "pa1", nombre: "Losa 1", tipo: "losa", plantaId: "p1",
          perimetro: ["n1", "n2", "n3", "n4"], materialId: "m1",
          espesor: 0.25, tamMalla: 0.5, bordeApoyo: "simple",
        },
      ],
    };
    modeloStore.getState().cargarModelo(m);
    vistaStore.getState().setPlantaActiva("p1");
    vistaStore.getState().abrirDialogo("plantas");
    render(<DialogoPlantas />);
    const dialogo = screen.getByRole("dialog", { name: "Plantas" });

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    await user.click(within(detalle).getByRole("button", { name: "Eliminar planta" }));

    // Arrastra dependientes -> aparece la confirmacion (NO borra aun).
    expect(plantas()).toHaveLength(1);
    const confirm = screen.getByRole("dialog", { name: /Eliminar/ });
    // La frase menciona los dependientes, incluidos los paños.
    expect(within(confirm).getByText(/paño/i)).toBeInTheDocument();

    // Confirmar: desaparece la planta y todo lo que arrastra (cascada en un comando).
    await user.click(within(confirm).getByRole("button", { name: "Eliminar" }));
    expect(plantas()).toHaveLength(0);
    expect(modelo().pilares).toHaveLength(0);
    expect(modelo().vigas).toHaveLength(0);
    expect(modelo().panos).toHaveLength(0);
  });
});

describe("DialogoPlantas: categoria de uso -> sobrecarga (qk CTE)", () => {
  // El SelectUso (Radix) es inestable en jsdom para abrir el listbox (ver cabecera),
  // asi que NO se conduce por el Select. Se cubre el CABLEADO categoria -> sobrecargaUso
  // por VARIAS categorias, ejerciendo el MISMO comando que editarCategoria construye
  // (editarPlanta con ambos campos en una sola edicion / un solo undo).
  it("cambiar la categoria asigna el qk normativo (A=2, B=2, C=5, D=5, E=2, F=1, G=1)", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    const plantaId = plantas()[0].id;

    const esperado: Record<CategoriaUso, number> = {
      A: 2, B: 2, C: 5, D: 5, E: 2, F: 1, G: 1,
    };

    for (const cat of Object.keys(esperado) as CategoriaUso[]) {
      // Mismo cableado que el handler editarCategoria: categoria + qk en UNA edicion.
      const m = modelo();
      modeloStore
        .getState()
        .ejecutar(
          editarPlanta(m, plantaId, {
            categoriaUso: cat,
            sobrecargaUso: categoriaUso(cat).qk,
          }),
        );
      const p = plantas().find((x) => x.id === plantaId)!;
      expect(p.categoriaUso).toBe(cat);
      expect(p.sobrecargaUso).toBe(esperado[cat]);
      expect(p.sobrecargaUso).toBe(categoriaUso(cat).qk);
    }
  });

  it("el override manual de sobrecargaUso persiste hasta el SIGUIENTE cambio de categoria", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    const plantaId = plantas()[0].id;

    // Override manual de la sobrecarga (campo numerico estable, mismo onCommit-en-blur).
    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputSobre = within(detalle).getByLabelText(/Sobrecarga de uso/);
    await user.clear(inputSobre);
    await user.type(inputSobre, "3.5");
    await user.tab();
    expect(plantas()[0].sobrecargaUso).toBe(3.5); // override permitido (CYPECAD)

    // Un cambio de categoria RE-ASIGNA al qk normativo (pisa el override), como CYPECAD.
    const m = modelo();
    modeloStore
      .getState()
      .ejecutar(
        editarPlanta(m, plantaId, {
          categoriaUso: "C",
          sobrecargaUso: categoriaUso("C").qk,
        }),
      );
    expect(plantas()[0].categoriaUso).toBe("C");
    expect(plantas()[0].sobrecargaUso).toBe(5); // qk de C, no el 3,5 manual previo
  });
});

describe("DialogoPlantas: notas de honestidad", () => {
  it("UX-D2: muestra bajo la categoría el qk normativo que fija (CTE DB-SE-AE)", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    // Planta por defecto = categoria A -> qk 2,0 kN/m² (coma decimal es-ES).
    expect(
      within(dialogo).getByText(/La categoría A fija 2,0 kN\/m² \(CTE DB-SE-AE\)/),
    ).toBeInTheDocument();
  });

  it("planta SIN paños: la nota dice que las cargas no entran en el calculo", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    expect(
      within(dialogo).getByText(/Esta planta no tiene paños/i),
    ).toBeInTheDocument();
    // La nota afirmativa (con paños) no debe aparecer aqui.
    expect(
      within(dialogo).queryByText(/se aplican automáticamente como carga superficial/i),
    ).toBeNull();
  });

  it("planta CON paños: la nota afirma que se aplican sobre los paños", () => {
    // Modelo con una planta y un paño losa en ella.
    const m: Modelo = {
      ...crearModeloVacio(),
      plantas: [
        {
          id: "p1", nombre: "Planta 1", cota: 0, altura: 3,
          categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1,
        },
      ],
      nudos: [
        { id: "n1", x: 0, y: 0 },
        { id: "n2", x: 5, y: 0 },
        { id: "n3", x: 5, y: 5 },
        { id: "n4", x: 0, y: 5 },
      ],
      panos: [
        {
          id: "pa1", nombre: "Losa 1", tipo: "losa", plantaId: "p1",
          perimetro: ["n1", "n2", "n3", "n4"], materialId: "m1",
          espesor: 0.25, tamMalla: 0.5, bordeApoyo: "simple",
        },
      ],
    };
    modeloStore.getState().cargarModelo(m);
    vistaStore.getState().setPlantaActiva("p1");
    vistaStore.getState().abrirDialogo("plantas");
    render(<DialogoPlantas />);
    const dialogo = screen.getByRole("dialog", { name: "Plantas" });
    expect(
      within(dialogo).getByText(/se aplican automáticamente como carga superficial/i),
    ).toBeInTheDocument();
    // La nota negativa (sin paños) no debe aparecer.
    expect(
      within(dialogo).queryByText(/Esta planta no tiene paños/i),
    ).toBeNull();
  });
});

describe("DialogoPlantas: seleccion del maestro (aria-pressed)", () => {
  it("el boton de la planta activa lleva aria-pressed=true", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));

    // La ultima creada queda activa: su boton esta "pressed".
    const activaId = vistaStore.getState().plantaActivaId!;
    const activa = plantas().find((p) => p.id === activaId)!;
    const boton = botonPlanta(dialogo, activa.nombre);
    expect(boton.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("DialogoPlantas: UX-C8 teclado en campo de texto", () => {
  it("Escape en un campo de texto revierte lo tecleado sin commit", async () => {
    // NOTA: Radix Dialog intercepta Escape en captura sobre document; el dialogo puede
    // cerrarse igualmente. Lo que garantiza este fix es que el valor tecleado NO se
    // commitea al revertir con Esc (antes el blur commiteaba).
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    const nombreOriginal = plantas()[0].nombre;

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputNombre = within(detalle).getByLabelText(/Nombre/);
    await user.clear(inputNombre);
    await user.type(inputNombre, "Descartado");
    await user.keyboard("{Escape}");

    expect(plantas()[0].nombre).toBe(nombreOriginal);
  });

  it("Enter en un campo de texto confirma (commit del valor tecleado)", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));

    const detalle = dialogo.querySelector(".cx-gyp__detalle") as HTMLElement;
    const inputNombre = within(detalle).getByLabelText(/Nombre/);
    await user.clear(inputNombre);
    await user.type(inputNombre, "Forjado 1");
    await user.keyboard("{Enter}");

    expect(plantas()[0].nombre).toBe("Forjado 1");
  });
});

describe("DialogoPlantas: D16 coherencia cotas/alturas", () => {
  // Carga un modelo con plantas de cotas/alturas exactas y abre el dialogo. Asi
  // controlamos las cotas sin conducir campos numericos (estable).
  function renderConPlantas(
    ps: { id: string; nombre: string; cota: number; altura: number }[],
  ): HTMLElement {
    const m = crearModeloVacio();
    for (const p of ps) {
      m.plantas.push({
        ...p,
        categoriaUso: "A",
        sobrecargaUso: 0,
        cargasMuertas: 0,
      });
    }
    modeloStore.getState().cargarModelo(m);
    vistaStore.getState().setPlantaActiva(ps[0]!.id);
    vistaStore.getState().abrirDialogo("plantas");
    render(<DialogoPlantas />);
    return screen.getByRole("dialog", { name: "Plantas" });
  }

  it("plantas coherentes (cabeza_i == arranque_i+1): NO muestra ningun aviso", () => {
    const dialogo = renderConPlantas([
      { id: "p1", nombre: "Planta 1", cota: 0, altura: 3 },
      { id: "p2", nombre: "Planta 2", cota: 3, altura: 3 },
    ]);
    expect(within(dialogo).queryByText(/revisa cotas y alturas/)).toBeNull();
    expect(dialogo.querySelector(".cx-gyp__avisos-cotas")).toBeNull();
  });

  it("hueco entre plantas: muestra un aviso NO bloqueante (role=status) con el texto de obra", () => {
    const dialogo = renderConPlantas([
      { id: "p1", nombre: "Planta 1", cota: 0, altura: 3 },
      { id: "p2", nombre: "Planta 2", cota: 4, altura: 3 },
    ]);
    const aviso = within(dialogo).getByText(
      'La planta "Planta 1" termina a +3.00 m pero "Planta 2" arranca a +4.00 m: revisa cotas y alturas.',
    );
    expect(aviso).toBeInTheDocument();
    const status = within(dialogo).getByRole("status");
    expect(status).toContainElement(aviso);
  });

  it("un solo aviso POR PAR: dos huecos consecutivos -> dos avisos", () => {
    const dialogo = renderConPlantas([
      { id: "p1", nombre: "Planta 1", cota: 0, altura: 3 },
      { id: "p2", nombre: "Planta 2", cota: 4, altura: 3 },
      { id: "p3", nombre: "Planta 3", cota: 8, altura: 3 },
    ]);
    expect(within(dialogo).getAllByText(/revisa cotas y alturas/)).toHaveLength(2);
  });
});

describe("DialogoPlantas: undo", () => {
  it("deshacer revierte la creacion de una planta", async () => {
    const user = userEvent.setup();
    const dialogo = renderAbierto();
    await user.click(within(dialogo).getByRole("button", { name: "Nueva planta" }));
    expect(plantas()).toHaveLength(1);

    // Undo directo sobre el store (la pila la alimenta ejecutar()); no requiere boton.
    modeloStore.getState().deshacer();
    expect(plantas()).toHaveLength(0);
  });
});
