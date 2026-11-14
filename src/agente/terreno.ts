/**
 * Fase LC: lo que una losa de cimentación hace en el terreno (`docs/fem3d/losa-cimentacion.md` §4).
 * Por losa y por combinación (por defecto, la ELS característica, como las reacciones):
 * - la tensión σ = k·(−uz) en cada nudo, positiva en compresión: su máximo y su mínimo;
 * - el asiento máximo (−uz, positivo hacia abajo);
 * - el despegue (σ < 0): el área tributaria de los nudos en tracción y su fracción de la losa. El
 *   cálculo es lineal (Winkler): un muelle en tracción no se quita, así que donde despega el resultado
 *   no vale y se avisa (`cimentacion/despegue`);
 * - la distorsión angular entre los pilares que arrancan en ella, |Δw|/d;
 * - con la tensión admisible, si la pasa (`cimentacion/tension`; LC-f: sólo un aviso, la
 *   comprobación geotécnica es de CO).
 *
 * Con el sismo del programa (VS-o), uz no tiene un signo: en cada nudo se toman la parte estática
 * menos y más la amplitud del sismo.
 */
import type { Consultas } from "../compilador/consultas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { ConjuntoCombinaciones } from "./combinaciones.ts";
import type { Respuesta } from "./consultas.ts";

/** Un valor, dónde (x, y) y la combinación que lo da. */
export interface ExtremoTerreno {
  v: number;
  punto: [number, number];
  comb: string;
}

export interface TerrenoLosa {
  losa: string;
  /** kN/m³. */
  balasto: number;
  /** kN/m², si se dio. */
  tensionAdmisible?: number;
  /** m² que apoyan en el terreno (la suma de las áreas tributarias). */
  area: number;
  /** σ máxima (compresión) y mínima (si es < 0, despega), kN/m². */
  sigmaMax: ExtremoTerreno;
  sigmaMin: ExtremoTerreno;
  /** Asiento máximo, m (hacia abajo, positivo). */
  asientoMax: ExtremoTerreno;
  /** La combinación en la que más despega: el área en tracción, m², y su fracción de la losa (null si no despega en ninguna). */
  despegue: { comb: string; area: number; fraccion: number } | null;
  /** Distorsión angular máxima entre dos pilares que arrancan en la losa, |Δw|/d (null con menos de dos). */
  distorsion: { v: number; entre: [string, string]; comb: string } | null;
}

