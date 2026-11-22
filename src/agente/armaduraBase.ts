/**
 * Armadura base de las losas (fase AB, `docs/fem3d/armado.md` §2.5): el momento que cubre la
 * armadura base de cada losa y armadura (kN·m/m), que el ingeniero da para ver sólo lo que queda por
 * encima (las zonas de refuerzo). Va en el `proyecto.json` fuera del modelo, como las vistas: no entra
 * en la huella ni en el cálculo.
 *
 * La base de una losa y una armadura es la de la losa si la tiene; si no, la común; si no, no hay.
 *
 * Puro: sin IO.
 */
import { erroresArmado, erroresArmadoForjado, erroresArmadoViga, erroresPunzonamiento, erroresZapata, type ArmadoForjado, type ArmadoTramoPilar, type ArmadoVanoViga, type ArmaduraPunzonamiento, type Zapata } from "../comprobaciones/armado.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";

/** Las cuatro armaduras de una losa: X (su dirección 1) o Y (la 2), inferior o superior. */
export const ARMADURAS = ["x-inf", "x-sup", "y-inf", "y-sup"] as const;
export type Armadura = (typeof ARMADURAS)[number];

/** El momento que cubre la armadura base de cada armadura, kN·m/m (≥ 0). La que no se da, no hay. */
export interface BasesArmado {
  "x-inf"?: number;
  "x-sup"?: number;
  "y-inf"?: number;
  "y-sup"?: number;
}

/**
 * AB: la armadura base de las losas (kN·m/m). CO: el armado en barras de los pilares y de las vigas.
 * No entra en la huella ni en el cálculo.
 */
export interface ArmadoProyecto {
  /** La base común a todas las losas, por armadura. */
  base?: BasesArmado;
  /** Por losa (su id), lo que difiere de la común. */
  losas?: Record<string, BasesArmado>;
  /**
   * CO: el armado de cada pilar (su id), por tramo: la clave es la planta de la cabeza del tramo.
   * Los datos comunes (acero, recubrimiento), en `obra.armado`.
   */
  pilares?: Record<string, Record<string, ArmadoTramoPilar>>;
  /**
   * CO2: el armado de cada viga (su id), vano a vano en su orden a lo largo de la viga (entre las
   * caras de sus apoyos); null, el vano que no lo tiene.
   */
  vigas?: Record<string, (ArmadoVanoViga | null)[]>;
  /**
   * CO3: el armado en barras de cada losa maciza o reticular (su id): la base de cada cara y
   * dirección, la parrilla de los ábacos y los refuerzos.
   */
  forjados?: Record<string, ArmadoForjado>;
  /**
   * CO4: la armadura de punzonamiento de la losa junto a cada pilar (su id), por la planta de la
   * losa. Sin ella, la losa se comprueba ahí sin armadura de punzonamiento.
   */
  punzonamiento?: Record<string, Record<string, ArmaduraPunzonamiento>>;
  /**
   * CO5: la zapata aislada de cada pilar (su id) que la lleva: su posición (linderos, vigas
   * centradoras), sus dimensiones y sus parrillas. El terreno, en `obra.terreno`.
   */
  zapatas?: Record<string, Zapata>;
}

/** La base de una losa en una armadura (kN·m/m), o null si no hay. */
export function baseDe(a: ArmadoProyecto | undefined, losa: string, armadura: Armadura): number | null {
  return a?.losas?.[losa]?.[armadura] ?? a?.base?.[armadura] ?? null;
}

/** ¿Hay alguna base en esta armadura (común o de alguna losa)? */
export const hayBase = (a: ArmadoProyecto | undefined, armadura: Armadura): boolean => a?.base?.[armadura] !== undefined || Object.values(a?.losas ?? {}).some((b) => b[armadura] !== undefined);

/**
 * Lo que el esquema no ve: los valores, finitos y ≥ 0, y cada losa, una del modelo (las losas del
 * modelo son las macizas y las reticulares: las que tienen franjas).
 */
