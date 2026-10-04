/**
 * Límites de tamaño por tipo de dispositivo (D9: «el límite se fija en GDL según el dispositivo»;
 * H16). Un modelo que los pasa acaba con `modelo/demasiado-grande` antes de factorizar.
 *
 * **De dónde salen** (el portátil y los móviles de menos memoria, sin medir aún: S5 #2):
 * - **Sobremesa:** S7 estima ≈ 600 000 GDL en 10 s; E0 midió 680 646 ecuaciones con 1,2 GB de
 *   memoria del núcleo en 5,4 s, y su criterio de memoria era ≤ 2,5 GB. La memoria lineal de wasm32
 *   no pasa de 4 GiB.
 * - **Portátil:** la mitad. El edificio objetivo semirrígido (152 250 ecuaciones, 370 MB) cabe.
 * - **Móvil:** lo medido en un iPhone 13 Pro (6 GB, iOS 26.6; E4): calcula todos los tamaños del
 *   banco de dispositivos, hasta 183 330 ecuaciones (malla de 0,5 m) y el semirrígido del edificio
 *   objetivo (152 250 ecuaciones, 369 MB de núcleo, pico estimado 447 MB), tan rápido como el
 *   sobremesa. El límite es lo medido, no el techo del teléfono, que no se alcanzó; un móvil con
 *   menos memoria puede caerse antes.
 * - **Reciclaje:** un worker caliente se queda con el pico de memoria de su último cálculo, y la
 *   mayor parte no es del núcleo: en Chrome, el edificio objetivo con diafragma deja ~800 MB en el
 *   renderer con 128 MB de núcleo, y V8 no los devuelve con el worker en reposo (E4). En portátil y
 *   móvil se recicla tras cada cálculo (un 7–12 % más lento, sin JIT caliente); en sobremesa, sólo
 *   cuando el núcleo pasa de la mitad de su límite.
 */
import type { LimitesCalculo } from "../motor/calcular.ts";

export type PerfilDispositivo = "sobremesa" | "portatil" | "movil";

export interface LimitesDispositivo extends Required<LimitesCalculo> {
  /** Memoria lineal (bytes) a partir de la cual se recicla el worker tras un cálculo. */
  umbralReciclaje: number;
}

const MiB = 2 ** 20;

export const LIMITES: Record<PerfilDispositivo, LimitesDispositivo> = {
  sobremesa: { ecuaciones: 600_000, memoriaNucleo: 2560 * MiB, umbralReciclaje: 1280 * MiB },
  portatil: { ecuaciones: 300_000, memoriaNucleo: 1280 * MiB, umbralReciclaje: 0 },
  movil: { ecuaciones: 200_000, memoriaNucleo: 512 * MiB, umbralReciclaje: 0 },
};

export interface InfoDispositivo {
  movil: boolean;
  /** GB de memoria del equipo según el navegador (`navigator.deviceMemory`: sólo Chromium, redondeado; Chrome 154 da 32 en un equipo de 32 GB). */
  memoriaGB?: number;
}

/** Lo que hace falta de `navigator` (se pasa como argumento para no depender del DOM). */
export interface NavegadorParcial {
  userAgent: string;
  maxTouchPoints?: number;
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
}

/** Móvil o tableta por `userAgentData` o por el agente de usuario; el iPad se presenta como Mac táctil. */
export function infoNavegador(nav: NavegadorParcial): InfoDispositivo {
  const ua = nav.userAgent;
  const ipad = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  const movil = nav.userAgentData?.mobile ?? (/Android|iPhone|iPad|iPod|Mobile/.test(ua) || ipad);
  return { movil: movil || ipad, memoriaGB: nav.deviceMemory };
}

/**
 * Perfil del dispositivo. Sin `deviceMemory` (Safari, Firefox) no se sabe si es un portátil: se
 * toma el perfil prudente.
 */
export function perfilDispositivo(info: InfoDispositivo): PerfilDispositivo {
  if (info.movil) return "movil";
  if (info.memoriaGB !== undefined && info.memoriaGB >= 8) return "sobremesa";
  return "portatil";
}
