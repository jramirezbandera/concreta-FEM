/**
 * Comprobaciones de sensatez con resultados (A3, `docs/fem3d/agente.md` §8): la bajada por áreas
 * tributarias frente al axil de los pilares, las esbelteces de vigas y losas, las flechas, los
 * desplomes y el axil reducido. Son avisos de orden de magnitud, no comprobaciones de norma (las
 * de norma son de Concreta).
 *
 * Combinaciones:
 * - si todos los casos llevan su acción, la ELS característica para flechas y desplomes y las ELU
 *   del generador para el axil reducido;
 * - si no, «gravedad»: la suma de los casos gravitatorios (todos menos W, E, T, N y A, y menos los
 *   que no cargan en vertical), con factor 1 para las flechas y 1,4 para el axil reducido; el
 *   desplome, caso a caso.
 *
 * Las flechas son las elásticas del modelo, relativas: en una losa, a las esquinas de su recuadro
 * (`Consultas.flechas`); en un vano de viga o de vigueta, a la cuerda entre sus caras, con su
 * deformada muestreada en las estaciones de cada tramo flexible y en `MUESTRAS` puntos más. Puro.
 */
import { conjuntoCombinaciones, seleccionPorDefecto, type ConjuntoCombinaciones } from "./combinaciones.ts";
import { diagramaCombinado, type Resumen } from "./consultas.ts";
import type { Consultas } from "../compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion, Pilar } from "../compilador/fisico.ts";
import { EsfuerzosPiezas } from "../compilador/resultados.ts";
import { bajadaTributaria, type TramoTributario } from "./tributaria.ts";
import { ACCIONES_NO_GRAVITATORIAS, anchoSeccion, areaSeccion, cantoSeccion, num, Plantas, Registro, tipoCaso, UMBRALES, type Comprobacion } from "./sensatez.ts";

/** Puntos de más (uniformes) en el muestreo de la deformada de cada tramo flexible. */
export const MUESTRAS = 16;

/** Factor de la «gravedad» para el axil reducido cuando los casos no llevan su acción (entre 1,35 y 1,5). */
export const FACTOR_GRAVEDAD_ELU = 1.4;

export interface TramoComparado extends TramoTributario {
  /** Axil de compresión en la cabeza del tramo con la suma de los casos gravitatorios, kN. */
  axil: number;
  /** axil / bajada; null si la bajada es demasiado pequeña para compararla. */
  cociente: number | null;
}

export interface SensatezResultados {
  comprobaciones: Comprobacion[];
  /** Casos gravitatorios: los que se suman en la bajada y en la «gravedad». */
  gravedad: string[];
  /** Combinaciones de cada comprobación, en una línea. */
  combinaciones: { flechas: string; desplomes: string; axil: string };
  tributaria: TramoComparado[];
}

/** Casos gravitatorios: no son W, E, T, N ni A, y cargan en vertical (según el resumen). */
export function casosGravedad(f: ModeloFisico, res: Resumen): string[] {
  return f.casos
    .filter((c) => {
      const t = tipoCaso(c);
      if (t !== null && ACCIONES_NO_GRAVITATORIAS.includes(t)) return false;
      return (res.casos.find((x) => x.id === c.id)?.F[2] ?? 0) !== 0;
    })
    .map((c) => c.id);
}

/** La «gravedad»: la suma de los casos gravitatorios por un factor, como una sola combinación. */
export function gravedad(q: Consultas, casos: readonly string[], factor: number): ConjuntoCombinaciones {
  const f = new Float64Array(q.fisico.casos.length);
  q.fisico.casos.forEach((c, k) => {
    if (casos.includes(c.id)) f[k] = factor;
  });
  const nombre = `${factor === 1 ? "" : `${String(factor).replace(".", ",")}·`}(${casos.join(" + ")})`;
  return { descripcion: `gravedad ${nombre}`, nombres: [nombre], etiquetas: [nombre], factores: [f] };
}

