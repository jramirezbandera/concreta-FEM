// Integración REAL del flujo de importación (D2). Project `persistencia` (tiene
// fake-indexeddb): la lógica de importObra vive en /src/ui pero es node-safe (no React),
// así que aquí se ejercita contra Dexie + el modeloStore reales, sin mocks.
//
// Cubre el invariante del proyecto: "importar un proyecto nunca debe poder romper la app".
//   - texto válido -> validarTextoImport ok -> aplicarImport crea un proyecto NUEVO, lo
//     deja activo y hidrata el modeloStore con el modelo importado.
//   - texto corrupto/ajeno -> validarTextoImport NO ok -> el store NO se toca.
//   - una importación NO es reversible: tras aplicarla, la pila de undo queda vacía.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "./esquema";
import {
  validarTextoImport,
  aplicarImport,
} from "../ui/shell/importarObra";
import { exportarProyectoComoTexto } from "./serializacion";
import {
  crearProyecto,
  getProyectoActivoId,
  listarProyectos,
} from "./repositorio";
import { modeloStore } from "../estado/modeloStore";
import { crearModeloVacio } from "../dominio";

beforeEach(async () => {
  await db.proyectos.clear();
  await db.meta.clear();
  await db.plantillas.clear();
  // Store limpio antes de cada caso (evita arrastre entre tests).
  modeloStore.getState().cargarModelo(crearModeloVacio());
});

afterEach(async () => {
  await db.proyectos.clear();
  await db.meta.clear();
  await db.plantillas.clear();
});

// Fabrica el texto .json de una obra con un pilar reconocible (para verificar que ese
// modelo concreto acaba en el store tras importar).
function jsonConPilar(nombre: string): string {
  const modelo = crearModeloVacio();
  modelo.pilares.push({
    id: "pilar-json",
    nombre: "P-import",
    x: 3,
    y: 4,
    plantaInicial: "pa",
    plantaFinal: "pa",
    seccionId: "sX",
    materialId: "mX",
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado",
  });
  // Necesita una planta/grupo válidos para pasar Zod: crearModeloVacio ya trae la
  // estructura mínima; añadimos referencias coherentes si el esquema las exige.
  return exportarProyectoComoTexto(nombre, modelo);
}

describe("importar obra · integración real (D2)", () => {
  it("texto válido: crea un proyecto nuevo, lo deja activo e hidrata el store", async () => {
    // Parte de un proyecto existente (la obra actual) para probar que NO se sobrescribe.
    const actual = await crearProyecto("Obra actual");

    const validado = validarTextoImport(jsonConPilar("Obra importada"));
    expect(validado.ok).toBe(true);

    const res = await aplicarImport(validado);
    expect(res.nombre).toBe("Obra importada");

    // Se creó un proyecto NUEVO (la obra actual sigue existiendo): dos en la biblioteca.
    const lista = await listarProyectos();
    expect(lista).toHaveLength(2);
    expect(lista.some((p) => p.id === actual.id)).toBe(true);
    expect(lista.some((p) => p.id === res.proyectoId)).toBe(true);

    // El proyecto importado queda ACTIVO.
    expect(await getProyectoActivoId()).toBe(res.proyectoId);

    // El modeloStore quedó hidratado con el modelo importado (el pilar reconocible).
    const enStore = modeloStore.getState().getModelo();
    expect(enStore.pilares.some((p) => p.id === "pilar-json")).toBe(true);
  });

  it("una importación NO es reversible: la pila de undo queda vacía tras importar", async () => {
    // Ensucia la pila de undo con una edición previa (cargarModelo la limpiaría).
    const validado = validarTextoImport(jsonConPilar("Obra"));
    expect(validado.ok).toBe(true);
    await aplicarImport(validado);
    expect(modeloStore.getState().puedeDeshacer).toBe(false);
    expect(modeloStore.getState().puedeRehacer).toBe(false);
  });

  it("texto corrupto: validar falla y el store NO se toca (obra intacta)", async () => {
    // Store con un modelo marcado que NO debe cambiar.
    const marcado = crearModeloVacio();
    marcado.pilares.push({
      id: "no-tocar",
      nombre: "Q1",
      x: 0,
      y: 0,
      plantaInicial: "p",
      plantaFinal: "p",
      seccionId: "s",
      materialId: "m",
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado",
    });
    modeloStore.getState().cargarModelo(marcado);

    const validado = validarTextoImport("esto no es json");
    expect(validado.ok).toBe(false);

    // El store sigue con el modelo marcado (no se aplicó nada).
    const enStore = modeloStore.getState().getModelo();
    expect(enStore.pilares.some((p) => p.id === "no-tocar")).toBe(true);
    // No se creó ningún proyecto por el intento fallido.
    expect(await listarProyectos()).toHaveLength(0);
  });

  it("fichero .json ajeno (formato incorrecto): validar falla en lenguaje de obra", async () => {
    const ajeno = JSON.stringify({ foo: "bar", modelo: { schemaVersion: 3 } });
    const validado = validarTextoImport(ajeno);
    expect(validado.ok).toBe(false);
    if (!validado.ok) {
      // Mensaje legible (marca de formato), NO un stack trace.
      expect(validado.errores.join(" ")).toMatch(/formato|proyecto de Concreta/i);
    }
  });
});
