// Test de INTEGRACION del flujo F1 de "Entrada de pilares" (feature-11, Tarea 5.1).
// RTL en el project `jsdom`. A diferencia de InspectorPilar.test.tsx (que aisla el
// panel) o de los tests de cada pieza, este test ejercita la CADENA COMPLETA de
// stores+comandos de extremo a extremo, tal y como la orquesta el viewport+inspector:
//
//   defaults de herramienta -> snap a rejilla -> crearPilar -> seleccionar ->
//   editar en el InspectorPilar -> borrar -> deshacer/rehacer, con el contador de la
//   Sidebar reflejando cada paso.
//
// POR QUE NO SE CLICA EL PLANO R3F: la colocacion real (ColocacionPilar) ocurre por
// raycast sobre un plano three.js, que exige WebGL y NO esta disponible en jsdom
// (ver memoria feature-9: el Canvas se mockea, no se renderiza GL). El raycast no es
// testeable en unidad. Por eso aqui se ejercita la MISMA logica que el handler de
// clic de ColocacionPilar ejecuta: fijar `defaultsPilar` (seccion/material del
// catalogo) y construir+despachar `crearPilar` con coords pasadas por
// `snapARejilla`. Eso valida la cadena defaults->snap->comando que usa el viewport,
// sin acoplar la red de seguridad al GL. La interaccion de raycast queda para E2E
// (Playwright, feature-16).
//
// Stores singleton de modulo -> reset COMPLETO en beforeEach (incluida la herramienta
// y los defaults de pilar de vistaStore), mismo patron que DialogoGruposYPlantas.test
// y SelectSeccion.test (polyfills de Radix Select para el SelectSeccion del inspector).
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InspectorPilar } from "./InspectorPilar";
import { Sidebar } from "../shell/Sidebar";
import {
  modeloStore,
  seleccionStore,
  vistaStore,
  crearPilar,
  crearGrupo,
  crearPlanta,
  eliminarPilar,
  type DatosPilar,
} from "../../estado";
import { crearModeloVacio, plantasDeGrupo } from "../../dominio";
import { snapARejilla } from "../viewport/snap";
import { listarSecciones, listarMateriales } from "../../biblioteca";

// jsdom no implementa PointerCapture ni scrollIntoView, de los que depende Radix
// Select (SelectSeccion/SelectMaterial del inspector) al abrir el listbox. No-ops
// (patron estandar, ver SelectSeccion.test.tsx).
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

// Seccion y material VALIDOS tomados del catalogo de la biblioteca (no hardcodeados:
// el primero de cada lista, robusto ante cambios del catalogo).
const SECCION_ID = listarSecciones()[0]!.id;
const MATERIAL_ID = listarMateriales()[0]!.id;
// Una segunda seccion distinta para probar el cambio en el inspector (si el catalogo
// solo tuviera una, reusamos la misma: el test de cambio se vuelve trivial pero no
// rompe).
const SECCION_ID_2 = listarSecciones()[1]?.id ?? SECCION_ID;

// Reset reproducible de TODOS los stores singleton, incluido el estado de
// herramienta/defaults de vistaStore (que otros tests no tocan).
beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
  seleccionStore.getState().limpiar();
  const v = vistaStore.getState();
  v.setHerramienta("seleccion");
  v.setDefaultsPilar({
    seccionId: null,
    materialId: null,
    arranque: "empotrado",
    vinculacionExterior: true,
    angulo: 0,
  });
  v.setSnapActivo(true);
  v.setGrupoActivo(null);
  v.setPlantaActiva(null);
  v.setPestanaActiva("entradaPilares");
});

// Atajos a los selectores del modelo.
const modelo = () => modeloStore.getState().getModelo();
const pilares = () => modelo().pilares;
const pilarPorNombre = (n: string) => pilares().find((p) => p.nombre === n);