function conjunto(q: Consultas, seleccion: Parameters<typeof conjuntoCombinaciones>[1]): ConjuntoCombinaciones | null {
  const r = conjuntoCombinaciones(q, seleccion);
  return r.valido ? r.valor : null;
}

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};

const fraccion = (x: number) => (x > 0 ? `1/${num(1 / x)}` : "0");

/**
 * Las combinaciones de las comprobaciones con resultados (`agente.md` §8): si todos los casos llevan
 * su acción, la ELS característica (flechas y desplome) y las ELU (axil); si no, la «gravedad» con
 * factor 1 y 1,4, y el desplome caso a caso. null si no hay casos gravitatorios.
 */
export function conjuntosSensatez(q: Consultas, res: Resumen): { flechas: ConjuntoCombinaciones | null; axil: ConjuntoCombinaciones | null; desplome: ConjuntoCombinaciones | null } {
  const f = q.fisico;
  const grav = casosGravedad(f, res);
  const conAccion = f.casos.length > 0 && f.casos.every((c) => c.accion);
  const elsC = conAccion ? conjunto(q, { tipo: "situaciones", situaciones: ["ELS-C"] }) : null;
  const elu = conAccion ? conjunto(q, seleccionPorDefecto(f.casos, "esfuerzos")) : null;
  return {
    flechas: elsC ?? (grav.length ? gravedad(q, grav, 1) : null),
    axil: elu ?? (grav.length ? gravedad(q, grav, FACTOR_GRAVEDAD_ELU) : null),
    desplome: elsC ?? conjunto(q, { tipo: "casos" }),
  };
}

