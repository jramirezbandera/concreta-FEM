/**
 * La cola del worker (`cola.ts`): las tareas largas de Comprobación (proponer el armado, comprobar un
 * tipo entero) van por turnos, avisan de por dónde van, dejan pasar los demás pedidos y se pueden
 * cancelar, y nada de eso cambia un número: lo que contestan es lo de hacerlo de una vez.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import type { ArmadoProyecto } from "../agente/armaduraBase.ts";
import { VERSION_ESQUEMA } from "../agente/proyecto.ts";
import type { AccionCaso } from "../compilador/fisico.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Atendedor } from "./atender.ts";
import { Cola } from "./cola.ts";
import { TIPOS_COMPROBACION, type DatosArmar, type DatosComprobaciones, type ProgresoTarea, type TipoComprobacion } from "./comprobaciones.ts";
import type { MensajeDelWorker, Pedido } from "./protocolo.ts";

const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};

let motor: string;
let texto: string;

/** Un atendedor con el proyecto abierto y calculado. */
async function abierto(): Promise<Atendedor> {
  const at = new Atendedor(motor);
  for (const p of [{ tipo: "abrir", texto }, { tipo: "calcular" }] as Pedido[]) {
    const r = await at.atender(p);
    if (!r.ok) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  }
  return at;
}

type Respuesta = Extract<MensajeDelWorker, { id: number; ok: boolean }>;

/** Una cola con su atendedor: lo que envía, en orden, y cómo esperar la respuesta de un pedido. */
function montar(at: Atendedor, alEnviar?: (m: MensajeDelWorker) => void) {
  const enviados: MensajeDelWorker[] = [];
  const esperas = new Map<number, (r: Respuesta) => void>();
  const cola = new Cola(at, {
    enviar: (m) => {
      enviados.push(m);
      alEnviar?.(m);
      if (!("tipo" in m)) esperas.get(m.id)?.(m);
    },
    // Una vuelta del bucle de eventos, como en el worker
    ceder: () => new Promise((r) => setImmediate(r)),
    // Cada paso, un turno: lo más entrelazado que puede ir
    rebanada: 0,
  });
  let id = 0;
  const pedir = (pedido: Pedido): { id: number; respuesta: Promise<Respuesta> } => {
    const n = ++id;
    const respuesta = new Promise<Respuesta>((r) => esperas.set(n, r));
    cola.recibir({ id: n, pedido });
    return { id: n, respuesta };
  };
  const avances = (n: number): ProgresoTarea[] => enviados.flatMap((m) => ("tipo" in m && m.tipo === "progreso" && m.id === n && m.avance ? [m.avance] : []));
  const orden = () => enviados.flatMap((m) => ("tipo" in m ? [] : [m.id]));
  return { cola, pedir, avances, orden, enviados };
}

const valor = <T>(r: Respuesta): T => {
  if (!r.ok) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return r.valor as T;
};

let deUnaVez: DatosArmar;

beforeAll(async () => {
  const wasm = readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  motor = sha256(new Uint8Array(wasm));
  const f = edificioObjetivoLosas(2, 2, 2);
  texto = JSON.stringify({ esquema: VERSION_ESQUEMA, modelo: { ...f, casos: f.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })) } });
  // La propuesta de la obra, de una vez (como la CLI y los tests de CO6)
  const r = await (await abierto()).atender({ tipo: "armar", tipos: TIPOS_COMPROBACION });
  if (!r.ok) throw new Error("no arma");
  deUnaVez = r.valor as DatosArmar;
}, 600_000);

