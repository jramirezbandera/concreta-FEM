/**
 * C3 en modelos pequeños escritos a mano: rejilla y ejes de las láminas (C3-a), encuentros con otros
 * muros, losas y pilares (C3-c), huecos, bases (C3-f), diafragma (C3-d), barras auxiliares (C3-e),
 * peso propio con el solape de las losas (C3-g) y empujes (C3-h) frente a un cálculo a mano; y en
 * baterías al azar, el validador de la malla de los muros (criterio 3) y «sin pérdidas» (criterio 5).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../pruebas/losasAleatorias.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { conMurosAleatorios } from "../pruebas/murosAleatorios.ts";
import { compilar } from "./compilar.ts";
import type { CargaFisica, Losa, ModeloFisico, Muro, Pilar, Vec2, Viga } from "./fisico.ts";
import { ASPECTO_ALTO } from "./muros.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

/** Plantas P2 (6 m), P1 (3 m) y cimentación C (−3 m); hormigón HA-25 sin peso salvo que se diga. */
function modelo(o: { muros: Muro[]; losas?: Losa[]; vigas?: Viga[]; pilares?: Pilar[]; cargas?: CargaFisica[]; peso?: number }): ModeloFisico {
  return {
    plantas: [
      { id: "P2", altura: null },
      { id: "P1", altura: 3 },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25, peso: o.peso ?? 0 }],
    secciones: [
      { id: "p", material: "HA", forma: "rectangular", b: 0.3, h: 0.4 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.6 },
    ],
    pilares: o.pilares ?? [],
    vigas: o.vigas ?? [],
    muros: o.muros,
    losas: o.losas ?? [],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: o.cargas ?? [],
  };
}

const muro = (id: string, puntos: Vec2[], desde = "C", hasta = "P2", extra: Partial<Muro> = {}): Muro => ({ id, puntos, desde, hasta, espesor: 0.25, material: "HA", ...extra });

/** Nudos de cada lámina de un muro. */
const laminasDe = (r: ReturnType<typeof valido>, id: string) => r.mapeo.muros![id]!.map((i) => r.modelo.laminas![i]!);

const resolver = (m: ModeloAnalitico) => casosValidos(calcular(m, { solver: "perfil" }));

describe("rejilla de un muro (C3-a)", () => {
  it("un muro de 6 m y dos plantas: rejilla de columnas de ~h y filas de ≤ min(h, H/12), láminas con el eje 1 a lo largo y la normal a la derecha", () => {
    const r = valido(compilar(modelo({ muros: [muro("M", [[0, 0], [6, 0]])] }), { tamanoMalla: 0.5 }));
    const ls = laminasDe(r, "M");
    // 6 m a paso 1 (2h) con su punto medio: 12 columnas de 0,5; 3 m a ≤ min(0,5, 3/12): 12 filas por planta
    expect(ls).toHaveLength(12 * 12 * 2);
    for (const l of ls) {
      const X = l.nudos.map((n) => r.modelo.nudos[n]!);
      expect(X[1]!.x - X[0]!.x).toBeCloseTo(0.5, 12);
      expect(X[3]!.z - X[0]!.z).toBeCloseTo(0.25, 12);
      expect(l.eje1).toEqual([1, 0, 0]);
      // Normal (X3 − X1) × (X4 − X2): a la derecha del eje, −Y
      const a = [X[2]!.x - X[0]!.x, X[2]!.y - X[0]!.y, X[2]!.z - X[0]!.z];
      const b = [X[3]!.x - X[1]!.x, X[3]!.y - X[1]!.y, X[3]!.z - X[1]!.z];
      expect(a[2]! * b[0]! - a[0]! * b[2]!).toBeLessThan(0);
    }
    // Base empotrada: los 13 nudos de su base
    expect(r.modelo.apoyos!.filter((a) => r.modelo.nudos[a.nudo]!.z === -3)).toHaveLength(13);
  });

  it("al menos 8 elementos por tramo recto (H17), aunque el muro sea corto", () => {
    const r = valido(compilar(modelo({ muros: [muro("M", [[0, 0], [1.2, 0]])] }), { tamanoMalla: 0.75 }));
    const fila = laminasDe(r, "M").filter((l) => r.modelo.nudos[l.nudos[0]]!.z === -3);
    expect(fila).toHaveLength(8);
  });

  it("los tramos colineales cuentan como un solo tramo recto: el de 1,2 m junto a otro de 4,8 no se divide más", () => {
    const r = valido(compilar(modelo({ muros: [muro("A", [[0, 0], [1.2, 0]]), muro("B", [[1.2, 0], [6, 0]])] }), { tamanoMalla: 0.75 }));
    const anchos = laminasDe(r, "A").map((l) => r.modelo.nudos[l.nudos[1]]!.x - r.modelo.nudos[l.nudos[0]]!.x);
    expect(Math.min(...anchos)).toBeGreaterThan(0.29);
  });
});