export function sensatezResultados(q: Consultas, res: Resumen, opciones?: OpcionesCompilacion): SensatezResultados {
  const f = q.fisico;
  const U = UMBRALES;
  const P = new Plantas(f);
  const grav = casosGravedad(f, res);
  const { flechas: cjFlechas, axil: cjAxil, desplome: cjDesplome } = conjuntosSensatez(q, res);
  const ep = new EsfuerzosPiezas(q.modelo, q.mapeo, q.casos);
  const seccion = new Map(f.secciones.map((s) => [s.id, s]));
  const material = new Map(f.materiales.map((m) => [m.id, m]));
  const pilar = new Map((f.pilares ?? []).map((p) => [p.id, p]));
  const indiceCaso = new Map(f.casos.map((c, k) => [c.id, k]));

  // ─── Bajada tributaria ─────────────────────────────────────────────────────────────────────
  const trib = new Registro(
    "sensatez/tributaria",
    "Axil de los pilares frente a la bajada por áreas tributarias",
    `axil/bajada fuera de [${num(U.tributaria[0])}; ${num(U.tributaria[1])}], con la suma de los casos gravitatorios (salvo los tramos embebidos en un muro y las bajadas menores que el ${num(U.tributariaMinima * 100)} % de la mediana de su planta)`,
  );
  const comparados: TramoComparado[] = [];
  if (grav.length && f.pilares?.length) {
    const bajadas = bajadaTributaria(f, new Set(grav), opciones?.epsSnap);
    const medianas = new Map(P.ids.map((id) => [id, mediana(bajadas.filter((b) => b.planta === id).map((b) => b.bajada))]));
    const axiles = new Map<string, number>();
    for (const p of f.pilares) {
      const r = q.pilar(p.id);
      if (!r.valido) continue;
      for (const t of r.valor) {
        let N = 0;
        for (const c of grav) N -= t.cabeza.esfuerzos[6 * indiceCaso.get(c)!]!;
        axiles.set(`${p.id}@${t.planta}`, N);
      }
    }
    for (const b of bajadas) {
      const axil = axiles.get(`${b.pilar}@${b.planta}`);
      if (axil === undefined) continue;
      const comparable = !b.enMuro && b.bajada > 0 && b.bajada >= U.tributariaMinima * medianas.get(b.planta)!;
      const cociente = comparable ? axil / b.bajada : null;
      comparados.push({ ...b, axil, cociente });
      if (cociente === null) continue;
      trib.peor(Math.abs(Math.log(cociente)), `${b.pilar} en ${b.planta}: ${num(cociente)}`);
      if (cociente < U.tributaria[0] || cociente > U.tributaria[1])
        trib.aviso(
          `El tramo del pilar ${b.pilar} bajo la planta ${b.planta} lleva ${num(axil)} kN y su bajada por áreas tributarias es de ${num(b.bajada)} kN (${num(cociente)} veces): ¿está conectado, le falta un apoyo o es una transición?`,
          [b.pilar, b.planta],
          { axil, bajada: b.bajada, cociente },
        );
    }
  }

  // ─── Esbeltez de las vigas ─────────────────────────────────────────────────────────────────
  const ev = new Registro("sensatez/esbeltez-viga", "Luz libre / canto de las vigas", `más de ${num(U.esbeltezViga)} si es descolgada y de ${num(U.esbeltezVigaPlana)} si es plana (b ≥ h); un voladizo, con el doble de su luz`);
  for (const v of f.vigas ?? []) {
    const s = seccion.get(v.seccion);
    const h = s ? cantoSeccion(s) : null;
    if (!s || !h) continue;
    const b = anchoSeccion(s);
    const plana = b !== null && b >= h;
    const limite = plana ? U.esbeltezVigaPlana : U.esbeltezViga;
    const r = q.viga(v.id);
    if (!r.valido) continue;
    let peor: { x: number; L: number; voladizo: boolean } | null = null;
    for (const va of r.valor.vanos) {
      if (!va.apoyoInicio && !va.apoyoFin) continue;
      const voladizo = !va.apoyoInicio || !va.apoyoFin;
      const L = va.hasta - va.desde;
      const x = ((voladizo ? 2 : 1) * L) / h;
      if (!peor || x > peor.x) peor = { x, L, voladizo };
    }
    if (!peor) continue;
    ev.peor(peor.x / limite, `${v.id}: ${num(peor.x)}`);
    if (peor.x > limite)
      ev.aviso(`La viga ${v.id} (${plana ? "plana" : "descolgada"}, canto ${num(h)} m) tiene un ${peor.voladizo ? "voladizo" : "vano"} de ${num(peor.L)} m de luz libre: ${peor.voladizo ? "2·" : ""}L/h = ${num(peor.x)} (más de ${num(limite)}): ¿el canto o la luz están bien?`, [v.id], { esbeltez: peor.x, luz: peor.L, canto: h });
  }

  // ─── Losas: esbeltez y flechas por recuadro ────────────────────────────────────────────────
  const el = new Registro("sensatez/esbeltez-losa", "Mayor lado del recuadro / espesor", `más de ${num(U.esbeltezLosa)} en una losa maciza y de ${num(U.esbeltezReticular)} en un reticular`);
  const fl = new Registro("sensatez/flecha", "Flecha relativa elástica / luz", `más de ${fraccion(U.flecha)} (combinaciones: ${cjFlechas?.descripcion ?? "ninguna"})`);
  const ladoMayor = (ps: readonly string[]) => {
    const c = ps.map((id) => pilar.get(id)!);
    const d = (a: Pilar, b: Pilar) => Math.hypot(a.x - b.x, a.y - b.y);
    return Math.max(d(c[0]!, c[1]!), d(c[2]!, c[3]!), d(c[0]!, c[2]!), d(c[1]!, c[3]!));
  };
  for (const l of f.losas ?? []) {
    const f0 = cjFlechas?.factores[0] ?? new Float64Array(f.casos.length);
    const geo = q.flechas(l.id, f0);
    if (!geo.valido || !geo.valor.recuadros.length) continue;
    const limite = l.reticular ? U.esbeltezReticular : U.esbeltezLosa;
    const luces = geo.valor.recuadros.map((r) => ladoMayor(r.pilares));
    const Lmax = Math.max(...luces);
    const x = Lmax / l.espesor;
    el.peor(x / limite, `${l.id}: ${num(x)}`);
    if (x > limite) el.aviso(`La losa ${l.id} tiene recuadros de ${num(Lmax)} m de lado y ${num(l.espesor)} m de espesor: L/e = ${num(x)} (más de ${num(limite)}): ¿el espesor está bien o falta un pilar?`, [l.id], { esbeltez: x, luz: Lmax });
    if (!cjFlechas) continue;
    let peor: { x: number; flecha: number; L: number; pilares: readonly string[]; comb: string } | null = null;
    cjFlechas.factores.forEach((fa, kc) => {
      const r = kc === 0 ? geo : q.flechas(l.id, fa);
      if (!r.valido) return;
      r.valor.recuadros.forEach((rc, i) => {
        if (!rc.maxima) return;
        const xr = rc.maxima.flecha / luces[i]!;
        if (!peor || xr > peor.x) peor = { x: xr, flecha: rc.maxima.flecha, L: luces[i]!, pilares: rc.pilares, comb: cjFlechas.nombres[kc]! };
      });
    });
    const p = peor as { x: number; flecha: number; L: number; pilares: readonly string[]; comb: string } | null;
    if (!p) continue;
    fl.peor(p.x / U.flecha, `${l.id}: ${fraccion(p.x)}`);
    if (p.x > U.flecha)
      fl.aviso(`La losa ${l.id} tiene una flecha relativa de ${num(p.flecha * 1000)} mm en el recuadro de ${p.pilares.join(", ")} (${num(p.L)} m) con ${p.comb}: ${fraccion(p.x)} de la luz (más de ${fraccion(U.flecha)}).`, [l.id, ...p.pilares], {
        flecha: p.flecha,
        luz: p.L,
      });
  }

  // ─── Vigas y viguetas: flecha relativa a la cuerda de cada vano ────────────────────────────
  if (cjFlechas) {
    const piezas = [...(f.vigas ?? []).map((v) => v.id), ...Object.values(q.mapeo.panos ?? {}).flat()];
    for (const id of piezas) {
      const r = q.viga(id);
      const ts = ep.tramos(id);
      if (!r.valido || !ts.length) continue;
      let peor: { x: number; flecha: number; L: number; comb: string } | null = null;
      cjFlechas.factores.forEach((fa, kc) => {
        const Ds = ts.map((t) => ({ ...t, D: diagramaCombinado(ep, t.barra, fa) }));
        const u = (s: number) => {
          let t = Ds[0]!;
          for (const x of Ds) if (s >= x.s0 - 1e-9) t = x;
          return t.D.desplazamientosEn(Math.min(t.D.L, Math.max(0, s - t.s0)))[2]!;
        };
        for (const va of r.valor.vanos) {
          if (!va.apoyoInicio || !va.apoyoFin) continue; // la flecha de un voladizo no es relativa a una cuerda
          const L = va.hasta - va.desde;
          if (!(L > 0)) continue;
          const [ua, ub] = [u(va.desde), u(va.hasta)];
          for (const t of Ds) {
            const [a, b] = [Math.max(va.desde, t.s0), Math.min(va.hasta, t.s1)];
            if (!(b > a)) continue;
            const xs = new Set([...t.D.estaciones().map((x) => t.s0 + x), ...Array.from({ length: MUESTRAS + 1 }, (_, i) => a + ((b - a) * i) / MUESTRAS)]);
            for (const s of xs) {
              if (s < a || s > b) continue;
              const rel = ua + ((ub - ua) * (s - va.desde)) / L - t.D.desplazamientosEn(Math.min(t.D.L, Math.max(0, s - t.s0)))[2]!;
              const xr = rel / L;
              if (!peor || xr > peor.x) peor = { x: xr, flecha: rel, L, comb: cjFlechas.nombres[kc]! };
            }
          }
        }
      });
      const p = peor as { x: number; flecha: number; L: number; comb: string } | null;
      if (!p) continue;
      const tipo = r.valor.tipo === "vigueta" ? "vigueta" : "viga";
      fl.peor(p.x / U.flecha, `${id}: ${fraccion(p.x)}`);
      if (p.x > U.flecha) fl.aviso(`La ${tipo} ${id} tiene una flecha relativa de ${num(p.flecha * 1000)} mm en un vano de ${num(p.L)} m con ${p.comb}: ${fraccion(p.x)} de la luz (más de ${fraccion(U.flecha)}).`, [id], { flecha: p.flecha, luz: p.L });
    }
  }

  // ─── Desplomes ─────────────────────────────────────────────────────────────────────────────
  const de = new Registro("sensatez/desplome", "Desplome por planta / altura", `más de ${fraccion(U.desplome)} (combinaciones: ${cjDesplome?.descripcion ?? "ninguna"})`);
  if (cjDesplome && f.pilares?.length)
    for (let k = 0; k + 1 < P.ids.length; k++) {
      const id = P.ids[k]!;
      let peor: { x: number; d: number; pilar: string; comb: string } | null = null;
      cjDesplome.factores.forEach((fa, kc) => {
        const r = q.desplomes(id, fa);
        const m = r.valido ? r.valor.maximo : null;
        if (m && (!peor || m.relativo > peor.x)) peor = { x: m.relativo, d: m.d, pilar: m.pilar, comb: cjDesplome.nombres[kc]! };
      });
      const p = peor as { x: number; d: number; pilar: string; comb: string } | null;
      if (!p) continue;
      de.peor(p.x / U.desplome, `${id}: ${fraccion(p.x)}`);
      if (p.x > U.desplome) de.aviso(`La planta ${id} se desploma ${num(p.d * 1000)} mm respecto a la de abajo (pilar ${p.pilar}, ${p.comb}): ${fraccion(p.x)} de su altura (más de ${fraccion(U.desplome)}).`, [id, p.pilar], { desplome: p.x });
    }

  // ─── Axil reducido ─────────────────────────────────────────────────────────────────────────
  const ax = new Registro("sensatez/axil-reducido", "Axil reducido de los pilares de hormigón", `ν = Nd/(Ac·fcd) más de ${num(U.axilReducido)}, con fcd = fck/1,5 (combinaciones: ${cjAxil?.descripcion ?? "ninguna"})`);
  if (cjAxil)
    for (const p of f.pilares ?? []) {
      const r = q.pilar(p.id);
      if (!r.valido) continue;
      let peor: { nu: number; Nd: number; planta: string; comb: string } | null = null;
      for (const t of r.valor) {
        const s = seccion.get(t.seccion);
        const m = s && material.get(s.material);
        if (!s || !m || m.tipo !== "hormigon") continue;
        const fcd = (m.fck / 1.5) * 1000;
        cjAxil.factores.forEach((fa, kc) => {
          for (const e of [t.base.esfuerzos, t.cabeza.esfuerzos]) {
            let N = 0;
            for (let k = 0; k < fa.length; k++) if (fa[k]) N += fa[k]! * e[6 * k]!;
            const nu = -N / (areaSeccion(s) * fcd);
            if (!peor || nu > peor.nu) peor = { nu, Nd: -N, planta: t.planta, comb: cjAxil.nombres[kc]! };
          }
        });
      }
      const x = peor as { nu: number; Nd: number; planta: string; comb: string } | null;
      if (!x) continue;
      ax.peor(x.nu / U.axilReducido, `${p.id} bajo ${x.planta}: ${num(x.nu)}`);
      if (x.nu > U.axilReducido) ax.aviso(`El pilar ${p.id} bajo la planta ${x.planta} tiene ν = ${num(x.nu)} (Nd = ${num(x.Nd)} kN con ${x.comb}; más de ${num(U.axilReducido)}): ¿la sección es pequeña o le llega más carga de la debida?`, [p.id, x.planta], { nu: x.nu, Nd: x.Nd });
    }

  return {
    comprobaciones: [trib, ev, el, fl, de, ax].map((r) => r.c),
    gravedad: grav,
    combinaciones: { flechas: cjFlechas?.descripcion ?? "ninguna", desplomes: cjDesplome?.descripcion ?? "ninguna", axil: cjAxil?.descripcion ?? "ninguna" },
    tributaria: comparados,
  };
}