// --- Andamiaje del ambito: un grupo con dos plantas (cota 0 y 3) -----------------
// Se construye con los COMANDOS reales (crearGrupo/crearPlanta) para ejercitar la
// misma maquinaria que la UI, y se fijan grupo/planta activos como haria la Sidebar.
function prepararAmbito(): {
  grupoId: string;
  plantaBajaId: string;
  plantaAltaId: string;
} {
  modeloStore.getState().ejecutar(
    crearGrupo(modelo(), {
      categoriaUso: "A",
      sobrecargaUso: 2,
      cargasMuertas: 1,
    }),
  );
  const grupoId = modelo().grupos[0]!.id;
  modeloStore
    .getState()
    .ejecutar(crearPlanta(modelo(), { cota: 0, altura: 3, grupoId }));
  modeloStore
    .getState()
    .ejecutar(crearPlanta(modelo(), { cota: 3, altura: 3, grupoId }));
  const plantas = plantasDeGrupo(modelo(), grupoId)
    .slice()
    .sort((a, b) => a.cota - b.cota);
  vistaStore.getState().setGrupoActivo(grupoId);
  vistaStore.getState().setPlantaActiva(plantas[0]!.id);
  return {
    grupoId,
    plantaBajaId: plantas[0]!.id,
    plantaAltaId: plantas[1]!.id,
  };
}

// Reproduce EXACTAMENTE lo que hace el handler de clic de ColocacionPilar (sin el
// raycast GL): aplica snap si esta activo, lee los defaults y despacha crearPilar
// contra el modelo actual (invariante del `base`). Devuelve el id del pilar creado.
function colocarPilar(px: number, py: number): string {
  const v = vistaStore.getState();
  const { x, y } = v.snapActivo ? snapARejilla(px, py) : { x: px, y: py };
  const { defaultsPilar } = v;
  const tramo = plantasDeGrupo(modelo(), v.grupoActivoId!)
    .slice()
    .sort((a, b) => a.cota - b.cota);
  const datos: DatosPilar = {
    x,
    y,
    plantaInicial: tramo[0]!.id,
    plantaFinal: tramo[tramo.length - 1]!.id,
    seccionId: defaultsPilar.seccionId!,
    materialId: defaultsPilar.materialId!,
    angulo: defaultsPilar.angulo,
    vinculacionExterior: defaultsPilar.vinculacionExterior,
    arranque: defaultsPilar.arranque,
  };
  const base = modeloStore.getState().getModelo();
  modeloStore.getState().ejecutar(crearPilar(base, datos));
  // El ultimo pilar del array es el recien creado.
  const ps = pilares();
  return ps[ps.length - 1]!.id;
}

describe("Flujo Entrada de pilares: colocacion (defaults -> snap -> comando)", () => {
  it("activar herramienta + fijar defaults y colocar 3 pilares snappeados", () => {
    prepararAmbito();

    // Activar la herramienta "pilar" y fijar seccion/material como hace el panel de
    // herramienta de la Fase 4 (setDefaultsPilar). Sin esto, ColocacionPilar ignora
    // el clic (no hay seccion/material).
    vistaStore.getState().setHerramienta("pilar");
    vistaStore.getState().setDefaultsPilar({
      seccionId: SECCION_ID,
      materialId: MATERIAL_ID,
      arranque: "empotrado",
      vinculacionExterior: true,
      angulo: 0,
    });
    expect(vistaStore.getState().herramienta).toBe("pilar");

    // Tres clics en coords NO alineadas a la rejilla de 0.5 m: el snap las redondea.
    // (Se evitan entradas negativas que snappean a -0, indistinguible numericamente
    // de 0 pero que Object.is/toMatchObject distinguen; el snap de -0 ya se cubre en
    // snap.test.ts.)
    colocarPilar(0.12, 0.12); // -> (0, 0)
    colocarPilar(2.4, 2.4); //   -> (2.5, 2.5)
    colocarPilar(4.71, 0.26); //  -> (4.5, 0.5)

    expect(pilares()).toHaveLength(3);
    // Nombres CYPECAD derivados por el comando (P1, P2, P3).
    expect(pilares().map((p) => p.nombre)).toEqual(["P1", "P2", "P3"]);

    // Coords snappeadas a la rejilla.
    expect(pilarPorNombre("P1")).toMatchObject({ x: 0, y: 0 });
    expect(pilarPorNombre("P2")).toMatchObject({ x: 2.5, y: 2.5 });
    expect(pilarPorNombre("P3")).toMatchObject({ x: 4.5, y: 0.5 });

    // Defaults aplicados a cada pilar (seccion/material/arranque/vinculacion).
    for (const p of pilares()) {
      expect(p.seccionId).toBe(SECCION_ID);
      expect(p.materialId).toBe(MATERIAL_ID);
      expect(p.arranque).toBe("empotrado");
      expect(p.vinculacionExterior).toBe(true);
    }
  });

  it("con snap desactivado las coords se colocan tal cual", () => {
    prepararAmbito();
    vistaStore.getState().setDefaultsPilar({
      seccionId: SECCION_ID,
      materialId: MATERIAL_ID,
    });
    vistaStore.getState().setSnapActivo(false);

    colocarPilar(1.234, 5.678);
    expect(pilarPorNombre("P1")).toMatchObject({ x: 1.234, y: 5.678 });
  });
});

