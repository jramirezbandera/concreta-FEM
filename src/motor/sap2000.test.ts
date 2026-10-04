/**
 * El puente con SAP2000 de E6 (validacion/e6/sap2000/): lector del formato $2k, importador al modelo
 * analítico y comparador de resultados. Los ejemplos de CSI de la validación (1-004, 1-018 y 1-022)
 * escritos como SAP2000 los escribe tienen que dar, a través del importador y del comparador, los
 * valores publicados: así se comprueba la traducción de ejes locales, secciones, GDL activos,
 * diafragmas, cargas y signos de los esfuerzos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compararConSap } from "../../validacion/e6/sap2000/comparar.ts";
import { importarS2k } from "../../validacion/e6/sap2000/importar.ts";
import { s2kNavier } from "../../validacion/e6/sap2000/navier.ts";
import { escribirTablas, leerTablas, type Registro } from "../../validacion/e6/sap2000/s2k.ts";
import { modeloNavier, CASOS_NAVIER } from "../../validacion/e3/navier.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { calcular } from "./calcular.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const IN = 0.0254;

/** SAP2000 1-004 tal como lo escribe SAP2000 (kip, in): voladizo W12X106 con el eje 2 girado 30°. */
const S2K_1004 = `File C:\\SAP\\Example 1-004.$2k was saved on 1/1/10 at 0:00:00

TABLE:  "PROGRAM CONTROL"
   ProgramName=SAP2000   Version=14.0.0   ProgLevel=Advanced   CurrUnits="Kip, in, F"   SteelCode=AISC360-05/IBC2006

TABLE:  "JOINT COORDINATES"
   Joint=1   CoordSys=GLOBAL   CoordType=Cartesian   XorR=0   Y=0   Z=0   SpecialJt=No   GlobalX=0   GlobalY=0   GlobalZ=0
   Joint=2   CoordSys=GLOBAL   CoordType=Cartesian   XorR=144   Y=0   Z=0   SpecialJt=No   GlobalX=144   GlobalY=0   GlobalZ=0

TABLE:  "MATERIAL PROPERTIES 01 - GENERAL"
   Material=A992Fy50   Type=Steel   SymType=Isotropic   TempDepend=No   Color=Green

TABLE:  "MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES"
   Material=A992Fy50   UnitWeight=0   UnitMass=0   E1=29000   G12=11153.8461538462   U12=0.3   A1=6.5E-06

TABLE:  "FRAME SECTION PROPERTIES 01 - GENERAL"
   SectionName=W12X106   Material=A992Fy50   Shape="I/Wide Flange"   t3=12.9   t2=12.2   tf=0.99   tw=0.61   Area=31.2   TorsConst=9.13   I33=933   I22=301   I23=0   AS2=0   AS3=0 _
        S33=145   S22=49.3   Z33=164   Z22=75.1   R33=5.47   R22=3.11   AMod=1   A2Mod=0   A3Mod=0   JMod=1   I2Mod=1   I3Mod=1   MMod=1   WMod=1

TABLE:  "CONNECTIVITY - FRAME"
   Frame=1   JointI=1   JointJ=2   IsCurved=No   Length=144   CentroidX=72   CentroidY=0   CentroidZ=0

TABLE:  "FRAME SECTION ASSIGNMENTS"
   Frame=1   SectionType="I/Wide Flange"   AutoSelect=N.A.   AnalSect=W12X106   DesignSect=W12X106   MatProp=Default

TABLE:  "FRAME LOCAL AXES ASSIGNMENTS 1 - TYPICAL"
   Frame=1   Angle=30   MirrorAbt2=No   MirrorAbt3=No   AdvanceAxes=No

TABLE:  "JOINT RESTRAINT ASSIGNMENTS"
   Joint=1   U1=Yes   U2=Yes   U3=Yes   R1=Yes   R2=Yes   R3=Yes

TABLE:  "LOAD PATTERN DEFINITIONS"
   LoadPat=LC1   DesignType=OTHER   SelfWtMult=0
   LoadPat=LC2   DesignType=OTHER   SelfWtMult=0
   LoadPat=LC3   DesignType=OTHER   SelfWtMult=0

TABLE:  "FRAME LOADS - DISTRIBUTED"
   Frame=1   LoadPat=LC1   CoordSys=GLOBAL   Type=Force   Dir=Gravity   DistType=RelDist   RelDistA=0   RelDistB=1   AbsDistA=0   AbsDistB=144   FOverLA=0.01   FOverLB=0.01

TABLE:  "JOINT LOADS - FORCE"
   Joint=2   LoadPat=LC2   CoordSys=GLOBAL   F1=0   F2=0   F3=-1   M1=0   M2=0   M3=0
   Joint=2   LoadPat=LC3   CoordSys=GLOBAL   F1=0   F2=0   F3=0   M1=0   M2=240   M3=0

END TABLE DATA
`;

