/**
 * Lo que se teclea mientras una herramienta pide un punto (V2c-1, `docs/fem3d/dibujo.md` §2.3):
 *
 * | Se teclea   | Significa                                              |
 * |-------------|--------------------------------------------------------|
 * | `x, y`      | coordenadas absolutas                                  |
 * | `@dx, dy`   | relativas al último punto                              |
 * | `@L<ángulo` | polares, en grados desde el eje 1 de la losa           |
 * | `L`         | longitud en la dirección del cursor (con el ortogonal) |
 *
 * Los dos números se separan con «;», con espacios o con una coma seguida de espacio; la coma sin
 * espacio es la decimal, como en las tablas («3,5 4,2» y «3,5; 4,2» son (3,5; 4,2)). Si no hay otro
 * separador y el texto lleva punto decimal, la coma separa, como en los CAD («3.5,4.2»).
 *
 * Puro: sin IO.
 */
import type { Vec2 } from "../../compilador/fisico.ts";
import { ortogonal, unitario } from "./enganches.ts";

export type Entrada = { tipo: "absoluta"; p: Vec2 } | { tipo: "relativa"; d: Vec2 } | { tipo: "polar"; l: number; angulo: number } | { tipo: "longitud"; l: number };

export type Lectura<T> = { ok: true; valor: T } | { ok: false; mensaje: string };

const NUMERO = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/;

function numero(t: string): number | null {
  const s = t.trim();
  if (!NUMERO.test(s)) return null;
  const v = Number(s.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/** Los números de un texto, por sus separadores (cabecera). */
function numeros(t: string): number[] | null {
  const s = t.trim();
  if (!s) return null;
  let partes = s.split(/\s*;\s*|,\s+|\s+/).filter((x) => x !== "");
  if (partes.length === 1 && s.includes(".") && s.includes(",")) partes = s.split(",");
  const r = partes.map(numero);
  return r.some((x) => x === null) ? null : (r as number[]);
}

export function leerEntrada(texto: string): Lectura<Entrada> {
  const t = texto.trim();
  const mal = (m: string): Lectura<Entrada> => ({ ok: false, mensaje: m });
  if (!t) return mal("Escriba un punto: «x; y», «@dx; dy», «@L<ángulo» o una longitud.");
  if (t.startsWith("@")) {
    const r = t.slice(1);
    if (r.includes("<")) {
      const [a, b, ...resto] = r.split("<");
      const l = numero(a ?? "");
      const g = numero(b ?? "");
      if (resto.length || l === null || g === null) return mal(`«${t}» no es «@L<ángulo»: longitud y ángulo en grados (p. ej. «@5<90»).`);
      return { ok: true, valor: { tipo: "polar", l, angulo: g } };
    }
    const n = numeros(r);
    if (!n || n.length !== 2) return mal(`«${t}» no es «@dx; dy»: dos números (p. ej. «@6; 0» o «@6,5 0»).`);
    return { ok: true, valor: { tipo: "relativa", d: [n[0]!, n[1]!] } };
  }
  const n = numeros(t);
  if (n?.length === 1) return { ok: true, valor: { tipo: "longitud", l: n[0]! } };
  if (n?.length === 2) return { ok: true, valor: { tipo: "absoluta", p: [n[0]!, n[1]!] } };
  return mal(`«${t}» no es un punto: «x; y» (p. ej. «12,5; 4»), «@dx; dy», «@L<ángulo» o una longitud.`);
}

export interface ContextoEntrada {
  /** El último punto del segmento en curso (las relativas, las polares y la longitud lo necesitan). */
  ultimo: Vec2 | null;
  /** El cursor (la dirección de una longitud). */
  cursor: Vec2 | null;
  /** Dirección del eje 1 de la losa, grados desde +X. */
  direccion: number;
  /** El ortogonal está puesto (F8) o se pulsa Mayús (también a 45°). */
  orto: boolean;
  mayus: boolean;
}

/** El punto de una entrada. */
export function resolverEntrada(e: Entrada, c: ContextoEntrada): Lectura<Vec2> {
  if (e.tipo === "absoluta") return { ok: true, valor: e.p };
  const u = c.ultimo;
  if (!u) return { ok: false, mensaje: "No hay un punto anterior: el primero va con «x; y» o con un clic." };
  if (e.tipo === "relativa") return { ok: true, valor: [u[0] + e.d[0], u[1] + e.d[1]] };
  if (e.tipo === "polar") {
    const d = unitario(c.direccion + e.angulo);
    return { ok: true, valor: [u[0] + e.l * d[0], u[1] + e.l * d[1]] };
  }
  const q = c.cursor && (c.orto || c.mayus) ? ortogonal(u, c.cursor, c.direccion, c.mayus) : c.cursor;
  const dx = q ? q[0] - u[0] : 0;
  const dy = q ? q[1] - u[1] : 0;
  const l = Math.hypot(dx, dy);
  if (!(l > 0)) return { ok: false, mensaje: "Mueva el cursor hacia donde va la longitud, o escriba «@L<ángulo»." };
  // En los ejes, la otra coordenada es la del punto anterior, bit a bit
  if (dy === 0) return { ok: true, valor: [u[0] + Math.sign(dx) * e.l, u[1]] };
  if (dx === 0) return { ok: true, valor: [u[0], u[1] + Math.sign(dy) * e.l] };
  return { ok: true, valor: [u[0] + (e.l * dx) / l, u[1] + (e.l * dy) / l] };
}
