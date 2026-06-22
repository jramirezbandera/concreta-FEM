// Tests de los comandos CRUD de Grupos y Plantas (feature-10, T1.1). Se ejecutan a
// traves del modeloStore real (singleton de modulo): cargarModelo(crearModeloVacio())
// en beforeEach aisla cada test. Verifican el delta (aplicar/revertir via undo/redo),
// la cascada grupo->plantas en un solo paso de undo, y el naming "G{n}"/"Planta {n}"
// derivado del mayor sufijo en uso (no del recuento). Proyecto "node" (sin DOM).
import { describe, it, expect, beforeEach } from "vitest";
import {
  modeloStore,
  crearGrupo,
  editarGrupo,
  eliminarGrupo,
  crearPlanta,
  editarPlanta,
  eliminarPlanta,
  editarPilar,
  eliminarPilar,
  moverPilar,
} from "../index";
import { crearModeloVacio } from "../../dominio";
import type { CategoriaUso } from "../../dominio";
import type { DatosGrupo, DatosPlanta } from "./comandosModelo";

// Datos minimos de prueba (sin id/nombre, los genera el comando).
const datosGrupo: DatosGrupo = {
  categoriaUso: "A",
  sobrecargaUso: 2,
  cargasMuertas: 1,
};

const datosPlanta: DatosPlanta = {
  cota: 3,
  altura: 3,
  grupoId: "g1",
};

const m = () => modeloStore.getState().getModelo();

beforeEach(() => {
  modeloStore.getState().cargarModelo(crearModeloVacio());
});

// --- crearGrupo: aplicar / deshacer / rehacer --------------------------------

describe("crearGrupo", () => {
  it("anade un grupo con nombre 'G1'", () => {
    modeloStore.getState().ejecutar(crearGrupo(m(), datosGrupo));
    expect(m().grupos).toHaveLength(1);
    expect(m().grupos[0].nombre).toBe("G1");
    expect(m().grupos[0].id).toMatch(/[0-9a-f-]{36}/);
  });

  it("deshacer lo quita (deep-equal al previo) y rehacer lo vuelve a poner", () => {
    const previo = structuredClone(m());
    modeloStore.getState().ejecutar(crearGrupo(m(), datosGrupo));
    const conGrupo = structuredClone(m());

    modeloStore.getState().deshacer();
    expect(m()).toEqual(previo);

    modeloStore.getState().rehacer();
    expect(m()).toEqual(conGrupo);
  });

  it("numera por el mayor sufijo en uso (G1, G2)", () => {
    modeloStore.getState().ejecutar(crearGrupo(m(), datosGrupo));
    modeloStore.getState().ejecutar(crearGrupo(m(), datosGrupo));
    expect(m().grupos.map((g) => g.nombre)).toEqual(["G1", "G2"]);
  });
});

// --- editarGrupo -------------------------------------------------------------

describe("editarGrupo", () => {
  it("cambia categoriaUso/sobrecargaUso y deshacer revierte", () => {
    modeloStore.getState().ejecutar(crearGrupo(m(), datosGrupo));
    const id = m().grupos[0].id;
    const conGrupo = structuredClone(m());

    const nuevaCategoria: CategoriaUso = "C";
    modeloStore
      .getState()
      .ejecutar(
        editarGrupo(m(), id, { categoriaUso: nuevaCategoria, sobrecargaUso: 5 }),
      );
    expect(m().grupos[0].categoriaUso).toBe("C");
    expect(m().grupos[0].sobrecargaUso).toBe(5);

    modeloStore.getState().deshacer();
    expect(m()).toEqual(conGrupo);
    expect(m().grupos[0].categoriaUso).toBe("A");
    expect(m().grupos[0].sobrecargaUso).toBe(2);
  });

  it("editar un grupo inexistente es no-op (no lanza, no cambia)", () => {
    modeloStore.getState().ejecutar(crearGrupo(m(), datosGrupo));
    const antes = structuredClone(m());
    modeloStore.getState().ejecutar(editarGrupo(m(), "no-existe", { sobrecargaUso: 9 }));
    expect(m()).toEqual(antes);
  });
});

// --- eliminarGrupo: cascada a plantas en un solo paso de undo ----------------

