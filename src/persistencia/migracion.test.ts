// Tests de la frontera de importacion (T2.2). Validacion pura: no toca
// IndexedDB pese a vivir bajo el project `persistencia`. Verifica robustez:
// importar datos corruptos o de otra version NUNCA debe lanzar (CLAUDE.md §2.8).
import { describe, it, expect } from "vitest";
import {
  migrarYValidar,
  type Migracion,
  type ResultadoImport,
} from "./migracion";
import { crearModeloVacio } from "../dominio/helpers";
import { SCHEMA_VERSION } from "../dominio/comunes";
import type { Pilar } from "../dominio/pilar";

// Helper: estrecha el resultado a ok:false y devuelve sus errores.
function errores(r: ResultadoImport): string[] {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("se esperaba ok:false");
  return r.errores;
}

describe("migrarYValidar — caso feliz", () => {
  it("acepta un Modelo vacio valido y lo devuelve equivalente", () => {
    const modelo = crearModeloVacio();
    const r = migrarYValidar(modelo);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("se esperaba ok:true");
    expect(r.modelo).toEqual(modelo);
    expect(r.avisos).toEqual([]); // sin migracion aplicada
  });

  it("acepta un Modelo con elementos de obra", () => {
    const modelo = crearModeloVacio();
    modelo.grupos.push({
      id: "g1",
      nombre: "Cubierta",
      categoriaUso: "A",
      sobrecargaUso: 2,
      cargasMuertas: 1,
    });
    modelo.plantas.push({
      id: "p1",
      nombre: "Planta 1",
      cota: 3,
      altura: 3,
      grupoId: "g1",
    });
    const pilar: Pilar = {
      id: "pi1",
      nombre: "P1",
      x: 0,
      y: 0,
      plantaInicial: "p1",
      plantaFinal: "p1",
      seccionId: "s1",
      materialId: "m1",
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado",
    };
    modelo.pilares.push(pilar);

    const r = migrarYValidar(modelo);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("se esperaba ok:true");
    expect(r.modelo).toEqual(modelo);
  });
});

describe("migrarYValidar — version incompatible", () => {
  it("rechaza una version de esquema futura con mensaje claro", () => {
    const futuro = { ...crearModeloVacio(), schemaVersion: 999 };
    const errs = errores(migrarYValidar(futuro));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/version mas reciente/i);
    expect(errs[0]).toContain("999");
    expect(errs[0]).toContain(String(SCHEMA_VERSION));
  });
});

describe("migrarYValidar — datos corruptos (no lanza)", () => {
  it("rechaza null", () => {
    const errs = errores(migrarYValidar(null));
    expect(errs.length).toBeGreaterThan(0);
  });

  it("rechaza un no-objeto (string)", () => {
    expect(() => migrarYValidar("basura")).not.toThrow();
    expect(errores(migrarYValidar("basura")).length).toBeGreaterThan(0);
  });

  it("rechaza un objeto sin schemaVersion", () => {
    const errs = errores(migrarYValidar({ foo: "bar" }));
    expect(errs[0]).toMatch(/version de esquema|corrupto/i);
  });

  it("rechaza schemaVersion no numerico", () => {
    const errs = errores(migrarYValidar({ schemaVersion: "uno" }));
    expect(errs.length).toBeGreaterThan(0);
  });

  it("rechaza undefined", () => {
    expect(() => migrarYValidar(undefined)).not.toThrow();
    expect(errores(migrarYValidar(undefined)).length).toBeGreaterThan(0);
  });
});

describe("migrarYValidar — campo invalido apunta al campo", () => {
  it("detecta `unidades` mal y referencia la ruta", () => {
    const malo = { ...crearModeloVacio(), unidades: "kg-cm" };
    const errs = errores(migrarYValidar(malo));
    expect(errs.some((e) => e.startsWith("unidades:"))).toBe(true);
  });

  it("detecta un pilar sin seccionId y referencia su ruta", () => {
    const modelo = crearModeloVacio() as unknown as {
      pilares: unknown[];
    };
    // Pilar al que le falta `seccionId` (campo obligatorio).
    modelo.pilares.push({
      id: "pi1",
      nombre: "P1",
      x: 0,
      y: 0,
      plantaInicial: "p1",
      plantaFinal: "p1",
      materialId: "m1",
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado",
    });
    const errs = errores(migrarYValidar(modelo));
    // La ruta de Zod incluye el indice del array y el campo: "pilares.0.seccionId".
    expect(errs.some((e) => e.includes("pilares.0.seccionId"))).toBe(true);
  });
});

// Verifica que la CADENA de migraciones se aplica. No existe v2 real todavia,
// asi que se simula registrando una migracion temporal via override del modulo.
// Como el registro es privado, comprobamos en su lugar el comportamiento
// observable: un proyecto en la version VIGENTE no produce aviso de migracion
// (la cadena no se ejecuta). El test de aplicacion real de la cadena llegara
// con la primera v2 (cuando SCHEMA_VERSION suba). Se documenta aqui el limite.
describe("migrarYValidar — cadena de migraciones (v1)", () => {
  it("no aplica migracion cuando ya esta en la version vigente (sin avisos)", () => {
    const r = migrarYValidar(crearModeloVacio());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("se esperaba ok:true");
    expect(r.avisos).toEqual([]);
  });
});

// Ejercita la CADENA real (migracion.ts:81-94) inyectando un registro de
// migraciones sintetico (T3). Como SCHEMA_VERSION real es 1, partimos de un raw con
// schemaVersion=0 (MENOR que el objetivo): el bucle 0 -> 1 corre de verdad, aplica
// la migracion inyectada y emite el aviso. No tocamos el comportamiento de
// produccion: el registro real sigue vacio y el default no cambia.
describe("migrarYValidar — cadena de migraciones inyectada (T3)", () => {
  it("aplica una migracion 0 -> 1 inyectada: avanza la version y emite aviso", () => {
    // Modelo valido pero etiquetado en una version anterior a la vigente.
    const raw = { ...crearModeloVacio(), schemaVersion: 0 };
    // Migracion 0 -> 1: reetiqueta a la version vigente (forma ya valida).
    const migraciones: Record<number, Migracion> = {
      0: (datos) => ({
        ...(datos as Record<string, unknown>),
        schemaVersion: SCHEMA_VERSION,
      }),
    };

    const r = migrarYValidar(raw, migraciones);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("se esperaba ok:true");
    // Aviso de actualizacion de esquema (rama 95-99 + cuerpo del bucle 81-94).
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatch(/actualiz/i);
    // El modelo resultante quedo en la version vigente.
    expect(r.modelo.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("hueco en la cadena: registro vacio con schemaVersion menor -> error de migracion (T3)", () => {
    const raw = { ...crearModeloVacio(), schemaVersion: 0 };
    // Registro VACIO: no hay migracion 0 -> 1, la cadena no puede completarse.
    const r = migrarYValidar(raw, {});
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("se esperaba ok:false");
    expect(r.errores[0]).toMatch(/no es posible migrar/i);
    expect(r.errores[0]).toContain("v0");
  });
});