describe("encuentros (C3-c)", () => {
  it("muros en L y en T comparten los nudos de su arista vertical en todas las filas", () => {
    const r = valido(compilar(modelo({ muros: [muro("A", [[0, 0], [5, 0], [5, 4]]), muro("T", [[2.5, 0], [2.5, 3]])] }), { tamanoMalla: 0.5 }));
    const m = r.modelo;
    const nudosEn = (x: number, y: number) => m.nudos.flatMap((v, i) => (Math.abs(v.x - x) < 1e-9 && Math.abs(v.y - y) < 1e-9 ? [i] : []));
    for (const [x, y] of [
      [5, 0],
      [2.5, 0],
    ] as const) {
      const vertical = nudosEn(x, y);
      // Cada nudo de la arista está en láminas de los dos muros (o tramos) que se encuentran
      expect(vertical.length).toBe(25); // 2 plantas de 12 filas
      for (const n of vertical) {
        const de = new Set(m.laminas!.flatMap((l, i) => (l.nudos.includes(n) ? [r.mapeo.laminas![i]!.muro] : [])));
        if (x === 2.5) expect([...de].sort()).toEqual(["A", "T"]);
        else expect(de.has("A")).toBe(true);
      }
    }
  });

  it("dos muros apilados comparten los nudos de la cota común y las mismas estaciones", () => {
    const r = valido(compilar(modelo({ muros: [muro("ABAJO", [[0, 0], [6, 0]], "C", "P1"), muro("ARRIBA", [[2, 0], [6, 0]], "P1", "P2", { base: "ninguno" })] }), { tamanoMalla: 0.5 }));
    const m = r.modelo;
    const enP1 = (id: string) => new Set(laminasDe(r, id).flatMap((l) => [...l.nudos]).filter((n) => m.nudos[n]!.z === 0));
    const [a, b] = [enP1("ABAJO"), enP1("ARRIBA")];
    expect([...b].every((n) => a.has(n))).toBe(true);
    expect(b.size).toBe(9); // 4 m: 8 elementos de 0,5
  });

  it("muro bajo una losa: cada arista del muro en la cota es arista de la losa (conformidad), y entra en el diafragma", () => {
    const f = modelo({ muros: [muro("M", [[0, 2], [6, 2]], "C", "P1")], losas: [{ id: "L", planta: "P1", contorno: rect(0, 0, 6, 5), espesor: 0.25, material: "HA" }] });
    f.plantas = f.plantas.map((p) => (p.id === "C" ? { ...p, diafragma: "ninguno" } : p));
    const r = valido(compilar(f, { tamanoMalla: 0.5 }));
    const m = r.modelo;
    const aristasLosa = new Set<string>();
    m.laminas!.forEach((l, i) => {
      if (!r.mapeo.laminas![i]!.losa) return;
      for (let j = 0; j < 4; j++) {
        const [a, b] = [l.nudos[j]!, l.nudos[(j + 1) % 4]!];
        aristasLosa.add(a < b ? `${a},${b}` : `${b},${a}`);
      }
    });
    let aristas = 0;
    for (const l of laminasDe(r, "M")) {
      const [a, b] = [l.nudos[3]!, l.nudos[2]!];
      if (m.nudos[a]!.z !== 0) continue;
      aristas++;
      expect(aristasLosa.has(a < b ? `${a},${b}` : `${b},${a}`)).toBe(true);
    }
    expect(aristas).toBe(12);
    const diaf = m.restricciones!.find((x) => x.tipo === "diafragma")!;
    for (const l of laminasDe(r, "M")) for (const n of l.nudos) if (m.nudos[n]!.z === 0) expect(diaf.esclavos.includes(n)).toBe(true);
  });

  it("pilar en el eje de un muro: sus nudos en la cota de la planta dentro de la huella van con el enlace rígido", () => {
    const f = modelo({ muros: [muro("M", [[0, 0], [6, 0]], "C", "P1")], pilares: [{ id: "A", x: 3, y: 0, desde: "C", hasta: "P2", seccion: "p" }] });
    const r = valido(compilar(f, { tamanoMalla: 0.5 }));
    const m = r.modelo;
    const enlaces = m.restricciones!.filter((x) => x.tipo === "enlace-rigido");
    const enP1 = enlaces.find((e) => m.nudos[e.maestro]!.z === 0)!;
    expect(enP1.maestro).toBe(r.mapeo.nudosPilar["A@P1"]);
    // La huella de 0,3 × 0,4 (h según X): de x = 2,8 a 3,2, más ε_snap
    for (const s of enP1.esclavos) expect(Math.abs(m.nudos[s]!.x - 3)).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(enP1.esclavos.length).toBeGreaterThanOrEqual(2);
    // En la base, los nudos del muro tienen su apoyo y no van con el pilar
    expect(enlaces.some((e) => m.nudos[e.maestro]!.z === -3)).toBe(false);
  });
});

