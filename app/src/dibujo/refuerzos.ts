/**
 * CO6 (`docs/fem3d/comprobaciones.md` §8.12): los refuerzos y las zonas de cercos de las losas, con el
 * ratón, en la planta del espacio Comprobación.
 *
 * - **Con uno elegido** (un clic en él o en su fila de la ficha) se pintan su zona y sus cinco asas:
 *   la del medio de cada lado lo estira y la del centro lo mueve entero. Un clic en un asa la coge y
 *   el clic siguiente la deja; arrastrarla, también. Lo que cambia va a 5 cm.
 * - **Añadir:** con un elemento nuevo pedido en la barra, dos clics (o una ventana) dan las esquinas
 *   opuestas de su zona, en la losa que tiene debajo.
 * - El clic derecho o Esc sueltan lo que se tiene cogido.
 *
 * Aquí sólo está el ratón y lo que se pinta encima: la geometría es de `src/editor/refuerzosPlanta.ts`
 * y lo que se escribe en el proyecto lo hace quien recibe `alMover` y `alAnadir`.
 */
import type { Vec2 } from "../../../src/compilador/fisico.ts";
import type { ArmadoForjado, ArmaduraForjado } from "../../../src/comprobaciones/armado.ts";
import { asaEn, asasZona, esquinasZona, mismaZona, zonaElemento, zonaEntre, zonaMovida, type AsaZona, type ElementoLosa, type Rango, type ZonaPlanta } from "../../../src/editor/refuerzosPlanta.ts";
import type { Colores } from "../vistas/motor.ts";
import type { Dibujo2D } from "../vistas/vista2d.ts";

/** Una losa con lo que hace falta para editar sus refuerzos en planta. */
export interface LosaArmada {
  id: string;
  planta: string;
  eje1?: number;
  contorno: readonly Vec2[];
  armado?: ArmadoForjado;
}

/** Lo que se va a añadir: un refuerzo de una armadura (en un reticular, de los ábacos o de los nervios) o unos cercos de nervios. */
export type NuevoElemento = { lista: "refuerzos"; armadura: ArmaduraForjado; en?: "abacos" | "nervios" } | { lista: "cercos"; direccion: "x" | "y" };

const metros = (x: number) => x.toFixed(2).replace(".", ",");
const medidas = (z: Rango) => `${metros(z.s[1] - z.s[0])} × ${metros(z.t[1] - z.t[0])} m`;

function dentro(p: Vec2, anillo: readonly Vec2[]): boolean {
  let d = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [a, b] = [anillo[i]!, anillo[j]!];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) d = !d;
  }
  return d;
}

export class EditorRefuerzos {
  /** Las losas del proyecto, con su armado de ahora. */
  losas: readonly LosaArmada[] = [];
  /** El refuerzo o la zona de cercos elegido en las vistas. */
  elegido: { losa: string; elemento: ElementoLosa } | null = null;
  /** Lo que se va a añadir (la herramienta de la barra); null, ninguna. */
  nuevo: NuevoElemento | null = null;
  /** La zona de un elemento ha cambiado. */
  alMover: (losa: string, e: ElementoLosa, zona: Rango) => void = () => {};
  /** Un elemento nuevo en una losa. */
  alAnadir: (losa: string, n: NuevoElemento, zona: Rango) => void = () => {};
  /** Algo que decirle a quien dibuja (un clic fuera de las losas, una zona demasiado pequeña). */
  alAvisar: (texto: string | null) => void = () => {};

  private cogida: { asa: AsaZona; desde: Vec2 } | null = null;
  private primero: { p: Vec2; losa: LosaArmada } | null = null;
  private q: Vec2 | null = null;
  private bajo: AsaZona | null = null;
  private readonly adaptadores = new Map<string, Dibujo2D>();

  /** ¿Tiene algo a medias (un asa cogida o la primera esquina de uno nuevo)? */
  get ocupado(): boolean {
    return this.cogida !== null || this.primero !== null;
  }

  /** Suelta lo que tiene a medias; true si había algo. */
  cancelar(): boolean {
    const habia = this.ocupado;
    this.cogida = null;
    this.primero = null;
    return habia;
  }

