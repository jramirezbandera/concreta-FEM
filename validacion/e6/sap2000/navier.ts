/**
 * La placa ortótropa de Navier de E3 (fase-e3.md, «Pendiente», S5 #21) como modelo de SAP2000, para
 * que el usuario la importe, la calcule y compare con `comparar.ts`: 6 × 4 m, t = 0,30 m,
 * E = 3e7 kN/m², ν = 0,2, Shell-Thick, apoyo simple «hard» (w = 0 y giro tangente nulo en el borde;
 * membrana y giro normal coartados en todos los nudos), q = 10 kN/m² y los multiplicadores
 * m11 = 1, m22 = 0,3, m12 = 0,2, v13 = 0,5, v23 = 0,15. Malla de 0,125 m (48 × 32).
 *
 * Uso: bun validacion/e6/sap2000/navier.ts [h] → validacion/e6/sap2000/navier-ortotropa.$2k
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { escribirTablas, type Registro } from "./s2k.ts";

export function s2kNavier(h = 0.125): string {
  const [a, b, t, E, nu, q] = [6, 4, 0.3, 3e7, 0.2, 10];
  const nx = Math.round(a / h);
  const ny = Math.round(b / h);
  const joint = (i: number, j: number) => String(i * (ny + 1) + j + 1);
  const nudos: Registro[] = [];
  const restricciones: Registro[] = [];
  const yn = (v: boolean) => (v ? "Yes" : "No");
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      nudos.push({ Joint: joint(i, j), CoordSys: "GLOBAL", CoordType: "Cartesian", XorR: String((i * a) / nx), Y: String((j * b) / ny), Z: "0" });
      const bx = i === 0 || i === nx;
      const by = j === 0 || j === ny;
      restricciones.push({ Joint: joint(i, j), U1: "Yes", U2: "Yes", U3: yn(bx || by), R1: yn(bx), R2: yn(by), R3: "Yes" });
    }
  }
  const areas: Registro[] = [];
  const secciones: Registro[] = [];
  const modificadores: Registro[] = [];
  const cargas: Registro[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const id = String(i * ny + j + 1);
      areas.push({ Area: id, NumJoints: "4", Joint1: joint(i, j), Joint2: joint(i + 1, j), Joint3: joint(i + 1, j + 1), Joint4: joint(i, j + 1) });
      secciones.push({ Area: id, Section: "LOSA30", MatProp: "Default" });
      modificadores.push({ Area: id, f11: "1", f22: "1", f12: "1", m11: "1", m22: "0.3", m12: "0.2", v13: "0.5", v23: "0.15", MMod: "1", WMod: "1" });
      cargas.push({ Area: id, LoadPat: "Q", CoordSys: "GLOBAL", Dir: "Gravity", UnifLoad: String(q) });
    }
  }
  return escribirTablas(
    [
      ["PROGRAM CONTROL", [{ ProgramName: "SAP2000", Version: "14.0.0", CurrUnits: "KN, m, C" }]],
      ["ACTIVE DEGREES OF FREEDOM", [{ UX: "Yes", UY: "Yes", UZ: "Yes", RX: "Yes", RY: "Yes", RZ: "Yes" }]],
      ["MATERIAL PROPERTIES 01 - GENERAL", [{ Material: "HA30", Type: "Concrete", SymType: "Isotropic", TempDepend: "No" }]],
      ["MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES", [{ Material: "HA30", UnitWeight: "0", UnitMass: "0", E1: String(E), G12: String(E / (2 * (1 + nu))), U12: String(nu), A1: "1E-05" }]],
      ["AREA SECTION PROPERTIES", [{ Section: "LOSA30", Material: "HA30", MatAngle: "0", AreaType: "Shell", Type: "Shell-Thick", DrillDOF: "Yes", Thickness: String(t), BendThick: String(t) }]],
      ["JOINT COORDINATES", nudos],
      ["CONNECTIVITY - AREA", areas],
      ["AREA SECTION ASSIGNMENTS", secciones],
      ["AREA STIFFNESS MODIFIERS", modificadores],
      ["JOINT RESTRAINT ASSIGNMENTS", restricciones],
      ["LOAD PATTERN DEFINITIONS", [{ LoadPat: "Q", DesignType: "Other", SelfWtMult: "0" }]],
      ["LOAD CASE DEFINITIONS", [{ Case: "Q", Type: "LinStatic", InitialCond: "Zero", DesTypeOpt: "Prog Det", DesignType: "Other", RunCase: "Yes" }]],
      ["CASE - STATIC 1 - LOAD ASSIGNMENTS", [{ Case: "Q", LoadType: "Load pattern", LoadName: "Q", LoadSF: "1" }]],
      ["AREA LOADS - UNIFORM", cargas],
    ],
    "navier-ortotropa.$2k: placa ortótropa de Navier de Concreta FEM (E3/E6)",
  );
}

if (import.meta.main) {
  const h = Number(process.argv[2] ?? 0.125);
  const ruta = join(import.meta.dirname, "navier-ortotropa.$2k");
  writeFileSync(ruta, s2kNavier(h));
  console.log(`Escrito ${ruta} (malla de ${h} m)`);
}
