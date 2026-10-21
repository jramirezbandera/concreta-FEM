/**
 * Modelo de prueba de la fase PF (`docs/fem3d/punto-fijo.md`): una losa plana de 2 × 2 vanos y tres
 * plantas, con los pilares de fachada y de esquina de 40 × 40 hasta N1 y de 30 × 30 encima, con la
 * cara exterior (o la esquina) fija en el borde de la losa, como se hace en CYPECAD; el central, de
 * 40 × 40 a 30 × 30 con el centro fijo. Opcionalmente girado: la planta y los pilares, `giro` grados.
 * No es código del compilador.
 */
import type { ModeloFisico, Pilar, PuntoFijo, Vec2 } from "../compilador/fisico.ts";

export function edificioPuntoFijo(giro = 0): ModeloFisico {
  const L = 5;
  const [c, s] = giro % 90 === 0 ? ([[1, 0], [0, 1], [-1, 0], [0, -1]][(((giro / 90) % 4) + 4) % 4]! as [number, number]) : [Math.cos((giro * Math.PI) / 180), Math.sin((giro * Math.PI) / 180)];
  const P = (x: number, y: number): Vec2 => [x * c - y * s, x * s + y * c];
  const fijo = (i: number, j: number): PuntoFijo => {
    const h = i === 0 ? "izquierda" : i === 2 ? "derecha" : "";
    const v = j === 0 ? "inferior" : j === 2 ? "superior" : "";
    return h && v ? `esquina-${v}-${h}` as PuntoFijo : h ? `mitad-${h}` as PuntoFijo : v ? `mitad-${v}` as PuntoFijo : "centro";
  };
  const pilares: Pilar[] = [];
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) {
      const [x, y] = P(i * L, j * L);
      pilares.push({ id: `P${j * 3 + i + 1}`, x, y, desde: "C", hasta: "N3", seccion: "p40", tramos: [{ planta: "N2", seccion: "p30" }, { planta: "N3", seccion: "p30" }], fijo: fijo(i, j), ...(giro ? { giro } : {}) });
    }
  const contorno = [P(0, 0), P(2 * L, 0), P(2 * L, 2 * L), P(0, 2 * L)];
  return {
    plantas: [
      { id: "N3", altura: null },
      { id: "N2", altura: 3 },
      { id: "N1", altura: 3 },
      { id: "C", altura: 3.5, tipo: "sotano" },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
      { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
    ],
    pilares,
    losas: ["N1", "N2", "N3"].map((p) => ({ id: `L-${p}`, planta: p, contorno, espesor: 0.25, material: "HA", ...(giro ? { eje1: giro } : {}) })),
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }, { id: "Vx" }],
    cargas: [
      ...["N1", "N2", "N3"].map((p) => ({ tipo: "superficie" as const, id: `q-${p}`, caso: "Q", planta: p, losa: `L-${p}`, q: [0, 0, -3] as const })),
      { tipo: "pilar", id: "w", caso: "Vx", pilar: "P1", ejes: "global", q: [c * 4, s * 4, 0] },
      // Por los dos cambios de eje de P2, variable y en ejes locales
      { tipo: "pilar", id: "w2", caso: "Vx", pilar: "P2", ejes: "local", q: [0, 1, 3], qb: [0, 4, -1], desde: 2, hasta: 8 },
      { tipo: "puntual", id: "F", caso: "Q", planta: "N3", ...((([x, y]) => ({ x, y }))(P(7, 4))), F: [0, 0, -20] },
    ],
  };
}
