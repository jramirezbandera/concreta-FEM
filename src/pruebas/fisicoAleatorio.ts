/**
 * Generador de modelos físicos aleatorios para las pruebas metamórficas del compilador (C1):
 * retícula de pilares con plantas y luces al azar, pilares girados o que acaban antes, vigas
 * continuas o por vano, vigas secundarias en T, voladizos, rótulas y cargas de todos los tipos.
 * Reproducible por semilla y el mismo en V8 y en JavaScriptCore (sin `Math.hypot` ni `**`, COM-12). No es
 * código del compilador.
 */
import type { CargaFisica, ModeloFisico, Pilar, Planta, Seccion, Vec2, Viga } from "../compilador/fisico.ts";

/** Generador de Park–Miller: el mismo en cualquier motor de JavaScript. */
export function azar(semilla: number): () => number {
  let s = semilla % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export interface OpcionesFisicoAleatorio {
  /** Diafragma rígido en las plantas (por defecto); con false, ninguna planta lo lleva. */
  diafragma?: boolean;
}

/** Punto de una polilínea a la distancia s de su origen. */
export function puntoEnPolilinea(puntos: readonly Vec2[], s: number): Vec2 {
  let resto = s;
  for (let i = 0; i + 1 < puntos.length; i++) {
    const [a, b] = [puntos[i]!, puntos[i + 1]!];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const L = Math.sqrt(dx * dx + dy * dy);
    if (resto <= L || i + 2 === puntos.length) return [a[0] + ((b[0] - a[0]) * resto) / L, a[1] + ((b[1] - a[1]) * resto) / L];
    resto -= L;
  }
  return puntos[0]!;
}

export function longitudPolilinea(puntos: readonly Vec2[]): number {
  let L = 0;
  for (let i = 0; i + 1 < puntos.length; i++) {
    const [dx, dy] = [puntos[i + 1]![0] - puntos[i]![0], puntos[i + 1]![1] - puntos[i]![1]];
    L += Math.sqrt(dx * dx + dy * dy);
  }
  return L;
}

export function fisicoAleatorio(semilla: number, o: OpcionesFisicoAleatorio = {}): ModeloFisico {
  const r = azar(semilla);
  const entre = (a: number, b: number) => a + (b - a) * r();
  const entero = (a: number, b: number) => Math.floor(entre(a, b + 1 - 1e-12));
  const red = (x: number, paso = 0.05) => Math.round(x / paso) * paso;
  const nx = entero(2, 4);
  const ny = entero(1, 3);
  const np = entero(1, 3);
  const xs = [0];
  for (let i = 0; i < nx; i++) xs.push(red(xs[i]! + entre(4, 7)));
  const ys = [0];
  for (let j = 0; j < ny; j++) ys.push(red(ys[j]! + entre(4, 6.5)));
  // Plantas de arriba abajo: N{np}…N1 y la cimentación C (sótano)
  const plantas: Planta[] = [];
  for (let k = np; k >= 1; k--) plantas.push({ id: `N${k}`, altura: k === np ? null : red(entre(2.8, 4)), ...(o.diafragma === false ? { diafragma: "ninguno" as const } : {}) });
  plantas.push({ id: "C", tipo: "sotano", altura: red(entre(1, 3)) });
  const secciones: Seccion[] = [
    { id: "pa", material: "HA", forma: "rectangular", b: red(entre(0.25, 0.4)), h: red(entre(0.3, 0.6)) },
    { id: "pb", material: "HA", forma: "rectangular", b: red(entre(0.25, 0.4)), h: red(entre(0.25, 0.4)) },
    { id: "pc", material: "HA", forma: "circular", D: red(entre(0.3, 0.5)) },
    { id: "va", material: "HA", forma: "rectangular", b: red(entre(0.25, 0.4)), h: red(entre(0.4, 0.7)) },
    { id: "vb", material: "HA", forma: "rectangular", b: red(entre(0.25, 0.4)), h: red(entre(0.35, 0.6)) },
  ];
  const pilares: Pilar[] = [];
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const interior = i > 0 && i < nx && j > 0 && j < ny;
      // Algunos pilares interiores acaban una planta antes (la viga de encima pasa por su sitio)
      const hasta = interior && np > 1 && r() < 0.3 ? `N${np - 1}` : `N${np}`;
      const u = r();
      const giro = u < 0.5 ? 0 : u < 0.75 ? 90 : red(entre(0, 180), 1);
      const seccion = ["pa", "pb", "pc"][entero(0, 2)]!;
      pilares.push({ id: `P${i}-${j}`, x: xs[i]!, y: ys[j]!, desde: "C", hasta, seccion, giro, base: r() < 0.15 ? "articulado" : "empotrado" });
    }
  }
  const vigas: Viga[] = [];
  const rotula = (): Viga["liberaciones"] => {
    const u = r();
    const art = [false, false, false, false, true, true] as const;
    return u < 0.1 ? { inicio: art } : u < 0.2 ? { fin: art } : undefined;
  };
  for (let k = 1; k <= np; k++) {
    const p = `N${k}`;
    const linea = (id: string, a: Vec2[], continua: boolean) => {
      if (continua) vigas.push({ id, planta: p, puntos: a, seccion: r() < 0.5 ? "va" : "vb", liberaciones: rotula() });
      else for (let t = 0; t + 1 < a.length; t++) vigas.push({ id: `${id}.${t}`, planta: p, puntos: [a[t]!, a[t + 1]!], seccion: r() < 0.5 ? "va" : "vb", liberaciones: rotula() });
    };
    for (let j = 0; j <= ny; j++) linea(`X${j}-${p}`, xs.map((x) => [x, ys[j]!] as Vec2), r() < 0.5);
    for (let i = 0; i <= nx; i++) linea(`Y${i}-${p}`, ys.map((y) => [xs[i]!, y] as Vec2), r() < 0.5);
    // Secundarias en T: entre dos vigas Y, a media luz de un vano
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        if (r() < 0.35) vigas.push({ id: `S${i}-${j}-${p}`, planta: p, puntos: [[xs[i]!, red(ys[j]! + (ys[j + 1]! - ys[j]!) / 2)], [xs[i + 1]!, red(ys[j]! + (ys[j + 1]! - ys[j]!) / 2)]], seccion: "vb", liberaciones: rotula() });
      }
    }
    // Voladizo desde un pilar de la fachada x = máx
    if (r() < 0.6) {
      const j = entero(0, ny);
      vigas.push({ id: `V-${p}`, planta: p, puntos: [[xs[nx]!, ys[j]!], [xs[nx]! + red(entre(1, 2)), ys[j]!]], seccion: "vb" });
    }
  }
  const cargas: CargaFisica[] = [];
  let n = 0;
  for (const v of vigas) {
    const L = longitudPolilinea(v.puntos);
    const u = r();
    if (u < 0.4) cargas.push({ tipo: "viga", id: `q${n++}`, caso: "Q", viga: v.id, ejes: "global", q: [0, 0, -red(entre(5, 15), 0.5)] });
    else if (u < 0.6) {
      const a = red(entre(0, L / 2), 0.01);
      cargas.push({ tipo: "viga", id: `q${n++}`, caso: "Q", viga: v.id, ejes: "global", q: [0, 0, -4], qb: [0, 0, -9], desde: a, hasta: red(a + entre(0.5, L - a - 0.1), 0.01) });
    } else if (u < 0.75) cargas.push({ tipo: "viga", id: `q${n++}`, caso: "V", viga: v.id, ejes: "local", q: [0.5, 1.5, -2] });
    if (r() < 0.4) {
      const s = red(entre(0.6, L - 0.6), 0.01);
      const [x, y] = puntoEnPolilinea(v.puntos, s);
      cargas.push({ tipo: "puntual", id: `F${n++}`, caso: "Q", planta: v.planta, x: x + red(entre(-0.02, 0.02), 0.001), y, F: [0, 0, -red(entre(5, 30), 0.5)], M: r() < 0.3 ? [1, -2, 0.5] : undefined });
    }
  }
  for (const pl of pilares) {
    if (pl.x === xs[0] && r() < 0.5) cargas.push({ tipo: "pilar", id: `w${n++}`, caso: "V", pilar: pl.id, ejes: "global", q: [red(entre(0.5, 2), 0.1), 0, 0] });
    if (r() < 0.2) cargas.push({ tipo: "puntual", id: `H${n++}`, caso: "V", planta: pl.hasta, x: pl.x + 0.01, y: pl.y - 0.01, F: [3, -1, 0] });
  }
  return {
    plantas,
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones,
    pilares,
    vigas,
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }, { id: "V" }],
    cargas,
  };
}