describe("Flujo Entrada de pilares: seleccion + edicion en el InspectorPilar", () => {
  // Coloca un pilar, lo selecciona y renderiza el inspector. Devuelve su id.
  function colocarYSeleccionar(): string {
    prepararAmbito();
    vistaStore.getState().setDefaultsPilar({
      seccionId: SECCION_ID,
      materialId: MATERIAL_ID,
    });
    const id = colocarPilar(1, 1);
    seleccionStore.getState().seleccionar([id]);
    render(<InspectorPilar />);
    return id;
  }

  it("el panel muestra los valores del pilar seleccionado", () => {
    colocarYSeleccionar();
    expect(screen.getByText("Pilar P1")).toBeInTheDocument();
    expect((screen.getByLabelText("X") as HTMLInputElement).value).toBe("1");
    expect((screen.getByLabelText("Y") as HTMLInputElement).value).toBe("1");
  });

  it("editar el angulo (type + blur) cambia el modelo via editarPilar", async () => {
    const user = userEvent.setup();
    const id = colocarYSeleccionar();

    const inputAngulo = screen.getByLabelText("Ángulo");
    await user.clear(inputAngulo);
    await user.type(inputAngulo, "45");
    await user.tab();

    expect(pilares().find((p) => p.id === id)!.angulo).toBe(45);
  });

  it("cambiar la seccion por el SelectSeccion aplica el cambio", async () => {
    const user = userEvent.setup();
    const id = colocarYSeleccionar();

    // Abrir el Radix Select por TECLADO (foco + Enter), estable bajo jsdom con los
    // polyfills; click ademas de Enter lo cerraria por toggle (ver SelectSeccion.test).
    const combo = screen.getByRole("combobox", { name: "Sección" });
    combo.focus();
    await user.keyboard("{Enter}");
    const listbox = await screen.findByRole("listbox");
    const etiqueta = listarSecciones().find((s) => s.id === SECCION_ID_2)!.nombre;
    await user.click(within(listbox).getByText(etiqueta));

    expect(pilares().find((p) => p.id === id)!.seccionId).toBe(SECCION_ID_2);
  });

  it("un valor invalido (angulo vacio) NO commitea y muestra error", async () => {
    const user = userEvent.setup();
    const id = colocarYSeleccionar();

    const inputAngulo = screen.getByLabelText("Ángulo");
    await user.clear(inputAngulo);
    await user.tab();

    expect(screen.getByText("Introduce un número válido.")).toBeInTheDocument();
    // El angulo original (0) se conserva: no se guarda NaN.
    expect(pilares().find((p) => p.id === id)!.angulo).toBe(0);
  });
});

describe("Flujo Entrada de pilares: borrado", () => {
  it("borrar el pilar seleccionado lo elimina y limpia la seleccion", async () => {
    const user = userEvent.setup();
    prepararAmbito();
    vistaStore.getState().setDefaultsPilar({
      seccionId: SECCION_ID,
      materialId: MATERIAL_ID,
    });
    const id = colocarPilar(0, 0);
    seleccionStore.getState().seleccionar([id]);
    render(<InspectorPilar />);

    await user.click(screen.getByRole("button", { name: "Eliminar pilar" }));

    expect(pilares()).toHaveLength(0);
    expect(seleccionStore.getState().seleccion).toEqual([]);
  });
});

