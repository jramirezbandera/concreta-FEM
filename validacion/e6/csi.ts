/**
 * Ejemplos de verificación de barras de CSI (H48) con el motor: SAP2000 1-004, 1-018, 1-022 y 1-024.
 *
 * Fuentes (PDF públicos, leídos el 2026-10-04; en la carpeta Verification/Analysis/Frames de
 * https://docs.csiamerica.com/manuals/sap2000/):
 * - 1-004 «Frame – Rotated local axes», rev. 0, pp. 1–5: voladizo W12X106 con el eje 2 girado 30°
 *   respecto a Z; flecha de la punta en Y y Z con tres cargas. Solución cerrada (Roark).
 * - 1-018 «Frame – Bending, shear and axial deformations in a rigid frame», rev. 0, pp. 1–4: pórtico
 *   de un vano con articulación y deslizadera, 0,1 k/in en el dintel; flecha del centro con
 *   flexión, cortante y axil (modelos A–D, con modificadores). Solución cerrada (carga unidad).
 * - 1-022 «Frame – Two-dimensional moment frame with static and dynamic loads», rev. 0, pp. 1–7:
 *   pórtico plano de 7 plantas con diafragma por planta; caso estático LAT, 7 periodos y espectro.
 * - 1-024 «Frame – Response spectrum analysis of a three-dimensional moment frame», rev. 0,
 *   pp. 1–3: pórtico 3D de 2 plantas con diafragma rígido y masa excéntrica; 4 periodos y la
 *   flecha en X por espectro constante de 0,4g con CQC, SRSS, ABS y NRC 10 %.
 *
 * Los modelos van en kN y m (D1): los datos de CSI (kip, in, ft) se convierten aquí y los
 * resultados se devuelven en las unidades del PDF para compararlos con su redondeo.
 *
 * Los periodos y el espectro no necesitan análisis modal (E7): las masas sólo están en GDL de los
 * diafragmas, y la rigidez condensada a esos GDL, que sale de soluciones estáticas, es exacta
 * (`src/pruebas/modal.ts`).
 */
import type { SeccionBarra } from "../../src/elementos/barra.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { Apoyo, ModeloAnalitico, ResultadoCaso, Vec3 } from "../../src/motor/modelo.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { carga, Constructor, EMPOTRADO } from "../../src/pruebas/constructor.ts";
import { combinar, flexibilidad, inversa, modos, participacion, type GdlMasa } from "../../src/pruebas/modal.ts";

// Unidades de CSI → kN, m
export const IN = 0.0254;
export const FT = 0.3048;
export const KIP = 4.4482216152605;
/**
 * g de los ejemplos de espectro, en m/s²: 386,4 in/s² = 32,2 ft/s², la de CSI en unidades inglesas.
 * Los PDF no la dan; con la estándar (9,80665) todas las respuestas espectrales salen un 0,08 % bajas.
 */
export const G_CSI = 386.4 * IN;
const KSI = KIP / IN ** 2;
const KSF = KIP / FT ** 2;

/** Valor publicado con su número de decimales: el motor tiene que caer dentro de su redondeo. */
export interface Publicado {
  nombre: string;
  /** Valor del PDF, en sus unidades. */
  valor: number;
  decimales: number;
  /** Valor del motor en las mismas unidades. */
  motor: number;
  /** Solución cerrada, si la hay (para el error a 1e-10). */
  cerrada?: number;
  /** Tolerancia relativa si es mayor que el redondeo (sólo en el espectro: ver `resultados1022`). */
  tolRel?: number;
  fuente: string;
}

/** ¿Cae el motor dentro del redondeo del valor publicado (o de su tolerancia relativa)? */
export function dentroDelRedondeo(p: Publicado): boolean {
  const tol = Math.max(0.5 * 10 ** -p.decimales, (p.tolRel ?? 0) * Math.abs(p.valor));
  return Math.abs(p.motor - p.valor) <= tol * (1 + 1e-9);
}

/** Sólo los GDL del plano X-Z (ux, uz, ry): uy, rx y rz coartados, como un pórtico plano de SAP2000. */
const PLANO_XZ: Apoyo["coartados"] = [false, true, false, true, false, true];

