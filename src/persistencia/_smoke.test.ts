// Smoke test del harness de persistencia (T1.1): confirma que Dexie funciona
// contra el `indexedDB` global que instala fake-indexeddb/auto en este project.
// No prueba lógica de F8 (eso llega en T2+); solo blinda la infraestructura de tests.
import Dexie, { type Table } from "dexie";
import { afterEach, expect, it } from "vitest";

interface Registro {
  id: string;
  valor: number;
}

class SmokeDB extends Dexie {
  registros!: Table<Registro, string>;

  constructor() {
    super("smoke-persistencia");
    this.version(1).stores({ registros: "id" });
  }
}

afterEach(async () => {
  // fake-indexeddb persiste entre tests dentro del mismo worker: borrar la BD evita fugas.
  await Dexie.delete("smoke-persistencia");
});

it("escribe y lee un registro vía Dexie sobre fake-indexeddb", async () => {
  // Si `indexedDB` no estuviera definido aquí, Dexie lanzaría al abrir.
  expect(typeof indexedDB).not.toBe("undefined");

  const db = new SmokeDB();
  await db.registros.put({ id: "a", valor: 42 });
  const leido = await db.registros.get("a");

  expect(leido).toEqual({ id: "a", valor: 42 });
  db.close();
});
