/**
 * Generador de combinaciones (H30). Oráculos:
 * 1. el recuento del prototipo de la investigación (03-resultados/combos3d.mts → 176);
 * 2. un enumerador por fuerza bruta que recorre todo el producto de factores posibles y filtra
 *    con las expresiones 4.3–4.8 del DB SE (método independiente del constructivo);
 * 3. la tabla de coeficientes de una memoria CYPE de CE/CTE (P2115, apartado A.3), transcrita.
 */
import { describe, expect, it } from "vitest";
import { generarCombinaciones, matrizFactores, SITUACIONES, type CasoCarga, type Situacion } from "./generador.ts";
import { PSI_TEMPERATURA, PSI_VIENTO, psiNieve, psiUso } from "./psi.ts";

const viento = (dirs: readonly ("X+" | "X-" | "Y+" | "Y-")[]): CasoCarga[] =>
  dirs.map((d) => ({ id: `W${d}`, tipo: "W", familia: "W", psi: PSI_VIENTO, direccion: d[0] as "X" | "Y", signo: d[1] === "+" ? 1 : -1 }));

/** Los 11 casos del prototipo de H30. */
const CASOS_H30: CasoCarga[] = [
  { id: "G", tipo: "G" },
  { id: "Q", tipo: "Q", psi: psiUso("A") },
  { id: "S", tipo: "S", psi: psiNieve(false) },
  ...viento(["X+", "X-", "Y+", "Y-"]),
  { id: "EX+e", tipo: "E", familia: "EX", direccion: "X" },
  { id: "EX-e", tipo: "E", familia: "EX", direccion: "X" },
  { id: "EY+e", tipo: "E", familia: "EY", direccion: "Y" },
  { id: "EY-e", tipo: "E", familia: "EY", direccion: "Y" },
];

const cuenta = (cs: { situacion: Situacion }[], s: Situacion) => cs.filter((c) => c.situacion === s).length;

describe("recuento de H30", () => {
  it("11 casos: 74 ELU persistentes, 64 sísmicas y 37 ELS características (176 con la casi permanente del prototipo)", () => {
    const c = generarCombinaciones(CASOS_H30);
    expect(cuenta(c, "ELU-PT")).toBe(74);
    expect(cuenta(c, "ELU-SIS")).toBe(64);
    expect(cuenta(c, "ELS-C")).toBe(37);
    // El prototipo daba 1 casi permanente; aquí la sobrecarga puede faltar (favorable): 2.
    expect(cuenta(c, "ELS-CP")).toBe(2);
    // Sin G favorable el prototipo daba 37 persistentes: aquí la G favorable siempre está.
    const sinSismo = generarCombinaciones(CASOS_H30.filter((x) => x.tipo !== "E"), { situaciones: ["ELU-PT", "ELU-SIS"] });
    expect(cuenta(sinSismo, "ELU-SIS")).toBe(0);
  });
});

// ------------------------------------------------------------------ fuerza bruta
/** Casos variados: dos permanentes de distinta fila de la tabla 4.1, dos usos, nieve > 1000 m (ψ2 > 0),
 *  viento en una familia, temperatura, sismo con excentricidad en X y sin ella en Y, y un impacto. */
const CASOS_RICOS: CasoCarga[] = [
  { id: "PP", tipo: "G" },
  { id: "EMP", tipo: "G", permanente: "empuje" },
  { id: "QA", tipo: "Q", psi: psiUso("A") },
  { id: "QC", tipo: "Q", psi: psiUso("C") },
  { id: "S", tipo: "S", psi: psiNieve(true) },
  ...viento(["X+", "X-"]),
  { id: "T", tipo: "T", psi: PSI_TEMPERATURA },
  { id: "EX+e", tipo: "E", familia: "EX", direccion: "X" },
  { id: "EX-e", tipo: "E", familia: "EX", direccion: "X" },
  { id: "EY", tipo: "E", direccion: "Y" },
  { id: "IMP", tipo: "A" },
];

/** Coeficientes del CTE, escritos aquí otra vez a partir del texto del DB SE (no del generador). */
function reglaCte(s: Situacion, c: CasoCarga): { gDesf: number; gFav: number } | { p: number; a: number } | null {
  if (c.tipo === "G") {
    if (s !== "ELU-PT") return { gDesf: 1, gFav: 1 };
    return c.permanente === "empuje" ? { gDesf: 1.35, gFav: 0.7 } : { gDesf: 1.35, gFav: 0.8 };
  }
  const psi = c.psi!;
  const t: Record<Situacion, [number, number]> = {
    "ELU-PT": [1.5, 1.5 * psi.psi0],
    "ELU-ACC": [psi.psi1, psi.psi2],
    "ELU-SIS": [psi.psi2, psi.psi2],
    "ELS-C": [1, psi.psi0],
    "ELS-F": [psi.psi1, psi.psi2],
    "ELS-CP": [psi.psi2, psi.psi2],
    GEO: [1, psi.psi0],
    "GEO-SIS": [psi.psi2, psi.psi2],
  };
  return { p: t[s][0], a: t[s][1] };
}