/** SAP2000 1-018 modelo A (kip, in): pórtico plano X-Z con articulación y deslizadera. */
const S2K_1018 = `TABLE:  "PROGRAM CONTROL"
   ProgramName=SAP2000   Version=14.0.0   CurrUnits="Kip, in, F"
TABLE:  "ACTIVE DEGREES OF FREEDOM"
   UX=Yes   UY=No   UZ=Yes   RX=No   RY=Yes   RZ=No
TABLE:  "JOINT COORDINATES"
   Joint=1   CoordSys=GLOBAL   CoordType=Cartesian   XorR=0   Y=0   Z=0
   Joint=2   CoordSys=GLOBAL   CoordType=Cartesian   XorR=0   Y=0   Z=144
   Joint=3   CoordSys=GLOBAL   CoordType=Cartesian   XorR=288   Y=0   Z=0
   Joint=4   CoordSys=GLOBAL   CoordType=Cartesian   XorR=288   Y=0   Z=144
   Joint=5   CoordSys=GLOBAL   CoordType=Cartesian   XorR=144   Y=0   Z=144
TABLE:  "MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES"
   Material=STEEL   UnitWeight=0   E1=29900   G12=11500   U12=0.3
TABLE:  "FRAME SECTION PROPERTIES 01 - GENERAL"
   SectionName=W8X31   Material=STEEL   Shape="I/Wide Flange"   Area=9.12   TorsConst=0.536   I33=110   I22=37.1   AS2=2.28   AS3=6.1
TABLE:  "CONNECTIVITY - FRAME"
   Frame=1   JointI=1   JointJ=2
   Frame=2   JointI=3   JointJ=4
   Frame=3   JointI=2   JointJ=5
   Frame=4   JointI=5   JointJ=4
TABLE:  "FRAME SECTION ASSIGNMENTS"
   Frame=1   AnalSect=W8X31
   Frame=2   AnalSect=W8X31
   Frame=3   AnalSect=W8X31
   Frame=4   AnalSect=W8X31
TABLE:  "JOINT RESTRAINT ASSIGNMENTS"
   Joint=1   U1=Yes   U2=Yes   U3=Yes   R1=No   R2=No   R3=No
   Joint=3   U1=No   U2=No   U3=Yes   R1=No   R2=No   R3=No
TABLE:  "LOAD PATTERN DEFINITIONS"
   LoadPat=G   DesignType=DEAD   SelfWtMult=0
TABLE:  "FRAME LOADS - DISTRIBUTED"
   Frame=3   LoadPat=G   CoordSys=GLOBAL   Type=Force   Dir=Gravity   DistType=RelDist   RelDistA=0   RelDistB=1   FOverLA=0.1   FOverLB=0.1
   Frame=4   LoadPat=G   CoordSys=GLOBAL   Type=Force   Dir=Gravity   DistType=RelDist   RelDistA=0   RelDistB=1   FOverLA=0.1   FOverLB=0.1
END TABLE DATA
`;

