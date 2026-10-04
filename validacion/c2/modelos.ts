/**
 * Modelos físicos de validación de C2 (no son código del compilador).
 *
 * `edificioObjetivoLosas`: el edificio objetivo de C1 (`validacion/c1/banco.ts`: retícula de
 * 10 × 8 pilares con luces de 6 × 5 m, vigas por todos los ejes y secundarias a media luz) con una
 * losa maciza de 25 cm por planta dibujada a ejes, con el hueco de la escalera. Cargas: peso propio
 * (pilares, vigas por su descuelgue y losas por su pp), resto de permanentes y sobrecarga como
 * superficie (con una zona más cargada), tabiquería como carga lineal y viento en los pilares.
 */
import type { CargaFisica, ModeloFisico } from "../../src/compilador/fisico.ts";
import { edificioObjetivo } from "../c1/banco.ts";

export function edificioObjetivoLosas(plantas = 7, nx = 9, ny = 7): ModeloFisico {
  const f = edificioObjetivo(plantas, nx, ny);
  const [X, Y] = [6 * nx, 5 * ny];
  // Hueco de la escalera en el vano (4, 3), o en el último si el edificio es más pequeño
  const [bx, by] = [6 * Math.min(4, nx - 1), 5 * Math.min(3, ny - 1)];
  const ids = Array.from({ length: plantas }, (_, k) => `N${k + 1}`);
  // Sin las cargas lineales de las vigas de C1: las cargas van ahora a la losa
  const cargas: CargaFisica[] = f.cargas!.filter((c) => c.tipo === "pilar");
  for (const p of ids) {
    cargas.push({ tipo: "superficie", id: `R-${p}`, caso: "G", planta: p, losa: `L-${p}`, q: [0, 0, -2] });
    cargas.push({ tipo: "superficie", id: `Q-${p}`, caso: "Q", planta: p, losa: `L-${p}`, q: [0, 0, -2] });
    cargas.push({
      tipo: "superficie",
      id: `Qz-${p}`,
      caso: "Q",
      planta: p,
      zona: [
        [6.8, 2.6],
        [Math.min(17.2, X - 0.8), 2.6],
        [Math.min(17.2, X - 0.8), Math.min(12.4, Y - 0.6)],
        [6.8, Math.min(12.4, Y - 0.6)],
      ],
      q: [0, 0, -3],
    });
    cargas.push({
      tipo: "lineal",
      id: `T-${p}`,
      caso: "G",
      planta: p,
      // En un edificio pequeño, en la primera fila de vanos (lejos del hueco)
      puntos: [
        [1.5, ny >= 4 ? 7.5 : 2.5],
        [Math.min(22.5, X - 1.5), ny >= 4 ? 7.5 : 2.5],
        [Math.min(22.5, X - 1.5), ny >= 4 ? Math.min(21.5, Y - 1.5) : 4.5],
      ],
      q: [0, 0, -7],
    });
  }
  return {
    ...f,
    losas: ids.map((p) => ({
      id: `L-${p}`,
      planta: p,
      contorno: [
        [0, 0],
        [X, 0],
        [X, Y],
        [0, Y],
      ],
      huecos: [
        [
          [bx + 0.6, by + 0.4],
          [bx + 5.4, by + 0.4],
          [bx + 5.4, by + 4.6],
          [bx + 0.6, by + 4.6],
        ],
      ],
      espesor: 0.25,
      material: "HA",
    })),
    cargas,
  };
}
