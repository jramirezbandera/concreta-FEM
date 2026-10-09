/**
 * Puerta de A4 (criterio 4, `docs/fem3d/agente.md` §10): mutaciones que sólo se ven en el dibujo.
 * Cada una se inyecta en un proyecto de los agentes de A2 (el edificio objetivo con losas y la
 * retícula con núcleo, que coinciden con la referencia). Se comprueba que el compilador la acepta y
 * que ni él ni la revisión de A3 dan un aviso que el proyecto sin mutar no da.
 *
 * Con `--imagenes <carpeta>`, escribe las PNG de las vistas `modelo` y `cargas` de cada planta de
 * los diez proyectos (los ocho mutados y los dos sin mutar), con la descripción de A2, cada uno en
 * una subcarpeta con un nombre que no dice cuál es (`encargo-A`…), y la clave en `claves.json`, al
 * lado de este fichero.
 *
 *   bun validacion/a4/mutaciones.ts > validacion/a4/out_mutaciones.txt
 *   bun validacion/a4/mutaciones.ts --imagenes <carpeta>
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escenaASvg, nombreFigura, vistaCargas, vistaModelo } from "../../src/agente/render/index.ts";
import type { Proyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { svgAPng } from "../../cli/png.ts";
import { nuevos } from "../a3/mutaciones.ts";
import { prepararNucleo, revisarProyecto } from "../a3/revisar.ts";

const base = (n: string): Proyecto => JSON.parse(readFileSync(join(import.meta.dirname, "..", "a2", "agente", n, "proyecto.json"), "utf8")) as Proyecto;

export interface MutacionVisual {
  id: number;
  proyecto: "edificio" | "nucleo";
  nombre: string;
  aplicar: (f: ModeloFisico) => ModeloFisico;
}

const copia = (f: ModeloFisico): ModeloFisico => structuredClone(f) as ModeloFisico;
type Mut<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? Mut<U>[] : T[K] extends object ? Mut<T[K]> : T[K] };
const mut = (f: ModeloFisico) => f as unknown as Mut<ModeloFisico>;

export const MUTACIONES_VISUALES: MutacionVisual[] = [
  {
    id: 1,
    proyecto: "edificio",
    nombre: "el pilar interior P-x36-y15 desplazado 1 m en X (x = 37) en toda su altura",
    aplicar: (f0) => {
      const f = copia(f0);
      mut(f).pilares!.find((p) => p.id === "P-x36-y15")!.x = 37;
      return f;
    },
  },
  {
    id: 2,
    proyecto: "edificio",
    nombre: "el hueco de la escalera olvidado en N4",
    aplicar: (f0) => {
      const f = copia(f0);
      delete mut(f).losas!.find((l) => l.id === "L-N4")!.huecos;
      return f;
    },
  },
  {
    // La primera propuesta (la secundaria acaba 0,6 m antes de la principal) ya la avisa A3: queda en
    // voladizo y su luz/canto pasa de 18 (sensatez/esbeltez-viga). Desplazada +2 m, el compilador
    // avisa de la calidad de la malla; −2 m, nada
    id: 3,
    proyecto: "edificio",
    nombre: "la viga secundaria VS-x15-y10-N3 desplazada 2 m en −X (en x = 13, fuera de la mitad del vano)",
    aplicar: (f0) => {
      const f = copia(f0);
      const v = mut(f).vigas!.find((x) => x.id === "VS-x15-y10-N3")!;
      v.puntos = v.puntos.map(([x, y]) => [x - 2, y] as [number, number]);
      return f;
    },
  },
  {
    id: 4,
    proyecto: "edificio",
    nombre: "la zona de 3 kN/m² de Q de N2 desplazada un vano en X (de x = 12,8 a 23,2)",
    aplicar: (f0) => {
      const f = copia(f0);
      const c = mut(f).cargas!.find((x) => x.id === "Q-zona-N2")! as unknown as { zona: [number, number][] };
      c.zona = c.zona.map(([x, y]) => [x + 6, y]);
      return f;
    },
  },
  {
    id: 5,
    proyecto: "edificio",
    nombre: "el pilar de 30 × 50 P-x18-y10, de una columna girada, con giro 0",
    aplicar: (f0) => {
      const f = copia(f0);
      delete mut(f).pilares!.find((p) => p.id === "P-x18-y10")!.giro;
      return f;
    },
  },
  {
    id: 6,
    proyecto: "edificio",
    nombre: "la tabiquería de N5 con un vértice errado: (22,5, 21,5) → (22,5, 15,5)",
    aplicar: (f0) => {
      const f = copia(f0);
      const c = mut(f).cargas!.find((x) => x.id === "G-tab-N5")! as unknown as { puntos: [number, number][] };
      c.puntos[2] = [22.5, 15.5];
      return f;
    },
  },
  {
    id: 7,
    proyecto: "nucleo",
    nombre: "el hueco de la losa fuera del núcleo: desplazado 6 m en X",
    aplicar: (f0) => {
      const f = copia(f0);
      const l = mut(f).losas![0]!;
      l.huecos = l.huecos!.map((h) => h.map(([x, y]) => [x + 6, y] as [number, number]));
      return f;
    },
  },
  {
    id: 8,
    proyecto: "nucleo",
    nombre: "la puerta del núcleo en el tercer lado (y = 10), a 2,4 m de su esquina (12, 10)",
    aplicar: (f0) => {
      const f = copia(f0);
      const m = mut(f).muros![0]!;
      m.huecos = [{ ...m.huecos![0]!, desde: 11 + 2.4, hasta: 11 + 3.4 }];
      return f;
    },
  },
];

const claveDiag = (d: { codigo: string; ids?: string[] }) => `${d.codigo}|${[...(d.ids ?? [])].sort().join(",")}`;

if (import.meta.main) {
  await prepararNucleo();
  const i = process.argv.indexOf("--imagenes");
  const carpeta = i > 0 ? process.argv[i + 1] : undefined;
  const proyectos: { clave: string; proyecto: Proyecto; que: string; base: "edificio" | "nucleo" }[] = [];
  const revisiones = new Map<string, Extract<ReturnType<typeof revisarProyecto>, { valido: true }>>();
  for (const n of ["edificio", "nucleo"] as const) {
    const r = revisarProyecto(base(n));
    if (!r.valido) throw new Error(n);
    revisiones.set(n, r);
    proyectos.push({ clave: "", proyecto: base(n), que: `${n} sin mutar`, base: n });
  }
  console.log("# validacion/a4/mutaciones.ts — mutaciones visuales (A4, criterio 4): el compilador las acepta y ni él ni A3 avisan");
  let limpias = 0;
  for (const m of MUTACIONES_VISUALES) {
    const p0 = base(m.proyecto);
    const p = { ...p0, modelo: m.aplicar(p0.modelo) };
    const c0 = compilar(p0.modelo, p0.opciones);
    const c = compilar(p.modelo, p.opciones);
    const r = revisarProyecto(p);
    if (!c.valido || !r.valido) {
      console.log(`${m.id}. ${m.nombre}: el compilador o el cálculo la RECHAZAN`);
      continue;
    }
    const ya = new Set(c0.diagnosticos.map(claveDiag));
    const compilador = c.diagnosticos.filter((d) => d.severidad !== "info" && !ya.has(claveDiag(d))).map((d) => d.codigo);
    const a3 = [...nuevos(revisiones.get(m.proyecto)!.revision, r.revision).keys()];
    const ok = !compilador.length && !a3.length;
    limpias += ok ? 1 : 0;
    console.log(`${m.id}. ${m.nombre}: ${ok ? "sólo se ve en el dibujo" : `AVISA (compilador: ${compilador.join(", ") || "nada"}; A3: ${a3.join(", ") || "nada"})`}; huella ${r.huella.slice(0, 12)}`);
    proyectos.push({ clave: "", proyecto: p, que: `${m.proyecto}, mutación ${m.id}: ${m.nombre}`, base: m.proyecto });
  }
  console.log(`\n${limpias} de ${MUTACIONES_VISUALES.length} sólo se ven en el dibujo.`);
  if (carpeta) {
    // Orden al azar con semilla fija: los nombres no dicen cuál es cuál
    let s = 2026;
    const azar = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const orden = proyectos.map((x) => [azar(), x] as const).sort((a, b) => a[0] - b[0]);
    const claves: Record<string, string> = {};
    for (const [k, [, x]] of orden.entries()) {
      x.clave = `encargo-${String.fromCharCode(65 + k)}`;
      claves[x.clave] = x.que;
      const dir = join(carpeta, x.clave);
      mkdirSync(dir, { recursive: true });
      copyFileSync(join(import.meta.dirname, "..", "a2", "descripciones", `${x.base}.md`), join(dir, "descripcion.md"));
      const f = x.proyecto.modelo;
      const d = { nombre: x.proyecto.nombre, huella: compilar(f, x.proyecto.opciones).huella };
      for (const pl of f.plantas) {
        writeFileSync(join(dir, `${nombreFigura(pl.id, "modelo")}.png`), await svgAPng(escenaASvg(vistaModelo(f, pl.id, d)).svg));
        for (const caso of f.casos) writeFileSync(join(dir, `${nombreFigura(pl.id, "cargas", caso.id)}.png`), await svgAPng(escenaASvg(vistaCargas(f, pl.id, caso.id, d)).svg));
      }
    }
    writeFileSync(join(import.meta.dirname, "claves.json"), `${JSON.stringify(claves, null, 2)}\n`);
    console.log(`Imágenes en ${carpeta}; claves en validacion/a4/claves.json.`);
  }
}
