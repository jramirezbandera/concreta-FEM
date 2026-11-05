/**
 * Las entidades de un DWG traducidas a sus pares de DXF (fase DW): los códigos de grupo que lee
 * `aplanar.ts`, con los valores que escribe AutoCAD (ángulos en grados; espesor, extrusión y
 * escalas sólo si no son los de por defecto). Portado de ACadSharp
 * (`IO/DWG/DwgStreamReaders/DwgObjectReader.cs`; MIT, commit d9f3de8, citado en `NOTICE`).
 *
 * Una entidad que `aplanar.ts` no dibuja (sombreados, sólidos 3D, rayos…) sale sólo con su tipo,
 * para que cuente entre las «no leídas» igual que en el DXF.
 *
 * Puro: sin IO, sin React ni DOM.
 */

import { ErrorDxf } from "../dxf/lector.ts";
import type { Entidad } from "./objetos.ts";
import { TIPO } from "./objetos.ts";
import type { Version } from "./version.ts";

const GRADOS = 180 / Math.PI;

/** Una entidad traducida: su tipo de DXF, sus pares y lo que se resuelve después (el bloque). */
export interface Traducida {
  tipo: string;
  codigos: number[];
  valores: string[];
  /** El handle del BLOCK_HEADER de un INSERT o una DIMENSION: su nombre va en el código 2. */
  bloque?: number;
  /** Desde 2004, los vértices de una POLYLINE o los atributos de un INSERT, en su orden. */
  propias?: number[];
}

/** El nombre de DXF de cada tipo fijo de entidad. */
/** El tipo de cada cota en el código 70 del DXF (los 3 bits bajos). */
const TIPO_COTA: Readonly<Record<number, number>> = {
  [TIPO.DIMENSION_LINEAR]: 0,
  [TIPO.DIMENSION_ALIGNED]: 1,
  [TIPO.DIMENSION_ANG_2LN]: 2,
  [TIPO.DIMENSION_DIAMETER]: 3,
  [TIPO.DIMENSION_RADIUS]: 4,
  [TIPO.DIMENSION_ANG_3PT]: 5,
  [TIPO.DIMENSION_ORDINATE]: 6,
};

export const NOMBRE_DXF: Readonly<Record<number, string>> = {
  [TIPO.TEXT]: "TEXT",
  [TIPO.ATTRIB]: "ATTRIB",
  [TIPO.ATTDEF]: "ATTDEF",
  [TIPO.BLOCK]: "BLOCK",
  [TIPO.ENDBLK]: "ENDBLK",
  [TIPO.SEQEND]: "SEQEND",
  [TIPO.INSERT]: "INSERT",
  [TIPO.MINSERT]: "INSERT",
  [TIPO.VERTEX_2D]: "VERTEX",
  [TIPO.VERTEX_3D]: "VERTEX",
  [TIPO.VERTEX_MESH]: "VERTEX",
  [TIPO.VERTEX_PFACE]: "VERTEX",
  [TIPO.VERTEX_PFACE_FACE]: "VERTEX",
  [TIPO.POLYLINE_2D]: "POLYLINE",
  [TIPO.POLYLINE_3D]: "POLYLINE",
  [TIPO.ARC]: "ARC",
  [TIPO.CIRCLE]: "CIRCLE",
  [TIPO.LINE]: "LINE",
  [TIPO.DIMENSION_ORDINATE]: "DIMENSION",
  [TIPO.DIMENSION_LINEAR]: "DIMENSION",
  [TIPO.DIMENSION_ALIGNED]: "DIMENSION",
  [TIPO.DIMENSION_ANG_3PT]: "DIMENSION",
  [TIPO.DIMENSION_ANG_2LN]: "DIMENSION",
  [TIPO.DIMENSION_RADIUS]: "DIMENSION",
  [TIPO.DIMENSION_DIAMETER]: "DIMENSION",
  [TIPO.POINT]: "POINT",
  [TIPO.FACE3D]: "3DFACE",
  [TIPO.POLYLINE_PFACE]: "POLYLINE",
  [TIPO.POLYLINE_MESH]: "POLYLINE",
  [TIPO.SOLID]: "SOLID",
  [TIPO.TRACE]: "TRACE",
  [TIPO.SHAPE]: "SHAPE",
  [TIPO.VIEWPORT]: "VIEWPORT",
  [TIPO.ELLIPSE]: "ELLIPSE",
  [TIPO.SPLINE]: "SPLINE",
  [TIPO.REGION]: "REGION",
  [TIPO.SOLID3D]: "3DSOLID",
  [TIPO.BODY]: "BODY",
  [TIPO.RAY]: "RAY",
  [TIPO.XLINE]: "XLINE",
  [TIPO.OLEFRAME]: "OLEFRAME",
  [TIPO.MTEXT]: "MTEXT",
  [TIPO.LEADER]: "LEADER",
  [TIPO.TOLERANCE]: "TOLERANCE",
  [TIPO.MLINE]: "MLINE",
  [TIPO.OLE2FRAME]: "OLE2FRAME",
  [TIPO.LWPOLYLINE]: "LWPOLYLINE",
  [TIPO.HATCH]: "HATCH",
  0x1f2: "ACAD_PROXY_ENTITY",
};