describe("Flujo Entrada de pilares: undo / redo de la secuencia", () => {
  it("deshacer/rehacer recorre crear -> editar -> borrar paso a paso", async () => {
    const user = userEvent.setup();
    prepararAmbito();
    vistaStore.getState().setDefaultsPilar({
      seccionId: SECCION_ID,
      materialId: MATERIAL_ID,
    });

    // 1) Crear un pilar.
    const id = colocarPilar(2, 2);
    expect(pilares()).toHaveLength(1);

    // 2) Editar su angulo a 30 desde el inspector.
    seleccionStore.getState().seleccionar([id]);
    render(<InspectorPilar />);
    const inputAngulo = screen.getByLabelText("Ángulo");
    await user.clear(inputAngulo);
    await user.type(inputAngulo, "30");
    await user.tab();
    expect(pilares().find((p) => p.id === id)!.angulo).toBe(30);

    // 3) Borrarlo.
    await user.click(screen.getByRole("button", { name: "Eliminar pilar" }));
    expect(pilares()).toHaveLength(0);

    // Deshacer el borrado -> el pilar reaparece con su angulo editado (30).
    modeloStore.getState().deshacer();
    expect(pilares()).toHaveLength(1);
    expect(pilares().find((p) => p.id === id)!.angulo).toBe(30);

    // Deshacer la edicion -> vuelve el angulo original (0).
    modeloStore.getState().deshacer();
    expect(pilares().find((p) => p.id === id)!.angulo).toBe(0);

    // Deshacer la creacion -> sin pilares.
    modeloStore.getState().deshacer();
    expect(pilares()).toHaveLength(0);

    // Rehacer la creacion -> reaparece (angulo original 0).
    modeloStore.getState().rehacer();
    expect(pilares()).toHaveLength(1);
    expect(pilares().find((p) => p.id === id)!.angulo).toBe(0);

    // Rehacer la edicion -> angulo 30 de nuevo.
    modeloStore.getState().rehacer();
    expect(pilares().find((p) => p.id === id)!.angulo).toBe(30);

    // Rehacer el borrado -> desaparece.
    modeloStore.getState().rehacer();
    expect(pilares()).toHaveLength(0);
  });
});

describe("Flujo Entrada de pilares: contador de la Sidebar", () => {
  it("el contador 'Pilares' refleja el nº de pilares del ambito activo al crear y borrar", () => {
    const { plantaBajaId } = prepararAmbito();
    vistaStore.getState().setDefaultsPilar({
      seccionId: SECCION_ID,
      materialId: MATERIAL_ID,
    });
    // La planta baja queda activa (la fija prepararAmbito); el contador cuenta los
    // pilares cuyo arranque/cabeza es esa planta. Los pilares abarcan plantaBaja->alta,
    // asi que todos cuentan en la planta baja activa.

    // Lee el contador de la fila "Pilares" (FilaArbol: .cx-row con .cx-row__count).
    function contadorPilares(): string {
      const fila = screen.getByText("Pilares").closest(".cx-row");
      if (!fila) throw new Error("No se encontro la fila 'Pilares' en la Sidebar");
      return (fila.querySelector(".cx-row__count")?.textContent ?? "").trim();
    }

    // Obra vacia: contador 0.
    const r0 = render(<Sidebar />);
    expect(contadorPilares()).toBe("0");
    r0.unmount();

    // Crear dos pilares (ambos arrancan en la planta baja activa). Se mutan los
    // stores ANTES de montar la Sidebar (patron probado en Sidebar.test.tsx: el
    // contador es derivado en render, sin depender del timing de la suscripcion).
    colocarPilar(0, 0);
    colocarPilar(2, 2);
    expect(plantasDeGrupo(modelo(), vistaStore.getState().grupoActivoId!)).toHaveLength(2);
    expect(plantaBajaId).toBe(vistaStore.getState().plantaActivaId);
    const r2 = render(<Sidebar />);
    expect(contadorPilares()).toBe("2");
    r2.unmount();

    // Borrar uno (comando directo, para aislar el conteo de la Sidebar de la UI del
    // inspector) -> al re-montar, contador 1.
    const primero = pilares()[0]!.id;
    modeloStore.getState().ejecutar(eliminarPilar(modelo(), primero));
    render(<Sidebar />);
    expect(contadorPilares()).toBe("1");
  });
});