// ---------------------------------------------------------------------------------------- 1-004

/**
 * 1-004: voladizo de 144 in con el eje 2 (el canto) girado 30° respecto a Z, hacia −Y (sección
 * C-C, vista según +X). I33 = 933 in⁴ (flexión alrededor del eje 3, es decir, Iy aquí) e I22 = 301 in⁴;
 * sin deformación por cortante. A y J (31,2 in² y 9,13 in⁴, tablas de AISC) no intervienen.
 *
 * La carga 3 es un momento de 240 k·in «about global Z axis» según el texto, pero la figura lo
 * dibuja en el alzado X-Z y los valores publicados (y la mano) corresponden a +240 k·in alrededor
 * de +Y: con Z, la flecha sería otra. Se modela alrededor de +Y.
 */
export function sap1004(): { modelo: ModeloAnalitico; resultados: Publicado[] } {
  const L = 144 * IN;
  const E = 29000 * KSI;
  const I33 = 933 * IN ** 4;
  const I22 = 301 * IN ** 4;
  const s: SeccionBarra = { E, G: E / 2.6, A: 31.2 * IN ** 2, Iy: I33, Iz: I22, J: 9.13 * IN ** 4 };
  const th = (30 * Math.PI) / 180;
  const e2: Vec3 = [0, -Math.sin(th), Math.cos(th)];
  const e3: Vec3 = [0, -Math.cos(th), -Math.sin(th)];
  const m = new Constructor();
  const a = m.nudo(0, 0, 0);
  const b = m.nudo(L, 0, 0);
  const barra = m.barra(a, b, s, e2);
  m.apoyo(a);
  const w = 0.01 * (KIP / IN);
  const P = 1 * KIP;
  const M = 240 * KIP * IN;
  m.caso("1", [], [], [{ tipo: "distribuida", barra, ejes: "global", qa: [0, 0, -w] }]);
  m.caso("2", [carga(b, { fz: -P })]);
  m.caso("3", [carga(b, { my: M })]);
  const modelo = m.modelo();
  const r = casosValidos(calcular(modelo));

  // Solución cerrada en ejes principales (Roark, tabla 3, 1a y 2a): una fuerza F o un par m en la
  // punta y una carga uniforme q dan, por cada eje principal eᵢ de la sección, flechas
  // (F·eᵢ)·L³/(3EI), (q·eᵢ)·L⁴/(8EI) y, el par, el giro κ·L con κ = Σ (m·eᵢ)/(E·Iᵢ)·eᵢ y la flecha
  // (L²/2)·κ × x. La fuerza según e2 flecta alrededor de e3 (I33) y la según e3, alrededor de e2 (I22).
  const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const fuerza = (F: Vec3, k: number) =>
    [0, 1, 2].map((c) => k * ((dot(F, e2) / I33) * e2[c]! + (dot(F, e3) / I22) * e3[c]!)) as unknown as Vec3;
  const lc1 = fuerza([0, 0, -w], L ** 4 / (8 * E));
  const lc2 = fuerza([0, 0, -P], L ** 3 / (3 * E));
  const mv: Vec3 = [0, M, 0];
  const kappa = [0, 1, 2].map((c) => (dot(mv, e2) / (E * I22)) * e2[c]! + (dot(mv, e3) / (E * I33)) * e3[c]!);
  const lc3: Vec3 = [0, (L ** 2 / 2) * kappa[2]!, (-(L ** 2) / 2) * kappa[1]!]; // κ × x̂ = (0, κz, −κy)
  const fuente = "SAP2000 1-004, p. 2";
  const uy = (c: ResultadoCaso) => c.u[6 * b + 1]! / IN;
  const uz = (c: ResultadoCaso) => c.u[6 * b + 2]! / IN;
  return {
    modelo,
    resultados: [
      { nombre: "1-004 caso 1: Uy punta (in)", valor: -0.01806, decimales: 5, motor: uy(r[0]!), cerrada: lc1[1] / IN, fuente },
      { nombre: "1-004 caso 1: Uz punta (in)", valor: -0.03029, decimales: 5, motor: uz(r[0]!), cerrada: lc1[2] / IN, fuente },
      { nombre: "1-004 caso 2: Uy punta (in)", valor: -0.03345, decimales: 5, motor: uy(r[1]!), cerrada: lc2[1] / IN, fuente },
      { nombre: "1-004 caso 2: Uz punta (in)", valor: -0.0561, decimales: 5, motor: uz(r[1]!), cerrada: lc2[2] / IN, fuente },
      { nombre: "1-004 caso 3: Uy punta (in)", valor: -0.08361, decimales: 5, motor: uy(r[2]!), cerrada: lc3[1] / IN, fuente },
      { nombre: "1-004 caso 3: Uz punta (in)", valor: -0.14024, decimales: 5, motor: uz(r[2]!), cerrada: lc3[2] / IN, fuente },
    ],
  };
}

