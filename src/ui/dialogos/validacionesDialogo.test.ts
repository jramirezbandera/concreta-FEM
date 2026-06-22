// Tests del modulo PURO de validacion del dialogo de Grupos y Plantas (T1.3).
//
// UBICACION: vive en src/ui/dialogos para acompanar al dialogo, pero el modulo es
// puro (no toca DOM). El project `node` de Vitest EXCLUYE `src/ui/**`, asi que este
// test lo recoge el project `jsdom` (include: src/ui/**/*.test.{ts,tsx}). Correr
// logica pura bajo jsdom es valido: setup-ui.ts solo anade matchers + cleanup RTL.
//   Ejecutar: npx vitest run --project jsdom src/ui/dialogos/validacionesDialogo.test.ts
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Modelo, Grupo, Planta } from "../../dominio";
import { validarGrupo, validarPlanta, esValido } from "./validacionesDialogo";

// Fabrica un grupo minimo valido (los campos de uso no los valida el dialogo aqui).
function grupo(id: string, nombre: string): Grupo {
  return {
    id,
    nombre,
    categoriaUso: "A",
    sobrecargaUso: 2,
    cargasMuertas: 1,
  };
}

function planta(id: string, nombre: string, cota: number, grupoId: string): Planta {
  return { id, nombre, cota, altura: 3, grupoId };
}

// Modelo con dos grupos y dos plantas (una por grupo) para los casos de unicidad.
function modeloBase(): Modelo {
  const m = crearModeloVacio();
  m.grupos = [grupo("g1", "Planta tipo"), grupo("g2", "Cubierta")];
  m.plantas = [
    planta("p1", "Forjado 1", 3, "g1"),
    planta("p2", "Forjado cubierta", 6, "g2"),
  ];
  return m;
}

describe("validarGrupo", () => {
  it("error de nombre cuando el nombre esta vacio (tras trim)", () => {
    const m = modeloBase();
    const errores = validarGrupo(m, null, { nombre: "   " });
    expect(errores).toEqual([{ campo: "nombre", mensaje: "El grupo necesita un nombre." }]);
  });

  it("error cuando el nombre duplica el de otro grupo", () => {
    const m = modeloBase();
    const errores = validarGrupo(m, null, { nombre: "Cubierta" });
    expect(errores).toHaveLength(1);
    expect(errores[0].campo).toBe("nombre");
    expect(errores[0].mensaje).toContain("Ya existe un grupo");
  });

  it("sin error al EDITAR el mismo grupo conservando su nombre", () => {
    const m = modeloBase();
    // Edito g2 ("Cubierta") manteniendo su propio nombre: no debe chocar consigo mismo.
    const errores = validarGrupo(m, "g2", { nombre: "Cubierta" });
    expect(esValido(errores)).toBe(true);
  });

  it("error de numero cuando sobrecargaUso no es finito (NaN)", () => {
    const m = modeloBase();
    const errores = validarGrupo(m, "g2", { nombre: "Cubierta", sobrecargaUso: NaN });
    expect(errores).toContainEqual({
      campo: "sobrecargaUso",
      mensaje: "Introduce un número válido.",
    });
  });

  it("error de numero cuando cargasMuertas no es finito (NaN)", () => {
    const m = modeloBase();
    const errores = validarGrupo(m, "g2", { nombre: "Cubierta", cargasMuertas: NaN });
    expect(errores.some((e) => e.campo === "cargasMuertas")).toBe(true);
  });

  it("sin error de numero si los campos numericos no se aportan", () => {
    const m = modeloBase();
    const errores = validarGrupo(m, "g2", { nombre: "Cubierta" });
    expect(esValido(errores)).toBe(true);
  });

  it("error cuando sobrecargaUso es negativa", () => {
    const m = modeloBase();
    const errores = validarGrupo(m, "g2", { nombre: "Cubierta", sobrecargaUso: -1 });
    expect(errores).toContainEqual({
      campo: "sobrecargaUso",
      mensaje: "La sobrecarga de uso no puede ser negativa.",
    });
  });

  it("error cuando cargasMuertas es negativa", () => {
    const m = modeloBase();
    const errores = validarGrupo(m, "g2", { nombre: "Cubierta", cargasMuertas: -3 });
    expect(errores.some((e) => e.campo === "cargasMuertas")).toBe(true);
  });
});

describe("validarPlanta", () => {
  it("error de altura cuando es cero", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, {
      nombre: "Forjado 2",
      cota: 9,
      altura: 0,
      grupoId: "g1",
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
      grupoId: "g1",
    });
    expect(errores.some((e) => e.campo === "altura")).toBe(true);
  });

  it("error de cota cuando se repite en el MISMO grupo", () => {
    const m = modeloBase();
    // g1 ya tiene una planta a cota 3.
    const errores = validarPlanta(m, null, {
      nombre: "Forjado nuevo",
      cota: 3,
      altura: 3,
      grupoId: "g1",
    });
    expect(errores).toHaveLength(1);
    expect(errores[0].campo).toBe("cota");
    expect(errores[0].mensaje).toContain("Ya hay una planta a la cota 3 m");
  });

  it("sin error si la misma cota esta en OTRO grupo", () => {
    const m = modeloBase();
    // Cota 3 ya existe en g1, pero la nueva planta es del g2 (alli no choca).
    const errores = validarPlanta(m, null, {
      nombre: "Forjado nuevo",
      cota: 3,
      altura: 3,
      grupoId: "g2",
    });
    expect(esValido(errores)).toBe(true);
  });

  it("error de numero cuando la altura no es finita (NaN)", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, {
      nombre: "Forjado 2",
      cota: 9,
      altura: NaN,
      grupoId: "g1",
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
      grupoId: "g1",
    });
    expect(errores).toContainEqual({
      campo: "cota",
      mensaje: "Introduce un número válido.",
    });
  });

  it("cota repetida se detecta con tolerancia (diferencia subepsilon)", () => {
    const m = modeloBase();
    // g1 tiene una planta a cota 3; una cota a 3 + 1e-9 debe considerarse la misma.
    const errores = validarPlanta(m, null, {
      nombre: "Forjado nuevo",
      cota: 3 + 1e-9,
      altura: 3,
      grupoId: "g1",
    });
    expect(errores.some((e) => e.campo === "cota")).toBe(true);
  });

  it("caso valido: nombre nuevo, altura positiva, cota libre", () => {
    const m = modeloBase();
    const errores = validarPlanta(m, null, {
      nombre: "Forjado 2",
      cota: 9,
      altura: 3,
      grupoId: "g1",
    });
    expect(esValido(errores)).toBe(true);
  });
});
