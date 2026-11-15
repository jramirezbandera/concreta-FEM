/**
 * Fase IG (`docs/fem3d/imperfeccion.md`): la imperfección geométrica global del CE Anejo 19 §5.2 en el
 * compilador y en las consultas.
 * - θ = θ₀·α_h·α_m a mano, y sus límites.
 * - Los casos del programa (`IMP-X(<caso>)`, `IMP-Y(<caso>)`): detrás de los del modelo, derivados en
 *   el modelo analítico; su resultado es el de las mismas fuerzas θ·P escritas como cargas (1e-10).
 * - En un edificio con losas, vigas cargadas y peso propio (la vivienda): la resultante de cada caso
 *   es θ por la carga vertical de su origen, planta a planta, y cumple el equilibrio.
 * - Las combinaciones: en ELU-PT (y ELU-ACC), con el factor del origen; en el sentido del viento o, sin
 *   viento, las cuatro; nunca en servicio ni con el sismo; con el segundo orden, amplificadas.
 * - Sin casos con acción, sin pilares ni muros o con `aplicar: false`, nada cambia.
 * - Lo que no vale es un error; lo escrito a mano no se duplica.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioSO, type VarianteSO } from "../../validacion/so/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { CargaFisica, CasoFisico, ImperfeccionEdificio, ModeloFisico } from "./fisico.ts";
import { alfaAltura, alfaElementos, calcularImperfeccion, INCLINACION_BASE, resolverImperfeccion } from "./imperfeccion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function calculado(f: ModeloFisico) {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return { f, c, r, q: new Consultas(f, c, r.casos, {}, r.modal) };
}

const con = (v: VarianteSO, imperfeccion?: ImperfeccionEdificio, mas: Partial<ModeloFisico> = {}): ModeloFisico => {
  const f = edificioSO(v);
  return { ...f, ...mas, ...(imperfeccion ? { acciones: { ...f.acciones, imperfeccion } } : {}) };
};

const codigos = (f: ModeloFisico, severidad = "error") => {
  const c = compilar(f);
  return c.diagnosticos.filter((d) => d.severidad === severidad).map((d) => d.codigo);
};

/** θ del edificio de SO: 9 m de altura (α_h = 2/3) y 9 pilares por planta. */
const THETA = INCLINACION_BASE * (2 / 3) * Math.sqrt(0.5 * (1 + 1 / 9));
const IDS = ["IMP-X(G)", "IMP-Y(G)", "IMP-X(Q)", "IMP-Y(Q)"];