describe("La cola del worker: las tareas de Comprobación, por turnos", () => {
  it("proponer por turnos da lo de una vez, avisa pieza a pieza y da el armado de cada tipo al acabarlo; un pedido que llega a mitad pasa delante", async () => {
    const at = await abierto();
    let colado: { id: number; respuesta: Promise<Respuesta> } | null = null;
    let estado: { id: number; respuesta: Promise<Respuesta> } | null = null;
    const m = montar(at, (x) => {
      // Al primer aviso de la propuesta: la tabla de las vigas (otra tarea) y un pedido de los de una vez
      if (!colado && "tipo" in x && x.tipo === "progreso" && x.avance) {
        colado = m.pedir({ tipo: "comprobaciones", de: "vigas" });
        estado = m.pedir({ tipo: "estado" });
      }
    });
    const armar = m.pedir({ tipo: "armar", tipos: TIPOS_COMPROBACION });
    const propuesto = valor<DatosArmar>(await armar.respuesta);
    expect(propuesto).toEqual(deUnaVez);
    // Avisa de todos los tipos, con su cuenta, y da un parcial por tipo: el último, el armado entero
    const av = m.avances(armar.id);
    expect(new Set(av.map((a) => a.tipo))).toEqual(new Set(TIPOS_COMPROBACION));
    expect(av.every((a) => a.partes === 4 && a.hecho <= a.total)).toBe(true);
    const parciales = av.filter((a) => a.parcial);
    expect(parciales.map((a) => a.tipo)).toEqual([...TIPOS_COMPROBACION]);
    expect(parciales[parciales.length - 1]!.parcial).toEqual(propuesto.armado);
    expect(Object.keys(parciales[0]!.parcial!)).toEqual(["pilares"]);
    // Lo que llegó a mitad se contestó antes de que acabase la propuesta, y es lo de pedirlo solo
    const tablaVigas = valor<DatosComprobaciones>(await colado!.respuesta);
    await estado!.respuesta;
    const orden = m.orden();
    expect(orden.indexOf(estado!.id)).toBeLessThan(orden.indexOf(armar.id));
    expect(orden.indexOf(colado!.id)).toBeLessThan(orden.indexOf(armar.id));
    const sola = await (await abierto()).atender({ tipo: "comprobaciones", de: "vigas" });
    expect(sola.ok && tablaVigas).toEqual(sola.ok && sola.valor);
    await m.cola.vacia();
    expect(m.cola.enMarcha).toBe(0);
  }, 600_000);

  it("lo propuesto queda comprobado: sus tablas salen sin comprobar nada más, y son las de comprobarlo en una sesión nueva", async () => {
    const at = await abierto();
    const m = montar(at);
    const propuesto = valor<DatosArmar>(await m.pedir({ tipo: "armar", tipos: TIPOS_COMPROBACION }).respuesta);
    const nueva = await abierto();
    // El armado, como vuelve del proyecto: con las claves en otro orden
    const desordenado = JSON.parse(JSON.stringify(propuesto.armado, (_k, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))) as ArmadoProyecto;
    for (const de of TIPOS_COMPROBACION as readonly TipoComprobacion[]) {
      const t = valor<DatosComprobaciones>(await m.pedir({ tipo: "comprobaciones", de, armado: desordenado }).respuesta);
      expect(t.comprobadas, de).toBe(0);
      const r = await nueva.atender({ tipo: "comprobaciones", de, armado: propuesto.armado });
      if (!r.ok) throw new Error("no comprueba");
      const fresca = r.valor as DatosComprobaciones;
      expect(fresca.comprobadas, de).toBeGreaterThan(0);
      expect({ ...t, comprobadas: 0 }, de).toEqual({ ...fresca, comprobadas: 0 });
    }
  }, 600_000);

  it("una propuesta se cancela a mitad: contesta «cancelado» y lo siguiente se atiende", async () => {
    const at = await abierto();
    let cancelada = false;
    const m = montar(at, (x) => {
      // Con los pilares ya propuestos (su parcial), a mitad de las vigas
      if (!cancelada && "tipo" in x && x.tipo === "progreso" && x.avance?.tipo === "vigas") {
        cancelada = true;
        m.cola.cancelar(armar.id);
      }
    });
    const armar = m.pedir({ tipo: "armar", tipos: TIPOS_COMPROBACION });
    const r = await armar.respuesta;
    expect(r.ok).toBe(false);
    expect(!r.ok && r.diagnosticos[0]!.codigo).toBe("visor/cancelado");
    const parciales = m.avances(armar.id).filter((a) => a.parcial);
    expect(parciales.map((a) => a.tipo)).toEqual(["pilares"]);
    expect(parciales[0]!.parcial!.pilares).toEqual(deUnaVez.armado.pilares);
    // Los pilares ya propuestos están comprobados; y el worker sigue
    const t = valor<DatosComprobaciones>(await m.pedir({ tipo: "comprobaciones", de: "pilares", armado: parciales[0]!.parcial! }).respuesta);
    expect(t.comprobadas).toBe(0);
    expect(t.resumen.sinArmado).toBe(0);
    await m.cola.vacia();
    expect(m.cola.enMarcha).toBe(0);
  }, 600_000);

  it("la tabla y la planta de un tipo, pedidas a la vez, comparten la puesta al día; con otro proyecto abierto a mitad, una tarea contesta que ya no vale", async () => {
    const at = await abierto();
    const m = montar(at);
    const planta = (JSON.parse(texto) as { modelo: { plantas: { id: string }[] } }).modelo.plantas[0]!.id;
    const armado = { vigas: deUnaVez.armado.vigas! };
    const a = m.pedir({ tipo: "comprobaciones", de: "vigas", armado });
    const b = m.pedir({ tipo: "escena", planta, vista: { vista: "comprobacion", de: "vigas", armado } });
    const [ta, eb] = [await a.respuesta, await b.respuesta];
    expect(ta.ok && eb.ok).toBe(true);
    // Las dos avisaron, y entre las dos no pasaron dos veces por las mismas vigas
    const pasos = [...m.avances(a.id), ...m.avances(b.id)];
    const vigas = (JSON.parse(texto) as { modelo: { vigas: unknown[] } }).modelo.vigas.length;
    expect(pasos.length).toBeGreaterThan(0);
    expect(pasos.length).toBeLessThanOrEqual(vigas);
    // Otro proyecto (el mismo, abierto de nuevo: otra sesión) a mitad de una tabla
    let abiertoOtro = false;
    const m2 = montar(await abierto(), (x) => {
      if (!abiertoOtro && "tipo" in x && x.tipo === "progreso" && x.avance) {
        abiertoOtro = true;
        m2.pedir({ tipo: "abrir", texto });
      }
    });
    const r = await m2.pedir({ tipo: "comprobaciones", de: "vigas", armado }).respuesta;
    expect(!r.ok && r.diagnosticos[0]!.codigo).toBe("visor/obsoleto");
    await m2.cola.vacia();
  }, 600_000);
});
