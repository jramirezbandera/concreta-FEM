/**
 * Fase SO (segundo orden, `docs/fem3d/segundo-orden.md`): lo medido antes de empezar. Con el cálculo de
 * primer orden de hoy, cuánto valdría el coeficiente de estabilidad global de cada hipótesis horizontal
 * (el γz de CYPECAD: 1 / (1 − Σ P·δ / Σ H·z)) en el ejemplo 11 del usuario (3 plantas) y en el edificio
 * objetivo de 7 plantas con losas, con la rigidez bruta y con los desplazamientos multiplicados por 2 y
 * por 3 (la rigidez nominal del CE, 0,4·Ecd·Ic, es un tercio de la bruta), y para la carga gravitatoria
 * casi permanente (la masa del modal: G + ψ·Q) y ×1,4 (≈ 1,35·G + 1,5·Q). Al lado, la θ máxima de planta
 * (NCSE-02 3.8, EC8) y el αcr equivalente (1 / (m·C)).
 *
 * Las cargas gravitatorias por planta son aquí la masa del análisis modal por g (no van por caso); la
 * fase las toma de las fuerzas nodales equivalentes de cada caso. Es una medida de orden de magnitud.
 *
 *   bun validacion/so/medir.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { modos, sismo } from "../../src/agente/consultas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { AccionCaso, ModeloFisico, SismoEdificio } from "../../src/compilador/fisico.ts";
import { sha256 } from "../../src/compilador/huella.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { Sesion } from "../../src/visor/sesion.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";

const AQUI = import.meta.dirname;
const RAIZ = join(AQUI, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);

const out: string[] = [];
const log = (l = "") => {
  out.push(l);
  console.log(l);
};
const f2 = (v: number) => v.toFixed(2);
const f3 = (v: number) => v.toFixed(3);
const f1 = (v: number) => v.toFixed(1);

/** Lo que mide una hipótesis horizontal: los momentos de vuelco y de P·δ, el coeficiente y la θ máxima. */
interface Medida {
  id: string;
  MH: number;
  MPd: number;
  C: number;
  thetaMax: number;
  plantas: { planta: string; z: number; P: number; H: number; V: number; d: number; theta: number }[];
}

const MULTIPLICADORES = [1, 2, 3];
const GAMMAS = [1, 1.4];

function informar(nombre: string, medidas: Medida[]): void {
  log(`## ${nombre}`);
  log();
  log("Por hipótesis: M_H = Σ H·z (kN·m), M_Pδ = Σ P·δ (kN·m) con la rigidez bruta, C = M_Pδ / M_H, θ máxima de planta y γz = 1 / (1 − γg·m·C) con m el multiplicador de los desplazamientos y γg el de la carga gravitatoria.");
  log();
  const cab = ["hipótesis", "M_H", "M_Pδ", "C", "αcr (m=1)", "αcr (m=3)", "θ máx (m=1)", "θ máx (m=3)", ...MULTIPLICADORES.flatMap((m) => GAMMAS.map((g) => `γz m=${m} γg=${g}`))];
  log(`| ${cab.join(" | ")} |`);
  log(`|${cab.map(() => "---").join("|")}|`);
  for (const x of medidas) {
    const gz = MULTIPLICADORES.flatMap((m) => GAMMAS.map((g) => (g * m * x.C < 1 ? f3(1 / (1 - g * m * x.C)) : "∞")));
    log(`| ${x.id} | ${f1(x.MH)} | ${f1(x.MPd)} | ${x.C.toFixed(4)} | ${f1(1 / x.C)} | ${f1(1 / (3 * x.C))} | ${f3(x.thetaMax)} | ${f3(3 * x.thetaMax)} | ${gz.join(" | ")} |`);
  }
  log();
  for (const x of medidas.filter((_, i) => i === 0 || medidas[i - 1]!.id.slice(0, 3) !== medidas[i]!.id.slice(0, 3))) {
    log(`Plantas de ${x.id} (de arriba abajo): P acumulada (kN), H de la planta (kN), V bajo la planta (kN), δ del maestro (mm) y θ = P·Δ/(V·h):`);
    for (const p of x.plantas) log(`  ${p.planta}: z = ${f2(p.z)} m, P = ${f1(p.P)}, H = ${f1(p.H)}, V = ${f1(p.V)}, δ = ${f2(1000 * p.d)}, θ = ${f3(p.theta)}`);
    log();
  }
}