export function comprobarArmado(a: ArmadoProyecto | undefined, m: ModeloFisico): Diagnostico[] {
  if (!a) return [];
  const r: Diagnostico[] = [];
  const losas = new Set((m.losas ?? []).map((l) => l.id));
  const valores = (b: BasesArmado, donde: string, ids: string[]) => {
    for (const k of ARMADURAS) {
      const v = b[k];
      if (v !== undefined && !(Number.isFinite(v) && v >= 0)) r.push({ codigo: "armado/base", severidad: "error", mensaje: `La armadura base ${k} de ${donde} tiene que ser un número ≥ 0 (kN·m/m), y es ${String(v)}.`, ...(ids.length ? { ids } : {}), detalles: { armadura: k } });
    }
  };
  if (a.base) valores(a.base, "todas las losas", []);
  for (const [id, b] of Object.entries(a.losas ?? {})) {
    if (!losas.has(id)) r.push({ codigo: "armado/losa", severidad: "error", mensaje: `La armadura base es de «${id}», que no es una losa del modelo (las franjas son de las losas macizas y reticulares).`, ids: [id] });
    else valores(b, `la losa ${id}`, [id]);
  }
  const pilares = new Set((m.pilares ?? []).map((p) => p.id));
  const plantas = new Set(m.plantas.map((p) => p.id));
  for (const [id, tramos] of Object.entries(a.pilares ?? {})) {
    if (!pilares.has(id)) {
      r.push({ codigo: "armado/pilar", severidad: "error", mensaje: `Hay un armado de «${id}», que no es un pilar del modelo.`, ids: [id] });
      continue;
    }
    for (const [planta, t] of Object.entries(tramos)) {
      if (!plantas.has(planta)) r.push({ codigo: "armado/planta", severidad: "error", mensaje: `El armado del pilar ${id} tiene un tramo en «${planta}», que no es una planta del modelo (cada tramo va por la planta de su cabeza).`, ids: [id] });
      for (const e of erroresArmado(t)) r.push({ codigo: "armado/barras", severidad: "error", mensaje: `El armado del pilar ${id} en ${planta} no vale: ${e}.`, ids: [id], detalles: { planta } });
    }
  }
  const vigas = new Set((m.vigas ?? []).map((v) => v.id));
  for (const [id, vanos] of Object.entries(a.vigas ?? {})) {
    if (!vigas.has(id)) {
      r.push({ codigo: "armado/viga", severidad: "error", mensaje: `Hay un armado de «${id}», que no es una viga del modelo.`, ids: [id] });
      continue;
    }
    if (!Array.isArray(vanos)) {
      r.push({ codigo: "armado/barras", severidad: "error", mensaje: `El armado de la viga ${id} tiene que ser la lista de sus vanos, en su orden.`, ids: [id] });
      continue;
    }
    vanos.forEach((t, i) => {
      if (t === null) return;
      for (const e of erroresArmadoViga(t)) r.push({ codigo: "armado/barras", severidad: "error", mensaje: `El armado de la viga ${id} en su vano ${i} no vale: ${e}.`, ids: [id], detalles: { vano: i } });
    });
  }
  for (const [id, porPlanta] of Object.entries(a.punzonamiento ?? {})) {
    if (!pilares.has(id)) {
      r.push({ codigo: "armado/pilar", severidad: "error", mensaje: `Hay una armadura de punzonamiento de «${id}», que no es un pilar del modelo.`, ids: [id] });
      continue;
    }
    for (const [planta, t] of Object.entries(porPlanta ?? {})) {
      if (!plantas.has(planta)) r.push({ codigo: "armado/planta", severidad: "error", mensaje: `La armadura de punzonamiento del pilar ${id} está en «${planta}», que no es una planta del modelo (va por la planta de la losa).`, ids: [id] });
      for (const e of erroresPunzonamiento(t)) r.push({ codigo: "armado/barras", severidad: "error", mensaje: `La armadura de punzonamiento del pilar ${id} en ${planta} no vale: ${e}.`, ids: [id], detalles: { planta } });
    }
  }
  const materiales = new Map(m.materiales.map((x) => [x.id, x]));
  const pilarDe = new Map((m.pilares ?? []).map((p) => [p.id, p]));
  for (const [id, z] of Object.entries(a.zapatas ?? {})) {
    const p = pilarDe.get(id);
    if (!p) {
      r.push({ codigo: "armado/pilar", severidad: "error", mensaje: `Hay una zapata de «${id}», que no es un pilar del modelo.`, ids: [id] });
      continue;
    }
    if (p.base === "ninguno") r.push({ codigo: "armado/zapata", severidad: "error", mensaje: `El pilar ${id} lleva zapata, pero nace sobre otra pieza (base «ninguno»): no llega a la cimentación.`, ids: [id] });
    for (const e of erroresZapata(z)) r.push({ codigo: "armado/zapata", severidad: "error", mensaje: `La zapata del pilar ${id} no vale: ${e}.`, ids: [id] });
    if (z && typeof z === "object") {
      if (z.material !== undefined) {
        const mat = materiales.get(z.material);
        if (!mat) r.push({ codigo: "armado/zapata", severidad: "error", mensaje: `La zapata del pilar ${id} es de «${z.material}», que no es un material del modelo.`, ids: [id, z.material] });
        else if (mat.tipo !== "hormigon") r.push({ codigo: "armado/zapata", severidad: "error", mensaje: `La zapata del pilar ${id} es de «${z.material}», que no es un hormigón.`, ids: [id, z.material] });
      }
      for (const c of Array.isArray(z.centradoras) ? z.centradoras : []) {
        if (c === id) r.push({ codigo: "armado/zapata", severidad: "error", mensaje: `La viga centradora de la zapata del pilar ${id} va a él mismo: va al pilar interior.`, ids: [id] });
        else if (!pilarDe.has(c)) r.push({ codigo: "armado/zapata", severidad: "error", mensaje: `La viga centradora de la zapata del pilar ${id} va a «${c}», que no es un pilar del modelo.`, ids: [id] });
      }
    }
  }
  const deLosa = new Map((m.losas ?? []).map((l) => [l.id, l]));
  for (const [id, f] of Object.entries(a.forjados ?? {})) {
    const l = deLosa.get(id);
    if (!l) {
      r.push({ codigo: "armado/losa", severidad: "error", mensaje: `Hay un armado de «${id}», que no es una losa del modelo (se arman las losas macizas y reticulares).`, ids: [id] });
      continue;
    }
    if (!f || typeof f !== "object") {
      r.push({ codigo: "armado/barras", severidad: "error", mensaje: `El armado de la losa ${id} no vale.`, ids: [id] });
      continue;
    }
    for (const e of erroresArmadoForjado(f, l.reticular !== undefined)) r.push({ codigo: "armado/barras", severidad: "error", mensaje: `El armado de la losa ${id} no vale: ${e}.`, ids: [id] });
  }
  return r;
}

