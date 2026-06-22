// Tests de resolverVistaActiva (feature-9, T3): coherencia de grupo/planta
// activos frente al modelo, con foco en el FAILURE MODE de cargar una segunda
// obra (ids obsoletos de la obra anterior). Corre en el project "jsdom" (vive
// bajo src/ui/, excluido del project "node"); la funcion es pura y solo importa
// un tipo, asi que no necesita DOM.
import { describe, it, expect, beforeEach } from "vitest";
import { resolverVistaActiva, type VistaActiva } from "./resolverVistaActiva";
import { modeloStore } from "../../estado";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";

// Construye una obra con grupos/plantas dados. Cada planta lleva su grupo y cota.
function obra(
  grupos: string[],
  plantas: Array<{ id: string; grupoId: string; cota: number }>,
): Modelo {
  return {
    ...crearModeloVacio(),
    grupos: grupos.map((id) => ({
      id,
      nombre: id,
      categoriaUso: "A",
      sobrecargaUso: 2,
      cargasMuertas: 1,
    })),
    plantas: plantas.map((p) => ({
      id: p.id,
      nombre: p.id,
      cota: p.cota,
      altura: 3,
      grupoId: p.grupoId,
    })),
  };
}

// Obra A: grupo gA con dos plantas (cabecera = a2 por mayor cota).
const obraA = obra(
  ["gA"],
  [
    { id: "a1", grupoId: "gA", cota: 0 },
    { id: "a2", grupoId: "gA", cota: 3 },
  ],
);

// Obra B: grupo gB con dos plantas (cabecera = b2).
const obraB = obra(
  ["gB"],
  [
    { id: "b1", grupoId: "gB", cota: 0 },
    { id: "b2", grupoId: "gB", cota: 3 },
  ],
);

const VACIA: VistaActiva = { grupoActivoId: null, plantaActivaId: null };

describe("resolverVistaActiva: seleccion inicial sobre obra con contenido", () => {
  it("desde vista vacia escoge primer grupo + planta cabecera (mayor cota)", () => {
    expect(resolverVistaActiva(obraA, VACIA)).toEqual({
      grupoActivoId: "gA",
      plantaActivaId: "a2",
    });
  });

  it("modelo vacio => grupo y planta a null", () => {
    expect(resolverVistaActiva(crearModeloVacio(), VACIA)).toEqual(VACIA);
  });

  it("es idempotente: aplicar dos veces da el mismo resultado", () => {
    const r1 = resolverVistaActiva(obraA, VACIA);
    const r2 = resolverVistaActiva(obraA, r1);
    expect(r2).toEqual(r1);
  });

  it("preserva una seleccion valida del usuario (no pisa a1 por la cabecera)", () => {
    const elegida: VistaActiva = { grupoActivoId: "gA", plantaActivaId: "a1" };
    expect(resolverVistaActiva(obraA, elegida)).toEqual(elegida);
  });
});

describe("resolverVistaActiva: FAILURE MODE de ids obsoletos tras cambiar de obra", () => {
  it("grupo de la obra anterior (inexistente) => re-selecciona el de la nueva obra", () => {
    // Vista quedo apuntando a gA (obra anterior); ahora el modelo es obraB.
    const obsoleta: VistaActiva = { grupoActivoId: "gA", plantaActivaId: "a2" };
    expect(resolverVistaActiva(obraB, obsoleta)).toEqual({
      grupoActivoId: "gB",
      plantaActivaId: "b2",
    });
  });

  it("planta de otro grupo => re-selecciona cabecera del grupo resuelto", () => {
    // Grupo valido (gB) pero planta de la obra anterior.
    const mixta: VistaActiva = { grupoActivoId: "gB", plantaActivaId: "a1" };
    expect(resolverVistaActiva(obraB, mixta)).toEqual({
      grupoActivoId: "gB",
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
    expect(vistaA).toEqual({ grupoActivoId: "gA", plantaActivaId: "a2" });

    // 2) Cargar obra B conservando la vista de A (ids ahora obsoletos).
    modeloStore.getState().cargarModelo(obraB);
    const vistaB = resolverVistaActiva(modeloStore.getState().modelo, vistaA);

    // El grupo/planta activos pasan a ser de B, no quedan en gA/a2.
    expect(vistaB.grupoActivoId).toBe("gB");
    expect(vistaB.plantaActivaId).toBe("b2");
    expect(vistaB.grupoActivoId).not.toBe("gA");
    expect(vistaB.plantaActivaId).not.toBe("a2");
  });
});