const CON_PRINCIPAL = new Set<Situacion>(["ELU-PT", "ELU-ACC", "ELS-C", "ELS-F", "GEO"]);

function esValida(s: Situacion, casos: readonly CasoCarga[], f: number[]): boolean {
  // Permanentes: todas desfavorables o todas favorables
  const gs = casos.map((c, i) => [c, i] as const).filter(([c]) => c.tipo === "G");
  const estado = (e: "gDesf" | "gFav") => gs.every(([c, i]) => f[i] === (reglaCte(s, c) as { gDesf: number; gFav: number })[e]);
  if (!estado("gDesf") && !estado("gFav")) return false;
  // Familias excluyentes
  const familias = new Map<string, number>();
  casos.forEach((c, i) => c.familia && f[i] !== 0 && familias.set(c.familia, (familias.get(c.familia) ?? 0) + 1));
  if ([...familias.values()].some((v) => v > 1)) return false;
  // Variables: existe una principal (o ninguna) que cuadre con 4.3–4.8
  const vars = casos.map((c, i) => [c, i] as const).filter(([c]) => "QSWT".includes(c.tipo));
  const encaja = (p: number | null) =>
    vars.every(([c, i]) => {
      const r = reglaCte(s, c) as { p: number; a: number };
      if (i === p) return f[i] === r.p && r.p !== 0;
      if (p === null && CON_PRINCIPAL.has(s)) return f[i] === 0;
      return f[i] === 0 || f[i] === r.a;
    });
  if (![null, ...vars.map(([, i]) => i)].some(encaja)) return false;
  // Sismo: sólo en las situaciones sísmicas, 100 % en una dirección y 30 % en la otra
  const es = casos.map((c, i) => [c, i] as const).filter(([c]) => c.tipo === "E");
  const sismica = s === "ELU-SIS" || s === "GEO-SIS";
  if (!sismica) {
    if (es.some(([, i]) => f[i] !== 0)) return false;
  } else {
    const llenos = es.filter(([, i]) => Math.abs(f[i]!) === 1);
    const terc = es.filter(([, i]) => Math.abs(f[i]!) === 0.3);
    if (llenos.length !== 1 || terc.length !== 1) return false;
    if (llenos[0]![0].direccion === terc[0]![0].direccion) return false;
    if (es.some(([, i]) => f[i] !== 0 && Math.abs(f[i]!) !== 1 && Math.abs(f[i]!) !== 0.3)) return false;
  }
  // Accidental: una (o ninguna con incendio) en ELU-ACC; nunca fuera
  const as = casos.map((c, i) => [c, i] as const).filter(([c]) => c.tipo === "A");
  const nA = as.filter(([, i]) => f[i] !== 0).length;
  if (s === "ELU-ACC") return as.every(([, i]) => f[i] === 0 || f[i] === 1) && nA <= 1;
  return nA === 0;
}

function fuerzaBruta(s: Situacion, casos: readonly CasoCarga[]): Set<string> {
  const candidatos = casos.map((c): number[] => {
    if (c.tipo === "G") {
      const r = reglaCte(s, c) as { gDesf: number; gFav: number };
      return [...new Set([r.gDesf, r.gFav])];
    }
    if (c.tipo === "E") return [0, 1, -1, 0.3, -0.3];
    if (c.tipo === "A") return [0, 1];
    const r = reglaCte(s, c) as { p: number; a: number };
    return [...new Set([0, r.p, r.a])];
  });
  const out = new Set<string>();
  const f = new Array<number>(casos.length).fill(0);
  const rec = (k: number) => {
    if (k === casos.length) {
      if (esValida(s, casos, f)) out.add(f.map((v) => Math.round(v * 1e12) / 1e12 || 0).join(","));
      return;
    }
    for (const v of candidatos[k]!) {
      f[k] = v;
      rec(k + 1);
    }
  };
  rec(0);
  return out;
}