/** El bloque sin lo vacío (una losa sin valores, un bloque sin nada): undefined si no queda nada. */
export function limpiarArmado(a: ArmadoProyecto | undefined): ArmadoProyecto | undefined {
  if (!a) return undefined;
  const limpio = (b: BasesArmado | undefined): BasesArmado | undefined => {
    if (!b) return undefined;
    // Una clave que no es una armadura se queda, para que la rechace el esquema
    const c: Record<string, number> = {};
    for (const [k, v] of Object.entries(b)) if (v !== undefined) c[k] = v;
    return Object.keys(c).length ? c : undefined;
  };
  const base = limpio(a.base);
  const losas: Record<string, BasesArmado> = {};
  for (const id of Object.keys(a.losas ?? {}).sort()) {
    const b = limpio(a.losas![id]);
    if (b) losas[id] = b;
  }
  const pilares: Record<string, Record<string, ArmadoTramoPilar>> = {};
  for (const id of Object.keys(a.pilares ?? {}).sort()) if (Object.keys(a.pilares![id]!).length) pilares[id] = a.pilares![id]!;
  const vigas: Record<string, (ArmadoVanoViga | null)[]> = {};
  for (const id of Object.keys(a.vigas ?? {}).sort()) if (a.vigas![id]!.some((v) => v !== null)) vigas[id] = a.vigas![id]!;
  const forjados: Record<string, ArmadoForjado> = {};
  for (const id of Object.keys(a.forjados ?? {}).sort()) forjados[id] = a.forjados![id]!;
  const punzonamiento: Record<string, Record<string, ArmaduraPunzonamiento>> = {};
  for (const id of Object.keys(a.punzonamiento ?? {}).sort()) if (Object.keys(a.punzonamiento![id] ?? {}).length) punzonamiento[id] = a.punzonamiento![id]!;
  const zapatas: Record<string, Zapata> = {};
  for (const id of Object.keys(a.zapatas ?? {}).sort()) zapatas[id] = a.zapatas![id]!;
  const r: ArmadoProyecto = {
    ...(base ? { base } : {}),
    ...(Object.keys(losas).length ? { losas } : {}),
    ...(Object.keys(pilares).length ? { pilares } : {}),
    ...(Object.keys(vigas).length ? { vigas } : {}),
    ...(Object.keys(forjados).length ? { forjados } : {}),
    ...(Object.keys(punzonamiento).length ? { punzonamiento } : {}),
    ...(Object.keys(zapatas).length ? { zapatas } : {}),
  };
  return Object.keys(r).length ? r : undefined;
}

