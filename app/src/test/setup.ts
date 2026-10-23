import "@testing-library/jest-dom/vitest";
// AL: los proyectos del navegador (IndexedDB) en las pruebas de DOM. Cada prueba empieza sin
// proyectos y sin `?local=` en la URL (si no, la app reabriría el de la prueba anterior)
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach } from "vitest";
import { olvidarBD } from "../sesion/almacen.ts";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  olvidarBD();
  if (typeof history !== "undefined") history.replaceState(null, "", "/");
});