describe("huecos y bases (C3-f)", () => {
  it("una puerta desde el forjado y una ventana: sus elementos no están y el área es la del alzado sin huecos", () => {
    const huecos = [
      { desde: 1, hasta: 2, z0: 0, z1: 2.1 },
      { desde: 3.5, hasta: 5, z0: 4, z1: 5 },
    ];
    const r = valido(compilar(modelo({ muros: [muro("M", [[0, 0], [6, 0]], "C", "P2", { huecos })] }), { tamanoMalla: 0.5 }));
    let area = 0;
    for (const l of laminasDe(r, "M")) {
      const X = l.nudos.map((n) => r.modelo.nudos[n]!);
      area += (X[1]!.x - X[0]!.x) * (X[3]!.z - X[0]!.z);
      const [xm, zm] = [(X[0]!.x + X[1]!.x) / 2, (X[0]!.z + X[3]!.z) / 2 + 3];
      for (const h of huecos) expect(xm > h.desde && xm < h.hasta && zm > h.z0 && zm < h.z1).toBe(false);
    }
    expect(area).toBeCloseTo(6 * 6 - 2.1 - 1.5, 10);
    // La puerta llega a la base: sus nudos de la base no existen o no tienen apoyo sin lámina
    const usados = new Set(r.modelo.laminas!.flatMap((l) => [...l.nudos]));
    for (const a of r.modelo.apoyos!) expect(usados.has(a.nudo)).toBe(true);
  });

  it("un hueco de doble altura que cruza la planta: no deja nudos sueltos en la cota", () => {
    const f = modelo({ muros: [muro("M", [[0, 0], [6, 0]], "C", "P2", { huecos: [{ desde: 2, hasta: 4, z0: 1, z1: 5 }] })] });
    const r = valido(compilar(f, { tamanoMalla: 0.5 }));
    const usados = new Set([...r.modelo.laminas!.flatMap((l) => [...l.nudos]), ...r.modelo.restricciones!.map((x) => x.maestro)]);
    r.modelo.nudos.forEach((_, n) => expect(usados.has(n), `nudo ${r.modelo.nudos[n]!.id}`).toBe(true));
  });

  it("base articulada: coarta los desplazamientos de sus nudos y deja los giros", () => {
    const r = valido(compilar(modelo({ muros: [muro("M", [[0, 0], [6, 0]], "C", "P1", { base: "articulado" })] }), { tamanoMalla: 0.5 }));
    const base = r.modelo.apoyos!.filter((a) => r.modelo.nudos[a.nudo]!.z === -3);
    expect(base).toHaveLength(13);
    for (const a of base) expect(a.coartados).toEqual([true, true, true, false, false, false]);
  });

  it("un muro apeado («ninguno») sobre una viga parte la viga en sus nudos; sin nada debajo, es un error", () => {
    const pilares: Pilar[] = [
      { id: "A", x: 0, y: 0, desde: "C", hasta: "P2", seccion: "p" },
      { id: "B", x: 6, y: 0, desde: "C", hasta: "P2", seccion: "p" },
    ];
    const vigas: Viga[] = [{ id: "V", planta: "P1", puntos: [[0, 0], [6, 0]], seccion: "v" }];
    const r = valido(compilar(modelo({ pilares, vigas, muros: [muro("M", [[0, 0], [6, 0]], "P1", "P2", { base: "ninguno" })] }), { tamanoMalla: 0.5 }));
    expect(r.mapeo.piezas.V!.length).toBeGreaterThan(8);
    // Lejos de los pilares (en sus huellas apoyaría en sus cabezas)
    const sin = compilar(modelo({ pilares, muros: [muro("M", [[1, 2], [5, 2]], "P1", "P2", { base: "ninguno" })] }), { tamanoMalla: 0.5 });
    expect(sin.valido).toBe(false);
    expect(sin.diagnosticos.some((d) => d.codigo === "muro/arranque-sin-apoyo" && d.ids?.includes("M"))).toBe(true);
  });
});