describe("eliminarGrupo (cascada)", () => {
  it("arrastra las plantas del grupo; deshacer restaura grupo + plantas", () => {
    // Grupo con dos plantas asociadas + una planta de otro grupo que NO debe caer.
    modeloStore.getState().ejecutar(crearGrupo(m(), datosGrupo));
    const grupoId = m().grupos[0].id;
    modeloStore.getState().ejecutar(crearPlanta(m(), { ...datosPlanta, grupoId }));
    modeloStore.getState().ejecutar(crearPlanta(m(), { ...datosPlanta, grupoId }));
    modeloStore
      .getState()
      .ejecutar(crearPlanta(m(), { ...datosPlanta, grupoId: "otro" }));
    const conTodo = structuredClone(m());
    expect(m().plantas).toHaveLength(3);

    modeloStore.getState().ejecutar(eliminarGrupo(m(), grupoId));
    expect(m().grupos).toHaveLength(0);
    // Solo cae la planta de "otro" grupo se mantiene; las dos del grupo desaparecen.
    expect(m().plantas).toHaveLength(1);
    expect(m().plantas[0].grupoId).toBe("otro");

    // Un solo deshacer restaura grupo Y sus plantas (cascada = un paso).
    modeloStore.getState().deshacer();
    expect(m()).toEqual(conTodo);
  });
});

// --- crearPlanta: naming "Planta {n}" ----------------------------------------

describe("crearPlanta", () => {
  it("produce 'Planta 1', 'Planta 2'", () => {
    modeloStore.getState().ejecutar(crearPlanta(m(), datosPlanta));
    modeloStore.getState().ejecutar(crearPlanta(m(), datosPlanta));
    expect(m().plantas.map((p) => p.nombre)).toEqual(["Planta 1", "Planta 2"]);
  });

  it("tras eliminar 'Planta 1', la siguiente NO colisiona (usa el mayor sufijo)", () => {
    modeloStore.getState().ejecutar(crearPlanta(m(), datosPlanta));
    modeloStore.getState().ejecutar(crearPlanta(m(), datosPlanta));
    const idPlanta1 = m().plantas.find((p) => p.nombre === "Planta 1")!.id;

    modeloStore.getState().ejecutar(eliminarPlanta(m(), idPlanta1));
    // Queda solo "Planta 2"; la siguiente es "Planta 3" (max+1), no reusa "Planta 2".
    modeloStore.getState().ejecutar(crearPlanta(m(), datosPlanta));
    const nombres = m().plantas.map((p) => p.nombre);
    expect(nombres).toContain("Planta 2");
    expect(nombres).toContain("Planta 3");
    expect(nombres).not.toContain("Planta 1");
  });
});

// --- editarPlanta ------------------------------------------------------------

describe("editarPlanta", () => {
  it("cambia cota/altura y deshacer revierte", () => {
    modeloStore.getState().ejecutar(crearPlanta(m(), datosPlanta));
    const id = m().plantas[0].id;
    const conPlanta = structuredClone(m());

    modeloStore.getState().ejecutar(editarPlanta(m(), id, { cota: 9, altura: 4 }));
    expect(m().plantas[0]).toMatchObject({ cota: 9, altura: 4 });

    modeloStore.getState().deshacer();
    expect(m()).toEqual(conPlanta);
  });
});

// --- eliminarPlanta ----------------------------------------------------------

describe("eliminarPlanta", () => {
  it("quita solo esa planta", () => {
    modeloStore.getState().ejecutar(crearPlanta(m(), datosPlanta));
    modeloStore.getState().ejecutar(crearPlanta(m(), datosPlanta));
    const id = m().plantas[0].id;

    modeloStore.getState().ejecutar(eliminarPlanta(m(), id));
    expect(m().plantas).toHaveLength(1);
    expect(m().plantas.find((p) => p.id === id)).toBeUndefined();
  });
});

// --- Integridad referencial: el borrado arrastra pilares/vigas/cargas ---------
// (revision de ingenieria F10). Construimos un modelo con elementos de Capa 1 que
// referencian plantas de dos grupos y comprobamos que borrar arrastra SOLO los
// dependientes correctos, deja los nudos (geometria compartida) y es un paso de undo.

