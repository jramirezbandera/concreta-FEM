/**
 * Las versiones de DWG que se leen (fase DW, DW-b) y las banderas con las que el formato cambia,
 * con los nombres de ACadSharp (`IO/DWG/DwgSectionIO.cs`). Puro.
 */

import { ErrorDxf } from "../dxf/lector.ts";

export interface Version {
  /** «AC1015»… */
  nombre: string;
  /** 1014, 1015, 1018, 1021, 1024, 1027 o 1032. */
  n: number;
  r13_14: boolean;
  r13_15: boolean;
  r2000: boolean;
  r2004pre: boolean;
  r2004: boolean;
  r2007: boolean;
  r2010: boolean;
  r2013: boolean;
  r2018: boolean;
}

/** Las versiones del formato y su nombre comercial. */
export const VERSIONES_DWG: Readonly<Record<string, string>> = {
  AC1012: "R13",
  AC1014: "R14",
  AC1015: "2000",
  AC1018: "2004",
  AC1021: "2007",
  AC1024: "2010",
  AC1027: "2013",
  AC1032: "2018",
};

/** Las que se leen ya (los tramos de DW: R13–R2000 en DW1 y DW2; 2004+ en DW3; 2007 en DW5). */
export const VERSIONES_LEIDAS: readonly string[] = ["AC1012", "AC1014", "AC1015"];

export function version(nombre: string): Version {
  const n = /^AC1\d{3}$/.test(nombre) ? Number(nombre.slice(2)) : NaN;
  if (!(nombre in VERSIONES_DWG)) {
    if (Number.isFinite(n) && n < 1012) throw new ErrorDxf(`Es un DWG de antes de R13 (${nombre}): guárdalo como DWG 2010 o 2018, o como DXF.`);
    throw new ErrorDxf(`Es un DWG de una versión que no se conoce (${nombre.replace(/[^\x20-\x7e]/g, "?")}): guárdalo como DWG 2018 o como DXF.`);
  }
  if (!VERSIONES_LEIDAS.includes(nombre))
    throw new ErrorDxf(`Todavía no se leen los DWG ${VERSIONES_DWG[nombre]} (${nombre}): guárdalo como DWG 2000 o como DXF.`);
  return {
    nombre,
    n,
    r13_14: n === 1012 || n === 1014,
    r13_15: n >= 1012 && n <= 1015,
    r2000: n >= 1015,
    r2004pre: n < 1018,
    r2004: n >= 1018,
    r2007: n >= 1021,
    r2010: n >= 1024,
    r2013: n >= 1027,
    r2018: n >= 1032,
  };
}