class Pares implements Traducida {
  codigos: number[] = [];
  valores: string[] = [];
  bloque?: number;
  propias?: number[];
  readonly tipo: string;
  constructor(tipo: string) {
    this.tipo = tipo;
  }
  p(c: number, v: number | string): void {
    this.codigos.push(c);
    this.valores.push(typeof v === "number" ? String(v) : v);
  }
  /** Un punto en los códigos c, c + 10 y c + 20. */
  pt(c: number, v: readonly number[]): void {
    this.p(c, v[0]!);
    this.p(c + 10, v[1]!);
    this.p(c + 20, v[2] ?? 0);
  }
  /** Sólo si no es el de por defecto. */
  si(c: number, v: number, def: number): void {
    if (v !== def) this.p(c, v);
  }
  extrusion(e: readonly number[]): void {
    if (e[0] !== 0 || e[1] !== 0 || e[2] !== 1) this.pt(210, e);
  }
}

/** Una entidad sin traducir: sólo su tipo, para que se cuente como no leída. */
export function soloTipo(tipo: string): Traducida {
  return new Pares(tipo);
}

/**
 * La traducción de la entidad `e` (con su cabecera común ya leída), o sólo su tipo si `aplanar.ts`
 * no la dibuja. Lee los flujos de `e` en su orden.
 */
