/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.11): el armado dibujado pone cada barra donde la toma la
 * comprobación. Las secciones (barras dentro del cerco, con el recubrimiento hasta el cerco; tantas
 * como dice el armado), el alzado de un vano (sus zonas y sus cercos) y los refuerzos de una losa en
 * planta (con los ejes de las franjas del compilador).
 */
import { describe, expect, it } from "vitest";
import { ejesArmado } from "../compilador/franjas.ts";
import { barrasDe, type ArmadoForjado, type ArmadoTramoPilar, type ArmadoVanoViga } from "./armado.ts";
import { alzadoPilar, alzadoVano, armadoDeZona, cercosDibujados, zonasCercosPilar, cotasRefuerzo, ejesArmadura, PRIMER_CERCO, puntosCercos, refuerzosDibujados, seccionPilarArmada, seccionVigaArmada } from "./dibujoArmado.ts";

const REC = 30;

describe("CO6: el armado dibujado", () => {
  it("pilar rectangular: tantas barras como el armado, dentro del cerco y a su recubrimiento", () => {
    const a: ArmadoTramoPilar = { esquinas: 16, caraB: { n: 2, diametro: 12 }, caraH: { n: 1, diametro: 12 }, cercos: { diametro: 8, separacion: 150 } };
    const s = seccionPilarArmada({ b: 300, h: 500 }, a, REC);
    expect(s.barras).toHaveLength(barrasDe(a));
    // x es el canto h e y el ancho b
    expect([s.ancho, s.alto, s.cotas]).toEqual([500, 300, { x: "h", y: "b" }]);
    // El eje del cerco, a recubrimiento + Øc/2 de la cara
    expect(s.cerco).toEqual({ diametro: 8, ancho: 500 - 2 * REC - 8, alto: 300 - 2 * REC - 8 });
    // Cada barra, tocando el cerco por dentro o más adentro: su cara de fuera, a ≥ rec + Øc de las del hormigón
    for (const q of s.barras) {
      expect(500 / 2 - Math.abs(q.x) - q.diametro / 2).toBeGreaterThanOrEqual(REC + 8 - 1e-9);
      expect(300 / 2 - Math.abs(q.y) - q.diametro / 2).toBeGreaterThanOrEqual(REC + 8 - 1e-9);
    }
    // Las de esquina, justo en las esquinas del cerco
    const esquinas = s.barras.filter((q) => q.grupo === "esquinas");
    expect(esquinas.map((q) => [Math.abs(q.x), Math.abs(q.y)])).toEqual(Array(4).fill([250 - REC - 8 - 8, 150 - REC - 8 - 8]));
    // Las de las caras b (las del canto: x = ±), 2 por cara repartidas en y; las de las caras h, 1 por cara en x = 0
    const cb = s.barras.filter((q) => q.grupo === "caraB");
    expect(cb).toHaveLength(4);
    expect(new Set(cb.map((q) => Math.abs(q.x)))).toEqual(new Set([250 - REC - 8 - 6]));
    expect(cb.filter((q) => q.x > 0).map((q) => q.y).sort((p, q) => p - q)).toEqual([-(150 - REC - 16) / 3, (150 - REC - 16) / 3].map((v) => expect.closeTo(v, 9)));
    const ch = s.barras.filter((q) => q.grupo === "caraH");
    expect(ch.map((q) => [q.x, Math.abs(q.y)])).toEqual([[0, 150 - REC - 8 - 6], [0, 150 - REC - 8 - 6]]);
    // Simétrica respecto a los dos ejes
    const clave = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;
    const puestas = new Set(s.barras.map((q) => clave(q.x, q.y)));
    for (const q of s.barras) expect(puestas.has(clave(-q.x, q.y)) && puestas.has(clave(q.x, -q.y))).toBe(true);
    expect(s.avisos).toEqual([]);
  });

  it("pilar circular: las barras del anillo, repartidas en su circunferencia", () => {
    const a: ArmadoTramoPilar = { anillo: { n: 6, diametro: 16 }, cercos: { diametro: 6, separacion: 200 } };
    const s = seccionPilarArmada({ D: 400 }, a, REC);
    expect(s.forma).toBe("circular");
    expect(s.barras).toHaveLength(6);
    for (const q of s.barras) expect(Math.hypot(q.x, q.y)).toBeCloseTo(200 - REC - 6 - 8, 9);
    // Repartidas: la suma de sus posiciones es nula
    expect(Math.hypot(s.barras.reduce((t, q) => t + q.x, 0), s.barras.reduce((t, q) => t + q.y, 0))).toBeLessThan(1e-9);
  });

  it("un armado a medias (el borrador) dibuja lo que tiene, y avisa de las barras que no caben", () => {
    expect(seccionPilarArmada({ b: 300, h: 300 }, undefined, REC).barras).toEqual([]);
    expect(seccionPilarArmada({ b: 300, h: 300 }, { esquinas: 12 }, REC).barras).toHaveLength(4);
    expect(seccionPilarArmada({ b: 300, h: 300 }, { caraB: { n: Number.NaN, diametro: 12 } } as never, REC).barras).toEqual([]);
    // 8 barras de 25 por cara en 30 cm no caben
    const lleno = seccionPilarArmada({ b: 300, h: 300 }, { esquinas: 25, caraB: { n: 8, diametro: 25 }, cercos: { diametro: 8, separacion: 100 } }, REC);
    expect(lleno.avisos.length).toBe(1);
  });

  it("viga: la inferior y la superior de cada zona, las ramas interiores de los cercos y la piel", () => {
    const a: ArmadoVanoViga = { inferior: { n: 3, diametro: 16 }, superior: { n: 2, diametro: 12 }, superiorFin: { n: 4, diametro: 16 }, cercos: { diametro: 8, separacion: 200, ramas: 4 }, cercosInicio: { diametro: 8, separacion: 100 }, piel: { n: 1, diametro: 12 } };
    const centro = seccionVigaArmada({ b: 300, h: 500 }, a, "centro", REC);
    const fin = seccionVigaArmada({ b: 300, h: 500 }, a, "fin", REC);
    const inicio = seccionVigaArmada({ b: 300, h: 500 }, a, "inicio", REC);
    const cuenta = (s: typeof centro, g: string) => s.barras.filter((q) => q.grupo === g).length;
    expect([cuenta(centro, "inferior"), cuenta(centro, "superior"), cuenta(centro, "piel")]).toEqual([3, 2, 2]);
    expect(cuenta(fin, "superior")).toBe(4);
    expect(cuenta(inicio, "superior")).toBe(2);
    // Las ramas: 4 en el centro y en el fin (dos interiores), 2 en el inicio (ninguna interior)
    expect([centro.ramas.length, fin.ramas.length, inicio.ramas.length]).toEqual([2, 2, 0]);
    // La inferior, abajo y de lado a lado del cerco; la superior, arriba
    const inf = centro.barras.filter((q) => q.grupo === "inferior");
    expect(inf.map((q) => q.y)).toEqual(Array(3).fill(-250 + REC + 8 + 8));
    expect(inf.map((q) => q.x)).toEqual([-(150 - REC - 16), 0, 150 - REC - 16]);
    expect(centro.barras.filter((q) => q.grupo === "superior").every((q) => q.y === 250 - REC - 8 - 6)).toBe(true);
    expect(armadoDeZona(a, "fin")).toMatchObject({ superiorPropia: true, cercosPropios: false });
    expect(armadoDeZona(a, "inicio")).toMatchObject({ superiorPropia: false, cercosPropios: true, cercos: { separacion: 100 } });
  });

  it("alzado de un vano: los cuartos de la luz y los cercos de cada zona a su separación", () => {
    const a: ArmadoVanoViga = { inferior: { n: 2, diametro: 12 }, superior: { n: 2, diametro: 12 }, cercos: { diametro: 6, separacion: 200 }, cercosInicio: { diametro: 6, separacion: 100 } };
    const al = alzadoVano(4, a);
    expect(al.zonas.map((z) => [z.zona, z.desde, z.hasta])).toEqual([["inicio", 0, 1], ["centro", 1, 3], ["fin", 3, 4]]);
    const [ini, cen, fin] = al.zonas;
    // Inicio: de 0,05 a 1 cada 0,10; centro: de 1 a 3 cada 0,20; fin: de 3 a 3,95 cada 0,20
    expect(ini.posiciones[0]).toBe(PRIMER_CERCO);
    expect(ini.posiciones).toHaveLength(10);
    expect(cen.posiciones).toHaveLength(11);
    expect(fin.posiciones).toHaveLength(5);
    for (const z of al.zonas) {
      for (let i = 1; i < z.posiciones.length; i++) expect(z.posiciones[i]! - z.posiciones[i - 1]!).toBeCloseTo(z.cercos!.separacion / 1000, 9);
      expect(z.posiciones.every((x) => x >= z.desde - 1e-9 && x <= z.hasta + 1e-9)).toBe(true);
    }
    // Sin armado, sin cercos ni barras
    const vacio = alzadoVano(4, undefined);
    expect([vacio.inferior, vacio.zonas.flatMap((z) => z.posiciones)]).toEqual([undefined, []]);
  });

  it("los ejes de una armadura son los de las franjas del compilador, en cualquier ángulo", () => {
    for (const eje1 of [undefined, 0, 90, 180, 270, 30, -45, 123.4]) {
      const c = ejesArmado({ eje1 } as never);
      expect(ejesArmadura(eje1, "x-inf"), `eje1 ${eje1}`).toEqual(c[1]);
      expect(ejesArmadura(eje1, "y-sup"), `eje1 ${eje1}`).toEqual(c[2]);
      expect(ejesArmadura(eje1, "y")).toEqual(c[2]);
    }
  });

  it("los refuerzos y los cercos de una losa, en planta: su zona, su barra y su reparto", () => {
    const a: Pick<ArmadoForjado, "refuerzos" | "cercos"> = {
      refuerzos: [
        { armadura: "x-sup", s: [2, 5], t: [1, 2], barras: { diametro: 12, separacion: 200 } },
        { armadura: "y-inf", s: [1, 3], t: [4, 6], barras: { diametro: 16, n: 2 }, en: "nervios" },
        // A medias: no se dibuja
        { armadura: "x-inf", s: [3, 3], t: [0, 1], barras: { diametro: 12, separacion: 200 } },
      ],
      cercos: [{ direccion: "y", s: [0, 2], t: [1, 1.8], cercos: { diametro: 6, separacion: 150, ramas: 2 } }],
    };
    const r = refuerzosDibujados(0, a);
    expect(r.map((x) => x.indice)).toEqual([0, 1]);
    // X: s es x y t es y
    expect(r[0]).toMatchObject({ cara: "superior", zona: [[2, 1], [5, 1], [5, 2], [2, 2]], barra: [[2, 1.5], [5, 1.5]], reparto: [[3.5, 1], [3.5, 2]], centro: [3.5, 1.5], giro: 0, texto: "Ø12/200", largo: 3, ancho: 1 });
    // Y: s es y y t es x (d = eje 2, n = eje 1)
    expect(r[1]).toMatchObject({ cara: "inferior", barra: [[5, 1], [5, 3]], reparto: [[4, 2], [6, 2]], centro: [5, 2], giro: 90, texto: "2Ø16 por nervio", largo: 2, ancho: 2, en: "nervios" });
    const c = cercosDibujados(0, a);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ direccion: "y", centro: [1.4, 1], d: [0, 1], texto: "cØ6/150 (2R)", largo: 2, ramas: 2, s: [0, 2], t: [1, 1.8] });
    expect(c[0]!.ancho).toBeCloseTo(0.8, 12);
    expect(c[0]!.separacion).toBeCloseTo(0.15, 12);
    // Un punto por cerco sobre cada nervio que cruza la zona: 2 m a 150 mm son 13 cercos, el primero a 75 mm
    const nervios: [[number, number], [number, number]][] = [
      [[1.2, -1], [1.2, 5]], // dentro, entero
      [[1.6, 0.5], [1.6, 5]], // dentro, desde y = 0,5
      [[2.4, -1], [2.4, 5]], // fuera de la zona (t = x = 2,4)
      [[0, 1], [5, 1]], // de la otra familia
    ];
    const ps = puntosCercos(c[0]!, nervios);
    const en12 = ps.filter((p) => Math.abs(p[0] - 1.2) < 1e-9);
    const en16 = ps.filter((p) => Math.abs(p[0] - 1.6) < 1e-9);
    expect(en12).toHaveLength(13);
    expect(en12[0]![1]).toBeCloseTo(0.075, 12);
    expect(en12[12]![1]).toBeCloseTo(1.875, 12);
    // El segundo nervio empieza en 0,5: sus cercos, a la misma altura que los del primero
    expect(en16.map((p) => p[1])).toEqual(en12.map((p) => p[1]).filter((y) => y >= 0.5));
    expect(ps).toHaveLength(en12.length + en16.length);
    // Sin nervios que la crucen, sobre su eje
    expect(puntosCercos(c[0]!, []).every((p) => Math.abs(p[0] - 1.4) < 1e-9)).toBe(true);
    expect(puntosCercos(c[0]!, [])).toHaveLength(13);
    // Girada: las medidas no cambian y la barra va según el eje 1
    const g = refuerzosDibujados(30, a)[0]!;
    expect(Math.hypot(g.barra[1][0] - g.barra[0][0], g.barra[1][1] - g.barra[0][1])).toBeCloseTo(3, 12);
    expect(Math.hypot(g.reparto[1][0] - g.reparto[0][0], g.reparto[1][1] - g.reparto[0][1])).toBeCloseTo(1, 12);
    expect(g.giro).toBeCloseTo(30, 9);
    expect(refuerzosDibujados(0, undefined)).toEqual([]);
    // Cada uno lleva sus ejes y su rectángulo en ellos (para acotarlo y para editarlo)
    expect(r[1]).toMatchObject({ d: [0, 1], n: [1, 0], s: [1, 3], t: [4, 6] });
  });

  it("las cotas de un refuerzo (§8.12): por tramos desde el eje que tiene dentro o, si no, de cada punta al más cercano", () => {
    // Un refuerzo superior sobre un pilar: lo que sale a cada lado de su eje
    expect(cotasRefuerzo([4, 6.2], [5, 11, -3])).toEqual({ dentro: [5], fuera: [null, null] });
    // Dos ejes a menos de 5 cm (un pilar y el eje de su viga) son el mismo; los de las puntas no parten nada
    expect(cotasRefuerzo([4, 6.2], [5, 5.03, 4.02, 6.2])).toEqual({ dentro: [5], fuera: [null, null] });
    // Con más de tres dentro (un vano entero con sus apoyos), sin tramos: se lee su largo
    expect(cotasRefuerzo([0, 20], [2, 6, 10, 14])).toEqual({ dentro: [], fuera: [null, null] });
    expect(cotasRefuerzo([0, 20], [2, 6, 10]).dentro).toEqual([2, 6, 10]);
    // Un refuerzo de vano: lo que le falta a cada punta hasta el eje del apoyo, si está a menos de 2 m
    expect(cotasRefuerzo([1.2, 4.6], [0.75, 5, 9])).toEqual({ dentro: [], fuera: [0.75, 5] });
    expect(cotasRefuerzo([1.2, 4.6], [-1.5, 5])).toEqual({ dentro: [], fuera: [null, 5] });
    // La punta en el eje no se acota (0 m)
    expect(cotasRefuerzo([1.2, 4.6], [1.2, 4.601])).toEqual({ dentro: [], fuera: [null, null] });
    expect(cotasRefuerzo([1.2, 4.6], [])).toEqual({ dentro: [], fuera: [null, null] });
  });
});

