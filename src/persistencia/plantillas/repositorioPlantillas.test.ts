// Tests del repositorio de plantillas DXF (feature-15, T2.3). Project `persistencia`
// (fake-indexeddb/auto instala `indexedDB`). El repositorio opera sobre el singleton
// `db`, asi que vaciamos la tabla `plantillas` en afterEach.
import { afterEach, expect, it } from "vitest";
import { db } from "../esquema";
import type { Plantilla } from "../../ui/viewport/dxf/tiposDxf";
import {
  borrarPlantillasDeProyecto,
  cargarPlantillasDeProyecto,
  guardarPlantillasDeProyecto,
} from "./repositorioPlantillas";

// Factoria de una Plantilla valida (cumple PlantillaSchema). `creadaEn` lo inyecta
// el llamador (codigo de produccion no usa Date.now en codigo puro de DXF).
function plantillaValida(overrides: Partial<Plantilla> = {}): Plantilla {
  return {
    id: "pl-1",
    nombre: "Planta baja",
    nombreArchivo: "planta.dxf",
    plantaId: "p1",
    entidades: [{ tipo: "linea", x1: 0, y1: 0, x2: 1, y2: 1 }],
    transform: { x: 0, y: 0, escala: 1, rotacion: 0, opacidad: 0.5 },
    visible: true,
    bloqueado: false,
    creadaEn: 1000,
    ...overrides,
  };
}

afterEach(async () => {
  await db.plantillas.clear();
});

it("guardar -> cargar hace round-trip de las plantillas", async () => {
  const plantillas = [
    plantillaValida({ id: "a" }),
    plantillaValida({ id: "b", nombre: "Planta primera", plantaId: "p2" }),
  ];
  await guardarPlantillasDeProyecto("proy-1", plantillas);

  const leidas = await cargarPlantillasDeProyecto("proy-1");
  expect(leidas).toEqual(plantillas);
});

it("cargar un proyecto sin plantillas devuelve []", async () => {
  expect(await cargarPlantillasDeProyecto("inexistente")).toEqual([]);
});

it("guardar [] deja la fila vacia (cargar devuelve [])", async () => {
  await guardarPlantillasDeProyecto("proy-1", [plantillaValida()]);
  await guardarPlantillasDeProyecto("proy-1", []);
  expect(await cargarPlantillasDeProyecto("proy-1")).toEqual([]);
});

it("guardar reemplaza el bloque completo (no fusiona)", async () => {
  await guardarPlantillasDeProyecto("proy-1", [
    plantillaValida({ id: "vieja" }),
  ]);
  await guardarPlantillasDeProyecto("proy-1", [
    plantillaValida({ id: "nueva" }),
  ]);
  const leidas = await cargarPlantillasDeProyecto("proy-1");
  expect(leidas.map((p) => p.id)).toEqual(["nueva"]);
});

it("validacion en el borde: descarta una plantilla corrupta y conserva las validas", async () => {
  // Insertamos directamente en Dexie una mezcla de plantilla valida + basura, como
  // si el IndexedDB hubiera sido manipulado o vinieran de un esquema DXF viejo.
  await db.plantillas.put({
    proyectoId: "proy-1",
    plantillas: [
      plantillaValida({ id: "buena" }),
      { id: "mala", basura: true }, // no cumple PlantillaSchema
      // transform invalido (escala no positiva): tambien debe descartarse.
      plantillaValida({
        id: "mala2",
        transform: { x: 0, y: 0, escala: 0, rotacion: 0, opacidad: 1 },
      }),
    ],
    actualizadoEn: 0,
  });

  const leidas = await cargarPlantillasDeProyecto("proy-1");
  expect(leidas.map((p) => p.id)).toEqual(["buena"]);
});

it("aislamiento por proyecto: A no ve las plantillas de B", async () => {
  await guardarPlantillasDeProyecto("A", [plantillaValida({ id: "soloA" })]);
  await guardarPlantillasDeProyecto("B", [plantillaValida({ id: "soloB" })]);

  const deA = await cargarPlantillasDeProyecto("A");
  const deB = await cargarPlantillasDeProyecto("B");
  expect(deA.map((p) => p.id)).toEqual(["soloA"]);
  expect(deB.map((p) => p.id)).toEqual(["soloB"]);
});

it("borrar elimina la fila del proyecto (cargar devuelve [])", async () => {
  await guardarPlantillasDeProyecto("proy-1", [plantillaValida()]);
  await borrarPlantillasDeProyecto("proy-1");
  expect(await cargarPlantillasDeProyecto("proy-1")).toEqual([]);
});

it("guardar refresca actualizadoEn", async () => {
  await guardarPlantillasDeProyecto("proy-1", [plantillaValida()]);
  const registro = await db.plantillas.get("proy-1");
  expect(typeof registro!.actualizadoEn).toBe("number");
  expect(registro!.actualizadoEn).toBeGreaterThan(0);
});
