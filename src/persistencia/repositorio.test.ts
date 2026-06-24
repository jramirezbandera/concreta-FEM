// Tests del repositorio CRUD (T3.1). Corre en el project `persistencia`, que ya
// instala `indexedDB` via fake-indexeddb/auto. El repositorio opera sobre el
// singleton `db`, asi que reseteamos limpiando sus tablas en afterEach (no
// podemos recrear la instancia: el repositorio importa la suya).
import { afterEach, expect, it } from "vitest";
import { db } from "./esquema";
import {
  borrarProyecto,
  cargarProyecto,
  crearProyecto,
  getProyectoActivoId,
  guardarModeloDeProyecto,
  guardarProyecto,
  listarProyectos,
  renombrarProyecto,
  setProyectoActivoId,
} from "./repositorio";
import {
  cargarPlantillasDeProyecto,
  guardarPlantillasDeProyecto,
} from "./plantillas/repositorioPlantillas";
import type { Plantilla } from "../ui/viewport/dxf/tiposDxf";

afterEach(async () => {
  // Vaciar deja la DB limpia entre tests sin cerrar/recrear el singleton.
  await db.proyectos.clear();
  await db.meta.clear();
  await db.plantillas.clear();
});

// Factoria de una Plantilla valida (cumple PlantillaSchema), para los tests que
// verifican que borrar un proyecto arrastra tambien sus plantillas DXF.
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

it("crear -> cargar hace round-trip de todos los campos", async () => {
  const creado = await crearProyecto("Edificio A");

  expect(creado.id).toBeTruthy();
  expect(creado.nombre).toBe("Edificio A");
  expect(creado.schemaVersion).toBe(creado.modelo.schemaVersion);
  // creadoEn y actualizadoEn coinciden en un proyecto recien creado.
  expect(creado.actualizadoEn).toBe(creado.creadoEn);
  expect(creado.modelo.unidades).toBe("kN-m");
  expect(creado.modelo.pilares).toEqual([]);

  const leido = await cargarProyecto(creado.id);
  expect(leido).toEqual(creado);
});

it("cargar devuelve undefined si el id no existe", async () => {
  expect(await cargarProyecto("inexistente")).toBeUndefined();
});

it("listar ordena por actualizadoEn descendente", async () => {
  const a = await crearProyecto("Antiguo");
  const b = await crearProyecto("Medio");
  const c = await crearProyecto("Reciente");

  // Date.now() puede colisionar en el mismo ms; forzamos timestamps distintos
  // via put directo para fijar el orden esperado de forma determinista.
  await db.proyectos.put({ ...a, actualizadoEn: 100 });
  await db.proyectos.put({ ...b, actualizadoEn: 200 });
  await db.proyectos.put({ ...c, actualizadoEn: 300 });

  const lista = await listarProyectos();
  expect(lista.map((p) => p.id)).toEqual([c.id, b.id, a.id]);
});

it("guardarProyecto refresca actualizadoEn sin mutar el argumento", async () => {
  const creado = await crearProyecto("X");
  await db.proyectos.put({ ...creado, actualizadoEn: 1 });

  const antes = await cargarProyecto(creado.id);
  const arg = { ...antes! };
  await guardarProyecto(arg);

  // El argumento no se muta.
  expect(arg.actualizadoEn).toBe(1);
  const despues = await cargarProyecto(creado.id);
  expect(despues!.actualizadoEn).toBeGreaterThanOrEqual(1);
  expect(despues!.actualizadoEn).not.toBe(1);
});

it("borrar elimina el proyecto", async () => {
  const creado = await crearProyecto("Borrable");
  await borrarProyecto(creado.id);
  expect(await cargarProyecto(creado.id)).toBeUndefined();
});

it("borrar limpia el puntero activo si era el activo", async () => {
  const creado = await crearProyecto("Activo");
  await setProyectoActivoId(creado.id);

  await borrarProyecto(creado.id);
  expect(await getProyectoActivoId()).toBeUndefined();
});

it("borrar arrastra las plantillas del proyecto (no deja huerfanas)", async () => {
  const creado = await crearProyecto("Con plantillas");
  await guardarPlantillasDeProyecto(creado.id, [plantillaValida()]);
  // Otro proyecto con plantillas: NO debe verse afectado por el borrado.
  const otro = await crearProyecto("Otro");
  await guardarPlantillasDeProyecto(otro.id, [plantillaValida({ id: "pl-otro" })]);

  await borrarProyecto(creado.id);

  // Las plantillas del borrado desaparecen; las del otro proyecto se conservan.
  expect(await cargarPlantillasDeProyecto(creado.id)).toEqual([]);
  expect((await cargarPlantillasDeProyecto(otro.id)).map((p) => p.id)).toEqual([
    "pl-otro",
  ]);
});

