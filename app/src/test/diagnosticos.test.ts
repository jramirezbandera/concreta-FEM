/**
 * UI-38 y C-14: el orden y los grupos de la lista de diagnósticos. El aviso que toca a los objetos
 * de un error va delante (es su causa probable), los del mismo código van juntos y la información no
 * cuenta como aviso.
 */
import { describe, expect, it } from "vitest";
import type { Diagnostico } from "../../../src/motor/diagnosticos.ts";
import { agruparDiagnosticos } from "../componentes/comunes.tsx";

const d = (codigo: string, severidad: Diagnostico["severidad"], ids: string[] = [], mensaje = codigo): Diagnostico => ({ codigo, severidad, mensaje, ids });

describe("agruparDiagnosticos", () => {
  it("la causa delante, los iguales juntos y la información al final", () => {
    const g = agruparDiagnosticos([
      d("apoyo/a-viga", "info", ["AL1"]),
      d("topologia/tramo-degenerado", "error", ["V1"], "V1 degenerado"),
      d("malla/calidad", "aviso", ["L1"]),
      d("topologia/tramo-degenerado", "error", ["V2"], "V2 degenerado"),
      d("sensatez/dimension", "aviso", ["V1", "V2"], "¿b = 30 m? ¿No serán cm?"),
    ]);
    expect(g.map((x) => x.d.codigo)).toEqual(["sensatez/dimension", "topologia/tramo-degenerado", "malla/calidad", "apoyo/a-viga"]);
    expect(g[0]!.causa).toBe(true);
    expect(g[1]!.todos.map((x) => x.mensaje)).toEqual(["V1 degenerado", "V2 degenerado"]);
    expect(g[1]!.ids).toEqual(["V1", "V2"]);
    expect(g[2]!.causa).toBe(false);
  });
});