// ---------------------------------------------------------------------------------------- 1-018

/**
 * 1-018: pórtico de 288 × 144 in con articulación en 1 y deslizadera en 3, W8X31 (A = 9,12 in²,
 * I = 110 in⁴, Av = 2,28 in², E = 29 900 ksi, G = 11 500 ksi) y 0,1 k/in en el dintel. Flecha en el
 * centro del dintel (nudo 5) con modificadores: B sin cortante y axil ×1e4; C con I ×1e7 y axil
 * ×1e4; D con I ×1e7 y sin cortante. En SAP2000 «sin cortante» es el modificador 0 del área de
 * cortante; aquí, la sección sin Avz (el motor no admite modificadores nulos).
 *
 * SAP2000 usa axil ×1e5 (p. 1). Con el modelo B, esa penalización pierde 8,2 cifras en el GDL ux de
 * la deslizadera y el equilibrio queda en 1,1e-9 con el núcleo: el motor lo rechaza (regla de oro 2,
 * E6-1). Con ×1e4 el axil sigue sin asomar en las 5 cifras publicadas (7,6e-7 in).
 * Fuera del plano (Iz = 37,1 in⁴ y J = 0,536 in⁴ de AISC) no interviene: uy, rx y rz coartados.
 */
export function sap1018(): { resultados: Publicado[] } {
  const E = 29900 * KSI;
  const G = 11500 * KSI;
  const A = 9.12 * IN ** 2;
  const I = 110 * IN ** 4;
  const Av = 2.28 * IN ** 2;
  const L = 144 * IN;
  const w = 0.1 * (KIP / IN);
  const conCortante: SeccionBarra = { E, G, A, Iy: I, Iz: 37.1 * IN ** 4, J: 0.536 * IN ** 4, Avz: Av };
  const { Avz: _, ...sinCortante } = conCortante;
  const variantes = [
    { id: "A", s: conCortante, mod: {}, valor: -2.77076 },
    { id: "B", s: sinCortante, mod: { A: 1e4 }, valor: -2.72361 },
    { id: "C", s: conCortante, mod: { A: 1e4, Iy: 1e7 }, valor: -0.03954 },
    { id: "D", s: sinCortante, mod: { Iy: 1e7 }, valor: -0.0076 },
  ];
  return {
    resultados: variantes.map(({ id, s, mod, valor }) => {
      const m = new Constructor();
      const n1 = m.nudo(0, 0, 0);
      const n2 = m.nudo(0, 0, L);
      const n3 = m.nudo(2 * L, 0, 0);
      const n4 = m.nudo(2 * L, 0, L);
      const n5 = m.nudo(L, 0, L);
      const extra = { modificadores: mod };
      m.barra(n1, n2, s, [1, 0, 0], extra);
      m.barra(n3, n4, s, [1, 0, 0], extra);
      const d1 = m.barra(n2, n5, s, [0, 0, 1], extra);
      const d2 = m.barra(n5, n4, s, [0, 0, 1], extra);
      m.apoyo(n1, [true, true, true, true, false, true]);
      m.apoyo(n3, [false, true, true, true, false, true]);
      for (const v of [n2, n4, n5]) m.apoyo(v, PLANO_XZ);
      m.caso("G", [], [], [d1, d2].map((barra) => ({ tipo: "distribuida", barra, ejes: "global", qa: [0, 0, -w] }) as const));
      const [c] = casosValidos(calcular(m.modelo()));
      // Carga unidad (Cook & Young; mano de la p. 4): Δ = 2·(wL)·(1/2)·L/(EA) + ∫V·v/(GAv) + 5w(2L)⁴/(384EI)
      const EA = E * A * (mod.A ?? 1);
      const EI = E * I * (mod.Iy ?? 1);
      const ax = (w * L * L) / EA;
      const co = s.Avz ? ((w * L * L) / 2 / G) * (1 / Av) : 0;
      const fl = (5 * w * (2 * L) ** 4) / (384 * EI);
      return {
        nombre: `1-018 modelo ${id}: Uz nudo 5 (in)`,
        valor,
        decimales: 5,
        motor: c!.u[6 * n5 + 2]! / IN,
        cerrada: -(ax + co + fl) / IN,
        fuente: "SAP2000 1-018, p. 2",
      };
    }),
  };
}

