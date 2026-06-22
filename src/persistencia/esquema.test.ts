// Tests del esquema Dexie (T2.1). Corre en el project `persistencia`, que ya
// instala `indexedDB` via fake-indexeddb/auto (vitest.config.ts).
import Dexie from "dexie";
import { crearModeloVacio } from "../dominio";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  abrirDB,
  CLAVE_PROYECTO_ACTIVO,
  ConcretaDB,
  db as dbSingleton,
  type ProyectoGuardado,
} from "./esquema";

// Cada test usa su propia instancia y la borra al terminar: fake-indexeddb
// persiste entre tests dentro del worker (patron del _smoke.test.ts).
let db: ConcretaDB;

beforeEach(() => {
  db = new ConcretaDB();
});

afterEach(async () => {
  db.close();
  await Dexie.delete("concreta-estructuras");
});

function proyectoDe(id: string, nombre: string, ts: number): ProyectoGuardado {
  return {
    id,
    nombre,
    modelo: crearModeloVacio(),
    schemaVersion: crearModeloVacio().schemaVersion,
    creadoEn: ts,
    actualizadoEn: ts,
  };
}

it("abre la DB y declara las tablas tipadas", async () => {
  await db.open();
  expect(db.isOpen()).toBe(true);
  expect(db.tables.map((t) => t.name).sort()).toEqual(["meta", "proyectos"]);
});

it("hace put/get de un ProyectoGuardado con un Modelo real", async () => {
  const proyecto = proyectoDe("p1", "Edificio A", 1000);
  await db.proyectos.put(proyecto);

  const leido = await db.proyectos.get("p1");
  expect(leido).toEqual(proyecto);
  // El Modelo (Capa 1) sobrevive intacto al roundtrip de IndexedDB.
  expect(leido?.modelo.unidades).toBe("kN-m");
  expect(leido?.modelo.pilares).toEqual([]);
});

it("ordena por el indice actualizadoEn (mas recientes primero)", async () => {
  await db.proyectos.bulkPut([
    proyectoDe("a", "Antiguo", 100),
    proyectoDe("c", "Reciente", 300),
    proyectoDe("b", "Medio", 200),
  ]);

  const recientes = await db.proyectos
    .orderBy("actualizadoEn")
    .reverse()
    .toArray();

  expect(recientes.map((p) => p.id)).toEqual(["c", "b", "a"]);
});

it("escribe y lee el puntero proyectoActivoId via tabla meta", async () => {
  await db.meta.put({ clave: CLAVE_PROYECTO_ACTIVO, valor: "p1" });
  let activo = await db.meta.get(CLAVE_PROYECTO_ACTIVO);
  expect(activo?.valor).toBe("p1");

  // put atomico sobrescribe el puntero (cambiar de proyecto activo).
  await db.meta.put({ clave: CLAVE_PROYECTO_ACTIVO, valor: "p2" });
  activo = await db.meta.get(CLAVE_PROYECTO_ACTIVO);
  expect(activo?.valor).toBe("p2");
});

// Ciclo de vida del singleton `dbSingleton` (T4). Estos tests usan la instancia
// compartida del modulo (no la `db` local de los tests anteriores): probamos la
// apertura defensiva y el cierre por versionchange.
describe("ciclo de vida de la DB (singleton, T4)", () => {
  afterEach(async () => {
    // Dejamos el singleton abierto y limpio para no afectar a otros tests del
    // project que lo comparten (repositorio/autosave usan `db`).
    if (!dbSingleton.isOpen()) await dbSingleton.open();
    await dbSingleton.proyectos.clear();
    await dbSingleton.meta.clear();
  });

  it("abrirDB devuelve ok en el entorno de test (fake-indexeddb disponible)", async () => {
    const r = await abrirDB();
    expect(r.ok).toBe(true);
    expect(dbSingleton.isOpen()).toBe(true);
  });

  it("versionchange cierra la conexion vieja (no bloquea el upgrade de otra pestana)", async () => {
    await dbSingleton.open();
    expect(dbSingleton.isOpen()).toBe(true);

    // Invocamos el handler como lo haria IndexedDB al detectar un upgrade externo.
    // Dexie expone los handlers via on; disparamos el evento versionchange.
    dbSingleton.on.versionchange.fire({} as IDBVersionChangeEvent);

    expect(dbSingleton.isOpen()).toBe(false);
  });
});
