/**
 * Modelos físicos de validación de C5 (no son código del compilador):
 * - `losaPilaresMezclados`: losa plana de 3 × 2 vanos de 6 × 5 m con los pilares de 30 × 50 (girados
 *   0° o 90°) y de 40 × 40 del edificio objetivo, y su hueco de escalera en el último vano;
 * - `reticularH25`: la losa plana de H25 como reticular 30+5 con ábacos de 2,5 × 2,5 m;
 * - `conPropuesta`: un modelo con las bandas que propone el compilador;
 * - `conAcciones`: los casos del edificio objetivo (G, Q, Vx, Vy) con su acción, para generar las
 *   combinaciones.
 */
import { proponerBandas } from "../../src/compilador/bandas.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { losaPlanaFisica } from "../c2/losaPlana.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

export function losaPilaresMezclados(): ModeloFisico {
  const f = edificioObjetivoLosas(1, 3, 2);
  return { ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") };
}

export function reticularH25(): ModeloFisico {
  const base = losaPlanaFisica();
  return {
    ...base,
    bandas: undefined,
    losas: base.losas!.map((l) => ({
      ...l,
      espesor: 0.35,
      reticular: {
        intereje: 0.82,
        nervio: 0.12,
        capa: 0.05,
        caseton: "recuperable",
        abacos: base.pilares!.map((p) => [
          [p.x - 1.25, p.y - 1.25],
          [p.x + 1.25, p.y - 1.25],
          [p.x + 1.25, p.y + 1.25],
          [p.x - 1.25, p.y + 1.25],
        ]),
      },
    })),
  };
}

/** El modelo con las bandas que propone el compilador (en vez de las que tuviera). */
export function conPropuesta(f: ModeloFisico): ModeloFisico {
  const { bandas, diagnosticos } = proponerBandas({ ...f, bandas: undefined });
  if (diagnosticos.some((d) => d.severidad === "error")) throw new Error(diagnosticos.map((d) => d.mensaje).join("; "));
  return { ...f, bandas };
}

const PSI_Q = { psi0: 0.7, psi1: 0.5, psi2: 0.3 };
const PSI_W = { psi0: 0.6, psi1: 0.5, psi2: 0 };

/** Los casos G, Q, Vx y Vy del edificio objetivo con su acción (CTE). */
export function conAcciones(f: ModeloFisico): ModeloFisico {
  const accion: Record<string, NonNullable<ModeloFisico["casos"][number]["accion"]>> = {
    G: { tipo: "G" },
    Q: { tipo: "Q", psi: PSI_Q },
    Vx: { tipo: "W", direccion: "X", signo: 1, psi: PSI_W },
    Vy: { tipo: "W", direccion: "Y", signo: 1, psi: PSI_W },
  };
  return { ...f, casos: f.casos.map((c) => ({ ...c, accion: accion[c.id]! })) };
}
