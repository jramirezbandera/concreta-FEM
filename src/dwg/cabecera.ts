/**
 * La sección de variables de la cabecera (AcDb:Header) de un DWG, hasta `$INSUNITS` (fase DW).
 * Portado de ACadSharp (`IO/DWG/DwgStreamReaders/DwgHeaderReader.cs`, MIT, commit d9f3de8,
 * citado en `NOTICE`): las variables van una detrás de otra, sin nombres, así que para llegar a
 * `$INSUNITS` hay que leer todas las de antes en su orden y con su tipo. Además de `$INSUNITS`, se
 * guardan `$EXTMIN` y `$EXTMAX` del espacio modelo, que el DXF también tiene: si coinciden, la
 * lectura no se ha descolocado por el camino.
 *
 * Puro: sin IO, sin React ni DOM.
 */

import type { Bits } from "./bits.ts";
import type { Version } from "./version.ts";

export interface CabeceraDwg {
  /** `$INSUNITS` (desde R2000), o null. */
  insunits: number | null;
  extmin: [number, number, number];
  extmax: [number, number, number];
}

/**
 * Los flujos de un objeto o de la cabecera: datos, cadenas y handles. Hasta 2007, las cadenas van en
 * los datos; desde 2007, aparte (null si no tiene ninguna). `tv` lee un texto de donde toca: TV en
 * la página de códigos hasta 2007 y TU (UTF-16) desde entonces.
 */
export interface Flujos {
  d: Bits;
  t: Bits | null;
  h: Bits;
  tv(): string;
}

export function hacerFlujos(v: Version, d: Bits, t: Bits | null, h: Bits, dec: TextDecoder): Flujos {
  return { d, t, h, tv: () => (t === null ? "" : v.r2007 ? t.TU() : t.TV(dec)) };
}

/**
 * Un color CMC: su índice (256 = por capa). Hasta 2000, BS con el índice. Desde 2004, BS (0), BL con
 * el RGB y un RC con lo que sigue: el nombre del color y el del libro (texto, en las cadenas).
 */
export function cmc(v: Version, f: Flujos): number {
  if (!v.r2004) return f.d.BS();
  f.d.BS();
  const rgb = f.d.BL() >>> 0;
  const id = f.d.RC();
  if (id & 1) f.tv();
  if (id & 2) f.tv();
  if (rgb === 0xc0000000) return 256;
  return rgb & 0x01000000 ? rgb & 0xff : 0;
}

