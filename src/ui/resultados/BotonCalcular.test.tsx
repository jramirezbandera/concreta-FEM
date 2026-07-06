// [D22b] Tests de BotonCalcular: errores NAVEGABLES. Project `jsdom`.
//
// Se MOCKEA useCalcular (evita el solver/Pyodide, CLAUDE.md §13) para inyectar el estado
// del hook (estadoMotor listo + una lista de errores controlada). Lo que se prueba es la
// capa de PRESENTACIÓN de BotonCalcular: una fila con elementoId de pilar/viga/paño es un
// <button> que, al pulsar, selecciona el elemento (seleccionStore) y salta a la pestaña de
// su tipo (vistaStore); una fila de "modelo" o un nudo flotante NO son clicables.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { UseCalcular } from "./useCalcular";
import type { ErrorObra } from "../../discretizador";

// Estado del hook controlable desde cada test (vi.hoisted iza el holder por encima del
// mock). estadoMotor "listo" para que el botón quede habilitado; calcular() es un no-op.
const { holder } = vi.hoisted(() => ({
  holder: {
    estado: {
      calcular: vi.fn(async () => {}),
      estadoMotor: "listo" as const,
      calculando: false,
      errores: [] as ErrorObra[],
      avisos: [] as ErrorObra[],
      ultimoError: null,
    } as UseCalcular,
  },
}));
vi.mock("./useCalcular", () => ({
  useCalcular: (): UseCalcular => holder.estado,
}));

import { BotonCalcular } from "./BotonCalcular";
import { modeloStore, vistaStore, seleccionStore } from "../../estado";
import type { Modelo } from "../../dominio";
import { SCHEMA_VERSION } from "../../dominio";

// Modelo con un pilar (pil1 en p0..p1), una viga (vg1 en p1) y un paño (pa1 en p1). Sirve
// para que resolverContextoElemento resuelva el contexto (planta) del culpable.
function modeloPrueba(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p0", nombre: "Cimentación", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
    ],
    secciones: [{ id: "s1", nombre: "IPE 300", tipo: "perfilMetalico", perfilId: "IPE300" }],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 5, y: 0 },
      { id: "n3", x: 5, y: 5 },
      { id: "n4", x: 0, y: 5 },
    ],
    pilares: [
      {
        id: "pil1", nombre: "P1", x: 0, y: 0, plantaInicial: "p0", plantaFinal: "p1",
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
    muros: [],
    cargas: [],
    hipotesis: [],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

function err(parcial: Partial<ErrorObra>): ErrorObra {
  return { codigo: "X", severidad: "error", mensaje: "msg", ...parcial };
}

beforeEach(() => {
  holder.estado = {
    calcular: vi.fn(async () => {}),
    estadoMotor: "listo",
    calculando: false,
    errores: [],
    avisos: [],
    ultimoError: null,
  } as UseCalcular;
  modeloStore.getState().cargarModelo(modeloPrueba());
  vistaStore.getState().setPestanaActiva("resultados");
  vistaStore.getState().setPlantaActiva(null);
  seleccionStore.getState().limpiar();
});

describe("BotonCalcular · errores navegables (D22b)", () => {
  it("una fila de PILAR es un botón que selecciona y salta a Entrada de pilares", async () => {
    const user = userEvent.setup();
    holder.estado.errores = [
      err({ codigo: "REF_SECCION", mensaje: 'El pilar "P1"…', elementoId: "pil1", elementoTipo: "pilar" }),
    ];
    render(<BotonCalcular />);
    const fila = screen.getByRole("button", { name: /El pilar "P1"/ });
    await user.click(fila);
    expect(seleccionStore.getState().seleccion).toEqual(["pil1"]);
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
    // El contexto (planta del pie) se sincroniza vía resolverContextoElemento.
    expect(vistaStore.getState().plantaActivaId).toBe("p0");
  });

  it("una fila de VIGA salta a Entrada de vigas y la selecciona", async () => {
    const user = userEvent.setup();
    holder.estado.errores = [
      err({ codigo: "REF_SECCION", mensaje: 'La viga "V1"…', elementoId: "vg1", elementoTipo: "viga" }),
    ];
    render(<BotonCalcular />);
    await user.click(screen.getByRole("button", { name: /La viga "V1"/ }));
    expect(seleccionStore.getState().seleccion).toEqual(["vg1"]);
    expect(vistaStore.getState().pestanaActiva).toBe("entradaVigas");
  });

  it("una fila de PAÑO salta a Entrada de vigas y la selecciona", async () => {
    const user = userEvent.setup();
    holder.estado.errores = [
      err({ codigo: "PANO_SIN_APOYO", mensaje: 'El paño "Losa 1"…', elementoId: "pa1", elementoTipo: "pano" }),
    ];
    render(<BotonCalcular />);
    await user.click(screen.getByRole("button", { name: /El paño "Losa 1"/ }));
    expect(seleccionStore.getState().seleccion).toEqual(["pa1"]);
    expect(vistaStore.getState().pestanaActiva).toBe("entradaVigas");
  });

  it("una fila de MODELO (SIN_SUJECION) NO es clicable", () => {
    holder.estado.errores = [
      err({ codigo: "SIN_SUJECION", mensaje: "La estructura no está sujeta.", elementoTipo: "modelo" }),
    ];
    render(<BotonCalcular />);
    // El mensaje se muestra, pero no como botón (solo el botón "Calcular" es un button).
    expect(screen.getByText("La estructura no está sujeta.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /no está sujeta/ }),
    ).toBeNull();
  });

  it("un NUDO flotante (aviso) muestra la posición y NO navega", () => {
    holder.estado.avisos = [
      err({
        codigo: "FLOTANTE",
        severidad: "aviso",
        mensaje: "Hay un punto en (4.00, 3.00) que no conecta con ninguna viga.",
        elementoId: "n9",
        elementoTipo: "nudo",
        posicion: { x: 4, y: 3 },
      }),
    ];
    render(<BotonCalcular />);
    expect(
      screen.getByText(/Hay un punto en \(4\.00, 3\.00\)/),
    ).toBeInTheDocument();
    // No es un botón navegable (el nudo no es seleccionable como elemento).
    expect(screen.queryByRole("button", { name: /Hay un punto/ })).toBeNull();
  });

  it("varias filas iguales agregadas (×N) no son un botón navegable", () => {
    // Dos avisos con el MISMO mensaje colapsan en una fila con (×2): al ser agregada,
    // no ofrece navegación a un elemento concreto.
    holder.estado.avisos = [
      err({ codigo: "COMBO_SIN_CARGAS", severidad: "aviso", mensaje: "Hipótesis vacía.", elementoId: "h1", elementoTipo: "hipotesis" }),
      err({ codigo: "COMBO_SIN_CARGAS", severidad: "aviso", mensaje: "Hipótesis vacía.", elementoId: "h2", elementoTipo: "hipotesis" }),
    ];
    render(<BotonCalcular />);
    expect(screen.getByText(/×2/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hipótesis vacía/ })).toBeNull();
  });
});
