/**
 * Prueba en sombra del ejemplo 11 (`modelo.ts`, `leer_listado.py`): el motor frente al listado de
 * CYPECAD 2027, con las mismas combinaciones.
 *
 * 1. Sismo: periodos, masa desplazada, centro de masas y cortante combinado por planta.
 * 2. Pilares: los «esfuerzos pésimos» del listado en la cabeza y el pie de cada tramo, con la
 *    combinación de su nota (N, Mxx, Myy, Qx, Qy).
 * 3. Forjados (con `--nudos`): la envolvente de los esfuerzos mayorados (Mx, My, Qx, Qy) en los nudos
 *    del listado, con las combinaciones E.L.U. del generador (persistentes y sísmicas), y la de uz con
 *    las características; por zonas (ábacos y aligerado), sin los nudos junto a la cara de los pilares.
 * 4. Vigas del pórtico 1: las envolventes de My y Vz en las caras, frente a las capturas.
 * 5. Con el segundo listado: los pilares por hipótesis y el sumatorio por planta.
 *
 * Lo que sale está en `viento-sismo.md` §14.
 *
 *   bun validacion/sombra/ejemplo11/comparar.ts [<variante>] [--nudos] [--union=<modo>]
 *
 * La variante es una carpeta de `.datos/` (por defecto, `cype`). Escribe `out_<variante>.txt`
 * (`out_<variante>-union-<modo>.txt` con `--union`).
 *
 * `--union` cambia, sólo para medir, la unión de la losa con los pilares cuya huella pisa el ancho de
 * una viga (los de borde), en el modelo analítico ya compilado (`viento-sismo.md` §14.2). Los nudos
 * que dejan de ser rígidos pasan al diafragma de su planta:
 *   - `asoma`: sólo quedan rígidos los nudos de la huella en el ancho de la viga (en su cara); lo que
 *     asoma de la viga es losa normal;
 *   - `caras`: sólo las caras de la huella dentro de la losa (las que no son cara de una viga);
 *   - `barras`: de esas caras, sólo lo que queda a ≤ 0,12 m de una barra del emparrillado de CYPECAD
 *     que las cruza (las rectas x = 0,12 + 0,24·k e y = 0,15 + 0,24·k de los nudos del primer
 *     listado: un tercio del intereje de 0,72, por los nervios);
 *   - `nada`: la losa no toca esos pilares (sólo sus vigas).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../../../src/compilador/huella.ts";
import { triangulosCuadrilatero, valorEnTriangulo } from "../../../src/agente/render/isovalores.ts";
import { envolventeCampo, type Campo } from "../../../src/agente/render/resultados.ts";
import type { Vec2 } from "../../../src/compilador/fisico.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { Sesion } from "../../../src/visor/sesion.ts";
import { correlacionCqc } from "../../../src/motor/espectral.ts";

const AQUI = import.meta.dirname;
const RAIZ = join(AQUI, "..", "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);
const variante = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "cype";
const conNudos = process.argv.includes("--nudos");
const union = process.argv.find((x) => x.startsWith("--union="))?.slice("--union=".length);
if (union && !["asoma", "caras", "barras", "nada"].includes(union)) throw new Error(`--union=${union}: asoma, caras, barras o nada`);
const texto = readFileSync(join(AQUI, ".datos", variante, "proyecto.json"), "utf8");
// El listado: el del primer ejemplo (1.pdf) o, en las variantes `pf`, el del segundo (2.pdf)
const listado = variante.startsWith("pf") ? "cype2" : "cype";
const cy = JSON.parse(readFileSync(join(AQUI, ".datos", `${listado}.json`), "utf8"));

const a = Sesion.abrir(texto, sha256(new Uint8Array(WASM)));
if (!a.valido) throw new Error(JSON.stringify(a.diagnosticos));
const s = a.sesion;
const textoUnion = union ? cambiarUniones(union) : "";
const k = await s.calcular();
if (!k.ok) throw new Error(JSON.stringify(k.diagnosticos));
const q = s.q!;
const out: string[] = [];
const log = (l = "") => {
  out.push(l);
  console.log(l);
};
const f1 = (v: number) => v.toFixed(1);
const f3 = (v: number) => v.toFixed(3);
const pc = (a: number, b: number) => (Math.abs(b) < 1e-9 ? "—" : `${((a / b - 1) * 100).toFixed(1)} %`);

log(`# Ejemplo 11 frente a CYPECAD 2027, variante ${variante}${union ? `, unión «${union}»` : ""}`);
log();
if (textoUnion) {
  log(textoUnion);
  log();
}

// ─── 1. Sismo ───────────────────────────────────────────────────────────────────────────────────
{
  const mo = q.modos();
  const si = q.sismo();
  if (!mo.valido || !si.valido) throw new Error("sin modos");
  const M = mo.valor;
  log(`## Sismo`);
  log(`Masa de los diafragmas ${f1(M.masas.diafragmas)} t (peso ${f1(M.masas.diafragmas * M.g)} kN), al terreno ${f1(M.masas.terreno)} t; por planta: ${M.plantas.map((p) => `${p.planta} ${f1(p.masa)} t, c.d.m. (${f3(p.cm[0])}; ${f3(p.cm[1])})`).join("; ")}`);
  log(`CYPECAD, c.d.m.: ${Object.entries(cy.sismo.plantas as Record<string, { cm: number[] }>).map(([p, v]) => `${p} (${v.cm.join("; ")})`).join(", ")}`);
  log();
  log(`Modo | T CYPECAD | T motor | dif. | Mx CYPECAD | My CYPECAD | Mx motor | My motor`);
  // Los modos del motor, por periodo; los de CYPECAD, los cinco del listado
  for (let i = 0; i < M.modos.length; i++) {
    const m = M.modos[i]!;
    const c = cy.sismo.modos[i] as { T: number; Mx: number; My: number } | undefined;
    log(`${i + 1} | ${c ? c.T.toFixed(3) : "—"} | ${m.periodo.toFixed(4)} | ${c ? pc(m.periodo, c.T) : "—"} | ${c ? (100 * c.Mx).toFixed(2) : "—"} | ${c ? (100 * c.My).toFixed(2) : "—"} | ${(100 * m.masaEfectiva[0]!).toFixed(2)} | ${(100 * m.masaEfectiva[1]!).toFixed(2)}`);
  }
  const acu5 = M.modos.slice(0, 5).reduce((t, m) => [t[0]! + m.masaEfectiva[0]!, t[1]! + m.masaEfectiva[1]!], [0, 0]);
  const cy5 = (cy.sismo.modos as { Mx: number; My: number }[]).slice(0, 5).reduce((t, m) => [t[0]! + m.Mx, t[1]! + m.My], [0, 0]);
  log(`Masa de los 5 primeros modos: CYPECAD ${(100 * cy5[0]!).toFixed(2)} / ${(100 * cy5[1]!).toFixed(2)} %; motor ${(100 * acu5[0]!).toFixed(2)} / ${(100 * acu5[1]!).toFixed(2)} %`);
  log();
  const sis = (JSON.parse(texto).modelo.acciones.sismo ?? {}) as { regla?: string; excentricidad?: number };
  log(`Regla ${sis.regla ?? "srss"}, excentricidad ${sis.excentricidad ?? 0.05}. Cortante en la base: ${si.valor.direcciones.map((d) => `${d.eje} ${f1(d.basal)} kN (${(100 * d.coeficiente).toFixed(2)} % de ${f1(d.peso)})`).join("; ")}. Cortante combinado por planta (kN):`);
  log(`Dirección | Planta | Q CYPECAD | Q motor | dif. | F eq. CYPECAD | F eq. motor`);
  for (const d of si.valor.direcciones) {
    const nombre = d.eje === "X" ? "Sismo X1" : "Sismo Y1";
    for (const p of d.niveles) {
      const c = cy.sismo.cortantes[nombre][p.plantas[0]!] as { Qx: number; Qy: number; Fx: number; Fy: number };
      const [Q, F] = d.eje === "X" ? [c.Qx, c.Fx] : [c.Qy, c.Fy];
      log(`${d.eje} | ${p.plantas[0]} | ${f1(Q)} | ${f1(p.cortante)} | ${pc(p.cortante, Q)} | ${f1(F)} | ${f1(p.fuerza)}`);
    }
  }
  log();
}

// ─── 2. Pilares ─────────────────────────────────────────────────────────────────────────────────
const ids = q.fisico.casos.map((c) => c.id);
const W: Record<string, string> = {};
for (const d of ["+X", "-X", "+Y", "-Y"]) for (const e of ["+", "-"]) W[`V(${d}exc.${e})`] = `W${d}${e}e`;
/**
 * Los factores de los casos lógicos para una combinación del listado («1.35*PP+…-SX-0.3*SY»). Con
 * `signo30` = −1, el término del 30 % de la otra dirección con el signo cambiado.
 */
