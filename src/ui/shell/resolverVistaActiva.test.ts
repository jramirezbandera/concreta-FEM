// Tests de resolverVistaActiva (feature-9, T3; simplificada en F3.4 "plantas sin
// grupos"): coherencia de la planta activa frente al modelo, con foco en el FAILURE
// MODE de cargar una segunda obra (ids obsoletos de la obra anterior). Corre en el
// project "jsdom" (vive bajo src/ui/, excluido del project "node"); la funcion es
// pura y solo importa un tipo, asi que no necesita DOM.
import { describe, it, expect, beforeEach } from "vitest";
import { resolverVistaActiva, type VistaActiva } from "./resolverVistaActiva";
import { modeloStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";

// Construye una obra con las plantas dadas (id + cota). Sin grupos (F3.4): las
// plantas son una lista plana del edificio, cada una con su uso/cargas propios.
function obra(plantas: Array<{ id: string; cota: number }>): Modelo {
  return {
    ...crearModeloVacio(),
    plantas: plantas.map((p) => ({
      id: p.id,
      nombre: p.id,
      cota: p.cota,
      altura: 3,
      categoriaUso: "A",
      sobrecargaUso: 0,
      cargasMuertas: 0,
    })),
  };
}

// Obra A: dos plantas (cabecera = a2 por mayor cota).
const obraA = obra([
  { id: "a1", cota: 0 },
  { id: "a2", cota: 3 },
]);

// Obra B: dos plantas (cabecera = b2).
const obraB = obra([
  { id: "b1", cota: 0 },
  { id: "b2", cota: 3 },
]);

const VACIA: VistaActiva = { plantaActivaId: null };

describe("resolverVistaActiva: seleccion inicial sobre obra con contenido", () => {
  it("desde vista vacia escoge la planta cabecera (mayor cota)", () => {
    expect(resolverVistaActiva(obraA, VACIA)).toEqual({
      plantaActivaId: "a2",
    });
  });

  it("modelo vacio => planta a null", () => {
    expect(resolverVistaActiva(crearModeloVacio(), VACIA)).toEqual(VACIA);
  });

  it("es idempotente: aplicar dos veces da el mismo resultado", () => {
    const r1 = resolverVistaActiva(obraA, VACIA);
    const r2 = resolverVistaActiva(obraA, r1);
    expect(r2).toEqual(r1);
  });

  it("preserva una seleccion valida del usuario (no pisa a1 por la cabecera)", () => {
    const elegida: VistaActiva = { plantaActivaId: "a1" };
    expect(resolverVistaActiva(obraA, elegida)).toEqual(elegida);
  });
});

describe("resolverVistaActiva: FAILURE MODE de ids obsoletos tras cambiar de obra", () => {
  it("planta de la obra anterior (inexistente) => re-selecciona la cabecera de la nueva obra", () => {
    // Vista quedo apuntando a a2 (obra anterior); ahora el modelo es obraB.
    const obsoleta: VistaActiva = { plantaActivaId: "a2" };
    expect(resolverVistaActiva(obraB, obsoleta)).toEqual({
      plantaActivaId: "b2",
    });
  });
});

describe("integracion con modeloStore: cargar obra A y luego obra B no deja ids obsoletos", () => {
  beforeEach(() => {
    modeloStore.getState().cargarModelo(crearModeloVacio());
  });

  it("tras fijar la vista en A y cargar B, la vista resuelta es de B", () => {
    // 1) Cargar obra A y resolver la vista (como hace App al montar / al cambiar de obra).
    modeloStore.getState().cargarModelo(obraA);
    const vistaA = resolverVistaActiva(modeloStore.getState().modelo, VACIA);
    expect(vistaA).toEqual({ plantaActivaId: "a2" });

    // 2) Cargar obra B conservando la vista de A (ids ahora obsoletos).
    modeloStore.getState().cargarModelo(obraB);
    const vistaB = resolverVistaActiva(modeloStore.getState().modelo, vistaA);

    // La planta activa pasa a ser de B, no queda en a2.
    expect(vistaB.plantaActivaId).toBe("b2");
    expect(vistaB.plantaActivaId).not.toBe("a2");
  });
});
