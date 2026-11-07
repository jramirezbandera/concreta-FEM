/**
 * La nieve de la obra (2026-11-07): las tablas portadas de Concreta (con sus pruebas: casillas de la
 * E.2, el cruce de cada capital con la 3.8, el reconocimiento de la capital), sk desde el
 * emplazamiento con lo que se fuerza, el aviso del ψ de los casos de nieve frente a la altitud, la
 * hipótesis, y el caso que propone el editor. La nieve no cambia el modelo analítico.
 */
import { describe, expect, it } from "vitest";
import { cargaNieveTerreno, coeficienteForma } from "../normas/cteNieve.ts";
import { esCapitalDeProvincia, PROVINCIAS } from "../normas/provincias.ts";
import { propuestaCasoNieve } from "../editor/casos.ts";
import { compilar } from "./compilar.ts";
import type { AccionesEdificio, CasoFisico, ModeloFisico, Vec2 } from "./fisico.ts";
import { avisosNieve, erroresNieve, hipotesisNieve, nieveObra } from "./nieve.ts";

const rect = (X: number, Y: number): Vec2[] => [
  [0, 0],
  [X, 0],
  [X, Y],
  [0, Y],
];

function edificio(acciones?: AccionesEdificio, casos: CasoFisico[] = [{ id: "G", pesoPropio: true, accion: { tipo: "G" } }]): ModeloFisico {
  const esquinas: Vec2[] = [
    [0.15, 0.15],
    [7.85, 0.15],
    [7.85, 5.85],
    [0.15, 5.85],
  ];
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares: esquinas.map(([x, y], i) => ({ id: `P${i + 1}`, x, y, desde: "C", hasta: "N1", seccion: "P30" })),
    losas: [{ id: "L1", planta: "N1", contorno: rect(8, 6), espesor: 0.2, material: "HA" }],
    casos,
    ...(acciones ? { acciones } : {}),
  };
}

const S = (psi: "nieve-hasta-1000" | "nieve-mas-de-1000"): CasoFisico => ({ id: "S", nombre: "Nieve", accion: { tipo: "S", psi } });

describe("las tablas de la nieve (las pruebas de Concreta)", () => {
  it("la E.2: casillas exactas, intermedias y por encima de lo tabulado", () => {
    expect(cargaNieveTerreno(3, 1000)).toBe(0.7);
    expect(cargaNieveTerreno(4, 660)).toBeCloseTo(0.56, 12); // Madrid
    expect(cargaNieveTerreno(5, -20)).toBe(0.2);
    expect(cargaNieveTerreno(2, 2000)).toBeCloseTo(6.3, 12);
    expect(cargaNieveTerreno(1, 1600)).toBe(4.3);
    expect(cargaNieveTerreno(1, 1601)).toBeNull();
    expect(cargaNieveTerreno(7, 2000)).toBeNull();
  });

  it("la E.2 en la altitud de cada capital da su sk de la 3.8 (±0,1): la zona invernal de cada provincia", () => {
    for (const p of PROVINCIAS) {
      const sk = cargaNieveTerreno(p.zonaInvernal, p.capital.altitud);
      expect(sk, p.nombre).not.toBeNull();
      expect(Math.abs(sk! - p.capital.sk), `${p.nombre}: E.2 ${sk}, 3.8 ${p.capital.sk}`).toBeLessThanOrEqual(0.1);
    }
  });

  it("μ: 1 hasta 30°, 0 desde 60°; la capital, por su nombre", () => {
    expect([coeficienteForma(0), coeficienteForma(45), coeficienteForma(60), coeficienteForma(70, true)]).toEqual([1, 0.5, 0, 1]);
    for (const p of PROVINCIAS) for (const n of [p.capital.capital, ...p.capital.capital.split(" / ")]) expect(esCapitalDeProvincia(p.ine, n), n).toBe(true);
    for (const [ine, n] of [["29", "Marbella"], ["28", "Alcalá de Henares"], ["99", "Madrid"], ["28", ""]] as const) expect(esCapitalDeProvincia(ine, n)).toBe(false);
    expect(esCapitalDeProvincia("38", "Santa Cruz de Tenerife")).toBe(true);
    expect(esCapitalDeProvincia("18", "Granada")).toBe(true);
  });
});

