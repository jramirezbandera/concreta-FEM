/**
 * Generador de edificios de prueba para el motor: rejilla de pilares (barras), losas de láminas
 * con malla alineada, vigas de borde, un muro de láminas opcional, diafragma rígido por planta,
 * «huella» de enlaces rígidos encadenada al diafragma y muelles en la base. Sirve para las
 * pruebas metamórficas, la referencia congelada y el banco de tamaño (D9, H52).
 * No es código del motor ni un compilador: sólo fabrica modelos analíticos coherentes.
 */
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { carga, Constructor, seccionRectangular } from "./constructor.ts";

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
}

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
  const pilar = seccionRectangular(0.3, 0.4, E, nu);
  const viga = seccionRectangular(0.3, 0.6, E, nu);
  const mat = { E, nu, t };

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
        m.lamina([nudos[tag(a, b)]!, nudos[tag(a + 1, b)]!, nudos[tag(a + 1, b + 1)]!, nudos[tag(a, b + 1)]!], mat, `L${k}-${a}-${b}`);
      }
    }
    // Pilares
    const cabezas: number[] = [];
    for (let i = 0; i <= o.vanosX; i++) {
      for (let j = 0; j <= o.vanosY; j++) {
        const cabeza = nudos[tag(i * ex, j * ey)]!;
        m.barra(anterior(i, j), cabeza, pilar, [1, 0, 0], `C${i}-${j}-${k}`);
        cabezas.push(cabeza);
      }
    }
    anterior = (i, j) => nudos[tag(i * ex, j * ey)]!;
    // Vigas de borde
    if (o.vigas) {
      const borde = (a0: number, b0: number, da: number, db: number, n: number, id: string) => {
        for (let s = 0; s < n; s++) {
          m.barra(nudos[tag(a0 + s * da, b0 + s * db)]!, nudos[tag(a0 + (s + 1) * da, b0 + (s + 1) * db)]!, viga, [0, 0, 1], `V${k}-${id}-${s}`);
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
      for (let a = 0; a < ex; a++) m.lamina([muroAnterior[a]!, muroAnterior[a + 1]!, arriba[a + 1]!, arriba[a]!], mat, `W${k}-${a}`);
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
      g.push(carga(v, { fz: -10 * area * borde(a, b) }));
      if (a === 0) vx.push(carga(v, { fx: 1.5 * (k + 1) * dy * borde(1, b) }));
      if (b === 0) vy.push(carga(v, { fy: 1.5 * (k + 1) * dx * borde(a, 1) }));
      if (a === NX && b === NY) tor.push(carga(v, { fx: 20, mz: 5 }));
    });
  });
  m.caso("G", g);
  m.caso("Vx", vx);
  m.caso("Vy", vy);
  m.caso("T", tor);
  if (!o.muelles) m.caso("asiento", [], [{ nudo: pies[0]!, gdl: 2, valor: -0.005 }]);
  return { modelo: m.modelo(), losa, pies, maestros };
}
