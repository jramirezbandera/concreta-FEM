/**
 * VS2 en el compilador (`docs/fem3d/viento-sismo.md` §3.2 y §5): las fracciones de masa del sismo
 * (NCSE-02, art. 3.2), lo que no se puede saber como error, y el modelo analítico:
 * - sin `acciones.sismo`, el de siempre; con él, el mismo más `modal`, con las mismas ecuaciones y
 *   los mismos bits en los casos (criterio 6);
 * - Σ m·g es el peso de los casos con sus fracciones a 1e-12 (criterio 1), también con muros (la
 *   masa de sus filas intermedias, repartida por su cota, y la que les toca a los apoyos, al terreno);
 * - una planta con forjado y sin diafragma rígido es un error (VS-h).
 *
 * VS4, el municipio (`ine`): ab y K salen de la tabla del Anejo 1 (`src/normas/peligrosidad.ts`), los
 * escritos mandan, un código que no está es un error y, sin él, nada cambia.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { edificioUnidireccional } from "../../validacion/c4/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { GRAVEDAD, type ResultadoModal } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { resultanteAnalitica } from "./cargas.ts";
import { compilar, huellaSinCompilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { AccionCaso, CasoFisico, ModeloFisico, SismoEdificio } from "./fisico.ts";
import { calcularSismo, hipotesisEspectro, tieneEspectro } from "./sismo.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const conCasos = (casos: CasoFisico[], sismo: SismoEdificio = {}): ModeloFisico => ({ plantas: [], materiales: [], secciones: [], pilares: [], casos, acciones: { sismo } });
const caso = (id: string, accion?: AccionCaso, pesoPropio?: boolean): CasoFisico => ({ id, ...(accion ? { accion } : {}), ...(pesoPropio ? { pesoPropio } : {}) });
const fracciones = (m: ModeloFisico) => Object.fromEntries(calcularSismo(m)!.masas!.casos.map((c) => [c.caso, c.fraccion]));

describe("VS2: las fracciones de masa de la NCSE-02 (art. 3.2)", () => {
  it("por la acción de cada caso: G entero, el uso por su categoría, la nieve si permanece y nada de viento, sismo o temperatura", () => {
    const m = conCasos([
      caso("PP", undefined, true),
      caso("CM", { tipo: "G" }),
      caso("QA", { tipo: "Q", psi: "uso-A" }),
      caso("QB", { tipo: "Q", psi: "uso-B" }),
      caso("QC", { tipo: "Q", psi: "uso-C" }),
      caso("QD", { tipo: "Q", psi: "uso-D" }),
      caso("QE", { tipo: "Q", psi: "uso-E" }),
      caso("QG", { tipo: "Q", psi: "uso-G" }),
      caso("N+", { tipo: "S", psi: "nieve-mas-de-1000" }),
      caso("N-", { tipo: "S", psi: "nieve-hasta-1000" }),
      caso("W", { tipo: "W", psi: "viento", direccion: "X", signo: 1 }),
      caso("T", { tipo: "T", psi: "temperatura" }),
      caso("E", { tipo: "E", direccion: "X" }),
      caso("A", { tipo: "A" }),
    ]);
    expect(fracciones(m)).toEqual({ PP: 1, CM: 1, QA: 0.5, QB: 0.6, QC: 0.6, QD: 0.6, QE: 0.6, QG: 0, "N+": 0.5, "N-": 0, W: 0, T: 0, E: 0, A: 0 });
    expect(calcularSismo(m)!.masas!.nievePorDefecto).toBe(true);
  });

  it("la nieve, por la casilla «nievePermanente» antes que por su ψ; y las fracciones escritas mandan", () => {
    const casos = [caso("G", { tipo: "G" }), caso("N", { tipo: "S", psi: "nieve-hasta-1000" }), caso("Q", { tipo: "Q", psi: "uso-A" })];
    expect(fracciones(conCasos(casos, { nievePermanente: true }))).toEqual({ G: 1, N: 0.5, Q: 0.5 });
    expect(fracciones(conCasos(casos, { nievePermanente: false }))).toEqual({ G: 1, N: 0, Q: 0.5 });
    expect(calcularSismo(conCasos(casos, { nievePermanente: true }))!.masas!.nievePorDefecto).toBe(false);
    // un almacén: la sobrecarga entera
    expect(fracciones(conCasos(casos, { masas: [{ caso: "Q", fraccion: 1 }] }))).toEqual({ G: 1, N: 0, Q: 1 });
  });

  it("lo que no se puede saber es un error que pide la fracción, no un valor por defecto", () => {
    const codigos = (m: ModeloFisico) => calcularSismo(m)!.errores.map((e) => e.codigo);
    // sobrecarga de uso con ψ por sus valores, nieve con ψ por sus valores y un caso sin acción
    expect(codigos(conCasos([caso("Q", { tipo: "Q", psi: { psi0: 0.7, psi1: 0.5, psi2: 0.3 } })]))).toEqual(["sismo/caso-sin-fraccion"]);
    expect(codigos(conCasos([caso("Q", { tipo: "Q" })]))).toEqual(["sismo/caso-sin-fraccion"]);
    expect(codigos(conCasos([caso("N", { tipo: "S", psi: { psi0: 0.5, psi1: 0.2, psi2: 0 } })]))).toEqual(["sismo/caso-sin-fraccion"]);
    expect(codigos(conCasos([caso("X")]))).toEqual(["sismo/caso-sin-fraccion"]);
    // con su fracción escrita, bien
    expect(codigos(conCasos([caso("X")], { masas: [{ caso: "X", fraccion: 0.8 }] }))).toEqual([]);
    expect(codigos(conCasos([caso("G", { tipo: "G" })], { masas: [{ caso: "no", fraccion: 1 }] }))).toEqual(["sismo/caso-no-existe"]);
    expect(codigos(conCasos([caso("G", { tipo: "G" })], { masas: [{ caso: "G", fraccion: 1.2 }] }))).toEqual(["sismo/no-valido"]);
    expect(codigos(conCasos([caso("G", { tipo: "G" })], { masas: [{ caso: "G", fraccion: 1 }, { caso: "G", fraccion: 0.5 }] }))).toEqual(["sismo/no-valido"]);
    expect(codigos(conCasos([caso("G", { tipo: "G" })], { nievePermanente: "sí" as never }))).toEqual(["sismo/no-valido"]);
    // sin `acciones.sismo`, nada
    expect(calcularSismo({ plantas: [], materiales: [], secciones: [], pilares: [], casos: [] })).toBe(null);
  });
});

/**
 * Los casos de los modelos de referencia (G con el peso propio, Q y los horizontales) no llevan
 * acción: las fracciones, escritas (la mitad de Q y nada de los demás).
 */