  /** La zona de lo elegido, si es de una losa de la planta. */
  private zona(planta: string): { losa: LosaArmada; z: ZonaPlanta } | null {
    const e = this.elegido;
    if (!e) return null;
    const losa = this.losas.find((l) => l.id === e.losa && l.planta === planta);
    const z = losa ? zonaElemento(losa.eje1, losa.armado, e.elemento) : null;
    return losa && z ? { losa, z } : null;
  }

  private losaEn(planta: string, p: Vec2): LosaArmada | null {
    return this.losas.find((l) => l.planta === planta && dentro(p, l.contorno)) ?? null;
  }

  private zonaNueva(losa: LosaArmada, a: Vec2, b: Vec2): Rango | null {
    const n = this.nuevo;
    return n ? zonaEntre(losa.eje1, n.lista === "refuerzos" ? n.armadura : n.direccion, a, b) : null;
  }

  private anadir(losa: LosaArmada, a: Vec2, b: Vec2): void {
    const zona = this.zonaNueva(losa, a, b);
    if (!zona) return this.alAvisar("La zona es demasiado pequeña: dé dos esquinas opuestas.");
    this.alAvisar(null);
    this.alAnadir(losa.id, this.nuevo!, zona);
  }

  /** Lo que se da a la vista de una planta. */
  adaptador(planta: string): Dibujo2D {
    let a = this.adaptadores.get(planta);
    if (a) return a;
    a = {
      pasar: (p, radio) => {
        this.q = p;
        const z = this.nuevo || this.cogida ? null : this.zona(planta);
        this.bajo = z ? asaEn(z.z, p, radio) : null;
      },
      salir: () => {
        this.q = null;
        this.bajo = null;
      },
      clic: (p, radio) => {
        if (this.nuevo) {
          if (!this.primero) {
            const losa = this.losaEn(planta, p);
            if (!losa) this.alAvisar("Ese punto no está en ninguna losa de la planta.");
            else if (!losa.armado) this.alAvisar(`La losa ${losa.id} no tiene armado: propóngalo antes de añadirle refuerzos.`);
            else {
              this.alAvisar(null);
              this.primero = { p, losa };
            }
          } else {
            const { p: a0, losa } = this.primero;
            this.primero = null;
            this.anadir(losa, a0, p);
          }
          return true;
        }
        const z = this.zona(planta);
        if (!z) return false;
        if (this.cogida) {
          const { asa, desde } = this.cogida;
          this.cogida = null;
          const zona = zonaMovida(z.z, asa, desde, p);
          if (!mismaZona(zona, z.z)) this.alMover(z.losa.id, this.elegido!.elemento, zona);
          return true;
        }
        const asa = asaEn(z.z, p, radio);
        if (!asa) return false;
        this.cogida = { asa, desde: asasZona(z.z).find((x) => x.asa === asa)!.p };
        return true;
      },
      ventana: (caja) => {
        // Con la herramienta de añadir, una ventana da las dos esquinas
        if (!this.nuevo) return false;
        const [a0, b0]: [Vec2, Vec2] = [[caja[0], caja[1]], [caja[2], caja[3]]];
        const losa = this.losaEn(planta, [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2]) ?? this.losaEn(planta, a0) ?? this.losaEn(planta, b0);
        this.primero = null;
        if (!losa) this.alAvisar("Esa ventana no está en ninguna losa de la planta.");
        else if (!losa.armado) this.alAvisar(`La losa ${losa.id} no tiene armado: propóngalo antes de añadirle refuerzos.`);
        else this.anadir(losa, a0, b0);
        return true;
      },
      agarrar: (p, radio) => {
        if (this.nuevo || this.cogida) return false;
        const z = this.zona(planta);
        const asa = z ? asaEn(z.z, p, radio) : null;
        if (!z || !asa) return false;
        this.cogida = { asa, desde: asasZona(z.z).find((x) => x.asa === asa)!.p };
        this.q = p;
        return true;
      },
      derecho: () => this.cancelar(),
      cursor: () => {
        if (!this.q) return null;
        if (this.nuevo) {
          const zona = this.primero ? this.zonaNueva(this.primero.losa, this.primero.p, this.q) : null;
          return { p: this.q, texto: this.primero ? (zona ? `${medidas(zona)} · clic: la esquina opuesta` : "clic: la esquina opuesta") : "clic: una esquina de la zona" };
        }
        const z = this.zona(planta);
        if (z && this.cogida) return { p: this.q, texto: `${medidas(zonaMovida(z.z, this.cogida.asa, this.cogida.desde, this.q))} · clic para dejarlo, Esc lo suelta` };
        if (z && this.bajo) return { p: this.q, texto: this.bajo === "centro" ? "clic o arrastrar: mover la zona" : "clic o arrastrar: estirar este lado" };
        return null;
      },
      pintar: (ctx, aPx, c) => this.pintar(planta, ctx, aPx, c),
    };
    this.adaptadores.set(planta, a);
    return a;
  }

