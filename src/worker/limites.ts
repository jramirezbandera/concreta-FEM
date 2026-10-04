/**
 * Límites de tamaño por tipo de dispositivo (D9: «el límite se fija en GDL según el dispositivo»;
 * H16). Un modelo que los pasa acaba con `modelo/demasiado-grande` antes de factorizar.
 *
 * **Valores provisionales** hasta medir en portátil y móvil (S5 #2). De dónde salen:
 * - **Sobremesa:** S7 estima ≈ 600 000 GDL en 10 s; E0 midió 680 646 ecuaciones con 1,2 GB de
 *   memoria del núcleo en 5,4 s, y su criterio de memoria era ≤ 2,5 GB. La memoria lineal de wasm32
 *   no pasa de 4 GiB.
 * - **Portátil:** la mitad. El edificio objetivo semirrígido (152 250 ecuaciones, 370 MB) cabe.
 * - **Móvil:** iOS daría entre 300 MB y 1 GB (H16, soporte C). El edificio objetivo con diafragma
 *   rígido (76 146 ecuaciones, 128 MB de núcleo) cabe; el semirrígido, no.
 * - **Reciclaje:** un worker que ha pasado de la mitad de su límite se recicla, para que el
 *   siguiente cálculo empiece con la memoria lineal pequeña (la estimación del pico cuenta con ella).
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
  portatil: { ecuaciones: 300_000, memoriaNucleo: 1280 * MiB, umbralReciclaje: 640 * MiB },
  movil: { ecuaciones: 100_000, memoriaNucleo: 384 * MiB, umbralReciclaje: 192 * MiB },
};

export interface InfoDispositivo {
  movil: boolean;
  /** GB de memoria del equipo según el navegador (`navigator.deviceMemory`: sólo Chromium, y como mucho 8). */
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
