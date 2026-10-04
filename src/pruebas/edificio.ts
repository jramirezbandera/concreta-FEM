/**
 * Generador de edificios de prueba para el motor: rejilla de pilares (barras), losas de láminas
 * con malla alineada, vigas de borde, un muro de láminas opcional, diafragma rígido por planta,
 * «huella» de enlaces rígidos encadenada al diafragma y muelles en la base. Sirve para las
 * pruebas metamórficas, la referencia congelada y el banco de tamaño (D9, H52).
 * No es código del motor ni un compilador: sólo fabrica modelos analíticos coherentes.
 */
import type { MultiplicadoresLamina } from "../elementos/lamina.ts";
import type { CargaBarra, CargaLamina, ModeloAnalitico } from "../motor/modelo.ts";
import { carga, Constructor, seccionRectangular, seccionRectangularTimoshenko } from "./constructor.ts";

export interface OpcionesEdificio {
  /** Vanos en X y en Y. */
  vanosX: number;
  vanosY: number;
  /** Luces de los vanos, m. */
  luzX: number;
  luzY: number;
  plantas: number;
  altura: number;
  /** Tamaño de malla de la losa, m (se redondea para que cada vano tenga elementos enteros). */
  malla: number;
  espesor?: number;
  /** Diafragma rígido por planta (maestro auxiliar en el centro de la planta). */
  diafragma?: boolean;
  /** Enlaza rígidamente a la cabeza de cada pilar los nudos de losa a menos de esta distancia. */
  huella?: number;
  /** Muro de láminas en el primer vano de la fachada y = 0, en todas las plantas. */
  muro?: boolean;
  /** Muelles a tierra en vez de empotramientos en la base. */
  muelles?: boolean;
  /** Vigas de borde en el perímetro. */
  vigas?: boolean;
  /**
   * Barras de E2: pilares y vigas de Timoshenko, zona rígida de 0,3 m en la cabeza de los pilares,
   * vigas descolgadas (offset lateral de 0,175 m) con zonas rígidas en las caras de los pilares,
   * rótulas (My en j) en las vigas de la fachada norte y cargas de barra en G y Vx.
   */
  barrasE2?: boolean;
  /**
   * Láminas de E3: los vanos alternos de la losa son reticular (multiplicadores de RETICULAR y eje 1
   * de los nervios girado respecto a X) con ábacos macizos alrededor de los pilares; la gravitatoria
   * va como carga de superficie (en vez de nodal), con una tabiquería como carga de línea y una
   * puntual por planta; el viento en Y como presión sobre el muro; en Vx, una sobrecarga variable
   * por nudos; en T, una puntual con momento dentro de un elemento.
   */
  laminasE3?: boolean;
}

/** Multiplicadores de un reticular (H46, D3): flexión ~0,3, torsión, membrana y cortante reducidos. */
export const RETICULAR: MultiplicadoresLamina = { f11: 0.55, f22: 0.4, f12: 0.25, m11: 0.32, m22: 0.27, m12: 0.12, v13: 0.2, v23: 0.15 };

export interface Edificio {
  modelo: ModeloAnalitico;
  /** Nudos de losa por planta (índices). */
  losa: number[][];
  /** Nudos de pie de pilar. */
  pies: number[];
  /** Maestros de diafragma por planta (si hay diafragma). */
  maestros: number[];
}