export function traducir(v: Version, e: Entidad): Traducida {
  const { d, h } = e.f;
  const tv = () => e.f.tv();
  /** Desde 2004: n handles de lo que es suyo (vértices o atributos). */
  const propias = (n: number) => {
    r.propias = [];
    for (let i = 0; i < n; i++) r.propias.push(h.H());
  };
  const nombre = NOMBRE_DXF[e.tipo];
  if (!nombre) throw new ErrorDxf(`Tipo de entidad sin nombre: ${e.tipo}.`);
  const r = new Pares(nombre);

  switch (e.tipo) {
    case TIPO.LINE: {
      let a: number[];
      let b: number[];
      if (v.r13_14) {
        a = d.BD3();
        b = d.BD3();
      } else {
        const zCero = d.B() === 1;
        const x0 = d.RD();
        const x1 = d.DD(x0);
        const y0 = d.RD();
        const y1 = d.DD(y0);
        let z0 = 0;
        let z1 = 0;
        if (!zCero) {
          z0 = d.RD();
          z1 = d.DD(z0);
        }
        a = [x0, y0, z0];
        b = [x1, y1, z1];
      }
      r.si(39, d.BT(v.r2000), 0);
      r.pt(10, a);
      r.pt(11, b);
      r.extrusion(d.BE(v.r2000));
      return r;
    }

    case TIPO.CIRCLE:
    case TIPO.ARC: {
      const c = d.BD3();
      const radio = d.BD();
      r.si(39, d.BT(v.r2000), 0);
      const ext = d.BE(v.r2000);
      r.pt(10, c);
      r.p(40, radio);
      r.extrusion(ext);
      if (e.tipo === TIPO.ARC) {
        r.p(50, d.BD() * GRADOS);
        r.p(51, d.BD() * GRADOS);
      }
      return r;
    }

    case TIPO.POINT: {
      r.pt(10, d.BD3());
      r.si(39, d.BT(v.r2000), 0);
      r.extrusion(d.BE(v.r2000));
      return r;
    }

    case TIPO.ELLIPSE: {
      r.pt(10, d.BD3());
      r.pt(11, d.BD3());
      r.extrusion(d.BD3());
      r.p(40, d.BD());
      r.p(41, d.BD());
      r.p(42, d.BD());
      return r;
    }

    case TIPO.SOLID:
    case TIPO.TRACE: {
      r.si(39, d.BT(v.r2000), 0);
      const z = d.BD();
      for (const c of [10, 11, 12, 13]) {
        const [x, y] = d.RD2();
        r.pt(c, [x, y, z]);
      }
      r.extrusion(d.BE(v.r2000));
      return r;
    }

    case TIPO.FACE3D: {
      let ps: number[][];
      let flags = 0;
      if (v.r13_14) {
        ps = [d.BD3(), d.BD3(), d.BD3(), d.BD3()];
        flags = d.BS();
      } else {
        const sinFlags = d.B() === 1;
        const zCero = d.B() === 1;
        const p0 = [d.RD(), d.RD(), 0];
        if (!zCero) p0[2] = d.RD();
        ps = [p0];
        for (let i = 1; i < 4; i++) {
          const q = ps[i - 1]!;
          ps.push([d.DD(q[0]!), d.DD(q[1]!), d.DD(q[2]!)]);
        }
        if (!sinFlags) flags = d.BS();
      }
      [10, 11, 12, 13].forEach((c, i) => r.pt(c, ps[i]!));
      r.si(70, flags, 0);
      return r;
    }

    case TIPO.LWPOLYLINE: {
      const flags = d.BS();
      let ancho = 0;
      let elevacion = 0;
      let espesor = 0;
      let normal = [0, 0, 1];
      if (flags & 0x4) ancho = d.BD();
      if (flags & 0x8) elevacion = d.BD();
      if (flags & 0x2) espesor = d.BD();
      if (flags & 0x1) normal = d.BD3();
      const nv = d.cuenta(d.BL(), 4);
      const nb = flags & 0x10 ? d.cuenta(d.BL(), 2) : 0;
      const ni = flags & 0x400 ? d.cuenta(d.BL(), 2) : 0;
      const na = flags & 0x20 ? d.cuenta(d.BL(), 4) : 0;
      if (nb > nv || na > nv || ni > nv) throw new ErrorDxf("Una LWPOLYLINE con un número de vértices imposible.");
      const vs: [number, number][] = [];
      if (v.r13_14) for (let i = 0; i < nv; i++) vs.push(d.RD2());
      else if (nv > 0) {
        vs.push(d.RD2());
        for (let i = 1; i < nv; i++) {
          const q = vs[i - 1]!;
          vs.push([d.DD(q[0]), d.DD(q[1])]);
        }
      }
      const bulges = Array.from({ length: nb }, () => d.BD());
      for (let i = 0; i < ni; i++) d.BL();
      const anchos = Array.from({ length: na }, () => [d.BD(), d.BD()] as const);
      r.p(90, nv);
      r.p(70, (flags & 0x200 ? 1 : 0) | (flags & 0x100 ? 128 : 0));
      r.si(43, ancho, 0);
      r.si(38, elevacion, 0);
      r.si(39, espesor, 0);
      for (let i = 0; i < nv; i++) {
        r.p(10, vs[i]![0]);
        r.p(20, vs[i]![1]);
        if (anchos[i]) {
          r.si(40, anchos[i]![0], 0);
          r.si(41, anchos[i]![1], 0);
        }
        r.si(42, bulges[i] ?? 0, 0);
      }
      r.extrusion(normal);
      return r;
    }

    case TIPO.POLYLINE_2D: {
      const flags = d.BS();
      d.BS(); // tipo de curva
      d.BD(); // ancho inicial
      d.BD(); // ancho final
      const espesor = d.BT(v.r2000);
      const elevacion = d.BD();
      const normal = d.BE(v.r2000);
      if (v.r2004) propias(h.cuenta(d.BL(), 8));
      r.pt(10, [0, 0, elevacion]);
      r.si(39, espesor, 0);
      r.p(70, flags);
      r.extrusion(normal);
      return r;
    }

    case TIPO.POLYLINE_3D: {
      const curva = d.RC();
      const cerrada = d.RC();
      if (v.r2004) propias(h.cuenta(d.BL(), 8));
      r.pt(10, [0, 0, 0]);
      r.p(70, 8 | (cerrada & 1) | (curva & 3 ? 4 : 0));
      return r;
    }

    case TIPO.POLYLINE_PFACE:
      r.p(70, 64);
      return r;

    case TIPO.POLYLINE_MESH:
      r.p(70, d.BS() | 16);
      return r;

    case TIPO.VERTEX_2D: {
      const flags = d.RC();
      const p = d.BD3();
      const a = d.BD();
      if (a >= 0) d.BD();
      const bulge = d.BD();
      r.pt(10, p);
      r.si(42, bulge, 0);
      r.p(70, flags);
      return r;
    }

    case TIPO.VERTEX_3D:
    case TIPO.VERTEX_MESH:
    case TIPO.VERTEX_PFACE: {
      const flags = d.RC();
      r.pt(10, d.BD3());
      r.p(70, flags);
      return r;
    }

    case TIPO.SPLINE: {
      let escenario = d.BL();
      if (v.r2013) {
        const f1 = d.BL();
        const nudo = d.BL();
        // Desde 2013, una spline hecha por ajuste guarda sólo el ajuste (DW3-5: los puntos de control del DXF los calcula AutoCAD al exportar)
        escenario = nudo === 15 || (f1 & 8) === 0 ? 1 : 2;
      }
      const grado = d.BL();
      let flags = 0;
      let nn = 0;
      let nc = 0;
      let nf = 0;
      let pesos = false;
      if (escenario === 1) {
        if (d.B()) flags |= 4;
        if (d.B()) flags |= 1;
        if (d.B()) flags |= 2;
        d.BD(); // tolerancia de nudos
        d.BD(); // tolerancia de control
        nn = d.cuenta(d.BL(), 2);
        nc = d.cuenta(d.BL(), 6);
        pesos = d.B() === 1;
      } else if (escenario === 2) {
        d.BD(); // tolerancia de ajuste
        d.BD3(); // tangente inicial
        d.BD3(); // tangente final
        nf = d.cuenta(d.BL(), 6);
      } else throw new ErrorDxf(`Una SPLINE con el escenario ${escenario}.`);
      const nudos = Array.from({ length: nn }, () => d.BD());
      const ctrl: number[][] = [];
      const w: number[] = [];
      for (let i = 0; i < nc; i++) {
        ctrl.push(d.BD3());
        if (pesos) w.push(d.BD());
      }
      const ajuste = Array.from({ length: nf }, () => d.BD3());
      r.p(70, flags);
      r.p(71, grado);
      for (const k of nudos) r.p(40, k);
      if (pesos) for (const x of w) r.p(41, x);
      for (const c of ctrl) r.pt(10, c);
      for (const c of ajuste) r.pt(11, c);
      return r;
    }

    case TIPO.LEADER: {
      d.B();
      d.BS(); // tipo de anotación
      d.BS(); // tipo de camino
      const n = d.cuenta(d.BL(), 6);
      const ps = Array.from({ length: n }, () => d.BD3());
      d.BD3(); // origen
      const normal = d.BD3();
      for (const p of ps) r.pt(10, p);
      r.extrusion(normal);
      return r;
    }

    case TIPO.TEXT:
    case TIPO.ATTRIB:
    case TIPO.ATTDEF: {
      if (e.tipo === TIPO.ATTDEF) return r; // no se dibuja
      texto(v, e, r);
      if (e.tipo === TIPO.ATTRIB) {
        // Lo común de los atributos: etiqueta, longitud y banderas (70)
        if (v.r2010) d.RC();
        // De varias líneas (2018): su texto va en un MTEXT incrustado y el principal, vacío, como en el
        // DXF; ni uno ni otro lo dibujan (DW3-6). Se queda con lo leído.
        if (v.r2018 && d.RC() > 1) return r;
        r.p(2, tv());
        d.BS();
        r.p(70, d.RC());
      }
      return r;
    }

    case TIPO.MTEXT: {
      const p = d.BD3();
      const normal = d.BD3();
      const dir = d.BD3();
      const ancho = d.BD();
      if (v.r2007) d.BD();
      const alto = d.BD();
      const adjunto = d.BS();
      const sentido = d.BS();
      d.BD();
      d.BD();
      const s = tv();
      r.pt(10, p);
      r.p(40, alto);
      r.p(41, ancho);
      r.p(71, adjunto);
      r.p(72, sentido);
      r.p(1, s);
      r.extrusion(normal);
      r.pt(11, dir);
      return r;
    }

    case TIPO.INSERT:
    case TIPO.MINSERT: {
      const p = d.BD3();
      let s = [1, 1, 1];
      if (v.r13_14) s = d.BD3();
      else
        switch (d.BB()) {
          case 0: {
            const x = d.RD();
            s = [x, d.DD(x), d.DD(x)];
            break;
          }
          case 1:
            s = [1, d.DD(1), d.DD(1)];
            break;
          case 2: {
            const x = d.RD();
            s = [x, x, x];
            break;
          }
          default:
            s = [1, 1, 1];
        }
      const giro = d.BD();
      const normal = d.BD3();
      const atributos = d.B() === 1;
      const nAtributos = v.r2004 && atributos ? h.cuenta(d.BL(), 8) : 0;
      r.p(2, "");
      r.pt(10, p);
      r.si(41, s[0]!, 1);
      r.si(42, s[1]!, 1);
      r.si(43, s[2]!, 1);
      r.si(50, giro * GRADOS, 0);
      r.extrusion(normal);
      if (atributos) r.p(66, 1);
      if (e.tipo === TIPO.MINSERT) {
        r.si(70, d.BS(), 1);
        r.si(71, d.BS(), 1);
        r.si(44, d.BD(), 0);
        r.si(45, d.BD(), 0);
      }
      r.bloque = h.H();
      if (v.r2004 && atributos) propias(nAtributos);
      return r;
    }

    case TIPO.DIMENSION_ORDINATE:
    case TIPO.DIMENSION_LINEAR:
    case TIPO.DIMENSION_ALIGNED:
    case TIPO.DIMENSION_ANG_3PT:
    case TIPO.DIMENSION_ANG_2LN:
    case TIPO.DIMENSION_RADIUS:
    case TIPO.DIMENSION_DIAMETER: {
      // El bloque anónimo ya lleva el dibujo de la cota. De lo demás, lo que lee `fem importar-dxf`:
      // el tipo y las banderas (70), el texto (1), la medida (42) y, en las lineales y alineadas, sus
      // puntos (13, 14 y 10) y giros (52 y 50). Hasta 2000 no se guarda la medida.
      if (v.r2010) d.RC();
      const normal = d.BD3();
      const medio = d.RD2();
      const z = d.BD();
      // Las banderas: el bit 0 es lo contrario del 128 del código 70 y el bit 1, su 32; en las de
      // coordenadas, el 64 (según X) va en sus datos propios
      const banderas = d.RC();
      const i70 = r.codigos.length;
      r.p(70, TIPO_COTA[e.tipo]! + (banderas & 2 ? 32 : 0) + (banderas & 1 ? 0 : 128));
      const usuario = tv();
      if (usuario) r.p(1, usuario);
      d.BD(); // giro del texto
      d.BD(); // dirección horizontal
      d.BD3(); // escala de la inserción
      d.BD(); // giro de la inserción
      if (v.r2000) {
        d.BS();
        d.BS();
        d.BD();
        r.p(42, d.BD());
      }
      if (v.r2007) {
        d.B();
        d.B();
        d.B();
      }
      const p12 = d.RD2();
      r.p(2, "");
      r.pt(11, [medio[0], medio[1], z]);
      r.pt(12, [p12[0], p12[1], z]);
      if (e.tipo === TIPO.DIMENSION_LINEAR || e.tipo === TIPO.DIMENSION_ALIGNED) {
        r.pt(13, d.BD3());
        r.pt(14, d.BD3());
        r.pt(10, d.BD3());
        r.p(52, (d.BD() * 180) / Math.PI);
        if (e.tipo === TIPO.DIMENSION_LINEAR) r.p(50, (d.BD() * 180) / Math.PI);
      } else if (e.tipo === TIPO.DIMENSION_ORDINATE) {
        r.pt(10, d.BD3());
        r.pt(13, d.BD3());
        r.pt(14, d.BD3());
        if (d.RC() & 1) r.valores[i70] = String(Number(r.valores[i70]) + 64);
      }
      r.extrusion(normal);
      h.H(); // DIMSTYLE
      r.bloque = h.H();
      return r;
    }

    default:
      return r;
  }
}