// Modelo con dos grupos, tres plantas y pilares/vigas/cargas/nudos que las referencian.
function modeloConDependientes() {
  const base = crearModeloVacio();
  base.grupos = [
    { id: "g1", nombre: "G1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
    { id: "g2", nombre: "G2", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
  ];
  base.plantas = [
    { id: "p1", nombre: "Planta 1", cota: 0, altura: 3, grupoId: "g1" },
    { id: "p2", nombre: "Planta 2", cota: 3, altura: 3, grupoId: "g1" },
    { id: "p3", nombre: "Planta 3", cota: 0, altura: 3, grupoId: "g2" },
  ];
  base.nudos = [
    { id: "n1", x: 0, y: 0 },
    { id: "n2", x: 5, y: 0 },
  ];
  const pilarBase = {
    seccionId: "s1",
    materialId: "m1",
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado" as const,
  };
  base.pilares = [
    // pil1 va de p1 a p2 (ambas en g1): cae al borrar g1 o cualquiera de esas plantas.
    { id: "pil1", nombre: "P1", x: 0, y: 0, plantaInicial: "p1", plantaFinal: "p2", ...pilarBase },
    // pil2 en p3 (g2): sobrevive a borrados de g1.
    { id: "pil2", nombre: "P2", x: 5, y: 0, plantaInicial: "p3", plantaFinal: "p3", ...pilarBase },
  ];
  const vigaBase = {
    seccionId: "s1",
    materialId: "m1",
    nudoI: "n1",
    nudoJ: "n2",
    extremoI: "empotrado" as const,
    extremoJ: "empotrado" as const,
    tirante: false,
  };
  base.vigas = [
    { id: "v1", nombre: "V1", plantaId: "p2", ...vigaBase }, // g1: cae
    { id: "v2", nombre: "V2", plantaId: "p3", ...vigaBase }, // g2: sobrevive
  ];
  base.cargas = [
    { id: "c1", tipo: "lineal", ambito: "v1", valor: 5, hipotesisId: "h1" }, // sobre v1: cae
    { id: "c2", tipo: "superficial", ambito: "p1", valor: 2, hipotesisId: "h1" }, // sobre p1: cae
    { id: "c3", tipo: "lineal", ambito: "v2", valor: 5, hipotesisId: "h1" }, // sobre v2: sobrevive
  ];
  base.hipotesis = [{ id: "h1", nombre: "G", tipo: "permanente" }];
  return base;
}

describe("integridad referencial al borrar", () => {
  it("eliminarGrupo arrastra pilares/vigas/cargas de sus plantas, deja nudos y es 1 undo", () => {
    modeloStore.getState().cargarModelo(modeloConDependientes());
    const conTodo = structuredClone(m());

    modeloStore.getState().ejecutar(eliminarGrupo(m(), "g1"));

    expect(m().grupos.map((g) => g.id)).toEqual(["g2"]);
    expect(m().plantas.map((p) => p.id)).toEqual(["p3"]);
    expect(m().pilares.map((p) => p.id)).toEqual(["pil2"]); // pil1 (p1/p2) cae
    expect(m().vigas.map((v) => v.id)).toEqual(["v2"]); // v1 (p2) cae
    expect(m().cargas.map((c) => c.id)).toEqual(["c3"]); // c1 (v1) y c2 (p1) caen
    expect(m().nudos).toHaveLength(2); // geometria compartida: intacta

    modeloStore.getState().deshacer();
    expect(m()).toEqual(conTodo); // cascada = un solo paso
  });

  it("eliminarPlanta arrastra el pilar que la toca, su viga y sus cargas", () => {
    modeloStore.getState().cargarModelo(modeloConDependientes());

    modeloStore.getState().ejecutar(eliminarPlanta(m(), "p2"));

    expect(m().plantas.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(m().pilares.map((p) => p.id)).toEqual(["pil2"]); // pil1 toca p2 (plantaFinal)
    expect(m().vigas.map((v) => v.id)).toEqual(["v2"]); // v1 es de p2
    // c1 (sobre v1) cae con la viga; c2 (sobre p1) y c3 (sobre v2) sobreviven.
    expect(m().cargas.map((c) => c.id).sort()).toEqual(["c2", "c3"]);
    expect(m().nudos).toHaveLength(2);
  });
});

// --- Comandos de pilar (feature-11, T1.1) ------------------------------------
// Modelo con dos pilares y cargas: una directamente sobre un pilar (ambito=pilarId)
// para verificar la purga de eliminarPilar, otra sobre el otro pilar (sobrevive).

function modeloConPilares() {
  const base = crearModeloVacio();
  base.grupos = [
    { id: "g1", nombre: "G1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
  ];
  base.plantas = [
    { id: "p1", nombre: "Planta 1", cota: 0, altura: 3, grupoId: "g1" },
    { id: "p2", nombre: "Planta 2", cota: 3, altura: 3, grupoId: "g1" },
  ];
  const pilarBase = {
    seccionId: "s1",
    materialId: "m1",
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado" as const,
  };
  base.pilares = [
    { id: "pil1", nombre: "P1", x: 0, y: 0, plantaInicial: "p1", plantaFinal: "p2", ...pilarBase },
    { id: "pil2", nombre: "P2", x: 5, y: 0, plantaInicial: "p1", plantaFinal: "p2", ...pilarBase },
  ];
  // Cargas: c1 sobre pil1 (cae al borrarlo), c2 sobre pil2 (sobrevive).
  base.cargas = [
    { id: "c1", tipo: "puntual", ambito: "pil1", valor: 10, hipotesisId: "h1" },
    { id: "c2", tipo: "puntual", ambito: "pil2", valor: 7, hipotesisId: "h1" },
  ];
  base.hipotesis = [{ id: "h1", nombre: "G", tipo: "permanente" }];
  return base;
}

describe("editarPilar", () => {
  it("aplica un merge superficial de los cambios; deshacer revierte", () => {
    modeloStore.getState().cargarModelo(modeloConPilares());
    const conPilares = structuredClone(m());

    modeloStore
      .getState()
      .ejecutar(
        editarPilar(m(), "pil1", {
          seccionId: "s2",
          angulo: 90,
          arranque: "articulado",
        }),
      );
    const pil1 = m().pilares.find((p) => p.id === "pil1")!;
    expect(pil1).toMatchObject({ seccionId: "s2", angulo: 90, arranque: "articulado" });
    // Campos no incluidos en `cambios` quedan intactos (merge superficial).
    expect(pil1).toMatchObject({ x: 0, y: 0, materialId: "m1", nombre: "P1" });

    modeloStore.getState().deshacer();
    expect(m()).toEqual(conPilares);

    modeloStore.getState().rehacer();
    expect(m().pilares.find((p) => p.id === "pil1")).toMatchObject({
      seccionId: "s2",
      angulo: 90,
    });
  });

  it("editar un pilar inexistente es no-op (no lanza, no cambia)", () => {
    modeloStore.getState().cargarModelo(modeloConPilares());
    const antes = structuredClone(m());
    modeloStore.getState().ejecutar(editarPilar(m(), "no-existe", { angulo: 45 }));
    expect(m()).toEqual(antes);
  });
});

describe("eliminarPilar", () => {
  it("quita el pilar y purga sus cargas (ambito=pilarId) en un solo paso de undo", () => {
    modeloStore.getState().cargarModelo(modeloConPilares());
    const conTodo = structuredClone(m());

    modeloStore.getState().ejecutar(eliminarPilar(m(), "pil1"));

    expect(m().pilares.map((p) => p.id)).toEqual(["pil2"]);
    // c1 (sobre pil1) cae; c2 (sobre pil2) sobrevive.
    expect(m().cargas.map((c) => c.id)).toEqual(["c2"]);
    // Nudos no se tocan (geometria compartida).
    expect(m().nudos).toEqual(conTodo.nudos);

    // Un solo deshacer restaura pilar + carga (purga = un paso).
    modeloStore.getState().deshacer();
    expect(m()).toEqual(conTodo);

    modeloStore.getState().rehacer();
    expect(m().pilares.map((p) => p.id)).toEqual(["pil2"]);
    expect(m().cargas.map((c) => c.id)).toEqual(["c2"]);
  });

  it("eliminar un pilar inexistente no afecta a cargas ni pilares", () => {
    modeloStore.getState().cargarModelo(modeloConPilares());
    const antes = structuredClone(m());
    modeloStore.getState().ejecutar(eliminarPilar(m(), "no-existe"));
    expect(m()).toEqual(antes);
  });
});

describe("moverPilar", () => {
  it("cambia x/y; deshacer revierte", () => {
    modeloStore.getState().cargarModelo(modeloConPilares());
    const conPilares = structuredClone(m());

    modeloStore.getState().ejecutar(moverPilar(m(), "pil1", 2.5, 1.5));
    expect(m().pilares.find((p) => p.id === "pil1")).toMatchObject({ x: 2.5, y: 1.5 });

    modeloStore.getState().deshacer();
    expect(m()).toEqual(conPilares);
  });

  it("una rafaga de arrastre del MISMO pilar coalesce en un solo paso de undo", () => {
    modeloStore.getState().cargarModelo(modeloConPilares());
    const conPilares = structuredClone(m());

    // Rafaga: tres moverPilar consecutivos del mismo pilar (misma coalesceKey).
    modeloStore.getState().ejecutar(moverPilar(m(), "pil1", 1, 1));
    modeloStore.getState().ejecutar(moverPilar(m(), "pil1", 2, 2));
    modeloStore.getState().ejecutar(moverPilar(m(), "pil1", 3, 3));
    expect(m().pilares.find((p) => p.id === "pil1")).toMatchObject({ x: 3, y: 3 });

    // Un solo deshacer salta al estado previo a toda la rafaga.
    modeloStore.getState().deshacer();
    expect(m()).toEqual(conPilares);
    expect(modeloStore.getState().puedeDeshacer).toBe(false);
  });

  it("pilares distintos NO coalescen (cada uno es su paso de undo)", () => {
    modeloStore.getState().cargarModelo(modeloConPilares());

    modeloStore.getState().ejecutar(moverPilar(m(), "pil1", 1, 1));
    modeloStore.getState().ejecutar(moverPilar(m(), "pil2", 9, 9));
    expect(m().pilares.find((p) => p.id === "pil2")).toMatchObject({ x: 9, y: 9 });

    // Deshacer solo revierte pil2; pil1 sigue movido (dos pasos separados).
    modeloStore.getState().deshacer();
    expect(m().pilares.find((p) => p.id === "pil2")).toMatchObject({ x: 5, y: 0 });
    expect(m().pilares.find((p) => p.id === "pil1")).toMatchObject({ x: 1, y: 1 });
  });
});