// ---------------------------------------------------------------------------------------- 1-022

const W: Record<string, { A: number; I: number }> = {
  W14X176: { A: 51.7, I: 2150 },
  W14X211: { A: 62.1, I: 2670 },
  W14X246: { A: 72.3, I: 3230 },
  W14X287: { A: 84.4, I: 3910 },
  // 2,5 in² en el PDF (p. 3), sin duda por 32,5: no influye, el diafragma impide el axil de las vigas
  W24X110: { A: 2.5, I: 3330 },
  W24X130: { A: 38.3, I: 4020 },
  W24X160: { A: 47.1, I: 5120 },
};

/**
 * 1-022 (ETABS ej. 7): pórtico plano de 2 vanos de 30 ft y 7 plantas (13'6" las dos primeras y
 * 13' las demás), E = 29 500 ksi, sin cortante. Diafragma en cada planta (maestro: el nudo central,
 * que lleva la masa de 0,49 k·s²/in en X). Fuera del plano, el pórtico se coarta (uy, rx y rz).
 *
 * La numeración sigue la figura de la p. 3: nudos 1–3 en la base y 3·k+1…3·k+3 en el nivel k+1;
 * pilares 1–7 (izquierda), 8–14 (centro) y 15–21 (derecha) de abajo arriba; vigas 22–28 y 29–35.
 */
export function sap1022(): { modelo: ModeloAnalitico; nudo: (n: number) => number; barra: (n: number) => number; masas: GdlMasa[] } {
  const E = 29500 * KSI;
  const sec = (nombre: string): SeccionBarra => {
    const { A, I } = W[nombre]!;
    // Fuera del plano no interviene: Iz y J positivos cualesquiera
    return { E, G: E / 2.6, A: A * IN ** 2, Iy: I * IN ** 4, Iz: (I / 3) * IN ** 4, J: 10 * IN ** 4 };
  };
  const alturas = [162, 162, 156, 156, 156, 156, 156].map((h) => h * IN);
  const xs = [0, 360, 720].map((x) => x * IN);
  const extremos = ["W14X246", "W14X246", "W14X246", "W14X211", "W14X211", "W14X176", "W14X176"];
  const centro = ["W14X287", "W14X287", "W14X287", "W14X246", "W14X246", "W14X211", "W14X211"];
  const vigas = ["W24X160", "W24X160", "W24X130", "W24X130", "W24X110", "W24X110", "W24X110"];
  const m = new Constructor();
  const nudos: number[] = [];
  let z = 0;
  for (let k = 0; k <= 7; k++) {
    if (k > 0) z += alturas[k - 1]!;
    for (const x of xs) nudos.push(m.nudo(x, 0, z, `${nudos.length + 1}`));
  }
  const barras: number[] = [];
  for (const [col, secs] of [[0, extremos], [1, centro], [2, extremos]] as const) {
    for (let k = 0; k < 7; k++) barras.push(m.barra(nudos[3 * k + col]!, nudos[3 * (k + 1) + col]!, sec(secs[k]!), [1, 0, 0], `${barras.length + 1}`));
  }
  for (const vano of [0, 1]) {
    for (let k = 1; k <= 7; k++) barras.push(m.barra(nudos[3 * k + vano]!, nudos[3 * k + vano + 1]!, sec(vigas[k - 1]!), [0, 0, 1], `${barras.length + 1}`));
  }
  for (let c = 0; c < 3; c++) m.apoyo(nudos[c]!, EMPOTRADO);
  const masas: GdlMasa[] = [];
  for (let k = 1; k <= 7; k++) {
    const [izq, cen, der] = [nudos[3 * k]!, nudos[3 * k + 1]!, nudos[3 * k + 2]!];
    m.diafragma(cen, [izq, der], `D${k}`);
    m.apoyo(cen, PLANO_XZ);
    for (const v of [izq, der]) m.apoyo(v, [false, false, false, true, false, false]);
    masas.push({ nudo: cen, gdl: 0 });
  }
  // Caso LAT: cargas en los nudos de la izquierda (p. 3)
  const lat = [2.5, 5, 7.5, 10, 12.5, 15, 20];
  m.caso("LAT", lat.map((f, k) => carga(nudos[3 * (k + 1)]!, { fx: f * KIP })));
  return { modelo: m.modelo(), nudo: (n) => nudos[n - 1]!, barra: (n) => barras[n - 1]!, masas };
}