describe("CO1-f: las zonas de cercos de un tramo de pilar y su alzado", () => {
  const SOLAPES = { 12: 0.72, 16: 0.96, 20: 1.2 };
  it("junto a cada nudo, la mayor dimensión; en el pie, el solape con barras de más de 14; sin centro, a medias", () => {
    // 30 × 40 con Ø12: 0,40 m en cada extremo (el solape no cuenta hasta Ø14)
    expect(zonasCercosPilar({ b: 300, h: 400 }, 3, 12, SOLAPES)).toEqual({ libre: 3, pie: 0.4, cabeza: 0.4, centro: true });
    // Con Ø16, el pie llega al solape (0,96, al módulo de 5 cm por arriba)
    const z = zonasCercosPilar({ b: 300, h: 400 }, 3, 16, SOLAPES);
    expect(z.pie).toBeCloseTo(1, 12);
    expect(z.cabeza).toBeCloseTo(0.4, 12);
    expect(z.centro).toBe(true);
    // Circular, por su diámetro; sin tabla de solapes, sólo la dimensión
    expect(zonasCercosPilar({ D: 450 }, 3, 20, undefined)).toEqual({ libre: 3, pie: 0.45, cabeza: 0.45, centro: true });
    // Un tramo corto (0,90 m): menos de 30 cm de centro, y los dos extremos se reparten el tramo
    expect(zonasCercosPilar({ b: 300, h: 300 }, 0.85, 12, SOLAPES)).toEqual({ libre: 0.85, pie: 0.425, cabeza: 0.425, centro: false });
  });

  it("cada cerco en su sitio: el primero a 50 mm, cada zona a su separación y el último a 50 mm o más de la cara de arriba", () => {
    const a = { esquinas: 12, cercos: { diametro: 6, separacion: 180 }, cercosPie: { diametro: 6, separacion: 100 }, cercosCabeza: { diametro: 6, separacion: 100 } };
    const al = alzadoPilar({ b: 300, h: 300 }, 3.1, a, SOLAPES);
    expect(al.zonas.map((z) => [z.zona, z.propios, z.cercos!.separacion])).toEqual([["pie", true, 100], ["centro", false, 180], ["cabeza", true, 100]]);
    expect(al.zonas.map((z) => [z.desde, z.hasta].map((x) => Math.round(x * 1000)))).toEqual([[0, 300], [300, 2800], [2800, 3100]]);
    const todas = al.zonas.flatMap((z) => z.posiciones);
    expect(al.cercos).toBe(todas.length);
    expect(todas[0]).toBeCloseTo(0.05, 12);
    expect(todas[todas.length - 1]!).toBeLessThanOrEqual(3.1 - 0.05 + 1e-9);
    for (let i = 1; i < todas.length; i++) expect(todas[i]! - todas[i - 1]!).toBeGreaterThan(0.099);
    // Dentro de cada zona, a su separación; cada cerco, en la zona en la que cae
    for (const z of al.zonas) {
      for (const x of z.posiciones) expect(x >= z.desde - 1e-9 && x <= z.hasta + 1e-9).toBe(true);
      for (let i = 1; i < z.posiciones.length; i++) expect(z.posiciones[i]! - z.posiciones[i - 1]!).toBeCloseTo(z.cercos!.separacion / 1000, 9);
    }
    // Menos cercos que con todo a 100 mm
    const uniforme = alzadoPilar({ b: 300, h: 300 }, 3.1, { esquinas: 12, cercos: { diametro: 6, separacion: 100 } }, SOLAPES);
    expect(uniforme.zonas.every((z) => !z.propios)).toBe(true);
    expect(uniforme.cercos).toBe(31);
    // 3 en el pie (0,05 a 0,25), 14 en el centro (0,35 a 2,69) y 3 en la cabeza, desde su arranque (2,80 a 3,00)
    expect(al.zonas.map((z) => z.posiciones.length)).toEqual([3, 14, 3]);
    expect(al.zonas[2]!.posiciones[0]).toBeCloseTo(2.8, 9);
    expect(al.cercos).toBe(20);
    // Sin armado, las zonas sin cercos; un tramo corto, sólo pie y cabeza
    expect(alzadoPilar({ b: 300, h: 300 }, 3.1, undefined, SOLAPES).cercos).toBe(0);
    expect(alzadoPilar({ b: 300, h: 300 }, 0.85, a, SOLAPES).zonas.map((z) => z.zona)).toEqual(["pie", "cabeza"]);
  });
});