/** TEXT y ATTRIB: lo común de los textos de una línea (DXF 10, 11, 40, 1, 50, 41, 51, 71, 72, 73 o 74). */
function texto(v: Version, e: Entidad, r: Pares): void {
  const { d } = e.f;
  const vertical = e.tipo === TIPO.ATTRIB ? 74 : 73;
  if (v.r13_14) {
    const z = d.BD();
    const p = d.RD2();
    const a = d.RD2();
    const normal = d.BD3();
    const espesor = d.BD();
    const oblicuo = d.BD();
    const giro = d.BD();
    const alto = d.BD();
    const ancho = d.BD();
    const s = e.f.tv();
    const gen = d.BS();
    const ah = d.BS();
    const av = d.BS();
    r.si(39, espesor, 0);
    r.pt(10, [p[0], p[1], z]);
    r.p(40, alto);
    r.p(1, s);
    r.si(50, giro * GRADOS, 0);
    r.si(41, ancho, 1);
    r.si(51, oblicuo * GRADOS, 0);
    r.si(71, gen, 0);
    r.si(72, ah, 0);
    if (ah !== 0 || av !== 0) r.pt(11, [a[0], a[1], z]);
    r.extrusion(normal);
    r.si(vertical, av, 0);
    return;
  }
  const flags = d.RC();
  const z = flags & 0x1 ? 0 : d.RD();
  const p = d.RD2();
  const a = flags & 0x2 ? null : [d.DD(p[0]), d.DD(p[1])];
  const normal = d.BE(true);
  const espesor = d.BT(true);
  const oblicuo = flags & 0x4 ? 0 : d.RD();
  const giro = flags & 0x8 ? 0 : d.RD();
  const alto = d.RD();
  const ancho = flags & 0x10 ? 1 : d.RD();
  const s = e.f.tv();
  const gen = flags & 0x20 ? 0 : d.BS();
  const ah = flags & 0x40 ? 0 : d.BS();
  const av = flags & 0x80 ? 0 : d.BS();
  r.si(39, espesor, 0);
  r.pt(10, [p[0], p[1], z]);
  r.p(40, alto);
  r.p(1, s);
  r.si(50, giro * GRADOS, 0);
  r.si(41, ancho, 1);
  r.si(51, oblicuo * GRADOS, 0);
  r.si(71, gen, 0);
  r.si(72, ah, 0);
  if (a) r.pt(11, [a[0]!, a[1]!, z]);
  r.extrusion(normal);
  r.si(vertical, av, 0);
}