const sismoDe = (f: ModeloFisico): SismoEdificio => ({ masas: f.casos.filter((c) => !c.pesoPropio).map((c) => ({ caso: c.id, fraccion: c.id === "Q" ? 0.5 : 0 })) });
const conSismo = (f: ModeloFisico): ModeloFisico => ({ ...f, acciones: { ...f.acciones, sismo: sismoDe(f) } });

function modalDe(f: ModeloFisico): { modal: ResultadoModal; c: Extract<ReturnType<typeof compilar>, { valido: true }>; r: Extract<ReturnType<typeof calcular>, { valido: true }> } {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido || !r.modal) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return { modal: r.modal, c, r };
}

describe("VS2: el modelo analítico con las masas del sismo", () => {
  it("sin `acciones.sismo` no hay `modal`; con él, el mismo modelo más `modal`, las mismas ecuaciones y los mismos bits en los casos", () => {
    const f = edificioObjetivoLosas(2, 3, 2);
    const a = compilar(f);
    const b = compilar(conSismo(f));
    if (!a.valido || !b.valido) throw new Error("no compila");
    expect("modal" in a.modelo).toBe(false);
    const { modal, ...sinModal } = b.modelo;
    expect(JSON.stringify(sinModal)).toBe(JSON.stringify(a.modelo));
    // G entero (el del peso propio) y la mitad de Q; los horizontales no cuentan y no van en la lista
    expect(modal).toEqual({ masas: [{ caso: "G", fraccion: 1 }, { caso: "Q", fraccion: 0.5 }] });
    expect(b.hipotesis.some((h) => h.startsWith("Masas y modos de vibración para el sismo"))).toBe(true);
    expect(a.hipotesis.some((h) => h.includes("sismo"))).toBe(false);
    const [ra, rb] = [calcular(a.modelo), calcular(b.modelo)];
    if (!ra.valido || !rb.valido) throw new Error("no calcula");
    expect(rb.estadisticas.ecuaciones).toBe(ra.estadisticas.ecuaciones);
    expect(ra.modal).toBe(undefined);
    ra.casos.forEach((caso, k) => {
      for (const campo of ["u", "reacciones", "esfuerzosBarras", "esfuerzosLaminas"] as const) {
        expect(Buffer.from(rb.casos[k]![campo].buffer).equals(Buffer.from(caso[campo].buffer)), `${caso.id}.${campo}`).toBe(true);
      }
    });
  });

  it("los lados del modal se refinan aparte: si una solución unitaria necesita refinamiento, los casos no cambian ni un bit (VS2-7)", () => {
    // El unidireccional de 7 plantas: sin el modal no hay refinamiento; con él, una solución unitaria pasa de 1e-12
    const f = edificioUnidireccional(7);
    const [a, b] = [compilar(f), compilar(conSismo(f))];
    if (!a.valido || !b.valido) throw new Error("no compila");
    const [ra, rb] = [calcular(a.modelo), calcular(b.modelo)];
    if (!ra.valido || !rb.valido) throw new Error("no calcula");
    expect(ra.estadisticas.pasosRefinamiento).toBe(0);
    // si esto deja de cumplirse, la prueba ya no comprueba nada: hay que buscar otro modelo
    expect(rb.estadisticas.pasosRefinamiento).toBeGreaterThan(0);
    expect(rb.modal!.residuo).toBeLessThan(1e-12);
    ra.casos.forEach((caso, k) => {
      expect(rb.casos[k]!.residuo).toBe(caso.residuo);
      for (const campo of ["u", "reacciones", "esfuerzosBarras", "esfuerzosLaminas"] as const) {
        expect(Buffer.from(rb.casos[k]![campo].buffer).equals(Buffer.from(caso[campo].buffer)), `${caso.id}.${campo}`).toBe(true);
      }
    });
  });

  it("criterio 1: Σ m·g es el peso de los casos con sus fracciones a 1e-12, y la masa de las plantas más la del terreno es la total", () => {
    for (const [nombre, f] of [
      ["losas", edificioObjetivoLosas(2, 3, 2)],
      ["núcleo de muros", reticulaConNucleo()],
    ] as const) {
      const { modal, c } = modalDe(conSismo(f));
      const indice = new Map(c.modelo.casos.map((x, k) => [x.id, k] as const));
      const peso = c.modelo.modal!.masas!.reduce((s, m) => s - m.fraccion * resultanteAnalitica(c.modelo, indice.get(m.caso)!, [0, 0, 0]).F[2], 0);
      expect(Math.abs(modal.masas.total * GRAVEDAD - peso) / peso, nombre).toBeLessThan(1e-12);
      expect(Math.abs(modal.masas.diafragmas + modal.masas.terreno - modal.masas.total) / modal.masas.total, nombre).toBeLessThan(1e-12);
      expect(Math.abs(modal.diafragmas.reduce((s, d) => s + d.masa, 0) - modal.masas.diafragmas) / modal.masas.total).toBeLessThan(1e-13);
      // Con muros, la masa de sus filas intermedias se reparte por su cota y parte va a los apoyos
      if (nombre === "núcleo de muros") {
        expect(modal.masas.repartida).toBeGreaterThan(0);
        expect(modal.masas.terreno).toBeGreaterThan(0);
      }
      // En cada modo, equilibrio; entre todos, toda la masa en X, en Y y en el giro
      for (const m of modal.modos) {
        expect(m.equilibrio.fuerzas).toBeLessThan(1e-9);
        expect(m.equilibrio.momentos).toBeLessThan(1e-9);
      }
      expect(modal.modos.length).toBe(3 * modal.diafragmas.length);
      for (const d of [0, 1, 2]) expect(Math.abs(modal.modos.reduce((s, m) => s + m.masaEfectiva[d]!, 0) - 1), nombre).toBeLessThan(1e-10);
      for (let i = 1; i < modal.modos.length; i++) expect(modal.modos[i]!.periodo).toBeLessThanOrEqual(modal.modos[i - 1]!.periodo);
    }
  });

  it("las consultas dan la masa, el centro de masas y la inercia de giro de cada planta con su id", () => {
    const f = conSismo(edificioObjetivoLosas(2, 3, 2));
    const { modal, c, r } = modalDe(f);
    const q = new Consultas(f, c, r.casos, {}, r.modal);
    const md = q.modos();
    if (!md.valido) throw new Error("sin modos");
    expect(md.valor.plantas.map((p) => p.planta)).toEqual(["N1", "N2"]);
    md.valor.plantas.forEach((p, i) => {
      expect(p.masa).toBe(modal.diafragmas[i]!.masa);
      // la primera planta está en la ±0,00 (la cimentación, a −3)
      expect(p.cota).toBe(3 * i);
      // la planta es de 18 × 10 m: el centro de masas, cerca del centro (el hueco y las cargas lo mueven)
      expect(Math.hypot(p.cm[0] - 9, p.cm[1] - 5)).toBeLessThan(1.5);
      expect(Math.sqrt(p.J / p.masa)).toBeGreaterThan(4);
      expect(Math.sqrt(p.J / p.masa)).toBeLessThan(8);
    });
    // sin el sismo en las acciones, la consulta dice cómo pedirlo
    const sin = compilar(edificioObjetivoLosas(2, 3, 2));
    if (!sin.valido) throw new Error("no compila");
    const rs = calcular(sin.modelo);
    if (!rs.valido) throw new Error("no calcula");
    const qs = new Consultas(edificioObjetivoLosas(2, 3, 2), sin, rs.casos).modos();
    expect(qs.valido).toBe(false);
    expect(qs.diagnosticos[0]!.codigo).toBe("consulta/sin-modal");
  });

  it("con el viento del programa, sus casos no cuentan como masa", () => {
    const f = conSismo({ ...edificioObjetivoLosas(2, 3, 2), acciones: { viento: { zona: "A", aspereza: "IV" } } });
    const c = compilar(f);
    if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
    expect(c.modelo.casos.length).toBe(f.casos.length + 8);
    expect(c.modelo.modal).toEqual({ masas: [{ caso: "G", fraccion: 1 }, { caso: "Q", fraccion: 0.5 }] });
  });

  it("errores: un caso sin su fracción, y una planta con forjado y sin diafragma rígido (VS-h)", () => {
    const f = edificioObjetivoLosas(2, 3, 2);
    const errores = (m: ModeloFisico) => compilar(m).diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo);
    // Q y los horizontales no tienen acción: sin sus fracciones no se puede
    expect(errores({ ...f, acciones: { sismo: {} } })).toEqual(f.casos.filter((c) => !c.pesoPropio).map(() => "sismo/caso-sin-fraccion"));
    const sinDiafragma = conSismo({ ...f, plantas: f.plantas.map((p) => (p.id === "N1" ? { ...p, diafragma: "ninguno" as const } : p)) });
    expect(errores(sinDiafragma)).toEqual(["sismo/planta-sin-diafragma"]);
    // sin el sismo, esa planta sin diafragma compila como siempre
    expect(errores({ ...sinDiafragma, acciones: {} })).toEqual([]);
  });
});

