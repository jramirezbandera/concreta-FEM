/**
 * «Vigas de borde» (decisión del usuario, 2026-10-15): todo borde de forjado lleva su zuncho. La
 * orden pone una viga en cada lado del borde de una losa (contorno y huecos) que no va sobre una
 * viga, un muro, un apoyo lineal u otro forjado (`sensatez/borde-sin-viga`), con la regla de la
 * skill, la de los zunchos de la vivienda hechos a mano:
 *
 * - El eje del zuncho va por el eje de los pilares del lado (los que llegan a la planta y cuya huella
 *   pisa la banda de un zuncho enrasado); sin pilares, enrasado por fuera (b/2 hacia dentro del
 *   borde dibujado). Un lado libre sólo en parte sigue la recta de lo que ya lo ata.
 * - La losa no se toca (fase TB, 2026-10-28, a petición del usuario: el borde dibujado es donde se
 *   hormigona). El compilador lleva a la viga lo que cae en su ancho (LV) y la tira entre su cara de
 *   fuera y el borde, de hasta b (`tirasBorde`), con sus cargas; antes la orden retranqueaba la losa
 *   hasta el eje y pasaba las cargas de la banda a la viga.
 *
 * Las vigas, una por lado, con la sección rectangular b × h del material de la losa (la que ya haya
 * igual o una nueva). Todo queda en el modelo como piezas normales, que se pueden retocar.
 *
 * Puro: sin IO.
 */
import type { Losa, ModeloFisico, Seccion, Vec2 } from "../compilador/fisico.ts";
import { areaConSigno, defectoPoligono, puntoEnPoligono } from "../compilador/poligonos.ts";
import { anillosForjado, ejesQueAtan, libresTramo, Plantas, tramos } from "../agente/sensatez.ts";
import { ejeSeccion } from "../compilador/puntoFijo.ts";
import { formaSeccion, huellaPilarSolido } from "../visor/solido.ts";
import type { Operacion } from "./operaciones.ts";

export interface VigaBorde {
  id: string;
  puntos: [Vec2, Vec2];
  /** Por qué va ahí su eje. */
  regla: "pilares" | "enrasada" | "continua";
  /** Los pilares que fijan su eje (regla «pilares»). */
  pilares: string[];
  /** Distancia del borde dibujado a su eje, m. */
  retranqueo: number;
}

export interface PropuestaVigasBorde {
  losa: string;
  /** La sección de las vigas: una que ya hay, o la nueva (`nueva`). */
  seccion: Seccion;
  nueva: boolean;
  vigas: VigaBorde[];
  avisos: string[];
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const p6 = (q: Vec2): Vec2 => [r6(q[0]), r6(q[1])];
const sum = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + k * b[0], a[1] + k * b[1]];

/** Corte de las rectas P + s·u y Q + t·v (null si son paralelas). */
function corte(P: Vec2, u: Vec2, Q: Vec2, v: Vec2): Vec2 | null {
  const den = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(den) < 1e-12) return null;
  const s = ((Q[0] - P[0]) * v[1] - (Q[1] - P[1]) * v[0]) / den;
  return [P[0] + s * u[0], P[1] + s * u[1]];
}

/**
 * Las vigas de borde de `b` × `h` m en los lados libres de la losa `losaId`. `eps`: la tolerancia de
 * conexión (ε_snap). `anillos`: sólo los lados de esos anillos (0, el contorno; i, el hueco i − 1),
 * como el hueco recién dibujado con «Con zunchos»; los demás quedan como están.
 */