describe("los refuerzos por nervio, sobre sus nervios", () => {
  it("un refuerzo por nervio arma los nervios de su ancho; uno a una separación, o de ábaco, ninguno", async () => {
    const { nerviosDeRefuerzo, refuerzosDibujados } = await import("./dibujoArmado.ts");
    const ejes = [0.4, 1.2, 2.0, 2.8, 3.6];
    const [porNervio, parrilla, abaco, enCaseton] = refuerzosDibujados(0, {
      refuerzos: [
        { armadura: "x-inf", s: [0, 4], t: [0.8, 3.2], barras: { diametro: 12, n: 2 }, en: "nervios" },
        { armadura: "x-sup", s: [0, 4], t: [0.8, 3.2], barras: { diametro: 12, separacion: 200 } },
        { armadura: "y-sup", s: [0, 2], t: [0, 2], barras: { diametro: 8, n: 1 }, en: "abacos" },
        { armadura: "x-inf", s: [0, 4], t: [1.4, 1.9], barras: { diametro: 12, n: 2 }, en: "nervios" },
      ],
    });
    expect(porNervio!.porNervio).toBe(true);
    expect(nerviosDeRefuerzo(porNervio!, ejes)).toEqual([1.2, 2.0, 2.8]);
    expect(parrilla!.porNervio).toBe(false);
    expect(nerviosDeRefuerzo(parrilla!, ejes)).toEqual([]);
    expect(nerviosDeRefuerzo(abaco!, ejes)).toEqual([]);
    // Dibujado entre dos nervios (en un casetón): ninguno, y se dibuja por su zona
    expect(nerviosDeRefuerzo(enCaseton!, ejes)).toEqual([]);
  });
});