describe("diafragma y vigas (C3-d, C3-e)", () => {
  it("sin losas, los nudos del muro en la cota entran en el diafragma, también los de lo alto del dintel", () => {
    const r = valido(compilar(modelo({ muros: [muro("M", [[0, 0], [6, 0]], "C", "P1", { huecos: [{ desde: 2, hasta: 4, z0: 0, z1: 2.2 }] })] }), { tamanoMalla: 0.5 }));
    const diaf = r.modelo.restricciones!.find((x) => x.tipo === "diafragma")!;
    const enCota = laminasDe(r, "M").flatMap((l) => [...l.nudos]).filter((n) => r.modelo.nudos[n]!.z === 0);
    for (const n of enCota) expect(diaf.esclavos.includes(n)).toBe(true);
    expect(enCota.some((n) => r.modelo.nudos[n]!.x > 2 && r.modelo.nudos[n]!.x < 4)).toBe(true);
  });

  it("una viga que acaba en el extremo de un muro en su plano sigue dentro con barras auxiliares a lo largo de su canto", () => {
    const pilares: Pilar[] = [{ id: "A", x: 10, y: 0, desde: "C", hasta: "P2", seccion: "p" }];
    const vigas: Viga[] = [{ id: "V", planta: "P1", puntos: [[6, 0], [10, 0]], seccion: "v" }];
    const r = valido(compilar(modelo({ pilares, vigas, muros: [muro("M", [[0, 0], [6, 0]])] }), { tamanoMalla: 0.5 }));
    const aux = r.mapeo.barras.flatMap((b, i) => (b.auxiliar ? [i] : []));
    // Canto 0,6 con elementos de 0,5: dos barras, de x = 6 a 5
    expect(aux).toHaveLength(2);
    expect(r.mapeo.piezas.V!.some((b) => aux.includes(b))).toBe(false);
    const xs = aux.flatMap((b) => r.modelo.barras![b]!.nudos.map((n) => r.modelo.nudos[n]!.x));
    expect(Math.min(...xs)).toBeCloseTo(5, 12);
    expect(Math.max(...xs)).toBeCloseTo(6, 12);
    // Una viga que corre por el eje del muro se parte en sus nudos y no lleva auxiliares
    const r2 = valido(compilar(modelo({ pilares, vigas: [{ id: "V", planta: "P1", puntos: [[2, 0], [10, 0]], seccion: "v" }], muros: [muro("M", [[0, 0], [6, 0]])] }), { tamanoMalla: 0.5 }));
    expect(r2.mapeo.barras.some((b) => b.auxiliar)).toBe(false);
    expect(r2.mapeo.piezas.V!.length).toBeGreaterThan(8);
  });
});