/** Espectro de la p. 4 (El Centro N-S, 5 %), interpolado linealmente en el periodo (como SAP2000). */
const ESPECTRO_1022: readonly (readonly [number, number])[] = [
  [0.0769, 0.505311], [0.0795, 0.519598], [0.08, 0.520045], [0.0833, 0.518093], [0.087, 0.493366], [0.0909, 0.477599],
  [0.0951, 0.527825], [0.0952, 0.530631], [0.1, 0.581609], [0.1053, 0.564412], [0.1111, 0.523663], [0.1176, 0.572438],
  [0.119, 0.588211], [0.125, 0.627807], [0.1333, 0.665413], [0.1429, 0.636531], [0.1538, 0.905796], [0.1602, 0.804605],
  [0.1667, 0.78722], [0.1818, 0.943909], [0.2, 1.00562], [0.2222, 0.746135], [0.242, 0.704753], [0.25, 0.798052],
  [0.2857, 0.718264], [0.3333, 0.880624], [0.4, 0.882996], [0.4313, 0.921167], [0.5, 1.04662], [0.6667, 0.64175],
  [1, 0.482251], [1.273, 0.258617], [2, 0.160189],
];

function espectro1022(T: number): number {
  const e = ESPECTRO_1022;
  if (T <= e[0]![0]) return e[0]![1];
  for (let i = 1; i < e.length; i++) {
    const [t1, a1] = e[i]!;
    const [t0, a0] = e[i - 1]!;
    if (T <= t1) return a0 + ((a1 - a0) * (T - t0)) / (t1 - t0);
  }
  return e[e.length - 1]![1];
}