function factores(comb: string, signoE: "+" | "-", signo30 = 1): Float64Array {
  const fac = new Float64Array(ids.length);
  for (const m of comb.matchAll(/([+-]?)(?:(\d+(?:\.\d+)?)\*)?(PP|CM|Qa|SX|SY|V\([+-][XY]exc\.[+-]\))/g)) {
    let v = (m[1] === "-" ? -1 : 1) * (m[2] ? Number(m[2]) : 1);
    if ((m[3] === "SX" || m[3] === "SY") && Math.abs(v) < 1) v *= signo30;
    const caso = m[3] === "SX" ? `EX${signoE}e` : m[3] === "SY" ? `EY${signoE}e` : m[3]!.startsWith("V(") ? W[m[3]!]! : m[3]!;
    const i = ids.indexOf(caso);
    if (i < 0) throw new Error(`caso ${caso} de ${comb}`);
    fac[i] += v;
  }
  return fac;
}
type FilaPilar = { tramo: string; posicion: string; comprobacion: string; combinacion: string; N: number; Mxx: number; Myy: number; Qx: number; Qy: number };
type Comp = "N" | "Mxx" | "Myy" | "Qx" | "Qy";
const med = (xs: number[]) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length ? o[Math.floor(o.length / 2)]! : NaN;
};
{
  log(`## Pilares: esfuerzos pésimos del listado (cabeza y pie de cada tramo)`);
  log(`Los del motor en la cara inferior del forjado (cabeza) y en el arranque del tramo (pie), con la combinación de la nota. Ejes (comprobados con el viento y con el sismo en la dirección principal): N de compresión positivo; Mxx = −M3, Myy = M2, Qx = V3, Qy = −V2 del motor. Con excentricidad, de sus dos signos el de más |valor| en cada componente.`);
  log(`En una combinación sísmica, «principal» son las componentes de la dirección del sismo al 100 % (Myy y Qx con SX; Mxx y Qy con SY) y «30 %» las de la otra; «N (30 % cambiado)» es N con el término del 30 % de signo contrario.`);
  log();
  log(`Pilar | Tramo | Posición | Comprobación | Combinación | N CYPE / motor | N (30 % cambiado) | Mxx | Myy | Qx | Qy`);
  const grupos: Record<string, number[]> = {};
  const signos: Record<string, [number, number]> = {};
  const anota = (g: string, x: number, y: number) => {
    if (Math.abs(x) < 5) return;
    (grupos[g] ??= []).push(y / x - 1);
    const sg = (signos[g] ??= [0, 0]);
    sg[Math.sign(x) === Math.sign(y) ? 0 : 1]++;
  };
  const vistos = new Set<string>();
  for (const [pid, filas] of Object.entries(cy.pilares as Record<string, FilaPilar[]>)) {
    const t = q.pilar(pid);
    if (!t.valido) throw new Error(JSON.stringify(t.diagnosticos));
    for (const r of filas) {
      const tramo = r.tramo === "CIM" ? "F1" : r.tramo;
      const pos = r.posicion === "Arranque" ? "Pie" : r.posicion;
      if (pos !== "Cabeza" && pos !== "Pie") continue;
      const clave = `${pid} ${tramo} ${pos} ${r.combinacion} ${r.comprobacion}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      const tr = t.valor.find((x) => x.planta === tramo)!;
      const sec = pos === "Cabeza" ? tr.cabeza : tr.base;
      const ejes = (signo30: number): Record<Comp, number> => {
        const v = (["+", "-"] as const).map((e) => q.combinar(sec.esfuerzos, 6, factores(r.combinacion, e, signo30)));
        const comp = (i: number) => (Math.abs(v[0]![i]!) >= Math.abs(v[1]![i]!) ? v[0]![i]! : v[1]![i]!);
        return { N: -comp(0), Mxx: -comp(5), Myy: comp(4), Qx: comp(2), Qy: -comp(1) };
      };
      const m = ejes(1);
      const m30 = ejes(-1);
      const sismoX = /(^|[+-])SX/.test(r.combinacion), sismoY = /(^|[+-])SY/.test(r.combinacion);
      const tipo = sismoX ? "SX" : sismoY ? "SY" : "sin sismo";
      // La comprobación de la fila: en las de N,M los momentos de CYPECAD llevan ya la excentricidad
      // mínima y el segundo orden (son de dimensionado, no del análisis); en las de cortante, no
      const cq = r.comprobacion.includes("N,M") ? (r.comprobacion.includes("Q") ? "Q+N,M" : "N,M") : "Q";
      // (en «−SX−0,3·SY» SX va al 100 %: «(^|[+-])SX» no casa con «0.3*SX»)
      for (const c of ["N", "Mxx", "Myy", "Qx", "Qy"] as Comp[]) {
        const ec = c.startsWith("M") ? ` [${cq}]` : "";
        if (tipo === "sin sismo") anota(`sin sismo, ${c}${ec}`, r[c], m[c]);
        else if (c === "N") {
          anota(`sismo, N`, r.N, m.N);
          anota(`sismo, N (30 % cambiado)`, r.N, m30.N);
        } else {
          const principal = tipo === "SX" ? c === "Myy" || c === "Qx" : c === "Mxx" || c === "Qy";
          anota(`sismo, ${principal ? "principal" : "30 %"}, ${c}${ec}`, r[c], m[c]);
          if (!principal) anota(`sismo, 30 % cambiado, ${c}${ec}`, r[c], m30[c]);
        }
      }
      const cel = (c: Comp) => `${f1(r[c])} / ${f1(m[c])}`;
      log(`${pid} | ${tramo} | ${pos} | ${cq} | ${r.combinacion} | ${cel("N")} | ${tipo === "sin sismo" ? "—" : f1(m30.N)} | ${cel("Mxx")} | ${cel("Myy")} | ${cel("Qx")} | ${cel("Qy")}`);
    }
  }
  log();
  log(`Grupo | valores (|CYPE| ≥ 5) | motor/CYPE − 1: mediana | |dif.|: mediana | máximo | signo igual / distinto`);
  for (const [g, xs] of Object.entries(grupos).sort()) {
    const ab = xs.map(Math.abs);
    log(`${g} | ${xs.length} | ${(100 * med(xs)).toFixed(1)} % | ${(100 * med(ab)).toFixed(1)} % | ${(100 * Math.max(...ab)).toFixed(1)} % | ${signos[g]![0]} / ${signos[g]![1]}`);
  }
  log();
}

// ─── 4. Vigas del pórtico 1 (y = 0), frente a las capturas (sólo el primer ejemplo) ─────────────
if (listado === "cype") {
  log(`## Vigas del pórtico 1 (P1–P2–P3), envolventes en las caras de los pilares (a 0,15 m de su eje) y máximo del vano`);
  log(`CYPECAD (capturas «combinaciones persistentes esfuerzos viga My planta 1» y «combinaciones sísmicas … planta 3»), con «Decalar las leyes de momentos flectores» marcado; su redistribución de negativos, si la hay, no está en el listado.`);
  const CAPTURAS: Record<string, { sit: "ELU-PT" | "ELU-SIS"; My: string; Vz?: string }> = {
    F1: { sit: "ELU-PT", My: "caras −60,04 / −57,30 · −52,72 / −60,20; positivos 9,43 (P1), 17,63 (P3)" },
    F3: { sit: "ELU-SIS", My: "caras −26,54 / −39,80 · −36,10 / −26,72; vanos 10,08 / 11,42", Vz: "caras 60,10 / −71,17 · 70,58 / −61,45" },
  };
  for (const [planta, cap] of Object.entries(CAPTURAS)) {
    const conj = s.conjunto({ tipo: "situaciones", situaciones: [cap.sit] }, "esfuerzos");
    if (!conj.valido) throw new Error("conjunto");
    const res: string[] = [];
    const resV: string[] = [];
    const pos: string[] = [];
    for (const id of [`${planta}-VP1-P2`, `${planta}-VP2-P3`]) {
      const ds = conj.valor.factores.map((fc) => {
        const d = q.diagrama(id, fc);
        if (!d.valido) throw new Error(JSON.stringify(d.diagnosticos));
        return d.valor;
      });
      const en = (est: { s: number; izquierda: Float64Array; derecha: Float64Array }[], x: number) => {
        for (let i = 0; i + 1 < est.length; i++) {
          const [a, b] = [est[i]!, est[i + 1]!];
          if (x >= a.s - 1e-9 && x <= b.s + 1e-9 && b.s > a.s) {
            const w = (x - a.s) / (b.s - a.s);
            return a.derecha.map((v, k) => v * (1 - w) + b.izquierda[k]! * w);
          }
        }
        return est[est.length - 1]!.izquierda;
      };
      for (const x of [0.15, 6 - 0.15]) {
        const m = ds.map((e) => en(e, x)[4]!);
        const v = ds.map((e) => en(e, x)[2]!);
        res.push(`${f1(Math.min(...m))} (${f1(Math.max(...m))})`);
        const vmax = v.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
        resV.push(f1(vmax));
      }
      const mx = Math.max(...ds.flatMap((e) => e.filter((x) => x.s > 0.15 && x.s < 6 - 0.15).map((x) => Math.max(x.izquierda[4]!, x.derecha[4]!))));
      pos.push(f1(mx));
    }
    log(`${planta} (${cap.sit}, ${conj.valor.factores.length} combinaciones)`);
    log(`  CYPECAD My: ${cap.My}`);
    log(`  motor My: caras ${res[0]} / ${res[1]} · ${res[2]} / ${res[3]} (mínimo y, entre paréntesis, máximo); máximo positivo en el vano ${pos.join(" / ")}`);
    if (cap.Vz) {
      log(`  CYPECAD Vz: ${cap.Vz}`);
      log(`  motor Vz (el de más |valor|): caras ${resV[0]} / ${resV[1]} · ${resV[2]} / ${resV[3]}`);
    }
  }
  log();
}

// ─── 5. Pilares por hipótesis y sumatorio por planta (el segundo listado) ───────────────────────
if (cy.hipotesis && Object.keys(cy.hipotesis).length) {
  log(`## Pilares por hipótesis (listado «Esfuerzos de pilares por hipótesis»)`);
  log(`Base y cabeza de cada tramo, en los ejes locales de CYPECAD: N de compresión positivo, Mx = M2, My = −M3, Qx = V3, Qy = −V2 y T del motor (comprobados con el viento). El sismo, |valor| de la CQC de los 8 modos de CYPECAD con sus periodos (Ω = 5 %) frente a |EX| y |EY| del motor (sin excentricidad).`);
  const COMP = ["N", "Mx", "My", "Qx", "Qy", "T"] as const;
  const UMBRAL = [5, 2, 2, 1, 1, 0.5];
  const nuestro = (v: ArrayLike<number>) => [-v[0]!, v[4]!, -v[5]!, v[2]!, -v[1]!, v[3]!];
  const periodos = (cy.sismo.modos as { T: number }[]).map((m) => m.T);
  const cqc = (xs: number[]) => {
    let t = 0;
    for (let i = 0; i < xs.length; i++) for (let j = 0; j < xs.length; j++) t += correlacionCqc(periodos[i]!, periodos[j]!, 0.05) * xs[i]! * xs[j]!;
    return Math.sqrt(Math.max(0, t));
  };
  const caso = (h: string): Record<string, number> | null => {
    if (h === "Peso propio") return { PP: 1 };
    if (h === "Cargas muertas") return { CM: 1 };
    if (h === "Sobrecarga de uso") return { Qa: 1 };
    const w = /^Viento ([+-][XY]) exc\.([+-])$/.exec(h);
    return w ? { [`W${w[1]}${w[2]}e`]: 1 } : null;
  };
  const grupos: Record<string, number[]> = {};
  const signos: Record<string, [number, number]> = {};
  const anota = (g: string, c: number, m: number, k: number) => {
    if (Math.abs(c) < UMBRAL[k]!) return;
    (grupos[g] ??= []).push(m / c - 1);
    const sg = (signos[g] ??= [0, 0]);
    sg[Math.sign(c) === Math.sign(m) ? 0 : 1]++;
  };
  const filas: string[] = [];
  type Hip = Record<string, { base: number[]; cabeza: number[] }>;
  for (const [pid, porTramo] of Object.entries(cy.hipotesis as Record<string, Record<string, Hip>>)) {
    const t = q.pilar(pid);
    if (!t.valido) throw new Error(JSON.stringify(t.diagnosticos));
    for (const [tramo, hips] of Object.entries(porTramo)) {
      const tr = t.valor.find((x) => x.planta === tramo)!;
      for (const pos of ["base", "cabeza"] as const) {
        const sec = pos === "base" ? tr.base : tr.cabeza;
        const comb = (f: Record<string, number>) => {
          const fac = new Float64Array(ids.length);
          for (const [k, v] of Object.entries(f)) fac[ids.indexOf(k)] = v;
          return nuestro(q.combinar(sec.esfuerzos, 6, fac));
        };
        for (const [h, v] of Object.entries(hips)) {
          const f = caso(h);
          if (!f) continue;
          const m = comb(f);
          const tipo = h.startsWith("Viento") ? "viento" : "gravitatorias";
          COMP.forEach((c, k) => anota(`${tipo}, ${c}`, v[pos][k]!, m[k]!, k));
          if (pid === "P1" || pid === "P2" || pid === "P5") filas.push(`${pid} | ${tramo} | ${pos} | ${h} | ${COMP.map((_, k) => `${f1(v[pos][k]!)} / ${f1(m[k]!)}`).join(" | ")}`);
        }
        for (const [eje, id] of [["X", "EX+e"], ["Y", "EY+e"]] as const) {
          const modos = Object.keys(hips).filter((h) => h.startsWith(`Sismo ${eje} Modo`)).sort((a, b) => Number(a.split(" ").pop()) - Number(b.split(" ").pop()));
          if (!modos.length) continue;
          const c = COMP.map((_, k) => cqc(modos.map((h) => hips[h]![pos][k]!)));
          const m = comb({ [id]: 1 }).map(Math.abs);
          COMP.forEach((cc, k) => anota(`sismo ${eje}, ${cc}`, c[k]!, m[k]!, k));
          if (pid === "P1" || pid === "P2" || pid === "P5") filas.push(`${pid} | ${tramo} | ${pos} | Sismo ${eje} (CQC) | ${COMP.map((_, k) => `${f1(c[k]!)} / ${f1(m[k]!)}`).join(" | ")}`);
        }
      }
    }
  }
  log();
  log(`Pilar | Tramo | Posición | Hipótesis | ${COMP.map((c) => `${c} CYPE / motor`).join(" | ")}`);
  for (const l of filas) log(l);
  log();
  log(`Grupo | valores (|CYPE| ≥ 5 kN, 2 kN·m, 1 kN o 0,5 kN·m) | motor/CYPE − 1: mediana | |dif.|: mediana | máximo | signo igual / distinto`);
  for (const [g, xs] of Object.entries(grupos).sort()) {
    const ab = xs.map(Math.abs);
    log(`${g} | ${xs.length} | ${(100 * med(xs)).toFixed(1)} % | ${(100 * med(ab)).toFixed(1)} % | ${(100 * Math.max(...ab)).toFixed(1)} % | ${signos[g]![0]} / ${signos[g]![1]}`);
  }
  log();
  // El sumatorio por planta: la suma de N y del cortante de los tramos que arrancan de cada planta
  log(`## Sumatorio por planta (los tramos que arrancan de cada planta: su base)`);
  log(`Planta | hipótesis | N CYPE / motor | Qx CYPE / motor | Qy CYPE / motor`);
  const tramoDe: Record<string, string> = { F2: "F3", F1: "F2", CIM: "F1" };
  for (const [planta, hips] of Object.entries(cy.sumatorio as Record<string, Record<string, number[]>>)) {
    const tramo = tramoDe[planta]!;
    const suma = (f: Record<string, number> | null, eje?: "X" | "Y") => {
      const r = [0, 0, 0, 0, 0, 0];
      for (const pid of Object.keys(cy.hipotesis)) {
        const t = q.pilar(pid);
        if (!t.valido) continue;
        const sec = t.valor.find((x) => x.planta === tramo)!.base;
        const fac = new Float64Array(ids.length);
        if (f) for (const [k, v] of Object.entries(f)) fac[ids.indexOf(k)] = v;
        else fac[ids.indexOf(eje === "X" ? "EX+e" : "EY+e")] = 1;
        nuestro(q.combinar(sec.esfuerzos, 6, fac)).forEach((v, k) => (r[k]! += v));
      }
      return r;
    };
    for (const h of ["Peso propio", "Cargas muertas", "Sobrecarga de uso", "Viento +X exc.+", "Viento +Y exc.+"]) {
      const c = hips[h];
      if (!c) continue;
      const m = suma(caso(h));
      log(`${planta} | ${h} | ${f1(c[0]!)} / ${f1(m[0]!)} | ${f1(c[3]!)} / ${f1(m[3]!)} | ${f1(c[4]!)} / ${f1(m[4]!)}`);
    }
    for (const eje of ["X", "Y"] as const) {
      const modos = Object.keys(hips).filter((h) => h.startsWith(`Sismo ${eje} Modo`)).sort((a, b) => Number(a.split(" ").pop()) - Number(b.split(" ").pop()));
      const k = eje === "X" ? 3 : 4;
      const c = cqc(modos.map((h) => hips[h]![k]!));
      log(`${planta} | Sismo ${eje} (CQC de sus modos) | — | cortante ${f1(c)} | (el del motor, en «Sismo»)`);
    }
  }
  log();
}

// ─── 3. Forjados: envolventes en los nudos del listado ──────────────────────────────────────────
if (conNudos) {
  const rr = s.rr!;
  const c = s.compilado!;
  const conjE = s.conjunto({ tipo: "situaciones", situaciones: ["ELU-PT", "ELU-SIS"] }, "esfuerzos");
  const conjD = s.conjunto({ tipo: "situaciones", situaciones: ["ELS-C"] }, "desplazamientos");
  if (!conjE.valido || !conjD.valido) throw new Error("conjuntos");
  log(`## Forjados: envolventes en los nudos del listado`);
  log(`Esfuerzos: ${conjE.valor.factores.length} combinaciones E.L.U. (persistentes y sísmicas); uz: ${conjD.valor.factores.length} características.`);
  const PARES: [string, Campo, number][] = [["mx", "m11", 1], ["my", "m22", 1], ["qx", "v13", 1], ["qy", "v23", 1], ["uz", "uz", 1]];
  for (const planta of ["F1", "F2", "F3"]) {
    const nudos = cy.nudos[planta] as ({ x: number; y: number } & Record<string, [number, number]>)[];
    log();
    log(`### ${planta} (${nudos.length} nudos)`);
    log(`Campo | extremo | CYPE | motor | mediana motor/CYPE (|CYPE| > 40 % del extremo; nudos) | ábacos, a más de 0,25 m de la cara de los pilares: extremo CYPE / motor; mediana | aligerado: lo mismo`);
    for (const [cc, campo, esc] of PARES) {
      const conj = campo === "uz" ? conjD.valor : conjE.valor;
      for (const [cual, idx] of [["max", 1], ["min", 0]] as const) {
        const env = envolventeCampo(rr, planta, campo, conj, cual);
        // índice por celdas de las láminas
        const caja = new Map<string, number[]>();
        const pts = env.laminas.map((l) => c.modelo.laminas![l]!.nudos.map((n): Vec2 => [c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y]));
        pts.forEach((p, i) => {
          const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
          for (let gx = Math.floor(Math.min(...xs)); gx <= Math.floor(Math.max(...xs)); gx++)
            for (let gy = Math.floor(Math.min(...ys)); gy <= Math.floor(Math.max(...ys)); gy++) {
              const kk = `${gx},${gy}`;
              if (!caja.has(kk)) caja.set(kk, []);
              caja.get(kk)!.push(i);
            }
        });
        const valor = (x: number, y: number): number | null => {
          for (const i of caja.get(`${Math.floor(x)},${Math.floor(y)}`) ?? []) {
            const w = [0, 1, 2, 3].slice(0, pts[i]!.length).map((a) => env.v[4 * i + a]!);
            if (w.some((z) => Number.isNaN(z))) continue;
            for (const t of triangulosCuadrilatero(pts[i]!, w)) {
              const v = valorEnTriangulo(t, [x, y]);
              if (v !== null) return v;
            }
          }
          return null;
        };
        // Por zonas: en los ábacos y en el aligerado, sin los nudos a menos de 0,25 m de la cara de un
        // pilar (los picos de un solo nudo del emparrillado de CYPECAD junto a la cara)
        const abacos = (JSON.parse(texto).modelo.losas.find((l: { planta: string }) => l.planta === planta).reticular.abacos ?? []) as Vec2[][];
        const enAbaco = (x: number, y: number) => abacos.some((a) => x >= Math.min(...a.map((p) => p[0])) - 1e-9 && x <= Math.max(...a.map((p) => p[0])) + 1e-9 && y >= Math.min(...a.map((p) => p[1])) - 1e-9 && y <= Math.max(...a.map((p) => p[1])) + 1e-9);
        const PIL = [0, 6, 12];
        const juntoPilar = (x: number, y: number) => PIL.some((px) => PIL.some((py) => Math.abs(x - px) <= 0.4 && Math.abs(y - py) <= 0.4));
        const zonas: Record<string, [number, number][]> = { todos: [], abacos: [], aligerado: [] };
        for (const n of nudos) {
          if (!n[cc]) continue;
          const v = valor(n.x, n.y);
          if (v === null) continue;
          const par: [number, number] = [n[cc]![idx], v * esc];
          zonas.todos!.push(par);
          if (juntoPilar(n.x, n.y)) continue;
          zonas[enAbaco(n.x, n.y) ? "abacos" : "aligerado"]!.push(par);
        }
        const pares = zonas.todos!;
        const ext = (ps: [number, number][], sel: (p: [number, number]) => number) => (cual === "max" ? Math.max(...ps.map(sel)) : Math.min(...ps.map(sel)));
        const mediana = (ps: [number, number][]) => {
          if (!ps.length) return "—";
          const maxC = Math.max(...ps.map((p) => Math.abs(p[0])));
          const rat = ps.filter((p) => Math.abs(p[0]) > 0.4 * maxC && Math.sign(p[0]) === Math.sign(p[1])).map((p) => p[1] / p[0]).sort((a, b) => a - b);
          return rat.length ? `${rat[Math.floor(rat.length / 2)]!.toFixed(3)} (${rat.length})` : "—";
        };
        const z = (k: string) => (zonas[k]!.length ? `${f1(ext(zonas[k]!, (p) => p[0]))} / ${f1(ext(zonas[k]!, (p) => p[1]))}; ${mediana(zonas[k]!)}` : "—");
        log(`${cc} | ${cual} | ${f1(ext(pares, (p) => p[0]))} | ${f1(ext(pares, (p) => p[1]))} | ${mediana(pares)} | ábacos: ${z("abacos")} | aligerado: ${z("aligerado")}`);
      }
    }
  }
}

writeFileSync(join(AQUI, `out_${variante}${union ? `-union-${union}` : ""}${conNudos ? "-nudos" : ""}.txt`), out.join("\n") + "\n");

/** `--union`: cambia los enlaces de las huellas de los pilares de borde en la compilación de la sesión. */
function cambiarUniones(modo: string): string {
  const c = s.compilacion;
  if (!c.valido) throw new Error(JSON.stringify(c.diagnosticos));
  const fis = s.proyecto.modelo;
  const nudos = c.modelo.nudos;
  const E = 1e-6;
  // El ancho de las vigas de cada planta: sus tramos con medio ancho
  const tramos = new Map<string, { a: Vec2; b: Vec2; m: number }[]>();
  for (const v of fis.vigas ?? []) {
    const sec = fis.secciones.find((x) => x.id === v.seccion) as { b?: number } | undefined;
    if (!sec?.b) continue;
    const l = tramos.get(v.planta) ?? [];
    for (let i = 0; i + 1 < v.puntos.length; i++) l.push({ a: v.puntos[i]!, b: v.puntos[i + 1]!, m: sec.b / 2 });
    tramos.set(v.planta, l);
  }
  const enAncho = (planta: string, x: number, y: number) =>
    (tramos.get(planta) ?? []).some(({ a, b, m }) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) <= m + E;
    });
  const rejilla = (o: number, a0: number, a1: number) => {
    const r: number[] = [];
    for (let k = Math.ceil((a0 - o) / 0.24) - 1; o + 0.24 * k <= a1 + E; k++) if (o + 0.24 * k > a0 + E) r.push(o + 0.24 * k);
    return r;
  };
  const resumen: string[] = [];
  const restr = c.modelo.restricciones as { tipo: string; id: string; maestro: number; esclavos: number[] }[];
  for (let r = restr.length - 1; r >= 0; r--) {
    const h = restr[r]!;
    const m = /^(.+)@(.+):huella$/.exec(h.id);
    if (!m) continue;
    const [, pilar, planta] = m as unknown as [string, string, string];
    const esc = h.esclavos;
    const en = esc.filter((i) => enAncho(planta, nudos[i]!.x, nudos[i]!.y));
    if (!en.length) continue;
    let quedan: number[];
    if (modo === "asoma") quedan = en;
    else if (modo === "nada") quedan = [];
    else {
      // Las caras de la huella dentro de la losa: los lados de su caja que no son cara de una viga
      const xs = esc.map((i) => nudos[i]!.x);
      const ys = esc.map((i) => nudos[i]!.y);
      const caja = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      const lados = (
        [
          ["x", caja.x0, caja.y0, caja.y1],
          ["x", caja.x1, caja.y0, caja.y1],
          ["y", caja.y0, caja.x0, caja.x1],
          ["y", caja.y1, caja.x0, caja.x1],
        ] as const
      ).filter(([t, v]) => {
        const sobre = esc.filter((i) => Math.abs((t === "x" ? nudos[i]!.x : nudos[i]!.y) - v) < E);
        return !sobre.every((i) => enAncho(planta, nudos[i]!.x, nudos[i]!.y));
      });
      quedan = esc.filter((i) => {
        const nd = nudos[i]!;
        return lados.some(([t, v, a0, a1]) => {
          if (Math.abs((t === "x" ? nd.x : nd.y) - v) >= E) return false;
          if (modo === "caras") return true;
          const u = t === "x" ? nd.y : nd.x;
          return rejilla(t === "x" ? 0.15 : 0.12, a0, a1).some((g) => Math.abs(u - g) <= 0.12 + E);
        });
      });
    }
    const sueltos = esc.filter((i) => !quedan.includes(i));
    const dia = restr.find((x) => x.id === `${planta}:diafragma`);
    if (!dia) throw new Error(`sin diafragma en ${planta}`);
    dia.esclavos = [...dia.esclavos, ...sueltos].sort((x, y) => x - y);
    if (quedan.length) h.esclavos = quedan.sort((x, y) => x - y);
    else {
      restr.splice(r, 1);
      c.mapeo.restricciones.splice(r, 1);
    }
    resumen.push(`${pilar}@${planta} ${quedan.length}/${esc.length}`);
  }
  return `Unión «${modo}» en las huellas de los pilares de borde (nudos rígidos que quedan / que había): ${resumen.reverse().join(", ")}`;
}
