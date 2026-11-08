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
 *
 * Lo que sale está en `viento-sismo.md` §14.
 *
 *   bun validacion/sombra/ejemplo11/comparar.ts [<variante>] [--nudos]
 *
 * La variante es una carpeta de `.datos/` (por defecto, `cype`). Escribe `out_<variante>.txt`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../../../src/compilador/huella.ts";
import { triangulosCuadrilatero, valorEnTriangulo } from "../../../src/agente/render/isovalores.ts";
import { envolventeCampo, type Campo } from "../../../src/agente/render/resultados.ts";
import type { Vec2 } from "../../../src/compilador/fisico.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { Sesion } from "../../../src/visor/sesion.ts";

const AQUI = import.meta.dirname;
const RAIZ = join(AQUI, "..", "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);
const variante = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "cype";
const conNudos = process.argv.includes("--nudos");
const texto = readFileSync(join(AQUI, ".datos", variante, "proyecto.json"), "utf8");
const cy = JSON.parse(readFileSync(join(AQUI, ".datos", "cype.json"), "utf8"));

const a = Sesion.abrir(texto, sha256(new Uint8Array(WASM)));
if (!a.valido) throw new Error(JSON.stringify(a.diagnosticos));
const s = a.sesion;
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

log(`# Ejemplo 11 frente a CYPECAD 2027, variante ${variante}`);
log();

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
  log(`Masa de los 5 primeros modos: CYPECAD 96,37 / 96,38 %; motor ${(100 * acu5[0]!).toFixed(2)} / ${(100 * acu5[1]!).toFixed(2)} %`);
  log();
  const sis = (JSON.parse(texto).modelo.acciones.sismo ?? {}) as { regla?: string; excentricidad?: number };
  log(`Regla ${sis.regla ?? "srss"}, excentricidad ${sis.excentricidad ?? 0.05}. Cortante en la base: ${si.valor.direcciones.map((d) => `${d.eje} ${f1(d.basal)} kN (${(100 * d.coeficiente).toFixed(2)} % de ${f1(d.peso)})`).join("; ")}. Cortante combinado por planta (kN):`);
  log(`Dirección | Planta | Q CYPECAD | Q motor | dif. | F eq. CYPECAD | F motor (diferencia de cortantes)`);
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

// ─── 4. Vigas del pórtico 1 (y = 0), frente a las capturas ──────────────────────────────────────
{
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

writeFileSync(join(AQUI, `out_${variante}${conNudos ? "-nudos" : ""}.txt`), out.join("\n") + "\n");
