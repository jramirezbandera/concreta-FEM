/**
 * Los ejemplos de la app (`ejemplos/app/`, de `scripts/ejemplos-app.ts`): son para probar el programa
 * entero en la app, así que se leen sin errores, tienen los datos de la obra y el emplazamiento con el
 * viento y el sismo del programa, ningún caso de viento ni de sismo a mano, y los pequeños compilan y
 * calculan con equilibrio, con sus casos del viento, del sismo y de la imperfección.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { leerProyecto } from "./proyecto.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const EJEMPLOS = ["ejemplo", "vivienda", "muestrario", "nucleo", "1022", "edificio"];
const leer = (k: string) => leerProyecto(readFileSync(join(RAIZ, "ejemplos", "app", `${k}.json`), "utf8"));

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("los ejemplos de la app, al día", () => {
  for (const k of EJEMPLOS)
    it(`${k}: se lee sin errores, con la obra, el emplazamiento y el viento y el sismo del programa`, () => {
      const l = leer(k);
      expect(l.diagnosticos.filter((d) => d.severidad === "error")).toEqual([]);
      if (!l.valido) return;
      const { modelo: f, obra } = l.proyecto;
      expect(f.acciones?.emplazamiento?.ine, "emplazamiento").toMatch(/^\d{5}$/);
      expect(f.acciones?.viento?.aspereza, "viento").toBeDefined();
      expect(f.acciones?.sismo?.terreno, "sismo").toBeDefined();
      expect(f.acciones?.sismo?.mu, "ductilidad").toBeDefined();
      // Ningún caso de viento ni de sismo a mano: los hace el programa
      expect(f.casos.filter((c) => c.accion?.tipo === "W" || c.accion?.tipo === "E").map((c) => c.id)).toEqual([]);
      // Todos los casos con su acción, y el peso propio sin cargas del usuario
      expect(f.casos.filter((c) => !c.accion).map((c) => c.id)).toEqual([]);
      const pp = f.casos.find((c) => c.pesoPropio)?.id;
      expect(pp).toBeDefined();
      expect((f.cargas ?? []).filter((c) => c.caso === pp).map((c) => c.id)).toEqual([]);
      expect(obra?.uso).toBeDefined();
      expect(obra?.terreno?.tensionAdmisible).toBeGreaterThan(0);
      expect(obra?.armado?.recubrimiento).toBeGreaterThan(0);
    });

  for (const k of ["ejemplo", "nucleo", "1022"])
    it(`${k}: compila y calcula con los casos del viento, del sismo y de la imperfección`, () => {
      const l = leer(k);
      if (!l.valido) throw new Error(k);
      const c = compilar(l.proyecto.modelo, l.proyecto.opciones);
      expect(c.diagnosticos.filter((d) => d.severidad === "error")).toEqual([]);
      if (!c.valido) return;
      const r = calcular(c.modelo);
      if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join(" "));
      const q = new Consultas(l.proyecto.modelo, c, r.casos, l.proyecto.opciones ?? {}, r.modal);
      const ids = q.fisico.casos.map((x) => x.id);
      for (const x of ["W+X+e", "W-Y-e", "EX+e", "EY-e", "IMP-X(G)"]) expect(ids, x).toContain(x);
      const s = q.sismo();
      expect(s.valido).toBe(true);
      if (s.valido) for (const d of s.valor.direcciones) expect(d.basal).toBeGreaterThan(0);
    }, 120_000);
});
