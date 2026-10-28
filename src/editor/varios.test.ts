/** Editar varios objetos a la vez (`varios.ts`): lo común, el lote y que sea todo o nada. */
import { describe, expect, it } from "vitest";
import type { Proyecto } from "../agente/proyecto.ts";
import { aplicar } from "./operaciones.ts";
import { leerEjemplo } from "./serializar.test.ts";
import { DEF_TABLAS, contexto, objetosTabla } from "./tablas.ts";
import { columnasComunes, operacionVarios, porTabla } from "./varios.ts";

const pilares = (p: Proyecto) => objetosTabla(p.modelo, "pilares");

describe("varios a la vez", () => {
  const { proyecto } = leerEjemplo("edificio");
  const ids = pilares(proyecto).slice(0, 4).map((o) => o.id);

  it("reparte lo elegido por tablas", () => {
    const viga = objetosTabla(proyecto.modelo, "vigas")[0]!.id;
    const r = porTabla(proyecto.modelo, [...ids, viga, "no-existe"]);
    expect(r.get("pilares")).toEqual(ids);
    expect(r.get("vigas")).toEqual([viga]);
    expect([...r.keys()]).toEqual(["pilares", "vigas"]);
  });

  it("cada columna, con su valor si es el de todos y null si no; sin el id", () => {
    const cs = columnasComunes(proyecto.modelo, "pilares", ids);
    expect(cs.some((c) => c.columna.clave === "id")).toBe(false);
    const ctx = contexto(proyecto.modelo);
    const fs = pilares(proyecto).filter((o) => ids.includes(o.id)).map((o) => DEF_TABLAS.pilares.fila(o, ctx));
    for (const c of cs) {
      const vs = new Set(fs.map((f) => f[c.columna.clave] ?? ""));
      expect(c.valor, c.columna.clave).toBe(vs.size === 1 ? [...vs][0] : null);
    }
  });

  it("escribe en todos de una vez, y lo demás de cada uno no cambia", () => {
    const t = operacionVarios(proyecto.modelo, "pilares", ids, "giro", "90");
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const r = aplicar(proyecto, t.operacion);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const antes = new Map(pilares(proyecto).map((o) => [o.id, o]));
    for (const o of pilares(r.proyecto)) {
      if (ids.includes(o.id)) expect(o).toStrictEqual({ ...antes.get(o.id)!, giro: 90 });
      else expect(o).toStrictEqual(antes.get(o.id));
    }
    expect(columnasComunes(r.proyecto.modelo, "pilares", ids).find((c) => c.columna.clave === "giro")!.valor).toBe("90");
  });

  it("todo o nada: un valor que no vale no entra en ninguno, y el id no se cambia", () => {
    const t = operacionVarios(proyecto.modelo, "pilares", ids, "giro", "noventa");
    expect(t.ok).toBe(false);
    if (!t.ok) expect(new Set(t.errores.map((e) => e.id))).toEqual(new Set(ids));
    // Una referencia rota la rechaza el lote entero al aplicarlo
    const s = operacionVarios(proyecto.modelo, "pilares", ids, "seccion", "NO-HAY");
    expect(s.ok && aplicar(proyecto, s.operacion).ok).toBe(false);
    expect(operacionVarios(proyecto.modelo, "pilares", ids, "id", "P1").ok).toBe(false);
  });
});