describe("cargas (C3-g, C3-h)", () => {
  it("peso propio: γ·t·(alzado − huecos) menos el solape con la losa, frente a un cálculo a mano", () => {
    const g = 25;
    const t = 0.25;
    const e = 0.2;
    // Muro de C a P2 bajo una losa en P1 que lo cubre por un lado (borde a ejes) en 4 de sus 6 m
    const f = modelo({
      peso: g,
      muros: [muro("M", [[0, 0], [6, 0]], "C", "P2", { huecos: [{ desde: 1, hasta: 2, z0: 0, z1: 2 }] })],
      losas: [{ id: "L", planta: "P1", contorno: rect(0, 0, 4, 5), espesor: e, material: "HA", pp: 0 }],
    });
    const r = valido(compilar(f, { tamanoMalla: 0.5 }));
    const [G] = resolver(r.modelo);
    let Fz = 0;
    for (const a of r.modelo.apoyos!) Fz += G!.reacciones[6 * a.nudo + 2]!;
    // Solape: un lado cubierto en 4 m, con muro debajo y encima: 2 · γ·(t/2)·(e/2)
    const esperado = g * t * (6 * 6 - 2) - 2 * g * (t / 2) * (e / 2) * 4;
    expect(Fz / esperado - 1).toBeLessThan(1e-9);
    expect(Math.abs(Fz / esperado - 1)).toBeLessThan(1e-9);
  });

  it("empuje hidrostático en un muro con un hueco: resultante y punto de aplicación, del lado que toca", () => {
    const empuje: CargaFisica = { tipo: "empuje", id: "E", caso: "Q", muro: "M", lado: "derecho", z0: 0, z1: 2.5, p0: 30, p1: 0 };
    const f = modelo({ muros: [muro("M", [[0, 0], [6, 0]], "C", "P1", { huecos: [{ desde: 4, hasta: 5, z0: 1, z1: 2 }] })], cargas: [empuje] });
    const r = valido(compilar(f, { tamanoMalla: 0.5 }));
    const [, Q] = resolver(r.modelo);
    let Fy = 0;
    let Mx = 0;
    for (const a of r.modelo.apoyos!) {
      Fy += Q!.reacciones[6 * a.nudo + 1]!;
      Mx += Q!.reacciones[6 * a.nudo + 3]! + (r.modelo.nudos[a.nudo]!.y * Q!.reacciones[6 * a.nudo + 2]! - r.modelo.nudos[a.nudo]!.z * Q!.reacciones[6 * a.nudo + 1]!);
    }
    // Terreno a la derecha (y < 0): empuja hacia +y. Sin el hueco de 1 × 1 entre z = 1 y 2 (p de 18 a 6)
    const total = 6 * (30 * 2.5) / 2 - 1 * ((18 + 6) / 2);
    expect(-Fy / total - 1).toBeLessThan(1e-9);
    expect(Math.abs(-Fy / total - 1)).toBeLessThan(1e-9);
    // Momento respecto a la base (z = −3): ∫ p·(z − zb) dA = el de las reacciones, Mx − 3·ΣRy. En
    // el hueco, ∫₁² p·z dz con p lineal de 18 a 6: (b − a)/6·(a(2pa + pb) + b(pa + 2pb)) = 17
    const momento = 6 * ((30 * 2.5 * 2.5) / 6) - 17;
    expect(Math.abs((Mx - 3 * Fy) / momento - 1)).toBeLessThan(1e-9);
  });
});