it("borrar un proyecto SIN plantillas no lanza", async () => {
  const creado = await crearProyecto("Sin plantillas");
  await expect(borrarProyecto(creado.id)).resolves.toBeUndefined();
  expect(await cargarPlantillasDeProyecto(creado.id)).toEqual([]);
});

it("borrar no toca el puntero si el activo era otro", async () => {
  const uno = await crearProyecto("Uno");
  const dos = await crearProyecto("Dos");
  await setProyectoActivoId(uno.id);

  await borrarProyecto(dos.id);
  expect(await getProyectoActivoId()).toBe(uno.id);
});

it("renombrar cambia nombre y refresca actualizadoEn", async () => {
  const creado = await crearProyecto("Nombre viejo");
  await db.proyectos.put({ ...creado, actualizadoEn: 1 });

  await renombrarProyecto(creado.id, "Nombre nuevo");

  const leido = await cargarProyecto(creado.id);
  expect(leido!.nombre).toBe("Nombre nuevo");
  expect(leido!.actualizadoEn).not.toBe(1);
  expect(leido!.creadoEn).toBe(creado.creadoEn);
});

it("puntero activo: set / get / clear", async () => {
  expect(await getProyectoActivoId()).toBeUndefined();

  await setProyectoActivoId("p1");
  expect(await getProyectoActivoId()).toBe("p1");

  await setProyectoActivoId("p2");
  expect(await getProyectoActivoId()).toBe("p2");

  await setProyectoActivoId(undefined);
  expect(await getProyectoActivoId()).toBeUndefined();
});

it("guardarModeloDeProyecto actualiza modelo y actualizadoEn sin tocar id/nombre/creadoEn", async () => {
  const creado = await crearProyecto("Proyecto");
  await db.proyectos.put({ ...creado, actualizadoEn: 1 });

  const modeloNuevo = { ...creado.modelo, pilares: [{}] as never };
  const r = await guardarModeloDeProyecto(creado.id, modeloNuevo);
  expect(r.estado).toBe("guardado");
  if (r.estado !== "guardado") throw new Error("se esperaba guardado");
  expect(typeof r.actualizadoEn).toBe("number");

  const leido = await cargarProyecto(creado.id);
  expect(leido!.modelo.pilares).toHaveLength(1);
  expect(leido!.id).toBe(creado.id);
  expect(leido!.nombre).toBe(creado.nombre);
  expect(leido!.creadoEn).toBe(creado.creadoEn);
  expect(leido!.actualizadoEn).not.toBe(1);
  // El timestamp devuelto coincide con el persistido (baseline para el autosave).
  expect(leido!.actualizadoEn).toBe(r.actualizadoEn);
});

it("guardarModeloDeProyecto es no-op y devuelve no-existe si el id no existe", async () => {
  const r = await guardarModeloDeProyecto("inexistente", {} as never);
  expect(r.estado).toBe("no-existe");
  expect(await listarProyectos()).toEqual([]);
});

it("guardarModeloDeProyecto detecta conflicto si actualizadoEn supero la baseline", async () => {
  const creado = await crearProyecto("Proyecto");
  // Otra "pestana" escribio mas tarde: el registro queda con actualizadoEn=500.
  await db.proyectos.put({ ...creado, actualizadoEn: 500 });

  // Guardamos con una baseline ANTERIOR (400): debe detectar conflicto y NO escribir.
  const modeloNuevo = { ...creado.modelo, pilares: [{}] as never };
  const r = await guardarModeloDeProyecto(creado.id, modeloNuevo, 400);
  expect(r.estado).toBe("conflicto");
  if (r.estado !== "conflicto") throw new Error("se esperaba conflicto");
  expect(r.actualizadoEn).toBe(500);

  // El registro NO se machaco: sigue sin pilares y con el timestamp ajeno.
  const leido = await cargarProyecto(creado.id);
  expect(leido!.modelo.pilares).toHaveLength(0);
  expect(leido!.actualizadoEn).toBe(500);
});

it("guardarModeloDeProyecto guarda si la baseline coincide con el actualizadoEn en disco", async () => {
  const creado = await crearProyecto("Proyecto");
  await db.proyectos.put({ ...creado, actualizadoEn: 500 });

  const modeloNuevo = { ...creado.modelo, pilares: [{}] as never };
  // Baseline IGUAL al timestamp en disco: no es conflicto (nadie escribio despues).
  const r = await guardarModeloDeProyecto(creado.id, modeloNuevo, 500);
  expect(r.estado).toBe("guardado");

  const leido = await cargarProyecto(creado.id);
  expect(leido!.modelo.pilares).toHaveLength(1);
});

it("crearProyecto deja el proyecto como activo (T5)", async () => {
  const creado = await crearProyecto("Nuevo");
  expect(await getProyectoActivoId()).toBe(creado.id);
});