/** El terreno de una losa de cimentación (o de todas, sin `losa`). */
export function terreno(q: Consultas, conjunto: ConjuntoCombinaciones, o: { losa?: string } = {}): Respuesta<TerrenoLosa[]> {
  const ids = o.losa ? [o.losa] : Object.keys(q.mapeo.cimentacion ?? {});
  if (!ids.length) return { valido: false, diagnosticos: [{ codigo: "consulta/sin-terreno", severidad: "error", mensaje: "El modelo no tiene losas de cimentación (con «cimentacion»: { balasto }).", ids: [] }] };
  const r: TerrenoLosa[] = [];
  const diags: Diagnostico[] = [];
  // Los casos del sismo del programa entre los lógicos: con ellos, la parte estática ± la amplitud
  const espectral = q.sup.logicos.map((c) => !!c.espectral);
  for (const id of ids) {
    const t = q.terreno(id);
    if (!t.valido) return t;
    const { balasto: k, nudos, puntos, areas, uz } = t.valor;
    const n = nudos.length;
    const area = areas.reduce((s, a) => s + a, 0);
    const xy = (i: number): [number, number] => [puntos[i]![0], puntos[i]![1]];
    let sMax: ExtremoTerreno | null = null;
    let sMin: ExtremoTerreno | null = null;
    let wMax: ExtremoTerreno | null = null;
    let despegue: TerrenoLosa["despegue"] = null;
    let distorsion: TerrenoLosa["distorsion"] = null;
    const pilares = t.valor.pilares.map((p) => ({ id: p.id, v: p.nudo, x: p.punto[0], y: p.punto[1] }));
    conjunto.factores.forEach((f, kc) => {
      const comb = conjunto.nombres[kc]!;
      const hay = espectral.some((e, i) => e && f[i]);
      const fe = hay ? Float64Array.from(f, (x, i) => (espectral[i] ? x : 0)) : null;
      const fs = hay ? Float64Array.from(f, (x, i) => (espectral[i] ? 0 : x)) : f;
      const ws = q.combinar(uz, n, fs, true);
      const we = fe ? q.combinar(uz, n, fe, true) : null;
      let enTraccion = 0;
      for (let i = 0; i < n; i++) {
        const amp = we ? Math.abs(we[i]!) : 0;
        const [wBaja, wSube] = [ws[i]! - amp, ws[i]! + amp];
        const sigmaMax = -k * wBaja;
        const sigmaMin = -k * wSube;
        if (!sMax || sigmaMax > sMax.v) sMax = { v: sigmaMax, punto: xy(i), comb };
        if (!sMin || sigmaMin < sMin.v) sMin = { v: sigmaMin, punto: xy(i), comb };
        if (!wMax || -wBaja > wMax.v) wMax = { v: -wBaja, punto: xy(i), comb };
        if (sigmaMin < 0) enTraccion += areas[i]!;
      }
      if (enTraccion > 0 && (!despegue || enTraccion > despegue.area)) despegue = { comb, area: enTraccion, fraccion: enTraccion / area };
      // La distorsión angular entre pilares: con el asiento de la parte estática (con el sismo, más la amplitud de la diferencia)
      if (pilares.length >= 2) {
        const uzp = new Float64Array(pilares.length * q.nb);
        for (let kb = 0; kb < q.nb; kb++) pilares.forEach((p, j) => (uzp[kb * pilares.length + j] = q.casos[kb]!.u[6 * p.v + 2]!));
        const ps = q.combinar(uzp, pilares.length, fs, true);
        for (let a = 0; a < pilares.length; a++)
          for (let b = a + 1; b < pilares.length; b++) {
            const d = Math.hypot(pilares[a]!.x - pilares[b]!.x, pilares[a]!.y - pilares[b]!.y);
            if (!(d > 0)) continue;
            let dw = Math.abs(ps[a]! - ps[b]!);
            if (fe) {
              // La diferencia de los dos, combinada modo a modo
              const dif = new Float64Array(q.nb);
              for (let kb = 0; kb < q.nb; kb++) dif[kb] = uzp[kb * pilares.length + a]! - uzp[kb * pilares.length + b]!;
              dw = Math.abs(ps[a]! - ps[b]!) + Math.abs(q.combinar(dif, 1, fe, true)[0]!);
            }
            if (!distorsion || dw / d > distorsion.v) distorsion = { v: dw / d, entre: [pilares[a]!.id, pilares[b]!.id], comb };
          }
      }
    });
    const ta = t.valor.tensionAdmisible;
    const x: TerrenoLosa = { losa: id, balasto: k, ...(ta !== undefined ? { tensionAdmisible: ta } : {}), area, sigmaMax: sMax!, sigmaMin: sMin!, asientoMax: wMax!, despegue, distorsion };
    r.push(x);
    diags.push(...avisosTerreno(x));
  }
  return { valido: true, valor: r, diagnosticos: diags };
}

const coma = (x: number, d = 1) => x.toFixed(d).replace(".", ",");

/** Los avisos del terreno de una losa: el despegue y la tensión admisible. */
export function avisosTerreno(t: TerrenoLosa): Diagnostico[] {
  const r: Diagnostico[] = [];
  if (t.despegue)
    r.push({
      codigo: "cimentacion/despegue",
      severidad: "aviso",
      mensaje: `La losa de cimentación ${t.losa} despega del terreno en ${coma(t.despegue.area)} m² (el ${coma(100 * t.despegue.fraccion)} % de su área) en ${t.despegue.comb}: el cálculo es lineal y sus muelles trabajan a tracción, que el terreno no da. Donde despega, los resultados no valen; revise el canto, las cargas o el balasto.`,
      ids: [t.losa],
      detalles: { ...t.despegue },
    });
  if (t.tensionAdmisible !== undefined && t.sigmaMax.v > t.tensionAdmisible)
    r.push({
      codigo: "cimentacion/tension",
      severidad: "aviso",
      mensaje: `La tensión en el terreno bajo la losa ${t.losa} llega a ${coma(t.sigmaMax.v)} kN/m² en (${coma(t.sigmaMax.punto[0], 2)}; ${coma(t.sigmaMax.punto[1], 2)}) con ${t.sigmaMax.comb}, más que la admisible de ${coma(t.tensionAdmisible)} kN/m².`,
      ids: [t.losa],
      detalles: { sigma: t.sigmaMax.v, admisible: t.tensionAdmisible },
    });
  return r;
}