describe("fuerza bruta frente al generador (perfil CTE)", () => {
  for (const s of SITUACIONES) {
    it(`${s}: mismo conjunto de combinaciones`, () => {
      const gen = generarCombinaciones(CASOS_RICOS, { situaciones: [s], incendio: true });
      const claves = gen.map((c) => Array.from(c.factores).join(","));
      expect(new Set(claves).size).toBe(claves.length); // sin repetidas
      const bruta = fuerzaBruta(s, CASOS_RICOS);
      expect([...new Set(claves)].sort()).toEqual([...bruta].sort());
    });
  }
});

// ------------------------------------------------------------------ memoria CYPE P2115
/**
 * Tablas del apartado A.3 de `ejemplos anejos de calculo/P2115_A_anexo A_ESTRUCTURA.pdf`
 * (OREKARIestudio, 2022): [favorable, desfavorable, ψ principal, ψ acompañamiento].
 * Sobrecarga de categoría A1, nieve a ≤ 1000 m.
 */
const P2115: Record<string, Record<string, [number, number, number, number] | null>> = {
  "ELU-PT": { G: [0.8, 1.35, 1, 1], Q: [0, 1.5, 1, 0.7], W: [0, 1.5, 1, 0.6], S: [0, 1.5, 1, 0.5], E: null },
  "ELU-SIS": { G: [0.8, 1, 1, 1], Q: [0, 1, 0.3, 0.3], W: [0, 1, 0, 0], S: [0, 1, 0, 0], E: [-1, 1, 1, 0.3] },
  "ELU-ACC": { G: [0.8, 1, 1, 1], Q: [0, 1, 0.5, 0.3], W: [0, 1, 0.5, 0], S: [0, 1, 0.2, 0], E: null },
  // «Acciones características» para el terreno: γ sin ψ
  GEO: { G: [1, 1, 1, 1], Q: [0, 1, 1, 1], W: [0, 1, 1, 1], S: [0, 1, 1, 1], E: null },
  "GEO-SIS": { G: [1, 1, 1, 1], Q: [0, 1, 1, 1], W: [0, 0, 0, 0], S: [0, 1, 1, 1], E: [-1, 1, 1, 0.3] },
};

describe("perfil CYPE frente a la memoria P2115", () => {
  const casos: CasoCarga[] = [
    { id: "G", tipo: "G" },
    { id: "Q", tipo: "Q", psi: psiUso("A") },
    ...viento(["X+", "X-", "Y+", "Y-"]),
    { id: "S", tipo: "S", psi: psiNieve(false) },
    { id: "EX", tipo: "E", direccion: "X" },
    { id: "EY", tipo: "E", direccion: "Y" },
  ];
  for (const [s, tabla] of Object.entries(P2115)) {
    it(`${s}: los factores de cada acción son los de la tabla`, () => {
      const gen = generarCombinaciones(casos, { perfil: "cype", situaciones: [s as Situacion], incendio: true });
      expect(gen.length).toBeGreaterThan(0);
      for (const tipo of ["G", "Q", "W", "S", "E"] as const) {
        const fila = tabla[tipo];
        const idx = casos.map((c, i) => (c.tipo === tipo ? i : -1)).filter((i) => i >= 0);
        const vistos = new Set<number>();
        for (const c of gen) for (const i of idx) vistos.add(Math.round(c.factores[i]! * 1e9) / 1e9);
        if (!fila) {
          expect([...vistos], tipo).toEqual([0]);
          continue;
        }
        const [fav, desf, psiP, psiA] = fila;
        const esperados = new Set<number>();
        if (tipo === "G") {
          esperados.add(fav).add(desf);
        } else if (tipo === "E") {
          for (const v of [desf * psiP, desf * psiA]) esperados.add(v).add(fav * v);
        } else {
          esperados.add(fav * desf); // favorable: no está
          esperados.add(0);
          for (const v of [desf * psiP, desf * psiA]) esperados.add(Math.round(v * 1e9) / 1e9);
        }
        expect([...vistos].sort(), tipo).toEqual([...esperados].sort());
      }
    });
  }
});