export function edificio(o: OpcionesEdificio): Edificio {
  const E = 3e7;
  const nu = 0.2;
  const t = o.espesor ?? 0.25;
  const ex = Math.max(1, Math.round(o.luzX / o.malla));
  const ey = Math.max(1, Math.round(o.luzY / o.malla));
  const NX = o.vanosX * ex;
  const NY = o.vanosY * ey;
  const dx = o.luzX / ex;
  const dy = o.luzY / ey;
  const m = new Constructor();
  const pilar = o.barrasE2 ? seccionRectangularTimoshenko(0.3, 0.4, E, nu) : seccionRectangular(0.3, 0.4, E, nu);
  const viga = o.barrasE2 ? seccionRectangularTimoshenko(0.3, 0.6, E, nu) : seccionRectangular(0.3, 0.6, E, nu);
  const cargasBarra: CargaBarra[][] = [[], [], [], []]; // G, Vx, Vy, T
  const mat = { E, nu, t };
  const cargasLamina: CargaLamina[][] = [[], [], [], []]; // G, Vx, Vy, T

  // Base
  const pies: number[] = [];
  const pieDe = new Map<string, number>();
  for (let i = 0; i <= o.vanosX; i++) {
    for (let j = 0; j <= o.vanosY; j++) {
      const v = m.nudo(i * o.luzX, j * o.luzY, 0, `P${i}-${j}-0`);
      pies.push(v);
      pieDe.set(`${i},${j}`, v);
      if (o.muelles) m.muelle([v], [5e5, 5e5, 2e6, 1e5, 1e5, 5e4], undefined, `MZ${i}-${j}`);
      else m.apoyo(v);
    }
  }

  const losa: number[][] = [];
  const maestros: number[] = [];
  let anterior = (i: number, j: number) => pieDe.get(`${i},${j}`)!;
  // Nudos de la base del muro (si lo hay): fila y = 0 entre x = 0 y x = luzX
  let muroAnterior: number[] = [];
  if (o.muro) {
    for (let a = 0; a <= ex; a++) {
      if (a === 0) muroAnterior.push(pieDe.get("0,0")!);
      else if (a === ex) muroAnterior.push(pieDe.get("1,0")!);
      else {
        const v = m.nudo(a * dx, 0, 0, `W${a}-0`);
        m.apoyo(v);
        muroAnterior.push(v);
      }
    }
  }

  for (let k = 1; k <= o.plantas; k++) {
    const z = k * o.altura;
    const tag = (a: number, b: number) => a * (NY + 1) + b;
    const nudos: number[] = [];
    for (let a = 0; a <= NX; a++) for (let b = 0; b <= NY; b++) nudos.push(m.nudo(a * dx, b * dy, z, `S${k}-${a}-${b}`));
    losa.push(nudos);
    for (let a = 0; a < NX; a++) {
      for (let b = 0; b < NY; b++) {
        const enPilar = [a, a + 1].some((i) => i % ex === 0) && [b, b + 1].some((j) => j % ey === 0);
        const reticular = o.laminasE3 && (Math.floor(a / ex) + Math.floor(b / ey)) % 2 === 1 && !enPilar;
        const l = m.lamina(
          [nudos[tag(a, b)]!, nudos[tag(a + 1, b)]!, nudos[tag(a + 1, b + 1)]!, nudos[tag(a, b + 1)]!],
          mat,
          reticular ? { id: `L${k}-${a}-${b}`, multiplicadores: RETICULAR, eje1: [1, 0.2, 0] } : `L${k}-${a}-${b}`,
        );
        if (o.laminasE3) {
          cargasLamina[0]!.push({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, -10] });
          // sobrecarga variable en Vx, por nudos (crece con x)
          if (b === 0) cargasLamina[1]!.push({ tipo: "superficie", lamina: l, ejes: "local", q: [[0, 0, -a * dx * 0.1], [0, 0, -(a + 1) * dx * 0.1], [0, 0, -(a + 1) * dx * 0.1], [0, 0, -a * dx * 0.1]] });
          // tabiquería: carga de línea diagonal dentro del elemento (1, 1); puntual con momento en (2, 1)
          if (a === 1 && b === 1) cargasLamina[0]!.push({ tipo: "linea", lamina: l, ejes: "global", a: [1.2 * dx, 1.1 * dy, z], b: [1.9 * dx, 1.8 * dy, z], qa: [0, 0, -7], qb: [0, 0, -4] });
          if (a === 2 && b === 1) cargasLamina[3]!.push({ tipo: "puntual", lamina: l, ejes: "global", punto: [2.3 * dx, 1.6 * dy, z], F: [0, 0, -12], M: [3, -2, 1] });
        }
      }
    }
    // Pilares
    const cabezas: number[] = [];
    for (let i = 0; i <= o.vanosX; i++) {
      for (let j = 0; j <= o.vanosY; j++) {
        const cabeza = nudos[tag(i * ex, j * ey)]!;
        const c = m.barra(anterior(i, j), cabeza, pilar, [1, 0, 0], o.barrasE2 ? { id: `C${i}-${j}-${k}`, offsets: { j: [0, 0, -0.3] } } : `C${i}-${j}-${k}`);
        // viento en +X sobre los pilares de la fachada x = 0, en ejes locales (z local = X)
        if (o.barrasE2 && i === 0) cargasBarra[1]!.push({ tipo: "distribuida", barra: c, ejes: "local", qa: [0, 0, 1.2], qb: [0, 0, 2] });
        cabezas.push(cabeza);
      }
    }
    anterior = (i, j) => nudos[tag(i * ex, j * ey)]!;
    // Vigas de borde
    if (o.vigas) {
      const borde = (a0: number, b0: number, da: number, db: number, n: number, id: string) => {
        for (let s = 0; s < n; s++) {
          const [a1, b1] = [a0 + s * da, b0 + s * db];
          const [a2, b2] = [a1 + da, b1 + db];
          const ni = nudos[tag(a1, b1)]!;
          const nj = nudos[tag(a2, b2)]!;
          if (!o.barrasE2) {
            m.barra(ni, nj, viga, [0, 0, 1], `V${k}-${id}-${s}`);
            continue;
          }
          // zona rígida de 0,15 m en la cara de los pilares y descuelgue de 0,175 m
          const enPilar = (a: number, b: number) => a % ex === 0 && b % ey === 0;
          const u = [da, db];
          const ri = enPilar(a1, b1) ? 0.15 : 0;
          const rj = enPilar(a2, b2) ? 0.15 : 0;
          const b = m.barra(ni, nj, viga, [0, 0, 1], {
            id: `V${k}-${id}-${s}`,
            offsets: { i: [ri * u[0]!, ri * u[1]!, -0.175], j: [-rj * u[0]!, -rj * u[1]!, -0.175] },
            liberaciones: id === "N" && enPilar(a2, b2) ? { j: [false, false, false, false, true, false] } : undefined,
          });
          cargasBarra[0]!.push({ tipo: "distribuida", barra: b, ejes: "global", qa: [0, 0, -7] });
          if (s === 0 && id === "S") {
            // en x = 0,3 m del tramo flexible; con mallas de menos de 0,45 m no cabe y va a su centro
            const Lf = Math.hypot((a2 - a1) * dx, (b2 - b1) * dy) - ri - rj;
            cargasBarra[0]!.push({ tipo: "puntual", barra: b, ejes: "global", x: Lf >= 0.3 ? 0.3 : Lf / 2, F: [0, 0, -15], M: [0, 2, 0] });
          }
        }
      };
      borde(0, 0, 1, 0, NX, "S");
      borde(0, NY, 1, 0, NX, "N");
      borde(0, 0, 0, 1, NY, "O");
      borde(NX, 0, 0, 1, NY, "E");
    }
    // Muro: una fila de láminas por planta, en el primer vano de y = 0
    if (o.muro) {
      const arriba = Array.from({ length: ex + 1 }, (_, a) => nudos[tag(a, 0)]!);
      for (let a = 0; a < ex; a++) {
        const l = m.lamina([muroAnterior[a]!, muroAnterior[a + 1]!, arriba[a + 1]!, arriba[a]!], mat, `W${k}-${a}`);
        // viento en +Y: el muro tiene la normal −Y (ejes de CSI: 1 = +X, 2 = +Z, 3 = −Y), así que es −1,2 según el eje 3
        if (o.laminasE3) cargasLamina[2]!.push({ tipo: "superficie", lamina: l, ejes: "local", q: [0, 0, -1.2] });
      }
      muroAnterior = arriba;
    }
    // Huella: nudos de losa cercanos a cada cabeza, enlazados a ella
    const enHuella = new Set<number>();
    if (o.huella) {
      const r = o.huella;
      for (let i = 0; i <= o.vanosX; i++) {
        for (let j = 0; j <= o.vanosY; j++) {
          const a0 = i * ex;
          const b0 = j * ey;
          const esclavos: number[] = [];
          for (let a = Math.max(0, a0 - 2); a <= Math.min(NX, a0 + 2); a++) {
            for (let b = Math.max(0, b0 - 2); b <= Math.min(NY, b0 + 2); b++) {
              if (a === a0 && b === b0) continue;
              if (Math.abs(a - a0) * dx <= r + 1e-12 && Math.abs(b - b0) * dy <= r + 1e-12) esclavos.push(nudos[tag(a, b)]!);
            }
          }
          if (esclavos.length) {
            m.enlace(nudos[tag(a0, b0)]!, esclavos, `H${k}-${i}-${j}`);
            esclavos.forEach((s) => enHuella.add(s));
          }
        }
      }
    }
    if (o.diafragma) {
      const maestro = m.nudo((o.vanosX * o.luzX) / 2, (o.vanosY * o.luzY) / 2, z, `CM${k}`);
      maestros.push(maestro);
      m.diafragma(maestro, nudos.filter((v) => !enHuella.has(v)), `D${k}`);
    }
  }

  // Casos: gravitatoria por nudos de losa, viento en X y en Y, torsión y (sin muelles) un asiento
  const area = dx * dy;
  const g: ReturnType<typeof carga>[] = [];
  const vx: ReturnType<typeof carga>[] = [];
  const vy: ReturnType<typeof carga>[] = [];
  const tor: ReturnType<typeof carga>[] = [];
  losa.forEach((nudos, k) => {
    const borde = (a: number, b: number) => (a === 0 || a === NX ? 0.5 : 1) * (b === 0 || b === NY ? 0.5 : 1);
    nudos.forEach((v, idx) => {
      const a = Math.floor(idx / (NY + 1));
      const b = idx % (NY + 1);
      if (!o.laminasE3) g.push(carga(v, { fz: -10 * area * borde(a, b) }));
      if (a === 0) vx.push(carga(v, { fx: 1.5 * (k + 1) * dy * borde(1, b) }));
      if (b === 0) vy.push(carga(v, { fy: 1.5 * (k + 1) * dx * borde(a, 1) }));
      if (a === NX && b === NY) tor.push(carga(v, { fx: 20, mz: 5 }));
    });
  });
  m.caso("G", g, [], cargasBarra[0], cargasLamina[0]);
  m.caso("Vx", vx, [], cargasBarra[1], cargasLamina[1]);
  m.caso("Vy", vy, [], cargasBarra[2], cargasLamina[2]);
  m.caso("T", tor, [], cargasBarra[3], cargasLamina[3]);
  if (!o.muelles) m.caso("asiento", [], [{ nudo: pies[0]!, gdl: 2, valor: -0.005 }]);
  return { modelo: m.modelo(), losa, pies, maestros };
}
