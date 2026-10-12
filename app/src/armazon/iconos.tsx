/**
 * Iconos de la barra de herramientas que no están en lucide (piezas de estructura y modos de
 * resultados): trazo de 1,5 en una caja de 24, como los de lucide, para que convivan.
 */
import type { ReactNode } from "react";

export type Icono = (p: { size?: number }) => ReactNode;

const icono =
  (d: ReactNode): Icono =>
  ({ size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );

export const IcPilar = icono(
  <>
    <rect x="8.5" y="3" width="7" height="16" rx="1" />
    <path d="M5 21h14" />
  </>,
);
export const IcViga = icono(
  <>
    <rect x="2" y="9" width="20" height="6" rx="1" />
    <path d="M5 15v5M19 15v5" />
  </>,
);
export const IcLosa = icono(
  <>
    <path d="M3 13l5-6h13l-5 6z" />
    <path d="M3 13v3h13l5-6V7M16 13v3" />
  </>,
);
export const IcApoyo = icono(
  <>
    <path d="M12 5l6 10H6z" />
    <path d="M4 18h16M6 18l-2 3M10 18l-2 3M14 18l-2 3M18 18l-2 3" />
  </>,
);
export const IcAPlantas = icono(
  <>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </>,
);
export const IcPlantas = icono(
  <>
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="7" cy="6" r="1" />
  </>,
);
export const IcMateriales = icono(
  <>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </>,
);
export const IcSecciones = icono(<path d="M6 4h12M6 20h12M12 4v16" />);
export const IcPlanta = icono(<rect x="4" y="4" width="16" height="16" rx="1.5" />);
export const Ic3D = icono(
  <>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </>,
);
export const IcCarga = icono(
  <>
    <path d="M6 3v9M12 3v9M18 3v9M4 10l2 2 2-2M10 10l2 2 2-2M16 10l2 2 2-2" />
    <rect x="3" y="15" width="18" height="5" rx="1" />
  </>,
);
export const IcCasos = icono(<path d="M4 6h16M4 12h10M4 18h13" />);
export const IcCombinaciones = icono(<path d="M6 4v16M18 4v16M6 12h12M6 7l12 10" />);
export const IcLosas = icono(
  <>
    <path d="M3 12c3-7 15-7 18 0-3 7-15 7-18 0z" />
    <path d="M8 12c2-3 6-3 8 0-2 3-6 3-8 0z" />
  </>,
);
export const IcDiagramas = icono(
  <>
    <path d="M3 9h18" />
    <path d="M3 9c3 9 6 9 9 5s6-5 9 0" />
  </>,
);
export const IcPilares = icono(
  <>
    <rect x="9" y="6" width="6" height="15" rx="1" />
    <path d="M12 1v3M10 3l2 2 2-2" />
  </>,
);
export const IcDeformada = icono(
  <>
    <path d="M3 18c4 0 5-10 9-10s5 10 9 10" />
    <path d="M3 18h18" strokeDasharray="2 2" />
  </>,
);
export const IcFirma = icono(
  <>
    <path d="M3 17c3 0 4-6 6-6s1 5 3 5 2-3 4-3 2 2 5 2" />
    <path d="M3 21h18" />
  </>,
);
export const IcEjes = icono(
  <>
    <circle cx="6" cy="5" r="2.5" />
    <circle cx="18" cy="5" r="2.5" />
    <path d="M6 7.5V21M18 7.5V21M3 15h18" strokeDasharray="3 2" />
  </>,
);
export const IcAlzado = icono(
  <>
    <path d="M4 20h16M6 20V6M18 20V6M4 6h16M4 13h16" />
  </>,
);
/** Disposiciones de las vistas: una, dos lado a lado, dos una encima de otra y cuatro. */
export const IcDisp1 = icono(<rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />);
export const IcDisp2 = icono(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M12 4.5v15" />
  </>,
);
export const IcDisp3 = icono(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M3.5 12h17" />
  </>,
);
export const IcDisp4 = icono(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M12 4.5v15M3.5 12h17" />
  </>,
);