/** Las medidas de un cálculo: el viento del programa (casos W…) y el sismo del programa (EX, EY). */
function medir(q: Consultas): Medida[] {
  const g = 9.80665;
  const md = modos(q, { todos: true });
  if (!md.valido) throw new Error(md.diagnosticos.map((d) => d.mensaje).join(" "));
  // La masa por planta (G + ψ·Q), de arriba abajo, y la cota de cada planta
  const plantas = q.fisico.plantas.map((p) => p.id);
  const planta = (id: string) => {
    const r = q.planta(id);
    if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join(" "));
    return r.valor;
  };
  const cota = new Map(plantas.map((id) => [id, planta(id).cota]));
  const masa = new Map(md.valor.plantas.map((p) => [p.planta, p.masa]));
  const z0 = cota.get(plantas[plantas.length - 1]!)!;
  const medidas: Medida[] = [];
  // El viento: cada caso W con sus puntuales por planta y el desplazamiento del maestro en su dirección
  q.fisico.casos.forEach((c, j) => {
    if (c.accion?.tipo !== "W") return;
    const eje = c.accion.direccion === "Y" ? 1 : 0;
    const H = new Map<string, number>();
    for (const carga of q.fisico.cargas ?? []) if (carga.tipo === "puntual" && carga.caso === c.id && carga.F) H.set(carga.planta, (H.get(carga.planta) ?? 0) + carga.F[eje]);
    if (!H.size) return;
    const signo = Math.sign([...H.values()].reduce((s, v) => s + v, 0)) || 1;
    let MH = 0;
    let MPd = 0;
    let P = 0;
    let V = 0;
    const filas: Medida["plantas"] = [];
    const conMasa = plantas.filter((id) => (masa.get(id) ?? 0) > 0 || H.has(id));
    conMasa.forEach((id, i) => {
      const z = cota.get(id)!;
      const u = planta(id).maestro?.u;
      const d = u ? signo * u[3 * j + eje]! : 0;
      const Pi = (masa.get(id) ?? 0) * g;
      const Hi = signo * (H.get(id) ?? 0);
      MH += Hi * (z - z0);
      MPd += Pi * d;
      P += Pi;
      V += Hi;
      const abajo = conMasa[i + 1];
      const zAbajo = abajo ? cota.get(abajo)! : z0;
      const uAbajo = abajo ? planta(abajo).maestro?.u : null;
      const dAbajo = uAbajo ? signo * uAbajo[3 * j + eje]! : 0;
      const h = z - zAbajo;
      filas.push({ planta: id, z, P, H: Hi, V, d, theta: V > 0 && h > 0 ? (P * (d - dAbajo)) / (V * h) : 0 });
    });
    medidas.push({ id: c.id, MH, MPd, C: MPd / MH, thetaMax: Math.max(0, ...filas.map((f) => f.theta)), plantas: filas });
  });
  // El sismo: los niveles de la respuesta espectral (desplazamientos por μ, cortantes combinados)
  const s = sismo(q, { todos: true });
  if (s.valido) {
    for (const d of s.valor.direcciones) {
      let MH = 0;
      let MPd = 0;
      let P = 0;
      const filas: Medida["plantas"] = [];
      for (const n of d.plantas) {
        MH += n.cortante * n.altura;
        MPd += n.masa * g * n.desplazamiento;
        P += n.masa * g;
        filas.push({ planta: n.plantas.join("/"), z: n.cota, P, H: n.fuerza, V: n.cortante, d: n.desplazamiento, theta: n.theta });
      }
      medidas.push({ id: `E${d.eje} (μ = ${d.mu})`, MH, MPd, C: MPd / MH, thetaMax: d.thetaMaxima, plantas: filas });
    }
  }
  return medidas;
}

log("# Segundo orden: el coeficiente de estabilidad global con el cálculo de primer orden de hoy");
log();
log("Umbrales de referencia: αcr ≥ 10 (CE Anejo 22 §5.2.1, primer orden basta; con 3 ≤ αcr < 10, esfuerzos amplificados); θ ≤ 0,10 (NCSE-02 3.8 y EC8 4.4.2.2; con θ ≤ 0,2, amplificar por 1/(1−θ)); γz ≤ 1,10 (NBR 6118: estructura de nudos fijos). La rigidez nominal del hormigón fisurado del CE (0,4·Ecd·Ic, Ecd = Ecm/1,2) multiplica los desplazamientos por 3 frente a la bruta; sin fisurar (0,8·Ecd·Ic), por 1,5.");
log();

// 1. El ejemplo 11 (`validacion/sombra/ejemplo11/.datos/cype/proyecto.json`)
{
  const texto = readFileSync(join(RAIZ, "validacion", "sombra", "ejemplo11", ".datos", "cype", "proyecto.json"), "utf8");
  const a = Sesion.abrir(texto, sha256(new Uint8Array(WASM)));
  if (!a.valido) throw new Error(JSON.stringify(a.diagnosticos));
  const k = await a.sesion.calcular();
  if (!k.ok) throw new Error(JSON.stringify(k.diagnosticos));
  informar("Ejemplo 11 (3 plantas de 3 m, 2 × 2 vanos de 6 m, reticular 25+5, pilares 30 × 30, viento con banda de 18 m, sismo ab 0,11 g, μ = 2)", medir(a.sesion.q!));
}

// 2. El edificio objetivo de 7 plantas con losas, con el viento y el sismo del programa
{
  const ACCIONES: Record<string, AccionCaso> = { G: { tipo: "G" }, Q: { tipo: "Q", psi: "uso-A" } };
  const SISMO: SismoEdificio = { ab: 0.16, K: 1.0, terreno: "III", mu: 2, sistema: "porticos-ha" };
  const base = edificioObjetivoLosas();
  const f: ModeloFisico = {
    ...base,
    casos: base.casos.filter((c) => c.id === "G" || c.id === "Q").map((c) => ({ ...c, accion: ACCIONES[c.id]! })),
    cargas: (base.cargas ?? []).filter((c) => c.caso === "G" || c.caso === "Q"),
    acciones: { viento: { zona: "A", aspereza: "IV" }, sismo: SISMO },
  };
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join(" "));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join(" "));
  const q = new Consultas(f, c, r.casos, {}, r.modal);
  informar("Edificio objetivo de 7 plantas con losas (9 × 7 vanos, viento zona A aspereza IV, sismo ab 0,16 g, terreno III, μ = 2)", medir(q));
}

writeFileSync(join(AQUI, "out_medir.txt"), out.join("\n") + "\n");
