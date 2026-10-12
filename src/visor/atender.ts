/**
 * Atendedor del worker de sesión (V1): contesta los pedidos de `protocolo.ts` con una `Sesion`. Es
 * común al worker del navegador y a los tests, que lo llaman directamente.
 *
 * Puro: el núcleo WASM ya iniciado por quien lo crea.
 */
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { datosDesplomes, datosLosas, datosObjeto, datosPilar, datosPilares, datosRevision, datosViga, desplazamientos, estacionViga, geometria3D, piezasPlanta, valorEnPunto, type Resultado } from "./datos.ts";
import { alambrico } from "./alambrico.ts";
import type { Pedido, Respuestas } from "./protocolo.ts";
import { Sesion } from "./sesion.ts";

export type Contestacion = { ok: true; valor: unknown } | { ok: false; diagnosticos: Diagnostico[] };

const sin = (mensaje: string): Contestacion => ({ ok: false, diagnosticos: [{ codigo: "visor/sin-proyecto", severidad: "error", mensaje }] });
const de = <T>(r: Resultado<T>): Contestacion => (r.valido ? { ok: true, valor: r.valor } : { ok: false, diagnosticos: r.diagnosticos });
const bien = <K extends keyof Respuestas>(_k: K, valor: Respuestas[K]): Contestacion => ({ ok: true, valor });

export class Atendedor {
  private sesion: Sesion | null = null;
  readonly motor: string;

  constructor(motor: string) {
    this.motor = motor;
  }

  get huella(): string | null {
    return this.sesion?.huella ?? null;
  }

  async atender(p: Pedido): Promise<Contestacion> {
    if (p.tipo === "abrir") {
      const a = Sesion.abrir(p.texto, this.motor);
      if (!a.valido) {
        this.sesion = null;
        return { ok: false, diagnosticos: a.diagnosticos };
      }
      this.sesion = a.sesion;
      return bien("abrir", a.sesion.estado());
    }
    const s = this.sesion;
    if (!s) return sin("No hay ningún proyecto abierto.");
    switch (p.tipo) {
      case "guardados": {
        const r = await s.usarGuardados(p.cabecera, p.bytes);
        return bien("guardados", r.ok ? { usados: true, estado: s.estado() } : { usados: false, motivo: r.motivo });
      }
      case "calcular": {
        const r = await s.calcular();
        return r.ok ? bien("calcular", s.estado()) : { ok: false, diagnosticos: r.diagnosticos };
      }
      case "estado":
        return bien("estado", s.estado());
      case "escena": {
        const r = s.escena(p.planta, p.vista);
        return r.valido ? bien("escena", r.valor) : { ok: false, diagnosticos: r.diagnosticos };
      }
      case "alzado": {
        const r = s.alzado(p.plano, p.diagramas);
        return r.valido ? bien("alzado", r.valor) : { ok: false, diagnosticos: r.diagnosticos };
      }
      case "elegir":
        return bien("elegir", s.elegir(p.fuente, p.punto, p.radio, p.objetos));
      case "ventana":
        return bien("ventana", s.ventana(p.fuente, p.caja, p.modo));
      case "alambrico":
        return bien("alambrico", alambrico(s.proyecto.modelo));
      case "solido":
        return bien("solido", s.solido());
      case "objeto":
        return de(datosObjeto(s, p.id));
      case "losas":
        return de(datosLosas(s, p.planta, p.campo, p.combinaciones, p.escala));
      case "valor-punto":
        return de(valorEnPunto(s, p.planta, p.campo, p.combinaciones, p.x, p.y, p.escala));
      case "piezas":
        return bien("piezas", piezasPlanta(s, p.planta));
      case "viga":
        return de(datosViga(s, p.id, p.esfuerzo, p.combinaciones));
      case "estacion":
        return de(estacionViga(s, p.id, p.esfuerzo, p.combinaciones, p.s));
      case "pilares":
        return de(datosPilares(s, p.planta, p.combinaciones));
      case "pilar":
        return de(datosPilar(s, p.id, p.combinaciones));
      case "desplomes":
        return de(datosDesplomes(s, p.combinaciones));
      case "geometria":
        return de(geometria3D(s));
      case "deformada":
        return de(desplazamientos(s, p.combinaciones));
      case "diagramas3d":
        return de(s.diagramas3D(p));
      case "isovalores3d":
        return de(s.isovalores3D(p));
      case "pilares3d":
        return de(s.pilares3D(p));
      case "reacciones3d":
        return de(s.reacciones3D(p.combinaciones, p.escala));
      case "valor-lamina":
        return de(s.valorLamina(p));
      case "revision":
        return de(datosRevision(s, p.firmas, p.ficheroFirmas));
      case "precalentar":
        if (s.proyecto.modelo.plantas.some((x) => x.id === p.planta)) s.rr?.valores(p.planta);
        return bien("precalentar", null);
    }
  }
}

/** Arrays tipados de una respuesta, para devolverlos por Transferable (H27). */
export function transferibles(v: unknown, vistos = new Set<unknown>()): ArrayBuffer[] {
  if (v === null || typeof v !== "object" || vistos.has(v)) return [];
  vistos.add(v);
  if (ArrayBuffer.isView(v)) return v.buffer instanceof ArrayBuffer && v.byteOffset === 0 && v.byteLength === v.buffer.byteLength ? [v.buffer] : [];
  const r: ArrayBuffer[] = [];
  for (const x of Array.isArray(v) ? v : Object.values(v)) r.push(...transferibles(x, vistos));
  return [...new Set(r)];
}
