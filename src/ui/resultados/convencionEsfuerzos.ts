// convencionEsfuerzos: convenio de SIGNOS DE PRESENTACION de los esfuerzos y unico
// punto donde se voltea el signo crudo de PyNite (decision de usuario, 2026-07-06).
// PURO, sin dependencias: lo comparten el overlay de esfuerzos (esfuerzosGeometria/
// picosEsfuerzos) y el panel de diagramas por barra (PanelDiagramas). Voltear en
// cualquier OTRO punto intermedio esta prohibido: dos flips se anulan en silencio.
//
// CONVENIO CRUDO DE PYNITE (verificado, no de memoria):
//  - AXIL: COMPRESION POSITIVA. Empirico con el motor real (arnes golden,
//    fixturePesoPropioPilar): pilar comprimido por su peso -> axial = +A·rho·y
//    (+28.6 kN en la base con A=0.09, acero, H=3, ELU), decreciente a 0 en cabeza.
//  - FLECTOR Mz: VANO NEGATIVO. Lo fija el golden tests/golden/combinaciones
//    (viga en +X bajo gravedad -> min_moment_z = -wL²/8 en el vano).
//
// CONVENIO DE PRESENTACION (España/Eurocodigo, lo que ve el arquitecto):
//  - AXIL: TRACCION POSITIVA / compresion negativa.
//  - FLECTOR: VANO POSITIVO (tracciones abajo) / apoyo negativo (tracciones arriba).
//  - CORTANTE y FLECHA: se presentan tal cual (no hay convenio contrario asentado).
//
// LADO DE DIBUJO (solo overlay 3D): el flector se sigue dibujando del lado de las
// TRACCIONES (vano hacia abajo, apoyos hacia arriba). Con el signo de presentacion
// volteado, eso exige invertir tambien el eje de la ordenada del momento
// (LADO_DIBUJO=-1): +vano · (-y_local) = hacia abajo. Axil y cortante mantienen el
// eje local y (el lado es convencional, no comunica traccion/compresion).

import type { MagnitudEsfuerzo } from "../../estado";

// Campos de diagrama del contrato del solver (EstadoMiembroCombo).
export type CampoEsfuerzo = "axial" | "shear_y" | "moment_z" | "defl_y";

// Multiplicador crudo->presentacion por campo del contrato.
export const SIGNO_UI: Record<CampoEsfuerzo, 1 | -1> = {
  axial: -1, // PyNite compresion+ -> presentacion traccion+
  shear_y: 1,
  moment_z: -1, // PyNite vano- -> presentacion vano+
  defl_y: 1,
};

// Multiplicador del EJE de la ordenada del overlay 3D por magnitud (ver cabecera).
export const LADO_DIBUJO: Record<MagnitudEsfuerzo, 1 | -1> = {
  axil: 1,
  cortante: 1,
  momento: -1, // mantiene el flector dibujado del lado de las tracciones
};