/** SAP2000 1-022 (kip, in) generado con las tablas del PDF: pórtico plano de 7 plantas con diafragmas. */
function s2k1022(): string {
  const W: Record<string, [number, number]> = { W14X176: [51.7, 2150], W14X211: [62.1, 2670], W14X246: [72.3, 3230], W14X287: [84.4, 3910], W24X110: [2.5, 3330], W24X130: [38.3, 4020], W24X160: [47.1, 5120] };
  const z = [0, 162, 324, 480, 636, 792, 948, 1104];
  const nudos: Registro[] = [];
  for (let k = 0; k <= 7; k++) for (let c = 0; c < 3; c++) nudos.push({ Joint: String(3 * k + c + 1), CoordSys: "GLOBAL", CoordType: "Cartesian", XorR: String(360 * c), Y: "0", Z: String(z[k]) });
  const extremos = ["W14X246", "W14X246", "W14X246", "W14X211", "W14X211", "W14X176", "W14X176"];
  const centro = ["W14X287", "W14X287", "W14X287", "W14X246", "W14X246", "W14X211", "W14X211"];
  const vigas = ["W24X160", "W24X160", "W24X130", "W24X130", "W24X110", "W24X110", "W24X110"];
  const barras: Registro[] = [];
  const asign: Registro[] = [];
  const barra = (i: number, j: number, s: string) => {
    const f = String(barras.length + 1);
    barras.push({ Frame: f, JointI: String(i), JointJ: String(j), IsCurved: "No" });
    asign.push({ Frame: f, AnalSect: s, MatProp: "Default" });
  };
  for (const [c, secs] of [[0, extremos], [1, centro], [2, extremos]] as const) for (let k = 0; k < 7; k++) barra(3 * k + c + 1, 3 * (k + 1) + c + 1, secs[k]!);
  for (const v of [0, 1]) for (let k = 1; k <= 7; k++) barra(3 * k + v + 1, 3 * k + v + 2, vigas[k - 1]!);
  const restr: Registro[] = [1, 2, 3].map((j) => ({ Joint: String(j), U1: "Yes", U2: "Yes", U3: "Yes", R1: "Yes", R2: "Yes", R3: "Yes" }));
  const diaf: Registro[] = [];
  const defs: Registro[] = [];
  for (let k = 1; k <= 7; k++) {
    defs.push({ Name: `D${k}`, CoordSys: "GLOBAL", Axis: "Z", MultiLevel: "No" });
    for (const c of [1, 0, 2]) diaf.push({ Joint: String(3 * k + c + 1), Constraint: `D${k}`, Type: "Diaphragm" });
  }
  const lat = [2.5, 5, 7.5, 10, 12.5, 15, 20];
  return escribirTablas([
    ["PROGRAM CONTROL", [{ ProgramName: "SAP2000", CurrUnits: "Kip, in, F" }]],
    ["ACTIVE DEGREES OF FREEDOM", [{ UX: "Yes", UY: "No", UZ: "Yes", RX: "No", RY: "Yes", RZ: "No" }]],
    ["JOINT COORDINATES", nudos],
    ["MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES", [{ Material: "STEEL", UnitWeight: "0", E1: "29500", U12: "0.3" }]],
    ["FRAME SECTION PROPERTIES 01 - GENERAL", Object.entries(W).map(([n, [A, I]]) => ({ SectionName: n, Material: "STEEL", Shape: "General", Area: String(A), I33: String(I), I22: String(I / 3), TorsConst: "10", AS2: "0", AS3: "0" }))],
    ["CONNECTIVITY - FRAME", barras],
    ["FRAME SECTION ASSIGNMENTS", asign],
    ["JOINT RESTRAINT ASSIGNMENTS", restr],
    ["CONSTRAINT DEFINITIONS - DIAPHRAGM", defs],
    ["JOINT CONSTRAINT ASSIGNMENTS", diaf],
    ["LOAD PATTERN DEFINITIONS", [{ LoadPat: "LAT", SelfWtMult: "0" }]],
    ["LOAD CASE DEFINITIONS", [{ Case: "LAT", Type: "LinStatic" }]],
    ["CASE - STATIC 1 - LOAD ASSIGNMENTS", [{ Case: "LAT", LoadType: "Load pattern", LoadName: "LAT", LoadSF: "1" }]],
    ["JOINT LOADS - FORCE", lat.map((f, k) => ({ Joint: String(3 * (k + 1) + 1), LoadPat: "LAT", CoordSys: "GLOBAL", F1: String(f), F2: "0", F3: "0", M1: "0", M2: "0", M3: "0" }))],
  ]);
}