describe("VS4: el municipio del sismo, por su código INE", () => {
  const G = [caso("G", { tipo: "G" })];
  const resto: SismoEdificio = { terreno: "II", mu: 2 };
  const espectro = (sismo: SismoEdificio) => {
    const r = calcularSismo(conCasos(G, sismo))!;
    if (!r.espectro) throw new Error(r.errores.map((e) => `${e.codigo}: ${e.mensaje}`).join("\n"));
    return r.espectro;
  };
  const codigos = (sismo: SismoEdificio) => calcularSismo(conCasos(G, sismo))!.errores.map((e) => e.codigo);

  it("con el municipio, ab y K son los de la tabla del Anejo 1, y el espectro, el mismo que con ellos escritos", () => {
    // Alhaurín el Grande (Málaga): 0,08 g y K = 1,0
    const e = espectro({ ...resto, ine: "29008" });
    expect(e.emplazamiento.ab).toBe(0.08);
    expect(e.emplazamiento.K).toBe(1);
    expect(e.municipio).toEqual({ ine: "29008", nombre: "Alhaurín el Grande", provincia: "Málaga", ab: 0.08, K: 1, procedencia: "Anejo 1 de la NCSE-02" });
    expect(e.origen).toEqual({ ab: "municipio", K: "municipio" });
    const { municipio: _m, origen: _o, ...sinMunicipio } = e;
    expect(sinMunicipio).toEqual(espectro({ ...resto, ab: 0.08, K: 1 }));
    // Con K distinto de 1: Ayamonte (Huelva), 0,14 g y K = 1,3; y uno heredado de su municipio de origen
    expect(espectro({ ...resto, ine: "21010" }).emplazamiento).toMatchObject({ ab: 0.14, K: 1.3 });
    expect(espectro({ ...resto, ine: "29902" }).municipio).toMatchObject({ nombre: "Villanueva de la Concepción", ab: 0.09, K: 1, procedencia: "Heredado de Antequera · el municipio se creó en 2010 y el Anejo 1, de 2002, no lo nombra" });
    // El nombre, si se escribe, tiene que ser el de ese código (sin tildes y con el artículo donde sea)
    expect(espectro({ ...resto, ine: "29008", municipio: "Alhaurin el Grande" }).emplazamiento.ab).toBe(0.08);
    expect(espectro({ ...resto, ine: "04902", municipio: "El Ejido" }).municipio!.nombre).toBe("Ejido (El)");
  });

  it("ab y K escritos mandan sobre los del municipio, cada uno por su lado", () => {
    const soloAb = espectro({ ...resto, ine: "29008", ab: 0.11 });
    expect([soloAb.emplazamiento.ab, soloAb.emplazamiento.K]).toEqual([0.11, 1]);
    expect(soloAb.origen).toEqual({ ab: "escrita", K: "municipio" });
    const soloK = espectro({ ...resto, ine: "29008", K: 1.2 });
    expect([soloK.emplazamiento.ab, soloK.emplazamiento.K]).toEqual([0.08, 1.2]);
    expect(soloK.origen).toEqual({ ab: "municipio", K: "escrita" });
    const losDos = espectro({ ...resto, ine: "29008", ab: 0.11, K: 1.2 });
    expect([losDos.emplazamiento.ab, losDos.emplazamiento.K]).toEqual([0.11, 1.2]);
    expect(losDos.origen).toEqual({ ab: "escrita", K: "escrita" });
    // El municipio sigue en el espectro, con lo que dice la tabla
    expect(losDos.municipio).toMatchObject({ ine: "29008", ab: 0.08, K: 1 });
    const { municipio: _m, origen: _o, ...sinMunicipio } = losDos;
    expect(sinMunicipio).toEqual(espectro({ ...resto, ab: 0.11, K: 1.2 }));
    // Los escritos se comprueban como siempre
    expect(codigos({ ...resto, ine: "29008", ab: 0.8 })).toEqual(["sismo/dato-no-valido"]);
    expect(codigos({ ...resto, ine: "29008", K: 2 })).toEqual(["sismo/dato-no-valido"]);
  });

  it("un código que no está en la tabla es un error: no se da por exento en silencio", () => {
    // Madrid no está en el Anejo 1
    const r = calcularSismo(conCasos(G, { ...resto, ine: "28079" }))!;
    expect(r.errores.map((e) => e.codigo)).toEqual(["sismo/municipio-desconocido"]);
    expect(r.espectro).toBeNull();
    expect(r.masas).toBeNull();
    expect(r.errores[0]!.mensaje).toContain("28079");
    expect(r.errores[0]!.mensaje).toContain("Compruébalo antes de darlo por exento");
    expect(r.errores[0]!.mensaje).not.toMatch(/está exento|queda exento\./);
    // Ni con ab y K escritos: el código está mal, o sobra
    expect(codigos({ ...resto, ine: "28079", ab: 0.05, K: 1 })).toEqual(["sismo/municipio-desconocido"]);
    // Un código que no lo es
    for (const ine of ["2908", "290080", "Granada", "", 29008 as never]) expect(codigos({ ...resto, ine }), String(ine)).toEqual(["sismo/dato-no-valido"]);
    // El nombre y el código no casan: uno de los dos está mal
    expect(codigos({ ...resto, ine: "29008", municipio: "Alhaurín de la Torre" })).toEqual(["sismo/municipio-no-casa"]);
    expect(codigos({ ...resto, ine: "29008", municipio: 7 as never })).toEqual(["sismo/dato-no-valido"]);
    // El nombre solo no da el espectro (hay homónimos): se pide el código
    const solo = calcularSismo(conCasos(G, { ...resto, municipio: "Torrent" }))!;
    expect(solo.errores.map((e) => e.codigo)).toEqual(["sismo/sin-ab"]);
    expect(solo.errores[0]!.mensaje).toContain("fem emplazamiento");
    // En el compilador, el error llega como los demás del sismo
    const c = compilar(conCasos(G, { ...resto, ine: "28079" }));
    expect(c.valido).toBe(false);
    expect(c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo)).toContain("sismo/municipio-desconocido");
  });

  it("sin el municipio, nada cambia: el mismo espectro, sin sus campos, y la misma hipótesis", () => {
    const e = espectro({ ...resto, ab: 0.08, K: 1 });
    expect("municipio" in e).toBe(false);
    expect("origen" in e).toBe(false);
    expect(hipotesisEspectro(e)).toContain("Emplazamiento: ab = 0,08 g, K = 1, importancia normal (ρ = 1), terreno tipo II con C = 1,3;");
    // Un nombre sin código sólo acompaña a los valores escritos
    expect(espectro({ ...resto, ab: 0.08, K: 1, municipio: "Un municipio que no está en el anejo" })).toEqual(e);
    // Sin ab ni municipio, sólo masas y modos, como en VS2; y con ab hace falta K (o el municipio)
    expect(calcularSismo(conCasos(G, {}))!.espectro).toBeNull();
    expect(codigos({})).toEqual([]);
    expect(codigos({ ...resto, ab: 0.08 })).toEqual(["sismo/dato-no-valido"]);
    expect(codigos(resto)).toEqual(["sismo/sin-ab"]);
  });

  it("la hipótesis dice de dónde salen ab y K", () => {
    const h = (sismo: SismoEdificio) => hipotesisEspectro(espectro({ ...resto, ...sismo }));
    expect(h({ ine: "29008" })).toContain("Emplazamiento: ab = 0,08 g, K = 1 (de Alhaurín el Grande (Málaga), código INE 29008: Anejo 1 de la NCSE-02), importancia normal");
    expect(h({ ine: "29008", ab: 0.11 })).toContain("ab = 0,11 g, K = 1 (ab, escrita en el sismo: manda sobre la de la tabla; K, de Alhaurín el Grande (Málaga), código INE 29008, que en la tabla tiene ab = 0,08 g y K = 1; Anejo 1 de la NCSE-02), importancia");
    expect(h({ ine: "29008", K: 1.2 })).toContain("ab = 0,08 g, K = 1,2 (K, escrito en el sismo: manda sobre el de la tabla; ab, de Alhaurín el Grande (Málaga), código INE 29008, que en la tabla tiene ab = 0,08 g y K = 1; Anejo 1 de la NCSE-02), importancia");
    expect(h({ ine: "29008", ab: 0.11, K: 1.2 })).toContain("ab = 0,11 g, K = 1,2 (los dos, escritos en el sismo: mandan sobre los de Alhaurín el Grande (Málaga), código INE 29008, que en la tabla tiene ab = 0,08 g y K = 1; Anejo 1 de la NCSE-02), importancia");
    expect(h({ ine: "29902" })).toContain("(de Villanueva de la Concepción (Málaga), código INE 29902: Heredado de Antequera · el municipio se creó en 2010 y el Anejo 1, de 2002, no lo nombra)");
  });

  it("tieneEspectro: con ab o con el municipio; y el municipio entra en la huella", () => {
    expect(tieneEspectro(conCasos(G, {}))).toBe(false);
    expect(tieneEspectro(conCasos(G, { nievePermanente: true, municipio: "Granada" }))).toBe(false);
    expect(tieneEspectro(conCasos(G, { ab: 0.08 }))).toBe(true);
    expect(tieneEspectro(conCasos(G, { ine: "29008" }))).toBe(true);
    expect(tieneEspectro({ plantas: [], materiales: [], secciones: [], pilares: [], casos: [] })).toBe(false);
    expect(tieneEspectro(null)).toBe(false);
    const f = edificioObjetivoLosas(2, 3, 2);
    const con = (sismo: SismoEdificio): ModeloFisico => ({ ...f, acciones: { sismo: { ...sismoDe(f), ...resto, ...sismo } } });
    const huellas = [con({ ine: "29008" }), con({ ine: "18087" }), con({ ab: 0.08, K: 1 })].map((m) => huellaSinCompilar(m));
    expect(new Set(huellas).size).toBe(3);
  });

  it("de extremo a extremo: el edificio con el municipio da el sismo del mismo edificio con su ab y su K escritos", () => {
    const f = edificioObjetivoLosas(2, 3, 2);
    const con = (sismo: SismoEdificio): ModeloFisico => ({ ...f, acciones: { sismo: { ...sismoDe(f), ...resto, ...sismo } } });
    const sismo = (m: ModeloFisico) => {
      const { c, r } = modalDe(m);
      const s = new Consultas(m, c, r.casos, {}, r.modal).sismo();
      if (!s.valido) throw new Error(s.diagnosticos.map((d) => d.mensaje).join("\n"));
      return { s: s.valor, c };
    };
    // Granada: 0,23 g
    const a = sismo(con({ ine: "18087" }));
    const b = sismo(con({ ab: 0.23, K: 1 }));
    expect(a.s.casos).toEqual(["EX+e", "EX-e", "EY+e", "EY-e"]);
    expect(a.s.direcciones.map((d) => d.basal)).toEqual(b.s.direcciones.map((d) => d.basal));
    expect(a.s.direcciones[0]!.basal).toBeGreaterThan(0);
    // El modelo analítico no depende del municipio: es el de VS2
    expect(JSON.stringify(a.c.modelo)).toBe(JSON.stringify(b.c.modelo));
    expect(a.c.hipotesis.some((h) => h.includes("de Granada (Granada), código INE 18087: Anejo 1 de la NCSE-02"))).toBe(true);
    expect(b.c.hipotesis.some((h) => h.includes("código INE"))).toBe(false);
    // Con Alhaurín el Grande (0,08 g), el cortante en la base baja con la aceleración
    const menor = sismo(con({ ine: "29008" }));
    expect(menor.s.direcciones[0]!.basal).toBeLessThan(a.s.direcciones[0]!.basal);
  });
});