export function resultados1022(): Publicado[] {
  const { modelo, nudo, barra, masas } = sap1022();
  const fuente = "SAP2000 1-022, p. 6";
  const [lat] = casosValidos(calcular(modelo));
  const b1 = barra(1);
  // Esfuerzos del pilar 1 en el nudo 1 (i' = x = 0): N y My (= P y M3 de SAP2000, cabecera de modelo.ts)
  const N1 = lat!.esfuerzosBarras[12 * b1]! / KIP;
  const M1 = lat!.esfuerzosBarras[12 * b1 + 4]! / (KIP * IN);
  // Periodos: rigidez condensada a las 7 masas (0,49 k·s²/in en X)
  const mi = (0.49 * KIP) / IN;
  const F = flexibilidad(modelo, masas);
  const md = modos(inversa(F), masas.map(() => mi));
  const periodos = [1.2732, 0.4313, 0.242, 0.1602, 0.119, 0.0951, 0.0795];
  // Espectro (5 %): por modo, fuerzas estáticas equivalentes M·φₙ·Γₙ·Sa(Tₙ), un caso por modo
  const gamma = participacion(md, masas.map(() => mi), masas.map(() => 1));
  const casos = md.modos.map((phi, n) => ({
    id: `modo${n + 1}`,
    nodales: masas.map((g, i) => carga(g.nudo, { fx: mi * phi[i]! * gamma[n]! * espectro1022(md.periodos[n]!) * G_CSI })),
  }));
  const rm = casosValidos(calcular({ ...modelo, casos }));
  const omega = md.omega2.map(Math.sqrt);
  const ux = combinar(rm.map((c) => c.u[6 * nudo(22)]! / IN), omega, 0.05);
  const N = combinar(rm.map((c) => c.esfuerzosBarras[12 * b1]! / KIP), omega, 0.05);
  const M = combinar(rm.map((c) => c.esfuerzosBarras[12 * b1 + 4]! / (KIP * IN)), omega, 0.05);
  // El modo 1 (T₁ = 1,2732 s) cae justo después del punto 1,2730 de la tabla del espectro, y SAP2000
  // no documenta cómo interpola ahí: en el espectro se admite el redondeo o un 0,02 % (el Ux SRSS
  // queda a 0,013 %, 1,4 unidades de su última cifra; los otros cinco, dentro del redondeo).
  const fuenteEsp = { fuente: "SAP2000 1-022, p. 7", tolRel: 2e-4 };
  return [
    { nombre: "1-022 LAT: Ux nudo 22 (in)", valor: 1.45076, decimales: 5, motor: lat!.u[6 * nudo(22)]! / IN, fuente },
    { nombre: "1-022 LAT: axil pilar 1 (kip)", valor: 69.99, decimales: 2, motor: N1, fuente },
    { nombre: "1-022 LAT: momento pilar 1 en el nudo 1 (k·in)", valor: 2324.68, decimales: 2, motor: M1, fuente },
    ...periodos.map((T, n) => ({ nombre: `1-022 periodo del modo ${n + 1} (s)`, valor: T, decimales: 4, motor: md.periodos[n]!, fuente })),
    { nombre: "1-022 SRSS: Ux nudo 22 (in)", valor: 5.436, decimales: 3, motor: ux.srss, ...fuenteEsp },
    { nombre: "1-022 SRSS: axil pilar 1 (kip)", valor: 261.7, decimales: 1, motor: N.srss, ...fuenteEsp },
    { nombre: "1-022 SRSS: momento pilar 1 (k·in)", valor: 9864, decimales: 0, motor: M.srss, ...fuenteEsp },
    { nombre: "1-022 CQC: Ux nudo 22 (in)", valor: 5.431, decimales: 3, motor: ux.cqc, ...fuenteEsp },
    { nombre: "1-022 CQC: axil pilar 1 (kip)", valor: 261.5, decimales: 1, motor: N.cqc, ...fuenteEsp },
    { nombre: "1-022 CQC: momento pilar 1 (k·in)", valor: 9916, decimales: 0, motor: M.cqc, ...fuenteEsp },
  ];
}

// ---------------------------------------------------------------------------------------- 1-024

/**
 * 1-024: pórtico 3D de 2 × 2 vanos (35 ft en X, 25 ft en Y) y 2 plantas de 13 ft, empotrado.
 * Pilares E = 350 000 k/ft², A = 4 ft², I33 = I22 = 1,25 ft⁴; vigas E = 500 000 k/ft², A = 5 ft²,
 * I33 = 2,61 ft⁴ (vertical) e I22 = 1,67 ft⁴. Sin cortante. Diafragma rígido por planta con el
 * maestro en el centro de masas (38, 27) ft, que lleva 6,2112 k·s²/ft en X y en Y.
 *
 * El PDF no da J ni G, que influyen en la rigidez a torsión de la planta: `J` es la constante de
 * torsión de pilares y vigas (ft⁴), con G = E/2,4 (ν = 0,2). Por defecto, casi nula (1e-6 ft⁴).
 */