describe("E6: puente con SAP2000", () => {
  it("el lector de $2k: comillas, líneas partidas con « _», tablas delimitadas y vuelta por el escritor", () => {
    const t = leerTablas(S2K_1004);
    expect(t.get("FRAME SECTION PROPERTIES 01 - GENERAL")![0]!.WMod).toBe("1");
    expect(t.get("FRAME SECTION PROPERTIES 01 - GENERAL")![0]!.Shape).toBe("I/Wide Flange");
    const tablas: [string, Registro[]][] = [...t].map(([k, v]) => [k, v]);
    expect(leerTablas(escribirTablas(tablas))).toEqual(t);
    const csv = leerTablas('TABLE:  "JOINT DISPLACEMENTS"\nJoint;OutputCase;CaseType;U1;U2;U3\nText;Text;Text;m;m;m\n7;Q;LinStatic;0,001;0;-0,5\n');
    expect(csv.get("JOINT DISPLACEMENTS")).toEqual([{ Joint: "7", OutputCase: "Q", CaseType: "LinStatic", U1: "0,001", U2: "0", U3: "-0,5" }]);
  });

  it("SAP2000 1-004 importado: el eje 2 girado 30° y los 6 valores publicados", () => {
    const imp = importarS2k(leerTablas(S2K_1004));
    expect(imp.errores).toEqual([]);
    const r = casosValidos(calcular(imp.modelo));
    const v = imp.nudos.get("2")!;
    const pub = [[-0.01806, -0.03029], [-0.03345, -0.0561], [-0.08361, -0.14024]];
    r.forEach((c, k) => {
      expect(Math.abs(c.u[6 * v + 1]! / IN - pub[k]![0]!)).toBeLessThanOrEqual(5e-6);
      expect(Math.abs(c.u[6 * v + 2]! / IN - pub[k]![1]!)).toBeLessThanOrEqual(5e-6);
    });
  });

  it("SAP2000 1-018 importado: pórtico plano (GDL activos), cortante por AS2 y −2,77076 in", () => {
    const imp = importarS2k(leerTablas(S2K_1018));
    expect(imp.errores).toEqual([]);
    const [c] = casosValidos(calcular(imp.modelo));
    expect(Math.abs(c!.u[6 * imp.nudos.get("5")! + 2]! / IN + 2.77076)).toBeLessThanOrEqual(5e-6);
  });

  it("SAP2000 1-022 importado y comparado con sus tablas: Ux 22, P y M3 del pilar 1 con los signos de SAP2000", () => {
    const imp = importarS2k(leerTablas(s2k1022()));
    expect(imp.errores).toEqual([]);
    const r = casosValidos(calcular(imp.modelo));
    // Las tablas de resultados de SAP2000 con los valores publicados (p. 6)
    const resultados = leerTablas(
      escribirTablas([
        ["JOINT DISPLACEMENTS", [{ Joint: "22", OutputCase: "LAT", CaseType: "LinStatic", U1: "1.45076", U2: "0", U3: "", R1: "", R2: "", R3: "" }]],
        ["ELEMENT FORCES - FRAMES", [{ Frame: "1", Station: "0", OutputCase: "LAT", CaseType: "LinStatic", P: "69.99", V2: "", V3: "", T: "", M2: "", M3: "2324.68" }]],
      ]),
    );
    const informe = compararConSap(imp, r, resultados).get("LAT")!;
    const g = (n: string) => informe.find((x) => x.nombre === n)!;
    expect(g("desplazamientos (U1–U3)").maxDif / IN).toBeLessThanOrEqual(5e-6);
    expect(g("barras: P").maxDif / 4.4482216152605).toBeLessThanOrEqual(5e-3);
    expect(g("barras: M2, M3").maxDif / (4.4482216152605 * IN)).toBeLessThanOrEqual(5e-3);
  });

  it("la placa de Navier escrita como $2k e importada es el modelo de E3 (mismos resultados a 1e-12)", () => {
    const imp = importarS2k(leerTablas(s2kNavier(0.5)));
    expect(imp.errores).toEqual([]);
    const [a] = casosValidos(calcular(imp.modelo));
    const { modelo, centro } = modeloNavier(CASOS_NAVIER[2]!, 12, 8);
    const [b] = casosValidos(calcular(modelo));
    const w = a!.u[6 * imp.nudos.get(String(6 * 9 + 4 + 1))! + 2]!;
    expect(Math.abs(w / b!.u[6 * centro + 2]! - 1)).toBeLessThan(1e-12);
  });

  it("lo que no se sabe traducir da un error explícito", () => {
    const con = (extra: string) => importarS2k(leerTablas(S2K_1004.replace("END TABLE DATA", `${extra}\nEND TABLE DATA`))).errores.join(" | ");
    expect(con('TABLE:  "FRAME INSERTION POINT ASSIGNMENTS"\n   Frame=1   CardinalPt="8 (Top Center)"   StiffTrans=Yes')).toMatch(/inserción/);
    expect(con('TABLE:  "AREA LOADS - UNIFORM TO FRAME"\n   Area=1   LoadPat=LC1   UnifLoad=3')).toMatch(/UNIFORM TO FRAME/);
    expect(con('TABLE:  "FRAME RELEASE ASSIGNMENTS 1 - GENERAL"\n   Frame=1   M3J=Yes   PartialFix=Yes')).toMatch(/parciales/);
    expect(importarS2k(leerTablas(S2K_1004.replace('CurrUnits="Kip, in, F"', 'CurrUnits="Kip, yd, F"'))).errores.join()).toMatch(/Unidades/);
  });
});
