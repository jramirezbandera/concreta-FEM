// Tests del modulo PURO de validacion del dialogo de Plantas (T1.3; sin grupos desde
// F3.4). `validarGrupo` fue ELIMINADO con los grupos: solo queda `validarPlanta`.
//
// UBICACION: vive en src/ui/dialogos para acompanar al dialogo, pero el modulo es
// puro (no toca DOM). El project `node` de Vitest EXCLUYE `src/ui/**`, asi que este
// test lo recoge el project `jsdom` (include: src/ui/**/*.test.{ts,tsx}). Correr
// logica pura bajo jsdom es valido: setup-ui.ts solo anade matchers + cleanup RTL.
//   Ejecutar: npx vitest run --project jsdom src/ui/dialogos/validacionesDialogo.test.ts
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Modelo, Planta } from "../../dominio";
import { validarPlanta, esValido } from "./validacionesDialogo";

function planta(id: string, nombre: string, cota: number): Planta {
  return {
    id,
    nombre,
    cota,
    altura: 3,
    categoriaUso: "A",
    sobrecargaUso: 0,
    cargasMuertas: 0,
  };
}

// Modelo con dos plantas del edificio (sin grupos) para los casos de unicidad. Las
// cotas 3 y 6 estan ocupadas.
function modeloBase(): Modelo {
  const m = crearModeloVacio();
  m.plantas = [planta("p1", "Forjado 1", 3), planta("p2", "Forjado cubierta", 6)];
  return m;
}

describe("validarPlanta: nombre", () => {
  it("error de nombre cuando el nombre esta vacio (tras trim)", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, { nombre: "   ", cota: 9, altura: 3 });
    expect(errores).toContainEqual({
      campo: "nombre",
      mensaje: "La planta necesita un nombre.",
    });
  });

  it("error cuando el nombre duplica el de otra planta", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, {
      nombre: "Forjado 1",
      cota: 9,
      altura: 3,
    });
    expect(errores.some((e) => e.campo === "nombre")).toBe(true);
    expect(errores.find((e) => e.campo === "nombre")?.mensaje).toContain(
      "Ya existe una planta",
    );
  });

  it("sin error al EDITAR la misma planta conservando su nombre", () => {
    const m = modeloBase();
    // Edito p2 ("Forjado cubierta") manteniendo su propio nombre: no choca consigo misma.
    const errores = validarPlanta(m, "p2", {
      nombre: "Forjado cubierta",
      cota: 6,
      altura: 3,
    });
    expect(esValido(errores)).toBe(true);
  });
});

describe("validarPlanta: cargas", () => {
  it("error de numero cuando sobrecargaUso no es finito (NaN)", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, "p2", {
      nombre: "Forjado cubierta",
      cota: 6,
      altura: 3,
      sobrecargaUso: NaN,
    });
    expect(errores).toContainEqual({
      campo: "sobrecargaUso",
      mensaje: "Introduce un número válido.",
    });
  });

  it("error de numero cuando cargasMuertas no es finito (NaN)", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, "p2", {
      nombre: "Forjado cubierta",
      cota: 6,
      altura: 3,
      cargasMuertas: NaN,
    });
    expect(errores.some((e) => e.campo === "cargasMuertas")).toBe(true);
  });

  it("sin error de numero si los campos de carga no se aportan", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, "p2", {
      nombre: "Forjado cubierta",
      cota: 6,
      altura: 3,
    });
    expect(esValido(errores)).toBe(true);
  });

  it("error cuando sobrecargaUso es negativa", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, "p2", {
      nombre: "Forjado cubierta",
      cota: 6,
      altura: 3,
      sobrecargaUso: -1,
    });
    expect(errores).toContainEqual({
      campo: "sobrecargaUso",
      mensaje: "La sobrecarga de uso no puede ser negativa.",
    });
  });

  it("error cuando cargasMuertas es negativa", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, "p2", {
      nombre: "Forjado cubierta",
      cota: 6,
      altura: 3,
      cargasMuertas: -3,
    });
    expect(errores.some((e) => e.campo === "cargasMuertas")).toBe(true);
  });
});

describe("validarPlanta: altura y cota", () => {
  it("error de altura cuando es cero", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, {
      nombre: "Forjado 2",
      cota: 9,
      altura: 0,
    });
    expect(errores).toContainEqual({
      campo: "altura",
      mensaje: "La altura de la planta debe ser mayor que cero.",
    });
  });

  it("error de altura cuando es negativa", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, {
      nombre: "Forjado 2",
      cota: 9,
      altura: -2,
    });
    expect(errores.some((e) => e.campo === "altura")).toBe(true);
  });

  it("error de cota cuando se repite en el edificio (cota unica GLOBAL sin grupos)", () => {
    const m = modeloBase();
    // Ya hay una planta a cota 3.
    const errores = validarPlanta(m, null, {
      nombre: "Forjado nuevo",
      cota: 3,
      altura: 3,
    });
    expect(errores.some((e) => e.campo === "cota")).toBe(true);
    expect(errores.find((e) => e.campo === "cota")?.mensaje).toContain(
      "Ya hay una planta a la cota 3 m",
    );
  });

  it("cota libre: sin error", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, {
      nombre: "Forjado nuevo",
      cota: 9,
      altura: 3,
    });
    expect(esValido(errores)).toBe(true);
  });

  it("error de numero cuando la altura no es finita (NaN)", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, {
      nombre: "Forjado 2",
      cota: 9,
      altura: NaN,
    });
    expect(errores).toContainEqual({
      campo: "altura",
      mensaje: "Introduce un número válido.",
    });
  });

  it("error de numero cuando la cota no es finita (NaN)", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, {
      nombre: "Forjado 2",
      cota: NaN,
      altura: 3,
    });
    expect(errores).toContainEqual({
      campo: "cota",
      mensaje: "Introduce un número válido.",
    });
  });

  it("cota repetida se detecta con tolerancia (diferencia subepsilon)", () => {
    const m = modeloBase();
    // Hay una planta a cota 3; una cota a 3 + 1e-9 debe considerarse la misma.
    const errores = validarPlanta(m, null, {
      nombre: "Forjado nuevo",
      cota: 3 + 1e-9,
      altura: 3,
    });
    expect(errores.some((e) => e.campo === "cota")).toBe(true);
  });

  it("caso valido: nombre nuevo, altura positiva, cota libre", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, {
      nombre: "Forjado 2",
      cota: 9,
      altura: 3,
    });
    expect(esValido(errores)).toBe(true);
  });
});
