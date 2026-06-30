// Tests del modulo PURO de validacion de la carga (feature-13, T2.2).
//
// UBICACION: vive en src/ui/dialogos para acompanar al dialogo de cargas, pero el
// modulo es puro (no toca DOM). El project `node` de Vitest EXCLUYE `src/ui/**`,
// asi que lo recoge el project `jsdom` (include: src/ui/**/*.test.ts).
//   Ejecutar: npx vitest run src/ui/dialogos/validacionesCarga
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Modelo, Viga } from "../../dominio";
import {
  validarCarga,
  avisoSuperficial,
  esValido,
  type DatosCargaUI,
} from "./validacionesCarga";

// Hipotesis sembrada por crearModeloVacio(), valida como destino de la carga.
const HIP_OK = "hip-cargas-muertas";

function viga(id: string, nombre: string): Viga {
  return {
    id,
    nombre,
    plantaId: "p1",
    nudoI: "n1",
    nudoJ: "n2",
    seccionId: "IPE200",
    materialId: "S275",
    extremoI: "empotrado",
    extremoJ: "empotrado",
    tirante: false,
  };
}

// Modelo con una viga "V1" sobre la que aplicar la carga.
function modeloBase(): Modelo {
  const m = crearModeloVacio();
  m.vigas = [viga("vig1", "V1")];
  return m;
}

// Datos validos por defecto: carga lineal sobre la viga existente.
function datosOK(over: Partial<DatosCargaUI> = {}): DatosCargaUI {
  return {
    tipo: "lineal",
    ambito: "vig1",
    valor: 10,
    hipotesisId: HIP_OK,
    ...over,
  };
}

describe("validarCarga", () => {
  it("caso totalmente valido: cero errores", () => {
    const errores = validarCarga(modeloBase(), null, datosOK());
    expect(esValido(errores)).toBe(true);
  });

  it("valor positivo es valido", () => {
    const errores = validarCarga(modeloBase(), null, datosOK({ valor: 5 }));
    expect(esValido(errores)).toBe(true);
  });

  it("valor cero da error de valor", () => {
    const errores = validarCarga(modeloBase(), null, datosOK({ valor: 0 }));
    expect(errores).toContainEqual({
      campo: "valor",
      mensaje: "El valor de la carga debe ser mayor que cero.",
    });
  });

  it("valor negativo da error de valor (en F1 el sentido lo fija el discretizador)", () => {
    const errores = validarCarga(modeloBase(), null, datosOK({ valor: -5 }));
    expect(errores).toContainEqual({
      campo: "valor",
      mensaje: "El valor de la carga debe ser mayor que cero.",
    });
  });

  it("valor no finito (NaN) da error de valor", () => {
    const errores = validarCarga(modeloBase(), null, datosOK({ valor: Number.NaN }));
    expect(errores.some((e) => e.campo === "valor")).toBe(true);
  });

  it("hipotesis inexistente da error", () => {
    const errores = validarCarga(modeloBase(), null, datosOK({ hipotesisId: "hip-no-existe" }));
    expect(errores).toContainEqual({
      campo: "hipotesisId",
      mensaje: "La hipótesis a la que se asigna la carga no existe.",
    });
  });

  it("ambito inexistente da error", () => {
    const errores = validarCarga(modeloBase(), null, datosOK({ ambito: "no-existe" }));
    expect(errores.some((e) => e.campo === "ambito")).toBe(true);
  });

  it("acepta ambito que es un nudo o un pilar existente", () => {
    const m = modeloBase();
    m.nudos = [{ id: "nudoA", x: 0, y: 0 }];
    const errores = validarCarga(m, null, datosOK({ tipo: "puntual", ambito: "nudoA" }));
    expect(esValido(errores)).toBe(true);
  });
});

describe("avisoSuperficial", () => {
  it("no devuelve aviso para cargas lineales/puntuales", () => {
    expect(avisoSuperficial(datosOK({ tipo: "lineal" }))).toBeNull();
    expect(avisoSuperficial(datosOK({ tipo: "puntual" }))).toBeNull();
  });

  it("ya NO avisa para cargas superficiales (F3: la losa se calcula)", () => {
    // En F1 la carga superficial sobre paño no se calculaba y este aviso advertia. En
    // F3 corte 1 la losa ya se malla y calcula, asi que el caso losa ya no genera aviso.
    expect(avisoSuperficial(datosOK({ tipo: "superficial" }))).toBeNull();
  });

  it("una carga superficial NO es bloqueante en validarCarga (solo el aviso advierte)", () => {
    // El tipo superficial no genera ErrorCampo bloqueante: la carga puede guardarse;
    // es el discretizador quien la bloquea al calcular (PANO_NO_SOPORTADO).
    const errores = validarCarga(modeloBase(), null, datosOK({ tipo: "superficial" }));
    expect(esValido(errores)).toBe(true);
  });
});
