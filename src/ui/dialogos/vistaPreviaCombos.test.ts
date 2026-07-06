// Tests del formateador puro de la vista previa de combinaciones (D18). Node (project
// por defecto): sin React. Verifica que las lineas reflejan las hipotesis REALES del
// modelo (tipos y presencia del peso propio) y que los coeficientes salen de los datos.
import { describe, it, expect } from "vitest";
import { vistaPreviaCombos } from "./vistaPreviaCombos";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";

describe("vistaPreviaCombos", () => {
  it("emite ELU y ELS con la etiqueta larga y la formula del modelo vacio", () => {
    const m = crearModeloVacio();
    const lineas = vistaPreviaCombos(m);
    expect(lineas.map((l) => l.nombre)).toEqual(["ELU", "ELS"]);
    expect(lineas.map((l) => l.etiqueta)).toEqual([
      "E.L.U. (resistencia)",
      "E.L.S. (servicio)",
    ]);
    // Modelo vacio: cargas muertas (G) + sobrecarga de uso (Q) + peso propio automatico
    // (G). En ELU los dos terminos G comparten gamma 1,35 y colapsan a uno solo.
    expect(lineas[0].formula).toBe("1,35·G + 1,50·Q");
    expect(lineas[1].formula).toBe("1,00·G + 1,00·Q");
  });

  it("refleja las hipotesis reales: sin variables, ELU no muestra termino Q", () => {
    // Modelo con SOLO permanentes de usuario (sin variables). El helper no inventa una Q.
    const m: Modelo = crearModeloVacio();
    m.hipotesis = m.hipotesis.filter((h) => h.tipo === "permanente");
    const lineas = vistaPreviaCombos(m);
    // Todas permanentes: ELU pondera G a 1,35 (colapsado), ELS a 1,00. Sin "·Q".
    expect(lineas[0].formula).toBe("1,35·G");
    expect(lineas[1].formula).toBe("1,00·G");
  });

  it("con incluirPesoPropio OFF, la formula no cambia (el peso propio ya es G y colapsa)", () => {
    // El peso propio automatico es permanente (G). Excluirlo de los combos (flag OFF) no
    // altera la formula si sigue habiendo otra permanente: G ya estaba representado.
    const m = crearModeloVacio();
    m.analisis = { ...m.analisis, incluirPesoPropio: false };
    const lineas = vistaPreviaCombos(m);
    expect(lineas[0].formula).toBe("1,35·G + 1,50·Q");
  });

  it("un modelo sin hipotesis produce combos con formula vacia (—)", () => {
    const m = crearModeloVacio();
    m.hipotesis = [];
    const lineas = vistaPreviaCombos(m);
    expect(lineas.map((l) => l.formula)).toEqual(["—", "—"]);
  });

  // F3.4 (D-1): las cargas automaticas de planta viajan en cases SINTETICOS que no son
  // hipotesis del modelo. La vista previa debe RECOGERLOS (CM=G, uso=Q) sin que la
  // formula cambie de forma: colapsan con el resto de terminos del mismo gamma.
  it("con un paño y cargas de planta activas la formula sigue colapsada (sin terminos fantasma)", () => {
    const m: Modelo = crearModeloVacio();
    m.plantas = [
      { id: "p1", nombre: "P1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
    ];
    m.nudos = [
      { id: "q1", x: 0, y: 0 },
      { id: "q2", x: 4, y: 0 },
      { id: "q3", x: 4, y: 3 },
      { id: "q4", x: 0, y: 3 },
    ];
    m.panos = [
      {
        id: "f1", nombre: "F1", tipo: "losa", plantaId: "p1",
        perimetro: ["q1", "q2", "q3", "q4"],
        espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "simple",
      },
    ];
    const lineas = vistaPreviaCombos(m);
    // Los cases sinteticos (G y Q) colapsan con las hipotesis sembradas del mismo
    // gamma: la formula NO gana terminos nuevos ni pierde los de grupo.
    expect(lineas[0].formula).toBe("1,35·G + 1,50·Q");
    expect(lineas[1].formula).toBe("1,00·G + 1,00·Q");
  });

  it("SOLO cargas de planta (sin hipotesis del modelo): la formula las refleja igualmente", () => {
    const m: Modelo = crearModeloVacio();
    m.hipotesis = []; // sin hipotesis de usuario NI automatica
    m.analisis = { ...m.analisis, incluirPesoPropio: false };
    m.plantas = [
      { id: "p1", nombre: "P1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
    ];
    m.nudos = [
      { id: "q1", x: 0, y: 0 },
      { id: "q2", x: 4, y: 0 },
      { id: "q3", x: 4, y: 3 },
      { id: "q4", x: 0, y: 3 },
    ];
    m.panos = [
      {
        id: "f1", nombre: "F1", tipo: "losa", plantaId: "p1",
        perimetro: ["q1", "q2", "q3", "q4"],
        espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "simple",
      },
    ];
    const lineas = vistaPreviaCombos(m);
    // Antes del fix, formularCombo IGNORABA los ids sinteticos y mostraria "—":
    // la vista previa mentiria por omision.
    expect(lineas[0].formula).toBe("1,35·G + 1,50·Q");
  });
});