export function leerCabecera(v: Version, f: Flujos): CabeceraDwg {
  const { d, h } = f;
  const tv = () => f.tv();
  const bd = (n: number) => {
    for (let i = 0; i < n; i++) d.BD();
  };
  const bs = (n: number) => {
    for (let i = 0; i < n; i++) d.BS();
  };
  const b = (n: number) => {
    for (let i = 0; i < n; i++) d.B();
  };
  const hs = (n: number) => {
    for (let i = 0; i < n; i++) h.H();
  };

  if (v.r2013) d.BLL();
  bd(4); // desconocidos
  for (let i = 0; i < 4; i++) tv();
  d.BL();
  d.BL();
  if (v.r13_14) d.BS();
  if (v.r2004pre) h.H(); // viewport actual
  b(2); // DIMASO, DIMSHO
  if (v.r13_14) b(1); // DIMSAV
  b(7); // PLINEGEN, ORTHOMODE, REGENMODE, FILLMODE, QTEXTMODE, PSLTSCALE, LIMCHECK
  if (v.r13_14) b(1); // BLIPMODE
  if (v.r2004) b(1);
  b(4); // USRTIMER, SKPOLY, ANGDIR, SPLFRAME
  if (v.r13_14) b(2);
  b(2); // MIRRTEXT, WORLDVIEW
  if (v.r13_14) b(1);
  b(3); // TILEMODE, PLIMCHECK, VISRETAIN
  if (v.r13_14) b(1);
  b(2); // DISPSILH, PELLIPSE
  bs(1); // PROXYGRAPHICS
  if (v.r13_14) bs(1);
  bs(5); // TREEDEPTH, LUNITS, LUPREC, AUNITS, AUPREC
  if (v.r13_14) bs(1); // OSMODE
  bs(1); // ATTMODE
  if (v.r13_14) bs(1);
  bs(1); // PDMODE
  if (v.r13_14) bs(1);
  if (v.r2004) {
    d.BL();
    d.BL();
    d.BL();
  }
  bs(18); // USERI1–5, SPLINESEGS, SURFU, SURFV, SURFTYPE, SURFTAB1–2, SPLINETYPE, SHADEDGE, SHADEDIF, UNITMODE, MAXACTVP, ISOLINES, CMLJUST
  bs(1); // TEXTQLTY
  bd(21); // LTSCALE … CELTSCALE
  tv(); // MENU
  d.BL(); // TDCREATE
  d.BL();
  d.BL(); // TDUPDATE
  d.BL();
  if (v.r2004) {
    d.BL();
    d.BL();
    d.BL();
  }
  d.BL(); // TDINDWG
  d.BL();
  d.BL(); // TDUSRTIMER
  d.BL();
  cmc(v, f); // CECOLOR
  d.H(); // HANDSEED, en el flujo de datos
  hs(3); // CLAYER, TEXTSTYLE, CELTYPE
  if (v.r2007) hs(1); // CMATERIAL
  hs(2); // DIMSTYLE, CMLSTYLE
  if (v.r2000) bd(1); // PSVPSCALE
  bd(9); // PINSBASE, PEXTMIN, PEXTMAX (3BD)
  d.RD2(); // PLIMMIN
  d.RD2(); // PLIMMAX
  bd(1); // PELEVATION
  bd(9); // PUCSORG, PUCSXDIR, PUCSYDIR
  hs(1); // PUCSNAME
  if (v.r2000) {
    hs(1); // PUCSORTHOREF
    bs(1); // PUCSORTHOVIEW
    hs(1); // PUCSBASE
    bd(18); // PUCSORGTOP … PUCSORGBACK
  }
  bd(3); // INSBASE
  const extmin = d.BD3();
  const extmax = d.BD3();
  d.RD2(); // LIMMIN
  d.RD2(); // LIMMAX
  bd(1); // ELEVATION
  bd(9); // UCSORG, UCSXDIR, UCSYDIR
  hs(1); // UCSNAME
  if (v.r2000) {
    hs(1); // UCSORTHOREF
    bs(1); // UCSORTHOVIEW
    hs(1); // UCSBASE
    bd(18); // UCSORGTOP … UCSORGBACK
    tv(); // DIMPOST
    tv(); // DIMAPOST
  }
  if (v.r13_14) {
    b(11); // DIMTOL … DIMSOXD
    d.RC(); // DIMALTD
    d.RC(); // DIMZIN
    b(2); // DIMSD1, DIMSD2
    d.RC(); // DIMTOLJ
    d.RC(); // DIMJUST
    d.RC(); // DIMFIT
    b(1); // DIMUPT
    d.RC(); // DIMTZIN
    d.RC(); // DIMALTZ
    d.RC(); // DIMALTTZ
    d.RC(); // DIMTAD
    bs(6); // DIMUNIT, DIMAUNIT, DIMDEC, DIMTDEC, DIMALTU, DIMALTTD
    hs(1); // DIMTXSTY
  }
  bd(9); // DIMSCALE … DIMTM
  if (v.r2007) {
    bd(2); // DIMFXL, DIMJOGANG
    bs(1); // DIMTFILL
    cmc(v, f); // DIMTFILLCLR
  }
  if (v.r2000) {
    b(6); // DIMTOL, DIMLIM, DIMTIH, DIMTOH, DIMSE1, DIMSE2
    bs(3); // DIMTAD, DIMZIN, DIMAZIN
  }
  if (v.r2007) bs(1); // DIMARCSYM
  bd(8); // DIMTXT … DIMGAP
  if (v.r13_14) for (let i = 0; i < 5; i++) tv(); // DIMPOST, DIMAPOST, DIMBLK, DIMBLK1, DIMBLK2
  if (v.r2000) {
    bd(1); // DIMALTRND
    b(1); // DIMALT
    bs(1); // DIMALTD
    b(4); // DIMTOFL, DIMSAH, DIMTIX, DIMSOXD
  }
  cmc(v, f); // DIMCLRD
  cmc(v, f); // DIMCLRE
  cmc(v, f); // DIMCLRT
  if (v.r2000) {
    bs(11); // DIMADEC … DIMJUST
    b(2); // DIMSD1, DIMSD2
    bs(4); // DIMTOLJ, DIMTZIN, DIMALTZ, DIMALTTZ
    b(1); // DIMUPT
    bs(1); // DIMATFIT
  }
  if (v.r2007) b(1); // DIMFXLON
  if (v.r2010) {
    b(1); // DIMTXTDIRECTION
    bd(1); // DIMALTMZF
    tv(); // DIMALTMZS
    bd(1); // DIMMZF
    tv(); // DIMMZS
  }
  if (v.r2000) hs(5); // DIMTXSTY, DIMLDRBLK, DIMBLK, DIMBLK1, DIMBLK2
  if (v.r2007) hs(3); // DIMLTYPE, DIMLTEX1, DIMLTEX2
  if (v.r2000) bs(2); // DIMLWD, DIMLWE
  hs(9); // los objetos de control: BLOCK … DIMSTYLE
  if (v.r13_15) hs(1); // VP_ENT_HDR
  hs(3); // ACAD_GROUP, ACAD_MLINESTYLE, diccionario de objetos con nombre
  let insunits: number | null = null;
  if (v.r2000) {
    bs(2); // TSTACKALIGN, TSTACKSIZE
    tv(); // HYPERLINKBASE
    tv(); // STYLESHEET
    hs(3); // LAYOUTS, PLOTSETTINGS, PLOTSTYLES
    if (v.r2004) hs(2); // MATERIALS, COLORS
    if (v.r2007) hs(v.r2013 ? 2 : 1); // VISUALSTYLE
    d.BL(); // banderas: CELWEIGHT, ENDCAPS, JOINSTYLE, LWDISPLAY…
    insunits = d.BS();
  }
  return { insunits, extmin, extmax };
}