describe("la inclinación", () => {
  it("α_h y α_m del CE A19 §5.2(5), con sus límites", () => {
    expect(alfaAltura(1)).toBe(1);
    expect(alfaAltura(4)).toBe(1);
    expect(alfaAltura(6.25)).toBeCloseTo(0.8, 14);
    expect(alfaAltura(9)).toBeCloseTo(2 / 3, 14);
    expect(alfaAltura(30)).toBeCloseTo(2 / 3, 14);
    expect(alfaElementos(1)).toBe(1);
    expect(alfaElementos(4)).toBeCloseTo(Math.sqrt(0.625), 14);
    expect(alfaElementos(1e9)).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("en el edificio de 3 plantas: l = 9 m y m = 9, θ = 1/402", () => {
    const i = calcularImperfeccion(edificioSO()).imperfeccion!;
    expect(i.altura).toBe(9);
    expect(i.elementos).toBe(9);
    expect(i.alfaH).toBeCloseTo(2 / 3, 14);
    expect(i.inclinacion).toBeCloseTo(THETA, 16);
    expect(Math.round(1 / i.inclinacion)).toBe(402);
    expect(i.origen).toBe("calculada");
    expect(i.casos.map((c) => c.id)).toEqual(IDS);
  });

  it("m es el de la planta que menos pilares y muros tiene, y la altura, la que cubren", () => {
    const f = edificioSO();
    // Dos pilares sólo llegan a F1, y un sótano de 4 m con sólo 5 de los 9
    const g: ModeloFisico = {
      ...f,
      plantas: [...f.plantas.slice(0, 3), { id: "CIM", altura: 3 }, { id: "SOT", altura: 4, tipo: "sotano" }],
      pilares: f.pilares!.map((p, k) => ({ ...p, ...(k < 2 ? { hasta: "F1" } : {}), ...(k % 2 === 0 ? { desde: "SOT" } : {}) })),
    };
    const i = calcularImperfeccion(g).imperfeccion!;
    expect(i.elementos).toBe(5);
    expect(i.planta).toBe("CIM");
    expect(i.altura).toBe(13);
    expect(i.inclinacion).toBeCloseTo(INCLINACION_BASE * (2 / 3) * Math.sqrt(0.5 * (1 + 1 / 5)), 16);
  });

  it("escrita, manda", () => {
    const i = calcularImperfeccion(con({}, { inclinacion: 1 / 300 })).imperfeccion!;
    expect(i.inclinacion).toBe(1 / 300);
    expect(i.origen).toBe("escrita");
  });
});

describe("los casos del programa", () => {
  it("van detrás de los del modelo (y de los del viento), derivados de su caso vertical", () => {
    const { c, q } = calculado(edificioSO());
    expect(q.fisico.casos.map((x) => x.id)).toEqual(["G", "Q", "W+", "W-", ...IDS]);
    expect(c.modelo.casos.slice(4)).toEqual([
      { id: "IMP-X(G)", derivado: { de: "G", gdl: 0, factor: THETA } },
      { id: "IMP-Y(G)", derivado: { de: "G", gdl: 1, factor: THETA } },
      { id: "IMP-X(Q)", derivado: { de: "Q", gdl: 0, factor: THETA } },
      { id: "IMP-Y(Q)", derivado: { de: "Q", gdl: 1, factor: THETA } },
    ]);
    expect(q.fisico.casos[4]!.accion).toEqual({ tipo: "N", direccion: "X", derivadoDe: "G", inclinacion: THETA });
    expect(q.imperfeccion()!.inclinacion).toBe(THETA);
    expect(c.hipotesis.some((h) => h.startsWith("Imperfección geométrica global") && h.includes("1/402") && h.includes("IMP-X(G)"))).toBe(true);
    // y son hipótesis horizontales del segundo orden
    expect(c.hipotesis.some((h) => h.startsWith("Segundo orden global") && h.includes("IMP-Y(Q)"))).toBe(true);
  });

  it("dan lo mismo que las fuerzas θ·P escritas como cargas en un caso aparte", () => {
    const f = edificioSO();
    // G: 100 kN en cada pilar de cada planta; el mismo reparto, por θ, en horizontal
    const aMano: CargaFisica[] = (f.cargas ?? []).filter((x) => x.caso === "G" && x.tipo === "puntual").flatMap((x) => {
      if (x.tipo !== "puntual") return [];
      const P = -x.F![2];
      return [
        { ...x, id: `HX-${x.id}`, caso: "HX", F: [THETA * P, 0, 0] as [number, number, number] },
        { ...x, id: `HY-${x.id}`, caso: "HY", F: [0, THETA * P, 0] as [number, number, number] },
      ];
    });
    const casos: CasoFisico[] = [...f.casos, { id: "HX" }, { id: "HY" }];
    const { c, r } = calculado({ ...f, casos, cargas: [...(f.cargas ?? []), ...aMano] });
    const k = (id: string) => c.modelo.casos.findIndex((x) => x.id === id);
    // (sin acción, HX y HY no dan casos de imperfección; los de G y Q siguen detrás)
    expect(c.modelo.casos.map((x) => x.id)).toEqual(["G", "Q", "W+", "W-", "HX", "HY", ...IDS]);
    for (const [imp, mano] of [
      ["IMP-X(G)", "HX"],
      ["IMP-Y(G)", "HY"],
    ] as const) {
      const [a, b] = [r.casos[k(imp)]!, r.casos[k(mano)]!];
      for (const campo of ["u", "reacciones", "esfuerzosBarras"] as const) {
        const escala = b[campo].reduce((s, v) => Math.max(s, Math.abs(v)), 0);
        expect(escala).toBeGreaterThan(0);
        expect(a[campo].reduce((s, v, i) => Math.max(s, Math.abs(v - b[campo][i]!)), 0), `${imp} ${campo}`).toBeLessThanOrEqual(1e-10 * escala);
      }
      // 27 puntuales de 100 kN
      expect(a.cargas.F[imp === "IMP-X(G)" ? 0 : 1]).toBeCloseTo(THETA * 2700, 9);
      // a 3, 6 y 9 m
      expect(a.cargas.zF[imp === "IMP-X(G)" ? 0 : 1]).toBeCloseTo(THETA * 900 * (3 + 6 + 9), 8);
    }
  });

  it("en la vivienda (losas, vigas cargadas, peso propio): θ por la carga vertical de cada caso, con su equilibrio", () => {
    const p = JSON.parse(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8")) as { modelo: ModeloFisico };
    const { c, r, q } = calculado(p.modelo);
    const i = q.imperfeccion()!;
    // 4,30 m de altura (α_h = 2/√4,3) y la planta que menos pilares tiene
    expect(i.altura).toBeCloseTo(4.3, 12);
    expect(i.alfaH).toBeCloseTo(2 / Math.sqrt(4.3), 12);
    expect(i.inclinacion).toBeCloseTo(INCLINACION_BASE * i.alfaH * alfaElementos(i.elementos), 16);
    const verticales = ["G", "CM", "Q", "N"];
    expect(i.casos.map((x) => x.id)).toEqual(verticales.flatMap((v) => [`IMP-X(${v})`, `IMP-Y(${v})`]));
    const k = (id: string) => c.modelo.casos.findIndex((x) => x.id === id);
    const nn = c.modelo.nudos.length;
    for (const v of verticales) {
      const o = r.casos[k(v)]!;
      const P = -o.cargas.F[2];
      expect(P).toBeGreaterThan(0);
      (["X", "Y"] as const).forEach((d, gdl) => {
        const caso = r.casos[k(`IMP-${d}(${v})`)]!;
        expect(Math.abs(caso.cargas.F[gdl]! - i.inclinacion * P), `${caso.id}: ΣH = θ·ΣP`).toBeLessThanOrEqual(1e-9 * i.inclinacion * P);
        expect(caso.cargas.F[1 - gdl]).toBe(0);
        expect(caso.cargas.F[2]).toBe(0);
        expect(caso.equilibrio.fuerzas).toBeLessThanOrEqual(1e-9);
        expect(caso.equilibrio.momentos).toBeLessThanOrEqual(1e-9);
        let R = 0;
        for (let n = 0; n < nn; n++) R += caso.reacciones[6 * n + gdl]!;
        expect(Math.abs(R + i.inclinacion * P)).toBeLessThanOrEqual(1e-8 * i.inclinacion * P);
        // Empuja en su sentido: la cubierta se va hacia +d
        let u = 0;
        for (let n = 0; n < nn; n++) if (c.modelo.nudos[n]!.z > 4) u = Math.max(u, caso.u[6 * n + gdl]!);
        expect(u).toBeGreaterThan(0);
      });
    }
    // Los casos del usuario, con los mismos bits que sin la imperfección
    const sin = calculado({ ...p.modelo, acciones: { imperfeccion: { aplicar: false } } });
    expect(sin.c.modelo.casos.map((x) => x.id)).toEqual(verticales);
    verticales.forEach((_, j) => {
      expect(r.casos[j]!.u).toEqual(sin.r.casos[j]!.u);
      expect(r.casos[j]!.reacciones).toEqual(sin.r.casos[j]!.reacciones);
    });
    expect(sin.q.imperfeccion()).toBeNull();
    expect(sin.c.hipotesis.some((h) => h.startsWith("Imperfección"))).toBe(false);
  });
});

describe("las combinaciones", () => {
  it("en ELU-PT, con el factor de su origen: en el sentido del viento o, sin él, las cuatro; en servicio, nunca", () => {
    const { q } = calculado(con({}, undefined, { acciones: { segundoOrden: { amplificar: false } } }));
    const ids = q.fisico.casos.map((x) => x.id);
    const cs = q.combinaciones();
    if (!cs.valido) throw new Error("sin combinaciones");
    const f = (c: (typeof cs.valor)[number], id: string) => c.factores[ids.indexOf(id)]!;
    let [conViento, sinViento] = [0, 0];
    for (const c of cs.valor) {
      const n = IDS.map((id) => f(c, id));
      if (c.situacion !== "ELU-PT") {
        expect(n, c.id).toEqual([0, 0, 0, 0]);
        continue;
      }
      const s = f(c, "W+") > 0 ? 1 : f(c, "W-") > 0 ? -1 : 0;
      if (s !== 0) {
        conViento++;
        expect(n, c.etiqueta).toEqual([s * f(c, "G"), 0, s * f(c, "Q") || 0, 0]);
      } else {
        sinViento++;
        const enX = n[0] !== 0;
        const sg = Math.sign(enX ? n[0]! : n[1]!);
        expect(sg).not.toBe(0);
        expect(n, c.etiqueta).toEqual(enX ? [sg * f(c, "G"), 0, sg * f(c, "Q") || 0, 0] : [0, sg * f(c, "G"), 0, sg * f(c, "Q") || 0]);
      }
    }
    expect(conViento).toBeGreaterThan(0);
    // Sin viento: G desfavorable y favorable, con Q y sin ella, por ±X y ±Y
    expect(sinViento).toBe(16);
  });

  it("con el sismo del programa, no entran en la situación sísmica", () => {
    const { q } = calculado(edificioSO({ sismo: true }));
    const ids = q.fisico.casos.map((x) => x.id);
    const cs = q.combinaciones({ situaciones: ["ELU-SIS", "ELU-PT"] });
    if (!cs.valido) throw new Error("sin combinaciones");
    const conN = (c: (typeof cs.valor)[number]) => IDS.some((id) => c.factores[ids.indexOf(id)] !== 0);
    expect(cs.valor.filter((c) => c.situacion === "ELU-SIS").some(conN)).toBe(false);
    expect(cs.valor.filter((c) => c.situacion === "ELU-PT").every(conN)).toBe(true);
  });

  it("el segundo orden las amplifica con su γz, también sin viento", () => {
    const { q } = calculado(edificioSO({ sinViento: true, G: 400, Q: 200 }));
    const ids = q.fisico.casos.map((x) => x.id);
    const so = q.segundoOrdenCalculado();
    expect(so.horizontales.map((h) => h.caso)).toEqual(IDS);
    expect(so.gravitatorios.map((k) => ids[k])).toEqual(["G", "Q"]);
    const [g, a] = [q.combinacionesGeneradas({ situaciones: ["ELU-PT"] }), q.combinaciones({ situaciones: ["ELU-PT"] })];
    if (!g.valido || !a.valido) throw new Error("sin combinaciones");
    g.valor.forEach((c, k) => {
      const amp = a.valor[k]!;
      for (const x of amp.amplificacion ?? []) {
        const i = ids.indexOf(x.caso);
        const h = so.horizontales.find((y) => y.caso === x.caso)!;
        // Q = Σ γ·C, a mano, y su γz
        const Q = c.factores[0]! * h.C[0]! + c.factores[1]! * h.C[1]!;
        expect(x.Q).toBeCloseTo(Q, 14);
        expect(x.coeficiente).toBeCloseTo(1 / (1 - Q), 12);
        expect(x.coeficiente).toBeGreaterThan(1);
        expect(amp.factores[i]).toBe(c.factores[i]! * x.coeficiente);
      }
      expect((amp.amplificacion ?? []).map((x) => x.caso)).toEqual(IDS.filter((id) => c.factores[ids.indexOf(id)] !== 0));
      // lo demás, intacto
      expect(amp.factores[0]).toBe(c.factores[0]);
      expect(amp.factores[1]).toBe(c.factores[1]);
    });
    // La imperfección de G y la de Q, proporcionales a cargas con el mismo reparto: el mismo índice
    const [hg, hq] = [so.horizontales[0]!, so.horizontales[2]!];
    expect(hg.C[0]).toBeCloseTo(hq.C[0]!, 12);
    expect(hg.direccion[0]).toBeCloseTo(1, 12);
  });
});

describe("cuándo no hay", () => {
  it("con aplicar: false, el modelo analítico es el de antes", () => {
    const sin = compilar(con({}, { aplicar: false }));
    if (!sin.valido) throw new Error("no compila");
    expect(sin.modelo.casos.map((x) => x.id)).toEqual(["G", "Q", "W+", "W-"]);
    expect(sin.modelo.casos.some((x) => x.derivado)).toBe(false);
    const conElla = compilar(edificioSO());
    if (!conElla.valido) throw new Error("no compila");
    // los mismos nudos, barras y casos del usuario
    expect(conElla.modelo.nudos).toEqual(sin.modelo.nudos);
    expect(conElla.modelo.barras).toEqual(sin.modelo.barras);
    expect(conElla.modelo.casos.slice(0, 4)).toEqual(sin.modelo.casos);
    // y la huella cambia (es otro cálculo)
    expect(conElla.huella).not.toBe(sin.huella);
  });

  it("sin casos con su acción, o sin pilares ni muros, no se añade nada", () => {
    const f = edificioSO();
    const sinAccion: ModeloFisico = { ...f, casos: f.casos.map((c) => ({ id: c.id })) };
    expect(resolverImperfeccion(sinAccion).modelo).toBe(sinAccion);
    const c = compilar(sinAccion);
    if (!c.valido) throw new Error("no compila");
    expect(c.modelo.casos.map((x) => x.id)).toEqual(["G", "Q", "W+", "W-"]);
    const sinPilares: ModeloFisico = { ...f, pilares: [] };
    expect(calcularImperfeccion(sinPilares).imperfeccion).toBeNull();
    expect(resolverImperfeccion(sinPilares).modelo).toBe(sinPilares);
  });

  it("resolver dos veces no añade nada más", () => {
    const una = resolverImperfeccion(edificioSO());
    const dos = resolverImperfeccion(una.modelo);
    expect(dos.modelo).toBe(una.modelo);
    expect(dos.calculo.imperfeccion!.casos).toEqual(una.calculo.imperfeccion!.casos);
    expect(dos.calculo.nuevos).toEqual([]);
  });
});

describe("lo escrito a mano y lo que no vale", () => {
  it("una nocional con su inclinación escrita no se duplica, y lleva la suya", () => {
    const f = edificioSO();
    const casos: CasoFisico[] = [...f.casos, { id: "MiX", accion: { tipo: "N", direccion: "X", derivadoDe: "G", inclinacion: 0.004 } }];
    const { c, q } = calculado({ ...f, casos });
    expect(c.modelo.casos.map((x) => x.id)).toEqual(["G", "Q", "W+", "W-", "MiX", "IMP-Y(G)", "IMP-X(Q)", "IMP-Y(Q)"]);
    expect(c.modelo.casos[4]).toEqual({ id: "MiX", derivado: { de: "G", gdl: 0, factor: 0.004 } });
    expect(q.imperfeccion()!.casos.find((x) => x.id === "MiX")).toEqual({ id: "MiX", de: "G", direccion: "X", inclinacion: 0.004, delPrograma: false });
  });

  it("una nocional con sus cargas escritas, además de la del programa, se avisa", () => {
    const f = edificioSO();
    const g: ModeloFisico = {
      ...f,
      casos: [...f.casos, { id: "NX", accion: { tipo: "N", direccion: "X", signo: 1, derivadoDe: "G" } }],
      cargas: [...(f.cargas ?? []), { tipo: "puntual", id: "nx", caso: "NX", planta: "F3", x: 6, y: 6, F: [5, 0, 0] }],
    };
    expect(codigos(g, "aviso")).toContain("imperfeccion/nocional-a-mano");
    expect(codigos({ ...g, acciones: { imperfeccion: { aplicar: false } } }, "aviso")).not.toContain("imperfeccion/nocional-a-mano");
  });

  it.each([
    ["una inclinación negativa", { inclinacion: -0.001 }, "imperfeccion/no-valida"],
    ["una inclinación enorme", { inclinacion: 0.2 }, "imperfeccion/no-valida"],
    ["aplicar que no es un booleano", { aplicar: "no" as unknown as boolean }, "imperfeccion/no-valida"],
  ] as [string, ImperfeccionEdificio, string][])("%s", (_, imperfeccion, codigo) => {
    expect(codigos(con({}, imperfeccion))).toContain(codigo);
  });

  it("un caso con el id de uno del programa, una carga en un caso de la imperfección o una inclinación fuera de una nocional", () => {
    const f = edificioSO();
    expect(codigos({ ...f, casos: [...f.casos, { id: "IMP-X(G)" }] })).toContain("imperfeccion/id-existente");
    const conCarga: ModeloFisico = {
      ...f,
      casos: [...f.casos, { id: "MiX", accion: { tipo: "N", direccion: "X", derivadoDe: "G", inclinacion: 0.004 } }],
      cargas: [...(f.cargas ?? []), { tipo: "puntual", id: "mal", caso: "MiX", planta: "F3", x: 6, y: 6, F: [5, 0, 0] }],
    };
    expect(codigos(conCarga)).toContain("fisico/valor-no-valido");
    expect(codigos({ ...f, casos: f.casos.map((c) => (c.id === "G" ? { ...c, accion: { ...c.accion!, inclinacion: 0.004 } } : c)) })).toContain("fisico/valor-no-valido");
  });
});
