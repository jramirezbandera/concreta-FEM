/**
 * Casos derivados (fase IG, `docs/fem3d/imperfeccion.md`; `CasoDerivado` en `modelo.ts`): un caso sin
 * cargas propias cuya carga es, en cada nudo, una fuerza horizontal proporcional a la carga vertical
 * hacia abajo que otro caso pone en él. Es la carga equivalente a inclinar toda la estructura un
 * ángulo θ bajo las cargas del caso de origen (CE Anejo 19 §5.2: H = θ·N en cada nivel), nudo a nudo.
 *
 * El cálculo (`calcular.ts`) las monta con las fuerzas nodales equivalentes que ya ha ensamblado del
 * origen; lo de aquí es lo común con quien necesita las cargas nodales de un caso después del cálculo
 * (`FuerzasNodales`), que las rehace con las mismas cuentas.
 */
import { cargasDeBarrasDelCaso, equivalentesEnNudos, type BarraPreparada } from "./barras.ts";
import { Diagnosticos } from "./diagnosticos.ts";
import type { Geometria } from "./elementos.ts";
import { cargasDeLaminasDelCaso, type LaminaPreparada } from "./laminas.ts";
import type { CasoCarga, CasoDerivado, ModeloAnalitico } from "./modelo.ts";

/**
 * El índice del caso de origen de cada caso derivado (−1 en los que no lo son). Con `diag`, lo que no
 * vale es un error `carga/derivado-no-valido` (y su índice queda en −1): un origen que no existe o que
 * es a su vez derivado, un GDL que no es X ni Y, un factor no finito o un caso derivado con cargas
 * propias.
 */
export function origenesDerivados(casos: readonly CasoCarga[], diag?: Diagnosticos): Int32Array {
  const origen = new Int32Array(casos.length).fill(-1);
  const indice = new Map<string, number>();
  casos.forEach((c, k) => {
    if (!indice.has(c.id)) indice.set(c.id, k);
  });
  casos.forEach((caso, k) => {
    const d = caso.derivado as CasoDerivado | undefined;
    if (d === undefined) return;
    const mal = (que: string) => diag?.error("carga/derivado-no-valido", `El caso ${caso.id} es derivado y ${que}.`, [caso.id]);
    if (typeof d !== "object" || d === null) return mal("su definición no es un objeto { de, gdl, factor }");
    if (d.gdl !== 0 && d.gdl !== 1) return mal(`su GDL tiene que ser 0 (X) o 1 (Y) (es ${String(d.gdl)})`);
    if (typeof d.factor !== "number" || !Number.isFinite(d.factor)) return mal(`su factor no es un número finito (${String(d.factor)})`);
    if (caso.nodales?.length || caso.barras?.length || caso.laminas?.length || caso.impuestos?.length) return mal("lleva además cargas propias: un caso derivado sólo tiene las que salen de su caso de origen");
    const o = indice.get(d.de);
    if (o === undefined) return mal(`su caso de origen, «${String(d.de)}», no existe`);
    if (casos[o]!.derivado !== undefined) return mal(`su caso de origen, ${d.de}, es a su vez derivado`);
    origen[k] = o;
  });
  return origen;
}

/**
 * Las cargas nodales (6 por nudo) de un caso derivado: `factor`·P_v en su GDL, con `pesos` la carga
 * vertical hacia abajo del caso de origen en cada nudo.
 */
export function cargasDerivadas(d: CasoDerivado, pesos: ArrayLike<number>): Float64Array {
  const nn = pesos.length;
  const t = new Float64Array(6 * nn);
  for (let v = 0; v < nn; v++) {
    const p = pesos[v]!;
    if (p !== 0) t[6 * v + d.gdl] = d.factor * p;
  }
  return t;
}

/**
 * P_v = −Fz de las fuerzas nodales equivalentes de un caso que no es derivado, en cada nudo: sus
 * cargas nodales más el reparto de las de lámina y de las de barra, sumados en el orden del cálculo
 * (los mismos bits que su vector de cargas).
 */
export function pesosNodales(caso: CasoCarga, modelo: ModeloAnalitico, geo: Geometria, barras: readonly (BarraPreparada | undefined)[], laminas: readonly (LaminaPreparada | undefined)[]): Float64Array {
  const nn = modelo.nudos.length;
  const diag = new Diagnosticos();
  const fz = new Float64Array(nn);
  for (const c of caso.nodales ?? []) fz[c.nudo]! += c.f[2];
  const deLaminas = cargasDeLaminasDelCaso(caso.id, caso.laminas ?? [], laminas, modelo, geo, diag).equivalentes;
  if (deLaminas) for (let v = 0; v < nn; v++) fz[v]! += deLaminas[6 * v + 2]!;
  for (const [ib, cb] of cargasDeBarrasDelCaso(caso.id, caso.barras ?? [], barras, modelo, geo, diag).porBarra) {
    const [i, j] = modelo.barras![ib]!.nudos;
    const eq = equivalentesEnNudos(barras[ib]!, cb.ferC);
    fz[i]! += eq[2]!;
    fz[j]! += eq[8]!;
  }
  if (diag.hayErrores) throw new Error(`pesosNodales: el caso ${caso.id} tiene cargas no válidas (${diag.lista[0]!.mensaje})`);
  for (let v = 0; v < nn; v++) fz[v] = -fz[v]!;
  return fz;
}