export function sap1024(J = 1e-6): { modelo: ModeloAnalitico; masas: GdlMasa[] } {
  const Ec = 350000 * KSF;
  const Eb = 500000 * KSF;
  const ft4 = FT ** 4;
  const pilar: SeccionBarra = { E: Ec, G: Ec / 2.4, A: 4 * FT ** 2, Iy: 1.25 * ft4, Iz: 1.25 * ft4, J: J * ft4 };
  const viga: SeccionBarra = { E: Eb, G: Eb / 2.4, A: 5 * FT ** 2, Iy: 2.61 * ft4, Iz: 1.67 * ft4, J: J * ft4 };
  const m = new Constructor();
  const xs = [0, 35, 70].map((x) => x * FT);
  const ys = [0, 25, 50].map((y) => y * FT);
  const niveles: number[][] = [];
  for (let k = 0; k <= 2; k++) {
    const nivel: number[] = [];
    for (const y of ys) for (const x of xs) nivel.push(m.nudo(x, y, 13 * k * FT));
    niveles.push(nivel);
  }
  for (const v of niveles[0]!) m.apoyo(v, EMPOTRADO);
  const masas: GdlMasa[] = [];
  for (let k = 1; k <= 2; k++) {
    const nivel = niveles[k]!;
    nivel.forEach((v, i) => m.barra(niveles[k - 1]![i]!, v, pilar, [1, 0, 0]));
    for (let fila = 0; fila < 3; fila++) for (let c = 0; c < 2; c++) m.barra(nivel[3 * fila + c]!, nivel[3 * fila + c + 1]!, viga, [0, 0, 1]);
    for (let c = 0; c < 3; c++) for (let fila = 0; fila < 2; fila++) m.barra(nivel[3 * fila + c]!, nivel[3 * (fila + 1) + c]!, viga, [0, 0, 1]);
    const cm = m.nudo(38 * FT, 27 * FT, 13 * k * FT, `CM${k}`);
    m.diafragma(cm, nivel, `D${k}`);
    masas.push({ nudo: cm, gdl: 0 }, { nudo: cm, gdl: 1 });
  }
  m.caso("vacio");
  return { modelo: m.modelo(), masas };
}

export function resultados1024(J?: number): Publicado[] {
  const { modelo, masas } = sap1024(J);
  const mi = 6.2112 * (KIP / FT);
  const mm = masas.map(() => mi);
  const md = modos(inversa(flexibilidad(modelo, masas)), mm);
  const r = masas.map((g) => (g.gdl === 0 ? 1 : 0));
  const gamma = participacion(md, mm, r);
  // Espectro constante de 0,4g en X; flecha en X del CM de la cubierta (nudo 29: masa 2, componente X)
  const sa = 0.4 * G_CSI;
  const R = md.modos.map((phi, n) => (phi[2]! * gamma[n]! * sa) / md.omega2[n]! / FT);
  const c = combinar(R, md.omega2.map(Math.sqrt), 0.04);
  const fuente = "SAP2000 1-024, p. 3";
  return [
    ...[0.2271, 0.2156, 0.0733, 0.072].map((T, n) => ({ nombre: `1-024 periodo del modo ${n + 1} (s)`, valor: T, decimales: 4, motor: md.periodos[n]!, fuente })),
    { nombre: "1-024 CQC: Ux nudo 29 (ft)", valor: 0.02014, decimales: 5, motor: c.cqc, fuente },
    { nombre: "1-024 SRSS: Ux nudo 29 (ft)", valor: 0.02012, decimales: 5, motor: c.srss, fuente },
    { nombre: "1-024 ABS: Ux nudo 29 (ft)", valor: 0.0205, decimales: 5, motor: c.abs, fuente },
    { nombre: "1-024 NRC 10 %: Ux nudo 29 (ft)", valor: 0.02016, decimales: 5, motor: c.nrc10, fuente },
  ];
}

/** Todos los valores publicados de los cuatro ejemplos. */
export function todosCsi(): Publicado[] {
  return [...sap1004().resultados, ...sap1018().resultados, ...resultados1022(), ...resultados1024()];
}