export function proponerVigasBorde(m: ModeloFisico, losaId: string, b: number, h: number, eps = 0.05, anillos?: ReadonlySet<number>): PropuestaVigasBorde | { error: string } {
  const l = (m.losas ?? []).find((x) => x.id === losaId) as Losa | undefined;
  if (!l) return { error: `No hay ninguna losa «${losaId}».` };
  if (!(b > 0 && h > 0)) return { error: "La viga tiene que tener el ancho y el canto mayores que 0." };
  if (b > 1.5 || h > 3) return { error: `Una viga de borde de ${b} × ${h} m no es razonable: las medidas van en metros.` };
  const P = new Plantas(m);
  const k = P.indice.get(l.planta);
  if (k === undefined) return { error: `La planta «${l.planta}» de ${losaId} no existe.` };
  const material = m.materiales.find((x) => x.id === l.material);
  if (!material) return { error: `El material «${l.material}» de ${losaId} no existe.` };

  // La sección: una rectangular igual del mismo material, o una nueva
  // Una igual que no sea de pilares (la de un pilar en una viga confunde)
  const dePilares = new Set((m.pilares ?? []).flatMap((p) => [p.seccion, ...(p.tramos ?? []).map((t) => t.seccion)]));
  const igual = m.secciones.find((s) => s.forma === "rectangular" && s.material === l.material && Math.abs(s.b - b) < 1e-9 && Math.abs(s.h - h) < 1e-9 && !dePilares.has(s.id));
  const ids = new Set([...m.secciones.map((s) => s.id)]);
  let sid = `V${Math.round(b * 100)}x${Math.round(h * 100)}`;
  for (let i = 2; !igual && ids.has(sid); i++) sid = `V${Math.round(b * 100)}x${Math.round(h * 100)}-${i}`;
  const seccion: Seccion = igual ?? { id: sid, material: l.material, forma: "rectangular", b, h };

  // Los pilares que llegan a la planta, con su huella
  const pilares: { id: string; c: Vec2; huella: Vec2[] }[] = [];
  for (const p of m.pilares ?? []) {
    const [kh, kb] = [P.indice.get(p.hasta), P.indice.get(p.desde)];
    if (kh === undefined || kb === undefined || k < kh || k > kb) continue;
    const s = m.secciones.find((x) => x.id === (p.tramos?.find((t) => t.planta === l.planta)?.seccion ?? p.seccion));
    const fs = s ? formaSeccion(s) : null;
    if (fs) pilares.push({ id: p.id, c: ejeSeccion(p, s), huella: huellaPilarSolido(p, fs.poligono, s) });
  }

  const ejes = ejesQueAtan(m, P, l);
  const avisos: string[] = [];
  const todos = anillosForjado(l);
  /** Por anillo, el polígono de los ejes de sus vigas (para ver que cierra); la losa no se toca. */
  const nuevos: Vec2[][] = [];
  /** Las vigas (sin id). */
  const grupos: { viga: Omit<VigaBorde, "id"> }[] = [];
  for (const [ia, an0] of todos.entries()) {
    // Sin el vértice repetido ni lados nulos
    const an = an0.filter((q, i) => {
      const s = an0[(i + 1) % an0.length]!;
      return Math.hypot(s[0] - q[0], s[1] - q[1]) > 1e-12;
    });
    const n = an.length;
    if (n < 3) return { error: `Un anillo de ${losaId} tiene menos de 3 vértices.` };
    // Un anillo que no se pide se queda tal cual, bit a bit
    if (anillos && !anillos.has(ia)) {
      nuevos.push([...an0]);
      continue;
    }
    // Hacia la losa: a la izquierda en un contorno antihorario; en un hueco, hacia fuera de él
    const sentido = Math.sign(areaConSigno(an)) * (ia === 0 ? 1 : -1);
    const ts = tramos([...an, an[0]!]);
    const dentro = ts.map((t): Vec2 => [-t.u[1] * sentido, t.u[0] * sentido]);
    // Un lado atado como lo ve el compilador (con la tira de una viga a no más de b de su cara, y sus
    // esquinas: fase TB) no lleva viga; los demás se trazan con lo que lo ata por su eje o su ancho,
    // como antes: la viga de una pérgola a 0,27 m que llega a la esquina no hace del lado uno «en parte»
    const libres = ts.map((t, i) => (libresTramo(t, ejes, eps, dentro[i]!).length ? libresTramo(t, ejes, eps) : []));
    // La clase de cada lado: atado (sin viga nueva), libre en parte (la viga sigue su recta) o libre entero
    const clase = ts.map((t, i): "atado" | "parte" | "entero" => {
      const lib = libres[i]!;
      if (!lib.length) return "atado";
      return lib.length === 1 && lib[0]![0] <= eps && lib[0]![1] >= t.L - eps ? "entero" : "parte";
    });
    // El retranqueo de cada lado libre entero: al eje de sus pilares o enrasado
    const delta = ts.map(() => 0);
    const regla: VigaBorde["regla"][] = ts.map(() => "continua");
    const suyos: string[][] = ts.map(() => []);
    ts.forEach((t, i) => {
      if (clase[i] !== "entero") return;
      const ni = dentro[i]!;
      const en: { id: string; d: number }[] = [];
      for (const p of pilares) {
        // Su huella pisa la banda de un zuncho enrasado, a lo largo del lado (o hasta b más allá de sus extremos)
        const ss = p.huella.map((q) => (q[0] - t.A[0]) * t.u[0] + (q[1] - t.A[1]) * t.u[1]);
        const ds = p.huella.map((q) => (q[0] - t.A[0]) * ni[0] + (q[1] - t.A[1]) * ni[1]);
        const dc = (p.c[0] - t.A[0]) * ni[0] + (p.c[1] - t.A[1]) * ni[1];
        if (Math.max(...ss) <= -b || Math.min(...ss) >= t.L + b) continue;
        if (dc < -eps || Math.min(...ds) >= b - 1e-9 || Math.max(...ds) <= 0) continue;
        en.push({ id: p.id, d: dc });
      }
      if (en.length) {
        const ds = en.map((x) => x.d);
        const d = ds.reduce((s, x) => s + x, 0) / ds.length;
        if (Math.max(...ds) - Math.min(...ds) > eps)
          avisos.push(`Los pilares ${en.map((x) => x.id).join(", ")} del lado de (${r6(t.A[0])}, ${r6(t.A[1])}) a (${r6(t.B[0])}, ${r6(t.B[1])}) no están alineados (de ${r6(Math.min(...ds))} a ${r6(Math.max(...ds))} m del borde): el eje va a la media, ${r6(d)} m.`);
        delta[i] = Math.max(0, d);
        regla[i] = "pilares";
        suyos[i] = en.map((x) => x.id).sort();
      } else {
        delta[i] = b / 2;
        regla[i] = "enrasada";
      }
    });
    // Ejes paralelos a menos de b/2 se alinean (sin quiebros de unos centímetros): manda lo atado,
    // luego los pilares y luego el lado más largo
    const prioridad = (i: number) => (clase[i] !== "entero" ? 3 : regla[i] === "pilares" ? 2 : 1);
    const orden = ts.map((_, i) => i).sort((x, y) => prioridad(y) - prioridad(x) || ts[y]!.L - ts[x]!.L || x - y);
    const recta = ts.map((t, i) => dentro[i]![0] * t.A[0] + dentro[i]![1] * t.A[1] + delta[i]!);
    const hecho = ts.map(() => false);
    for (const i of orden) {
      if (hecho[i]) continue;
      hecho[i] = true;
      for (const j of orden) {
        if (hecho[j] || clase[j] !== "entero") continue;
        const par = dentro[i]![0] * dentro[j]![0] + dentro[i]![1] * dentro[j]![1] > 1 - 1e-9;
        if (!par || Math.abs(recta[j]! - recta[i]!) > b / 2 + 1e-9) continue;
        const dj = recta[i]! - (dentro[j]![0] * ts[j]!.A[0] + dentro[j]![1] * ts[j]!.A[1]);
        if (dj < -1e-9) continue;
        hecho[j] = true;
        recta[j] = recta[i]!;
        delta[j] = Math.max(0, dj);
        if (regla[i] === "pilares") regla[j] = "pilares";
      }
    }
    // Los vértices nuevos: el corte de las rectas de los dos lados (con un escalón si son paralelas)
    const ini: Vec2[] = [];
    const fin: Vec2[] = [];
    const anillo: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + n - 1) % n;
      const [tj, ti] = [ts[j]!, ts[i]!];
      const c = corte(sum(tj.A, dentro[j]!, delta[j]!), tj.u, sum(ti.A, dentro[i]!, delta[i]!), ti.u);
      if (c) {
        anillo.push(c);
        fin[j] = c;
        ini[i] = c;
      } else {
        const [a, bq] = [sum(ti.A, dentro[j]!, delta[j]!), sum(ti.A, dentro[i]!, delta[i]!)];
        anillo.push(a);
        if (Math.hypot(a[0] - bq[0], a[1] - bq[1]) > 1e-9) {
          avisos.push(`En (${r6(ti.A[0])}, ${r6(ti.A[1])}) dos lados en línea se retranquean distinto: el borde hace un escalón.`);
          anillo.push(bq);
        }
        fin[j] = a;
        ini[i] = bq;
      }
    }
    // Sin vértices repetidos ni en línea
    let nuevo = anillo.map(p6);
    for (let cambio = true; cambio && nuevo.length > 3; ) {
      cambio = false;
      for (let i = 0; i < nuevo.length; i++) {
        const [a, q, z] = [nuevo[(i + nuevo.length - 1) % nuevo.length]!, nuevo[i]!, nuevo[(i + 1) % nuevo.length]!];
        const cr = (q[0] - a[0]) * (z[1] - q[1]) - (q[1] - a[1]) * (z[0] - q[0]);
        if (Math.hypot(q[0] - a[0], q[1] - a[1]) < 1e-9 || Math.abs(cr) < 1e-12) {
          nuevo = nuevo.filter((_, k) => k !== i);
          cambio = true;
          break;
        }
      }
    }
    const defecto = defectoPoligono(nuevo, 1e-6);
    if (defecto || Math.sign(areaConSigno(nuevo)) !== Math.sign(areaConSigno(an))) return { error: `Los ejes de las vigas de borde de ${ia === 0 ? "el contorno" : `el hueco ${ia}`} de ${losaId} no forman un polígono (${defecto ?? "se da la vuelta"}): algún lado es más corto que la distancia de su borde al eje.` };
    nuevos.push(nuevo);
    // Las vigas: los lados libres en parte, por sus trozos libres; los libres enteros seguidos y en la
    // misma recta, una sola (un lado que se queda en nada va con la de antes)
    ts.forEach((t, i) => {
      if (clase[i] !== "parte") return;
      for (const [s0, s1] of libres[i]!) {
        const a = s0 <= eps ? ini[i]! : sum(t.A, t.u, s0);
        const z = s1 >= t.L - eps ? fin[i]! : sum(t.A, t.u, s1);
        grupos.push({ viga: { puntos: [p6(a), p6(z)], regla: "continua", pilares: [], retranqueo: 0 } });
      }
    });
    const largo = (i: number) => Math.hypot(fin[i]![0] - ini[i]![0], fin[i]![1] - ini[i]![1]);
    const mismaRecta = (i: number, j: number) => dentro[i]![0] * dentro[j]![0] + dentro[i]![1] * dentro[j]![1] > 1 - 1e-9 && Math.abs(recta[i]! - recta[j]!) < 1e-9;
    // Se empieza en un lado libre entero que no siga al anterior
    const sigue = (i: number) => {
      const j = (i + n - 1) % n;
      return clase[j] === "entero" && (largo(i) < 1e-9 || largo(j) < 1e-9 || mismaRecta(i, j));
    };
    const i0 = ts.findIndex((_, i) => clase[i] === "entero" && !sigue(i));
    if (i0 < 0 && clase.some((c) => c === "entero")) return { error: `Todo el borde de ${ia === 0 ? "el contorno" : `el hueco ${ia}`} de ${losaId} sale en una recta: no se pueden trazar sus vigas.` };
    let g: number[] | null = null;
    const cerrar = () => {
      if (!g) return;
      const con = g.filter((i) => largo(i) >= 1e-9);
      const [p, u] = [con[0] ?? g[0]!, con[con.length - 1] ?? g[g.length - 1]!];
      const ps = [...new Set(g.flatMap((i) => suyos[i]!))].sort();
      grupos.push({
        viga: { puntos: [p6(ini[p]!), p6(fin[u]!)], regla: g.some((i) => regla[i] === "pilares") ? "pilares" : "enrasada", pilares: ps, retranqueo: r6(delta[p]!) },
      });
      g = null;
    };
    if (i0 >= 0)
      for (let k = 0; k < n; k++) {
        const i = (i0 + k) % n;
        if (clase[i] !== "entero") {
          cerrar();
          continue;
        }
        if (g && !sigue(i)) cerrar();
        g ??= [];
        g.push(i);
      }
    cerrar();
  }
  const sinLargo = grupos.filter((x) => Math.hypot(x.viga.puntos[1][0] - x.viga.puntos[0][0], x.viga.puntos[1][1] - x.viga.puntos[0][1]) < 1e-9);
  if (sinLargo.length) return { error: `En ${losaId}, ${sinLargo.length} viga${sinLargo.length > 1 ? "s se quedan" : " se queda"} sin largo: algún lado es más corto que la distancia de su borde al eje.` };
  if (!grupos.length) return { error: `${losaId} ya tiene todos sus bordes sobre una viga, un muro, un apoyo lineal u otro forjado.` };
  // Los ejes de las vigas de los huecos, dentro de los del contorno
  for (const [i, hq] of nuevos.slice(1).entries())
    if (hq.some((q) => !puntoEnPoligono(q, nuevos[0]!))) return { error: `Los ejes de las vigas del hueco ${i + 1} de ${losaId} se salen de los del contorno.` };

  // Ids de las vigas
  const usados = new Set([...(m.vigas ?? []).map((v) => v.id), ...(m.pilares ?? []).map((v) => v.id), ...(m.losas ?? []).map((v) => v.id), ...(m.muros ?? []).map((v) => v.id), ...(m.panos ?? []).map((v) => v.id)]);
  const base = `Z-${losaId.replace(/^L-/, "")}`;
  let nz = 0;
  const vigas: VigaBorde[] = grupos.map((x) => {
    let id: string;
    do id = `${base}-${++nz}`;
    while (usados.has(id));
    return { id, ...x.viga };
  });

  return { losa: losaId, seccion, nueva: !igual, vigas, avisos };
}

/** La operación que aplica la propuesta: la sección (si es nueva) y las vigas. La losa no se toca. */
export function operacionVigasBorde(m: ModeloFisico, p: PropuestaVigasBorde): Operacion | null {
  const l = (m.losas ?? []).find((x) => x.id === p.losa);
  if (!l || !p.vigas.length) return null;
  const ops: Operacion[] = [];
  if (p.nueva) ops.push({ op: "crear", coleccion: "secciones", objeto: p.seccion as never });
  for (const v of p.vigas) ops.push({ op: "crear", coleccion: "vigas", objeto: { id: v.id, planta: l.planta, puntos: v.puntos, seccion: p.seccion.id } as never });
  return { op: "lote", operaciones: ops };
}