describe("baterías al azar (criterios 3 y 5)", () => {
  it("validador de la malla de los muros: área, rectángulos, conformidad con las losas, sin nudos sueltos; sin pérdidas y equilibrio", () => {
    for (const s of [1, 2, 3, 4, 5, 6]) {
      const f = conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(s), s), s);
      const r = valido(compilar(f));
      const m = r.modelo;
      expect(r.estadisticas.sinPerdidas.fuerzas, `semilla ${s}`).toBeLessThan(1e-9);
      expect(r.estadisticas.sinPerdidas.momentos, `semilla ${s}`).toBeLessThan(1e-9);
      expect(r.estadisticas.laminasMuros).toBeGreaterThan(0);
      // Rectángulos verticales y área por muro = alzado sin huecos (sin la malla: Σ franjas)
      for (const w of f.muros!) {
        let area = 0;
        for (const l of laminasDe(r, w.id)) {
          const X = l.nudos.map((n) => m.nudos[n]!);
          const ancho = Math.hypot(X[1]!.x - X[0]!.x, X[1]!.y - X[0]!.y);
          expect(Math.abs(X[3]!.x - X[0]!.x) + Math.abs(X[3]!.y - X[0]!.y)).toBeLessThan(1e-12);
          expect(X[0]!.z).toBe(X[1]!.z);
          area += ancho * (X[3]!.z - X[0]!.z);
        }
        expect(area).toBeGreaterThan(0);
      }
      // Sin nudos sueltos
      const usados = new Set([...m.laminas!.flatMap((l) => [...l.nudos]), ...(m.barras ?? []).flatMap((b) => [...b.nudos]), ...m.restricciones!.map((x) => x.maestro)]);
      m.nudos.forEach((v, n) => expect(usados.has(n), `semilla ${s}: ${v.id}`).toBe(true));
      // Conformidad muro–losa: cada arista de muro en la cota de una planta, si tiene losa al lado,
      // es arista de una lámina de la losa
      const aristasLosa = new Set<string>();
      const nudosLosa = new Set<number>();
      m.laminas!.forEach((l, i) => {
        if (!r.mapeo.laminas![i]!.losa) return;
        for (let j = 0; j < 4; j++) {
          const [a, b] = [l.nudos[j]!, l.nudos[(j + 1) % 4]!];
          aristasLosa.add(a < b ? `${a},${b}` : `${b},${a}`);
          nudosLosa.add(a);
        }
      });
      m.laminas!.forEach((l, i) => {
        if (!r.mapeo.laminas![i]!.muro) return;
        for (const [a, b] of [
          [l.nudos[0]!, l.nudos[1]!],
          [l.nudos[3]!, l.nudos[2]!],
        ] as const)
          if (nudosLosa.has(a) && nudosLosa.has(b)) expect(aristasLosa.has(a < b ? `${a},${b}` : `${b},${a}`), `semilla ${s}`).toBe(true);
      });
      for (const c of casosValidos(calcular(m))) expect(Math.max(c.equilibrio.fuerzas, c.equilibrio.momentos)).toBeLessThan(1e-9);
      expect(r.estadisticas.muros.aspectoMax).toBeGreaterThanOrEqual(1);
      if (r.estadisticas.muros.altos) expect(r.diagnosticos.some((d) => d.codigo === "muro/aspecto")).toBe(true);
      expect(ASPECTO_ALTO).toBe(4);
    }
  });
});
