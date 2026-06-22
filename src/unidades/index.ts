// Sistema de unidades de Concreta · Estructuras (CLAUDE.md §14).
// El modelo interno y el solver trabajan SIEMPRE en kN-m; la conversion vive
// solo en este modulo, en los bordes de entrada/salida.

export const SISTEMA_INTERNO = "kN-m" as const;

export * from "./conversion";