/**
 * El bloque tras una operación del editor que cambia el modelo de `antes` a `despues`: las losas
 * renombradas (`viejo → nuevo`) con su nuevo id, y sin las que se borraron. Lo que ya no era una losa
 * antes se queda como está (lo dice `comprobarArmado`; no se pierde en silencio).
 */
export function seguirLosas(a: ArmadoProyecto | undefined, renombres: ReadonlyMap<string, string>, antes: ModeloFisico, despues: ModeloFisico): ArmadoProyecto | undefined {
  if (!a?.losas && !a?.forjados) return a;
  const eran = new Set((antes.losas ?? []).map((l) => l.id));
  const son = new Set((despues.losas ?? []).map((l) => l.id));
  const seguir = <T,>(de: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!de) return undefined;
    const r: Record<string, T> = {};
    for (const [id, b] of Object.entries(de)) {
      const n = renombres.get(id) ?? id;
      if (eran.has(id) && !son.has(n)) continue;
      r[n] = b;
    }
    return r;
  };
  const [losas, forjados] = [seguir(a.losas), seguir(a.forjados)];
  return limpiarArmado({ ...a, ...(losas ? { losas } : {}), ...(forjados ? { forjados } : {}) });
}

/**
 * Lo mismo con el armado de los pilares: el pilar renombrado, con su nuevo id; el borrado, fuera; y
 * los tramos, con el nuevo id de su planta (sin los de una planta borrada).
 */
export function seguirPilares(a: ArmadoProyecto | undefined, renombres: ReadonlyMap<string, string>, antes: ModeloFisico, despues: ModeloFisico): ArmadoProyecto | undefined {
  if (!a?.pilares && !a?.punzonamiento) return a;
  const eran = new Set((antes.pilares ?? []).map((p) => p.id));
  const son = new Set((despues.pilares ?? []).map((p) => p.id));
  const eranPlantas = new Set(antes.plantas.map((p) => p.id));
  const sonPlantas = new Set(despues.plantas.map((p) => p.id));
  let cambia = false;
  /** Un bloque por pilar y planta (el armado de sus tramos, o la armadura de punzonamiento, CO4). */
  const seguir = <T,>(de: Record<string, Record<string, T>> | undefined): Record<string, Record<string, T>> | undefined => {
    if (!de) return undefined;
    const r: Record<string, Record<string, T>> = {};
    for (const [id, tramos] of Object.entries(de)) {
      const n = eran.has(id) ? (renombres.get(id) ?? id) : id;
      if (n !== id) cambia = true;
      if (eran.has(id) && !son.has(n)) {
        cambia = true;
        continue;
      }
      const t: Record<string, T> = {};
      for (const [planta, x] of Object.entries(tramos)) {
        const np = eranPlantas.has(planta) ? (renombres.get(planta) ?? planta) : planta;
        if (np !== planta) cambia = true;
        if (eranPlantas.has(planta) && !sonPlantas.has(np)) {
          cambia = true;
          continue;
        }
        t[np] = x;
      }
      r[n] = t;
    }
    return r;
  };
  const [pilares, punzonamiento] = [seguir(a.pilares), seguir(a.punzonamiento)];
  return cambia ? limpiarArmado({ ...a, ...(pilares ? { pilares } : {}), ...(punzonamiento ? { punzonamiento } : {}) }) : a;
}

