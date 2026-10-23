/**
 * Los proyectos del navegador (fase AL, `docs/fem3d/almacen-local.md`), con `fake-indexeddb`:
 * - criterio 3: el sello de otra pestaña da conflicto y no se pisa nada;
 * - criterio 5: restaurar da el texto de la versión byte a byte, y la retención cumple §3.3;
 * - §3.4: la caché de resultados guarda sólo la última huella de cada proyecto y respeta el tope.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { aPurgar, borrar, crear, duplicar, escribir, ficha, guardarResultados, leer, leerResultados, listar, olvidarBD, origenNavegador, restaurar, textoVersion, versionar, versiones, VERSIONES } from "../sesion/almacen.ts";

const texto = (nombre: string, n = 0) => JSON.stringify({ esquema: "concreta-fem/proyecto@1", nombre, n }, null, 2);
const MIN = 60_000;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  olvidarBD();
});

describe("proyectos", () => {
  it("crear, listar, leer y escribir con el sello", async () => {
    const a = await crear(texto("Nave"));
    const b = await crear(texto(""), "importado.json");
    expect(b.nombre).toBe("importado.json");
    expect((await listar()).map((f) => f.id).sort()).toEqual([a.id, b.id].sort());
    const l = await leer(a.id);
    expect(l?.texto).toBe(texto("Nave"));
    const w = await escribir(a.id, texto("Nave 2"), { sello: l!.ficha.sello });
    expect(w).toEqual({ ok: true, sello: "2" });
    expect((await ficha(a.id))?.nombre).toBe("Nave 2");
    expect((await listar())[0]!.id).toBe(a.id);
  });

  it("criterio 3: otra pestaña escribió antes: conflicto, y nada se pisa salvo con forzar", async () => {
    const a = await crear(texto("A"));
    const otra = origenNavegador(a.id, "A");
    const esta = origenNavegador(a.id, "A");
    const leido = await esta.leer("proyecto.json");
    expect(await otra.escribir(texto("A", 1), { sello: leido!.sello })).toMatchObject({ ok: true });
    const r = await esta.escribir(texto("A", 2), { sello: leido!.sello });
    expect(r).toMatchObject({ ok: false, conflicto: true });
    expect((await leer(a.id))?.texto).toBe(texto("A", 1));
    expect(await esta.sello("proyecto.json")).toBe("2");
    expect(await esta.escribir(texto("A", 2), { sello: leido!.sello, forzar: true })).toMatchObject({ ok: true, sello: "3" });
    expect((await leer(a.id))?.texto).toBe(texto("A", 2));
    // Lo que no es el proyecto (las firmas) no existe en el navegador
    expect(await esta.leer("proyecto.revision.json")).toBeNull();
  });

  it("borrar quita el proyecto, sus versiones y su caché; duplicar copia el texto", async () => {
    const a = await crear(texto("A"));
    await versionar(a.id);
    await guardarResultados(a.id, "h1", "{}", new Uint8Array(8));
    const c = await duplicar(a.id);
    expect(c?.nombre).toBe("A (copia)");
    expect((await leer(c!.id))?.texto).toBe(texto("A"));
    await borrar(a.id);
    expect(await leer(a.id)).toBeNull();
    expect(await versiones(a.id)).toEqual([]);
    expect(await leerResultados("h1")).toBeNull();
    expect(await leer(c!.id)).not.toBeNull();
    const r = await escribir(a.id, texto("A"), { sello: 1 });
    expect(r).toMatchObject({ ok: false, conflicto: false });
  });
});

describe("versiones (§3.3, criterio 5)", () => {
  it("una versión al abrir y como mucho una cada 10 minutos de edición; restaurar da su texto byte a byte", async () => {
    const a = await crear(texto("A", 0));
    // La fecha de una versión es la del texto que guarda: la de su última escritura
    const t0 = (await ficha(a.id))!.modificado;
    await versionar(a.id, t0);
    await versionar(a.id, t0 + 1); // el mismo texto: no repite
    expect((await versiones(a.id)).length).toBe(1);
    let sello = 1;
    for (let k = 1; k <= 12; k++) {
      const w = await escribir(a.id, texto("A", k), { sello, ahora: t0 + k * 2 * MIN });
      if (!w.ok) throw new Error(w.mensaje);
      sello = Number(w.sello);
    }
    // Escrituras a los 2, 4, … 24 min: a los 10 se guarda el texto de los 8 (el que se pisa), y a los
    // 18, el de los 16
    const vs = await versiones(a.id);
    expect(vs.length).toBe(3);
    const textos = await Promise.all(vs.map((v) => textoVersion(v.n)));
    expect(textos).toEqual([texto("A", 8), texto("A", 4), texto("A", 0)]);
    const r = await restaurar(a.id, vs[1]!.n, t0 + 30 * MIN);
    expect(r.ok).toBe(true);
    expect((await leer(a.id))?.texto).toBe(texto("A", 4));
    // Lo que había al restaurar queda como versión
    expect(await textoVersion((await versiones(a.id))[0]!.n)).toBe(texto("A", 12));
  });

  it("retención: las 30 últimas y la última de cada día durante 90 días", () => {
    const ahora = new Date(2026, 9, 23, 12).getTime();
    const vs: { n: number; fecha: number }[] = [];
    let n = 0;
    // 40 versiones hoy, cada 10 minutos hacia atrás; y tres al día durante los 100 días anteriores
    for (let k = 0; k < 40; k++) vs.push({ n: ++n, fecha: ahora - k * 10 * MIN });
    for (let d = 1; d <= 100; d++) for (const h of [9, 13, 18]) vs.push({ n: ++n, fecha: new Date(2026, 9, 23 - d, h).getTime() });
    const fuera = new Set(aPurgar(vs, ahora));
    const quedan = vs.filter((v) => !fuera.has(v.n));
    // Las 30 más nuevas
    for (let k = 0; k < 30; k++) expect(fuera.has(k + 1)).toBe(false);
    // De hoy, fuera de las 30, sólo una (la última del día que queda)
    const hoy = quedan.filter((v) => new Date(v.fecha).getDate() === 23 && new Date(v.fecha).getMonth() === 9);
    expect(hoy.length).toBe(31);
    // Días anteriores: uno por día, la de las 18 h, hasta 90 días
    const antes = quedan.filter((v) => !hoy.includes(v));
    expect(antes.every((v) => new Date(v.fecha).getHours() === 18)).toBe(true);
    expect(antes.length).toBe(VERSIONES.dias);
    expect(antes.every((v) => ahora - v.fecha <= VERSIONES.dias * 86_400_000)).toBe(true);
  });
});

describe("caché de resultados (§3.4)", () => {
  it("sólo la última huella de cada proyecto, y las más antiguas fuera del tope", async () => {
    const a = await crear(texto("A"));
    const b = await crear(texto("B"));
    await guardarResultados(a.id, "a1", "{}", new Uint8Array(100), 1000);
    await guardarResultados(a.id, "a2", "{}", new Uint8Array([1, 2, 3]), 1000);
    expect(await leerResultados("a1")).toBeNull();
    expect(Array.from((await leerResultados("a2"))!.bytes)).toEqual([1, 2, 3]);
    await guardarResultados(b.id, "b1", "{}", new Uint8Array(996), 1000);
    // a2 (3 + 2) + b1 (996 + 2) pasa de 1000: se va la más antigua
    expect(await leerResultados("a2")).toBeNull();
    expect(await leerResultados("b1")).not.toBeNull();
    expect(await origenNavegador(b.id, "B").guardados("b1")).not.toBeNull();
  });
});