  private pintar(planta: string, ctx: CanvasRenderingContext2D, aPx: (q: Vec2) => [number, number], c: Colores): void {
    const trazo = (puntos: readonly Vec2[], rayas: number[], ancho: number) => {
      ctx.beginPath();
      puntos.forEach((p, i) => {
        const [x, y] = aPx(p);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.setLineDash(rayas);
      ctx.lineWidth = ancho;
      ctx.strokeStyle = c.seleccion;
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const rotulo = (p: Vec2, texto: string) => {
      const [x, y] = aPx(p);
      ctx.font = "600 12px Geist, system-ui, sans-serif";
      const w = ctx.measureText(texto).width + 10;
      ctx.fillStyle = c.panel;
      ctx.strokeStyle = c.seleccion;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(Math.round(x - w / 2) + 0.5, Math.round(y - 27) + 0.5, w, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.texto;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(texto, x, y - 17.5);
    };
    ctx.save();
    const z = this.nuevo ? null : this.zona(planta);
    if (z) {
      const previa: ZonaPlanta | null = this.cogida && this.q ? { ...z.z, ...zonaMovida(z.z, this.cogida.asa, this.cogida.desde, this.q) } : null;
      // Con un asa cogida: la zona de partida, a rayas, y la que quedaría, entera
      trazo(esquinasZona(z.z), previa ? [4, 4] : [], previa ? 1 : 1.5);
      if (previa) {
        trazo(esquinasZona(previa), [], 2);
        rotulo(asasZona(previa).find((x) => x.asa === "centro")!.p, medidas(previa));
      }
      for (const a of asasZona(previa ?? z.z)) {
        const [x, y] = aPx(a.p);
        const activa = this.cogida ? a.asa === this.cogida.asa : a.asa === this.bajo;
        const r = activa ? 5.5 : 4;
        ctx.beginPath();
        if (a.asa === "centro") ctx.arc(x, y, r + 0.5, 0, 2 * Math.PI);
        else ctx.rect(Math.round(x - r) + 0.5, Math.round(y - r) + 0.5, 2 * r, 2 * r);
        ctx.fillStyle = activa ? c.seleccion : c.panel;
        ctx.strokeStyle = c.seleccion;
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      }
    }
    if (this.nuevo && this.primero && this.q && this.primero.losa.planta === planta) {
      const zona = this.zonaNueva(this.primero.losa, this.primero.p, this.q);
      const n = this.nuevo;
      if (zona) {
        const zp: ZonaPlanta = { ...zonaElemento(this.primero.losa.eje1, n.lista === "refuerzos" ? { refuerzos: [{ armadura: n.armadura, ...zona, barras: { diametro: 12 } }] } : { cercos: [{ direccion: n.direccion, ...zona, cercos: { diametro: 6, separacion: 150 } }] }, { lista: n.lista, indice: 0 })!, ...zona };
        trazo(esquinasZona(zp), [], 2);
        rotulo(asasZona(zp).find((x) => x.asa === "centro")!.p, medidas(zona));
      }
    }
    ctx.restore();
  }
}