describe("la nieve de la obra, del emplazamiento", () => {
  it("fuera de la capital, la E.2 por la zona de la provincia y la altitud; en ella, la 3.8", () => {
    // Alhaurín el Grande (Málaga, zona 6) a 240 m: entre 200 (0,2) y 400 (0,2)
    const a = nieveObra(edificio({ emplazamiento: { ine: "29008", municipio: "Alhaurín el Grande", altitud: 240 } })).nieve!;
    expect(a).toMatchObject({ zona: 6, zonaOrigen: "provincia", skOrigen: "anejoE", sk: 0.2, qnPlana: 0.2, psi: "nieve-hasta-1000", capital: null });
    // Granada capital a 680 m: la 3.8 (0,5 a 690 m)
    const g = nieveObra(edificio({ emplazamiento: { ine: "18087", municipio: "Granada", altitud: 680 } })).nieve!;
    expect(g).toMatchObject({ skOrigen: "tabla3.8", sk: 0.5, capital: { altitud: 690, sk: 0.5 } });
    // Forzada la E.2: zona 6 a 680 m, 0,5 + (680 − 600)/100·0,1 = 0,48
    const e2 = nieveObra(edificio({ emplazamiento: { ine: "18087", municipio: "Granada", altitud: 680 }, nieve: { capital: false } })).nieve!;
    expect(e2.skOrigen).toBe("anejoE");
    expect(e2.sk).toBeCloseTo(0.48, 12);
  });

  it("lo forzado manda: zona, sk escrita y exposición", () => {
    const n = nieveObra(edificio({ emplazamiento: { provincia: "29", altitud: 900 }, nieve: { zonaInvernal: 1, exposicion: "expuesta" } })).nieve!;
    expect(n).toMatchObject({ zona: 1, zonaOrigen: "escrita", sk: 1.4, factor: 1.2 });
    expect(n.qnPlana).toBeCloseTo(1.68, 12);
    const w = nieveObra(edificio({ emplazamiento: { provincia: "29", altitud: 2500 }, nieve: { sk: 3 } })).nieve!;
    expect(w).toMatchObject({ skOrigen: "escrita", sk: 3, psi: "nieve-mas-de-1000" });
  });

  it("sin provincia o sin altitud, por qué no; fuera de tabla, sk null con su nota", () => {
    expect(nieveObra(edificio({ emplazamiento: { altitud: 100 } })).motivo).toMatch(/provincia/);
    expect(nieveObra(edificio({ emplazamiento: { provincia: "29" } })).motivo).toMatch(/altitud/);
    const f = nieveObra(edificio({ emplazamiento: { provincia: "15", altitud: 1700 } })).nieve!; // A Coruña, zona 1
    expect(f.sk).toBeNull();
    expect(f.notas.some((x) => x.includes("3.5.2-3"))).toBe(true);
  });

  it("errores de lo forzado", () => {
    expect(erroresNieve(edificio({ nieve: { zonaInvernal: 8 as never, sk: -1, exposicion: "rara" as never } })).map((e) => e.codigo)).toEqual(["nieve/zona", "nieve/no-valida", "nieve/sk"]);
    expect(compilar(edificio({ nieve: { sk: 0 } })).diagnosticos.map((d) => d.codigo)).toContain("nieve/sk");
  });
});

describe("el caso de nieve frente a la altitud", () => {
  it("aviso si el ψ no es el de la altitud, en compilar; con el bueno, nada", () => {
    const alto = { emplazamiento: { provincia: "05", altitud: 1130 } };
    expect(avisosNieve(edificio(alto, [S("nieve-hasta-1000")])).map((a) => a.codigo)).toEqual(["nieve/psi-altitud"]);
    expect(avisosNieve(edificio(alto, [S("nieve-mas-de-1000")]))).toEqual([]);
    const c = compilar(edificio(alto, [{ id: "G", pesoPropio: true, accion: { tipo: "G" } }, S("nieve-hasta-1000")]));
    expect(c.valido).toBe(true);
    expect(c.diagnosticos.find((d) => d.codigo === "nieve/psi-altitud")?.ids).toEqual(["S"]);
    // Sin caso de nieve no se avisa de nada
    expect(avisosNieve(edificio(alto))).toEqual([]);
  });

  it("la hipótesis dice sk y su origen, y que las cargas son del usuario; el modelo analítico no cambia", () => {
    const casos = [{ id: "G", pesoPropio: true, accion: { tipo: "G" } } as CasoFisico, S("nieve-hasta-1000")];
    const conNieve = compilar(edificio({ emplazamiento: { provincia: "29", altitud: 240 }, nieve: { exposicion: "protegida" } }, casos));
    const sin = compilar(edificio(undefined, casos));
    expect(conNieve.valido && sin.valido).toBe(true);
    if (!conNieve.valido || !sin.valido) return;
    expect(JSON.stringify(conNieve.modelo)).toBe(JSON.stringify(sin.modelo));
    const h = hipotesisNieve(edificio({ emplazamiento: { provincia: "29", altitud: 240 }, nieve: { exposicion: "protegida" } }, casos))!;
    expect(h).toMatch(/sk = 0,20 kN\/m² \(tabla E\.2, zona 6 \(la de Málaga\) a 240 m\), protegida/);
    expect(conNieve.hipotesis).toContain(h);
  });

  it("el editor: crea el caso que pide la altitud, o le cambia el ψ", () => {
    const m = edificio({ emplazamiento: { provincia: "05", altitud: 1130 } });
    const f = propuestaCasoNieve(m, "nieve-mas-de-1000")!;
    expect(f.estado).toBe("falta");
    expect(f.operaciones).toEqual([{ op: "crear", coleccion: "casos", objeto: { id: "S", nombre: "Nieve (más de 1000 m)", accion: { tipo: "S", psi: "nieve-mas-de-1000", duracion: "media" } } }]);
    const o = propuestaCasoNieve({ ...m, casos: [...m.casos, S("nieve-hasta-1000")] }, "nieve-mas-de-1000")!;
    expect(o.estado).toBe("otro-psi");
    expect(o.operaciones).toEqual([{ op: "cambiar", coleccion: "casos", id: "S", objeto: { id: "S", nombre: "Nieve", accion: { tipo: "S", psi: "nieve-mas-de-1000", duracion: "media" } } }]);
    expect(propuestaCasoNieve({ ...m, casos: [...m.casos, S("nieve-mas-de-1000")] }, "nieve-mas-de-1000")!.estado).toBe("ok");
    expect(propuestaCasoNieve(m, null)).toBeNull();
  });
});