/** Lo mismo con el armado de las vigas: la renombrada, con su nuevo id; la borrada, fuera. */
export function seguirVigas(a: ArmadoProyecto | undefined, renombres: ReadonlyMap<string, string>, antes: ModeloFisico, despues: ModeloFisico): ArmadoProyecto | undefined {
  if (!a?.vigas) return a;
  const eran = new Set((antes.vigas ?? []).map((v) => v.id));
  const son = new Set((despues.vigas ?? []).map((v) => v.id));
  const vigas: Record<string, (ArmadoVanoViga | null)[]> = {};
  let cambia = false;
  for (const [id, vanos] of Object.entries(a.vigas)) {
    const n = eran.has(id) ? (renombres.get(id) ?? id) : id;
    if (n !== id) cambia = true;
    if (eran.has(id) && !son.has(n)) {
      cambia = true;
      continue;
    }
    vigas[n] = vanos;
  }
  return cambia ? limpiarArmado({ ...a, vigas }) : a;
}

/**
 * CO5: lo mismo con las zapatas: la del pilar renombrado, con su nuevo id; la del borrado, fuera; las
 * vigas centradoras, al nuevo id de su pilar (y sin las que iban a uno borrado: la viga ya no existe);
 * y el hormigón, al nuevo id de su material (sin él, si se borró: va el de la obra).
 */
export function seguirZapatas(a: ArmadoProyecto | undefined, renombres: ReadonlyMap<string, string>, antes: ModeloFisico, despues: ModeloFisico): ArmadoProyecto | undefined {
  if (!a?.zapatas) return a;
  const eran = new Set((antes.pilares ?? []).map((p) => p.id));
  const son = new Set((despues.pilares ?? []).map((p) => p.id));
  const eranMat = new Set(antes.materiales.map((x) => x.id));
  const sonMat = new Set(despues.materiales.map((x) => x.id));
  const pilar = (id: string): string | null => {
    const n = eran.has(id) ? (renombres.get(id) ?? id) : id;
    return eran.has(id) && !son.has(n) ? null : n;
  };
  let cambia = false;
  const zapatas: Record<string, Zapata> = {};
  for (const [id, z] of Object.entries(a.zapatas)) {
    const n = pilar(id);
    if (n !== id) cambia = true;
    if (n === null) continue;
    let w = z;
    if (z && typeof z === "object" && Array.isArray(z.centradoras)) {
      const cs = z.centradoras.map(pilar).filter((c): c is string => c !== null);
      if (cs.length !== z.centradoras.length || cs.some((c, i) => c !== z.centradoras![i])) {
        cambia = true;
        const { centradoras: _c, ...resto } = w;
        w = cs.length ? { ...resto, centradoras: cs } : resto;
      }
    }
    if (w && typeof w === "object" && w.material !== undefined && eranMat.has(w.material)) {
      const nm = renombres.get(w.material) ?? w.material;
      if (!sonMat.has(nm)) {
        cambia = true;
        const { material: _m, ...resto } = w;
        w = resto;
      } else if (nm !== w.material) {
        cambia = true;
        w = { ...w, material: nm };
      }
    }
    zapatas[n] = w;
  }
  return cambia ? limpiarArmado({ ...a, zapatas }) : a;
}
