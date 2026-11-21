/**
 * CO1-e (`docs/fem3d/comprobaciones.md` §8.4): las reglas de obra de lo propuesto.
 * - Sólo suben: cada tramo con ellas domina al de sin ellas, y sigue cumpliendo.
 * - Continuidad: un tramo propuesto domina al de encima (el que arranca de su cabeza), con la misma forma.
 * - Agrupar: en cada planta y sección, lo que el mayor cubre con ≥ AGRUPAR_AREA de su área, igual que él.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioSO } from "../../../validacion/so/modelos.ts";
import { leerProyecto } from "../../agente/proyecto.ts";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../compilador/fisico.ts";
import { calcular } from "../../motor/calcular.ts";
import { iniciarNucleo } from "../../nucleo/index.ts";
import { areaDe, barrasDe } from "../armado.ts";
import { AGRUPAR_AREA, comprobarPilares } from "../pilares.ts";
import { diametroDe, domina } from "./pilares.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function consultas(modelo: ModeloFisico, opciones?: OpcionesCompilacion): Consultas {
  const c = compilar(modelo, opciones);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new Consultas(modelo, c, r.casos, opciones ?? {}, r.modal);
}
function vivienda(): Consultas {
  const l = leerProyecto(readFileSync(join(import.meta.dirname, "..", "..", "..", "ejemplos", "vivienda", "proyecto.json"), "utf8"));
  if (!l.valido) throw new Error("la vivienda no se lee");
  return consultas(l.proyecto.modelo, l.proyecto.opciones);
}

describe("CO1-e: continuidad en altura y agrupar", () => {
  for (const [nombre, q] of [["edificio cargado con sismo", () => consultas(edificioSO({ G: 600, Q: 300, sismo: true }))], ["vivienda", vivienda]] as const)
    it(nombre, () => {
      const qq = q();
      const con = comprobarPilares(qq, undefined, undefined, { proponer: true });
      const sin = comprobarPilares(qq, undefined, undefined, { proponer: true, reglasObra: false });
      if (!con.valido || !sin.valido) throw new Error("no comprueba");
      let ajustados = 0;
      con.valor.pilares.forEach((p, i) =>
        p.tramos.forEach((t, k) => {
          const s = sin.valor.pilares[i]!.tramos[k]!;
          if (!t.armado || !s.armado) return;
          // Sólo suben, y lo subido cumple
          expect(domina(t.armado, s.armado), `${p.pilar} en ${t.planta}`).toBe(true);
          if (t.ajuste) {
            ajustados++;
            expect(t.cumple).toBe(true);
            expect(t.armado).not.toEqual(s.armado);
          } else expect(t.armado).toEqual(s.armado);
          // Continuidad con el de encima
          const encima = p.tramos.find((y) => y.plantaBase === t.planta && y.armado);
          if (encima && !!encima.armado!.anillo === !!t.armado.anillo) expect(domina(t.armado, encima.armado!), `${p.pilar} en ${t.planta} bajo ${encima.planta}`).toBe(true);
        }),
      );
      expect(ajustados).toBeGreaterThan(0);
      // Agrupar: ningún grupo deja dos armados que el mayor cubre por debajo del suyo
      const tramos = con.valor.pilares.flatMap((p) => p.tramos).filter((t) => t.origen === "propuesto" && t.armado);
      for (const a of tramos)
        for (const b of tramos) {
          if (a === b || a.planta !== b.planta || a.seccion !== b.seccion) continue;
          const [x, y] = [a.armado!, b.armado!];
          if (areaDe(y) < areaDe(x) && areaDe(y) >= AGRUPAR_AREA * areaDe(x) && barrasDe(y) <= barrasDe(x) && diametroDe(y) <= diametroDe(x)) expect.fail(`${b.seccion} en ${b.planta}: ${JSON.stringify(y)} queda por debajo de ${JSON.stringify(x)}`);
        }
    });
});