// ------------------------------------------------------------------ resto de reglas
describe("reglas", () => {
  it("las cargas nocionales siguen a su caso vertical y al signo del viento", () => {
    const casos: CasoCarga[] = [
      { id: "G", tipo: "G" },
      { id: "Q", tipo: "Q", psi: psiUso("B") },
      ...viento(["X+", "X-"]),
      ...(["X", "Y"] as const).flatMap((d) =>
        ([1, -1] as const).flatMap((sg) => ["G", "Q"].map((o): CasoCarga => ({ id: `N${d}${sg > 0 ? "+" : "-"}(${o})`, tipo: "N", derivadoDe: o, direccion: d, signo: sg }))),
      ),
    ];
    const id = (x: string) => casos.findIndex((c) => c.id === x);
    const elu = generarCombinaciones(casos, { situaciones: ["ELU-PT", "ELS-C"] });
    for (const c of elu) {
      const f = c.factores;
      const nocionalesActivas = casos.filter((x, i) => x.tipo === "N" && f[i] !== 0);
      if (c.situacion !== "ELU-PT") {
        expect(nocionalesActivas).toHaveLength(0);
        continue;
      }
      // Cada nocional activa lleva el factor de su origen
      for (const nc of nocionalesActivas) expect(f[id(nc.id)]).toBe(f[id(nc.derivadoDe!)]);
      const wxMas = f[id("WX+")]! > 0;
      const wxMenos = f[id("WX-")]! > 0;
      const dirs = new Set(nocionalesActivas.map((x) => `${x.direccion}${x.signo}`));
      if (wxMas) expect([...dirs]).toEqual(["X1"]);
      else if (wxMenos) expect([...dirs]).toEqual(["X-1"]);
      else expect(dirs.size).toBe(1); // sin viento, una dirección y signo por combinación
    }
    // Sin viento: las 4 direcciones de imperfección aparecen para 1,35·G + 1,5·Q
    const soloGQ = elu.filter((c) => c.situacion === "ELU-PT" && c.factores[id("G")] === 1.35 && c.factores[id("Q")] === 1.5 && c.factores[id("WX+")] === 0 && c.factores[id("WX-")] === 0);
    expect(soloGQ).toHaveLength(4);
  });

  it("duración de la combinación: la de la acción más corta presente", () => {
    const casos: CasoCarga[] = [
      { id: "G", tipo: "G" },
      { id: "Q", tipo: "Q", psi: psiUso("A") },
      { id: "S", tipo: "S", psi: psiNieve(true), duracion: "media" },
      ...viento(["X+"]),
    ];
    const c = generarCombinaciones(casos, { situaciones: ["ELU-PT"] });
    const dur = (q: number, s: number, w: number) =>
      c.find((x) => x.factores[0] === 1.35 && x.factores[1] === q && x.factores[2] === s && x.factores[3] === w)!.duracion;
    expect(dur(0, 0, 0)).toBe("permanente");
    expect(dur(1.5, 0, 0)).toBe("media");
    expect(dur(1.5, 1.05, 0)).toBe("media"); // nieve > 1000 m: media
    expect(dur(1.5, 0, 0.9)).toBe("corta");
  });

  it("un ψ nulo no repite combinaciones (cubierta de mantenimiento, categoría G)", () => {
    const casos: CasoCarga[] = [{ id: "G", tipo: "G" }, { id: "QA", tipo: "Q", psi: psiUso("A") }, { id: "QG", tipo: "Q", psi: psiUso("G") }];
    const c = generarCombinaciones(casos, { situaciones: ["ELU-PT"] });
    // G sola ×2, G + Q_A principal ×2 (con Q_G ausente, ψ0 = 0), G + Q_G principal (+ ψ0·Q_A o no) ×4
    expect(c).toHaveLength(8);
  });

  it("rechaza casos mal definidos", () => {
    expect(() => generarCombinaciones([{ id: "Q", tipo: "Q" }])).toThrow(/ψ/);
    expect(() => generarCombinaciones([{ id: "E", tipo: "E" }])).toThrow(/dirección/);
    expect(() => generarCombinaciones([{ id: "G", tipo: "G" }, { id: "G", tipo: "G" }])).toThrow(/repetido/);
    expect(() => generarCombinaciones([{ id: "N", tipo: "N", direccion: "X", signo: 1, derivadoDe: "W" }])).toThrow(/vertical/);
    expect(() =>
      generarCombinaciones([
        { id: "a", tipo: "Q", familia: "f", psi: psiUso("A") },
        { id: "b", tipo: "W", familia: "f", psi: PSI_VIENTO },
      ]),
    ).toThrow(/mezcla/);
  });

  it("etiquetas y matriz de factores", () => {
    const c = generarCombinaciones(CASOS_H30, { situaciones: ["ELU-PT", "ELU-SIS"] });
    expect(c[2]!.etiqueta).toBe("1.35·G + 1.5·Q + 0.9·WX+");
    expect(c.find((x) => x.situacion === "ELU-SIS")!.etiqueta).toBe("1·G + 1·EX+e + 0.3·EY+e");
    const m = matrizFactores(c, CASOS_H30.length);
    expect(m.length).toBe(c.length * CASOS_H30.length);
    expect(Array.from(m.subarray(2 * CASOS_H30.length, 3 * CASOS_H30.length))).toEqual(Array.from(c[2]!.factores));
  });
});
