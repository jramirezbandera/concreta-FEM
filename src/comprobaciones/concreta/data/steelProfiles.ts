// Steel profile catalogue — ArcelorMittal standard values
// Units: h, b, tf, tw, r in mm; A in cm²; Iy, Iz, It in cm⁴; Wpl_y, Wel_y in cm³; Iw in cm⁶

export interface SteelProfile {
  key: string;
  tipo: 'IPE' | 'HEA' | 'HEB' | 'IPN';
  size: number;
  label: string;
  h: number;      // total height (mm)
  b: number;      // flange width (mm)
  tf: number;     // flange thickness (mm)
  tw: number;     // web thickness (mm)
  r: number;      // fillet radius (mm)
  A: number;      // cross-sectional area (cm²)
  Iy: number;     // second moment of area about y-y (cm⁴)
  Iz: number;     // second moment of area about z-z (cm⁴)
  Wpl_y: number;  // plastic section modulus (cm³)
  Wel_y: number;  // elastic section modulus (cm³)
  It: number;     // St. Venant torsional constant (cm⁴)
  Iw: number;     // warping constant (cm⁶)
}

// IPE sections
const IPE_DATA: Array<[number, number, number, number, number, number, number, number, number, number, number, number, number]> = [
  // size,  h,   b,   tf,  tw,  r,   A,    Iy,    Iz,   Wpl_y, Wel_y, It,   Iw
  [ 80,   80,  46,  5.2, 3.8,  5,  7.64,   80.1,  8.49,  23.2,  20.0, 0.698,    118],
  [100,  100,  55,  5.7, 4.1,  7, 10.3,    171,  15.9,   39.4,  34.2, 1.20,     351],
  [120,  120,  64,  6.3, 4.4,  7, 13.2,    318,  27.7,   60.7,  53.0, 1.74,     890],
  [140,  140,  73,  6.9, 4.7,  7, 16.4,    541,  44.9,   88.3,  77.3, 2.45,    1981],
  [160,  160,  82,  7.4, 5.0,  9, 20.1,   869,  68.3,   123,   109,  3.60,    3990],
  [180,  180,  91,  8.0, 5.3,  9, 23.95, 1317,  100.9,  166.4, 146.3, 4.79,    7431],
  [200,  200, 100,  8.5, 5.6, 12, 28.5,  1943,   142.4, 220,   194,  6.98,   12990],
  [220,  220, 110,  9.2, 5.9, 12, 33.37, 2772,  204.9,  285.4, 252.0, 9.07,   22670],
  [240,  240, 120,  9.8, 6.2, 15, 39.1,  3892,   283.6, 367,   324, 12.9,    36920],
  [270,  270, 135, 10.2, 6.6, 15, 45.9,  5790,   420,   484,   429, 15.9,    70580],
  [300,  300, 150, 10.7, 7.1, 15, 53.8,  8356,   603.8, 628,   557, 20.1,   125900],
  [330,  330, 160, 11.5, 7.5, 18, 62.6, 11770,   788,   804,   713, 28.2,   198100],
  [360,  360, 170, 12.7, 8.0, 18, 72.7, 16270,  1043,  1019,   904, 37.3,   313600],
  [400,  400, 180, 13.5, 8.6, 21, 84.5, 23130,  1318,  1307,  1156, 51.1,   490000],
  [450,  450, 190, 14.6, 9.4, 21, 98.8, 33740,  1676,  1702,  1500, 66.9,   791000],
  [500,  500, 200, 16.0,10.2, 21,  116, 48200,  2142,  2194,  1928, 89.3,  1249000],
  [550,  550, 210, 17.2,11.1, 24,  134, 67120,  2668,  2787,  2441,  123,  1869000],
  [600,  600, 220, 19.0,12.0, 24,  156, 92080,  3387,  3512,  3069,  165,  2846000],
];

// IPN sections — DIN 1025-1 / ArcelorMittal standard catalogue
//
// PROCEDENCIA (revisado 2026-09-24): las 13 columnas salen del catálogo ArcelorMittal
// («Sections and merchant bars»), que para IPN SÍ publica Wpl_y, It e Iw. Cotejo hecho
// contra un segundo oráculo independiente: la geometría de la sección (alas al 14 % con
// acuerdos r1 y redondeos r2), que reproduce A e Iy al 1 % e It con un 2-6 % en toda la
// serie. La columna r es r1 (acuerdo ala-alma); r2 (redondeo del borde) no se guarda.
//
// HISTORIAL DE INCIDENTES (no borrar: son la razón de steelCatalogPhysics.test.ts):
//   2026-07-25 — Wpl_y e Iw llegaban 2.1x y 3.9-5.0x altos en toda la serie (Wpl/Wel = 2.51
//     en IPN 600, imposible: el techo teórico es 1.5). Como steelBeams.ts usa Wpl_y para
//     Mc,Rd en clase 1-2, un IPN 600 declaraba 2.1x su momento resistente real.
//   2026-09-24 — la columna It estaba entre un 27 % baja (IPN 160) y un 6 % alta (IPN 600)
//     respecto al catálogo: venía de otra fuente. Sustituida por la del catálogo, y Wpl_y e
//     Iw por los valores publicados (los derivados del 07-25 diferían < 1.5 %).
const IPN_DATA: Array<[number, number, number, number, number, number, number, number, number, number, number, number, number]> = [
  // size,  h,    b,    tf,    tw,    r,     A,      Iy,      Iz,   Wpl_y,   Wel_y,    It,        Iw
  [  80,   80,   42,   5.9,   3.9,   3.9,   7.58,    77.8,    6.29,    22.8,    19.5,   0.87,        87],
  [ 100,  100,   50,   6.8,   4.5,   4.5,   10.6,     171,    12.2,    39.8,    34.2,    1.6,       268],
  [ 120,  120,   58,   7.7,   5.1,   5.1,   14.2,     328,    21.5,    63.6,    54.7,   2.71,       685],
  [ 140,  140,   66,   8.6,   5.7,   5.7,   18.3,     573,    35.2,    95.4,    81.9,   4.32,      1540],
  [ 160,  160,   74,   9.5,   6.3,   6.3,   22.8,     935,    54.7,     136,     117,   6.57,      3138],
  [ 180,  180,   82,  10.4,   6.9,   6.9,   27.9,    1450,    81.3,     187,     161,   9.58,      5924],
  [ 200,  200,   90,  11.3,   7.5,   7.5,   33.4,    2140,     117,     250,     214,   13.5,     10520],
  [ 220,  220,   98,  12.2,   8.1,   8.1,   39.5,    3060,     162,     324,     278,   18.6,     17760],
  [ 240,  240,  106,  13.1,   8.7,   8.7,   46.1,    4250,     221,     412,     354,     25,     28730],
  [ 260,  260,  113,  14.1,   9.4,   9.4,   53.3,    5740,     288,     514,     442,   33.5,     44070],
  [ 280,  280,  119,  15.2,  10.1,  10.1,     61,    7590,     364,     632,     542,   44.2,     64580],
  [ 300,  300,  125,  16.2,  10.8,  10.8,     69,    9800,     451,     762,     653,   56.8,     91850],
  [ 320,  320,  131,  17.3,  11.5,  11.5,   77.7,   12510,     555,     914,     782,   72.5,    128800],
  [ 340,  340,  137,  18.3,  12.2,  12.2,   86.7,   15700,     674,    1080,     923,   90.4,    176300],
  [ 360,  360,  143,  19.5,    13,    13,     97,   19610,     818,    1276,    1090,    115,    240100],
  [ 380,  380,  149,  20.5,  13.7,  13.7,    107,   24010,     975,    1482,    1260,    141,    318700],
  [ 400,  400,  155,  21.6,  14.4,  14.4,    118,   29210,    1160,    1714,    1460,    170,    419600],
  [ 450,  450,  170,  24.3,  16.2,  16.2,    147,   45850,    1730,    2400,    2040,    267,    791100],
  [ 500,  500,  185,    27,    18,    18,    179,   68740,    2480,    3240,    2750,    402,   1403000],
  [ 550,  550,  200,    30,    19,    19,    212,   99180,    3490,    4240,    3610,    544,   2389000],
  [ 600,  600,  215,  32.4,  21.6,  21.6,    254,  139000,    4670,    5452,    4630,    787,   3821000],
];

// HEA sections
// It (cm⁴) e Iw (cm⁶) reconciliados contra eurocodeapplied.com (EN 1993,
// constante de torsión de St. Venant de perfiles laminados en caliente). La
// columna It anterior subvaloraba ~30% los tamaños ≥160 (p.ej. HEA200 It=14.7
// vs 20.4) e Iw subvaloraba 240/280/300 (auditoría 2026-06-28). Iy/Iz/A/Wel/Wpl
// estaban correctos y se mantienen. Fuente: It[×10³mm⁴]·0.1; Iw[×10⁶mm⁶]=cm⁶.
//
// 2026-09-24: HEA 160 traía Iz = 479 (la real es 615.6, −22 %: iz bajaba de 3.98 a 3.51 cm
// y el pandeo de eje débil salía un 13 % más esbelto de lo que es). Serie ampliada de 400
// a 1000 con el catálogo ArcelorMittal, cotejado contra eurocodeapplied.com y contra las
// fórmulas exactas de la sección (A, Iy, Iz, Wel, Wpl, It, Iw): 0 discrepancias.
const HEA_DATA: Array<[number, number, number, number, number, number, number, number, number, number, number, number, number]> = [
  // size,  h,   b,   tf,  tw,  r,   A,    Iy,    Iz,   Wpl_y, Wel_y, It,    Iw
  [100,   96, 100,  8.0, 5.0, 12, 21.2,   349,   134,    83.0,  72.8,  5.20,    2475],
  [120,  114, 120,  8.0, 5.0, 12, 25.3,   606,   231,   119,   106,    5.96,    6285],
  [140,  133, 140,  8.5, 5.5, 12, 31.4,  1033,   389,   174,   155,    8.03,   14729],
  [ 160,  152,  160,     9,     6,    15,   38.8,    1673,   615.6,     245,     220,  11.84,     30615],
  [180,  171, 180,  9.5, 6.0, 15, 45.25, 2510,   924.6, 324.9, 293.6, 14.66,   59014],
  [200,  190, 200, 10.0, 6.5, 18, 53.8,  3692,  1336,   429,   389,   20.43,  105580],
  [220,  210, 220, 11.0, 7.0, 18, 64.34, 5410,  1955,   568.5, 515.2, 28.09,  189610],
  [240,  230, 240, 12.0, 7.5, 21, 76.8,  7763,  2769,   745,   675,   41.03,  321640],
  [260,  250, 260, 12.5, 7.5, 24, 86.82,10450,  3668,   919.8, 836.4, 52.00,  504990],
  [280,  270, 280, 13.0, 8.0, 24, 97.3, 13670,  4763,  1112,  1013,   61.39,  770140],
  [300,  290, 300, 14.0, 8.5, 27,  112, 18260,  6310,  1383,  1260,   84.24, 1174700],
  [320,  310, 300, 15.5, 9.0, 27,  124, 22930,  6985,  1628,  1479,  108.8,  1482600],
  [340,  330, 300, 16.5, 9.5, 27, 133.5,27690,  7436,  1850,  1678,  128.7,  1790200],
  [360,  350, 300, 17.5,10.0, 27,  143, 33090,  7887,  2088,  1891,  151.0,  2137700],
  [400,  390, 300, 19.0,11.0, 27,  159, 45070,  8564,  2562,  2311,  191.4,  2893600],
  [ 450,  440,  300,    21,  11.5,    27,    178,   63720,    9465,    3216,    2896,  243.8,   4148000],
  [ 500,  490,  300,    23,    12,    27,  197.5,   86970,   10370,    3949,    3550,  309.3,   5643000],
  [ 550,  540,  300,    24,  12.5,    27,  211.8,  111900,   10820,    4622,    4146,  351.5,   7189000],
  [ 600,  590,  300,    25,    13,    27,  226.5,  141200,   11270,    5350,    4787,  397.8,   8978000],
  [ 650,  640,  300,    26,  13.5,    27,  241.6,  175200,   11720,    6136,    5474,  448.3,  11030000],
  [ 700,  690,  300,    27,  14.5,    27,  260.5,  215300,   12180,    7032,    6241,  513.9,  13350000],
  [ 800,  790,  300,    28,    15,    30,  285.8,  303400,   12640,    8699,    7682,  596.9,  18290000],
  [ 900,  890,  300,    30,    16,    30,  320.5,  422100,   13550,   10810,    9485,  736.8,  24960000],
  [1000,  990,  300,    31,  16.5,    30,  346.8,  553800,   14000,   12820,   11190,  822.4,  32070000],
];

// HEB sections
// 2026-09-24: It e Iw reconciliadas con el catálogo ArcelorMittal. La Iw de 280/320/360/400
// estaba desplazada de fila (HEB 400 traía ~la Iw de HEB 450: +41 %; HEB 360 +28 %) y la
// It de HEB 360 un 7 % alta — las dos inflan Mcr y con él χ_LT. Serie ampliada de 400 a
// 1000 con el mismo cotejo triple que HEA (catálogo, eurocodeapplied, geometría exacta).
const HEB_DATA: Array<[number, number, number, number, number, number, number, number, number, number, number, number, number]> = [
  // size,  h,   b,   tf,  tw,  r,   A,    Iy,    Iz,   Wpl_y, Wel_y, It,   Iw
  [100,  100, 100, 10.0, 6.0, 12, 26.0,   450,   167,   104,    89.9, 9.25,    3375],
  [120,  120, 120, 11.0, 6.5, 12, 34.0,   864,   318,   165,   144,  13.8,     9410],
  [140,  140, 140, 12.0, 7.0, 12, 43.0,  1509,   550,   245,   216,  20.1,    22480],
  [160,  160, 160, 13.0, 8.0, 15, 54.3,  2492,   889.2, 354,   311, 31.2,    47070],
  [180,  180, 180, 14.0, 8.5, 15, 65.25, 3831,  1363,   481.4, 425.7,42.16,   93750],
  [200,  200, 200, 15.0, 9.0, 18, 78.1,  5696,  2003,   642,   570, 59.3,   171100],
  [220,  220, 220, 16.0, 9.5, 18, 91.04, 8091,  2843,   827.0, 735.5,76.57,  295400],
  [240,  240, 240, 17.0,10.0, 21,  106, 11260,  3923,  1053,   938,  103,   486900],
  [260,  260, 260, 17.5,10.0, 24, 118.4,14920,  5135,  1283,  1148, 123.8,  753700],
  [ 280,  280,  280,    18,  10.5,    24,    131,   19270,    6595,    1534,    1376,  143.7,   1130000],
  [300,  300, 300, 19.0,11.0, 27,  149, 25170,  8563,  1869,  1678,  185,  1688000],
  [ 320,  320,  300,  20.5,  11.5,    27,    161,   30820,    9239,    2149,    1926,  225.1,   2069000],
  [340,  340, 300, 21.5,12.0, 27, 170.9,36660,  9690,  2408,  2156, 257.2, 2454000],
  [ 360,  360,  300,  22.5,  12.5,    27,    181,   43190,   10140,    2683,    2400,  292.5,   2883000],
  [ 400,  400,  300,    24,  13.5,    27,    197,   57680,   10820,    3240,    2884,  355.7,   3817000],
  [ 450,  450,  300,    26,    14,    27,    218,   79890,   11720,    3982,    3551,  440.5,   5258000],
  [ 500,  500,  300,    28,  14.5,    27,  238.6,  107200,   12620,    4815,    4287,  538.4,   7018000],
  [ 550,  550,  300,    29,    15,    27,  254.1,  136700,   13080,    5591,    4971,  600.3,   8856000],
  [ 600,  600,  300,    30,  15.5,    27,    270,  171000,   13530,    6425,    5701,  667.2,  10970000],
  [ 650,  650,  300,    31,    16,    27,  286.3,  210600,   13980,    7320,    6480,  739.2,  13360000],
  [ 700,  700,  300,    32,    17,    27,  306.4,  256900,   14440,    8327,    7340,  830.9,  16060000],
  [ 800,  800,  300,    33,  17.5,    30,  334.2,  359100,   14900,   10230,    8977,    946,  21840000],
  [ 900,  900,  300,    35,  18.5,    30,  371.3,  494100,   15820,   12580,   10980,   1137,  29460000],
  [1000, 1000,  300,    36,    19,    30,    400,  644700,   16280,   14860,   12890,   1254,  37640000],
];

function buildProfiles(
  tipo: 'IPE' | 'HEA' | 'HEB' | 'IPN',
  data: Array<[number, number, number, number, number, number, number, number, number, number, number, number, number]>,
): SteelProfile[] {
  return data.map(([size, h, b, tf, tw, r, A, Iy, Iz, Wpl_y, Wel_y, It, Iw]) => ({
    key: `${tipo}${size}`,
    tipo,
    size,
    label: `${tipo} ${size}`,
    h, b, tf, tw, r,
    A, Iy, Iz,
    Wpl_y, Wel_y,
    It, Iw,
  }));
}

export const STEEL_PROFILES: SteelProfile[] = [
  ...buildProfiles('IPE', IPE_DATA),
  ...buildProfiles('HEA', HEA_DATA),
  ...buildProfiles('HEB', HEB_DATA),
  ...buildProfiles('IPN', IPN_DATA),
];

export function getProfile(tipo: 'IPE' | 'HEA' | 'HEB' | 'IPN', size: number): SteelProfile | undefined {
  return STEEL_PROFILES.find((p) => p.tipo === tipo && p.size === size);
}

export function getSizesForTipo(tipo: 'IPE' | 'HEA' | 'HEB' | 'IPN'): number[] {
  return STEEL_PROFILES.filter((p) => p.tipo === tipo).map((p) => p.size);
}

// ---------------------------------------------------------------------------
// UPN channel sections — DIN 1026-1 / ArcelorMittal standard catalogue
// Units: h, b, tf, tw in mm; A in cm²; Iy, Iz in cm⁴; Wpl_y, Wel_y in cm³; It in cm⁴; e1 in mm
// e1 = distance from outer web face to UPN centroid (ys del catálogo; needed for Iz_box)
//
// PROCEDENCIA (revisado 2026-09-24): todas las columnas del catálogo ArcelorMittal, que
// publica Wpl_y, It e ys. Cotejo contra la geometría (alas al 8 %): A al 1.5 %, Wpl al 3 %,
// It al 10 %. Hasta esa fecha la tabla tenía 58 celdas malas de 176:
//   · UPN 320 y 350 con tw = 10.5 / 12 (real 14) y A = 65.2 / 66.0 (real 75.8 / 77.3);
//     UPN 380 con A = 70.4 (real 80.4); UPN 400 con la Iy del IPE 400 (23130 por 20350).
//   · Wpl_y entre +5 % (UPN 80) y +28 % (UPN 400): entra en Mc,Rd del cajón 2UPN en
//     clase 1-2 (vigas y pilares) y en el MRd de la cruceta de punzonamiento.
//   · It entre +12 % y +198 % (2-3x). e1 entre +6 % y +15 % desde UPN 120, con lo que
//     el Iz del cajón salía hasta un 20 % bajo (conservador, pero falso).
// Lo vigila steelCatalogPhysics.test.ts (bloque UPN): no tocar sin leerlo.
// ---------------------------------------------------------------------------

export interface UPNProfile {
  size: number;
  h: number; b: number; tf: number; tw: number;
  A: number; Iy: number; Iz: number;
  Wpl_y: number; Wel_y: number; It: number;
  e1: number;
}

// size,   h,   b,    tf,    tw,     A,     Iy,    Iz, Wpl_y, Wel_y,    It,    e1
const UPN_DATA: Array<[number,number,number,number,number,number,number,number,number,number,number,number]> = [
  [  80,   80,   45,     8,     6,    11,    106,  19.4,  31.8,  26.5,  2.16,  14.5],
  [ 100,  100,   50,   8.5,     6,  13.5,    206,  29.3,    49,  41.2,  2.81,  15.5],
  [ 120,  120,   55,     9,     7,    17,    364,  43.2,  72.6,  60.7,  4.15,    16],
  [ 140,  140,   60,    10,     7,  20.4,    605,  62.7,   103,  86.4,  5.68,  17.5],
  [ 160,  160,   65,  10.5,   7.5,    24,    925,  85.3,   138,   116,  7.39,  18.4],
  [ 180,  180,   70,    11,     8,    28,   1350,   114,   179,   150,  9.55,  19.2],
  [ 200,  200,   75,  11.5,   8.5,  32.2,   1910,   148,   228,   191,  11.9,  20.1],
  [ 220,  220,   80,  12.5,     9,  37.4,   2690,   197,   292,   245,    16,  21.4],
  [ 240,  240,   85,    13,   9.5,  42.3,   3600,   248,   358,   300,  19.7,  22.3],
  [ 260,  260,   90,    14,    10,  48.3,   4820,   317,   442,   371,  25.5,  23.6],
  [ 280,  280,   95,    15,    10,  53.3,   6280,   399,   532,   448,    31,  25.3],
  [ 300,  300,  100,    16,    10,  58.8,   8030,   495,   632,   535,  37.4,    27],
  [ 320,  320,  100,  17.5,    14,  75.8,  10870,   597,   826,   679,  66.7,    26],
  [ 350,  350,  100,    16,    14,  77.3,  12840,   570,   918,   734,  61.2,    24],
  [ 380,  380,  102,    16,  13.5,  80.4,  15760,   615,  1014,   829,  59.1,  23.8],
  [ 400,  400,  110,    18,    14,  91.5,  20350,   846,  1240,  1020,  81.6,  26.5],
];

export const UPN_PROFILES: UPNProfile[] = UPN_DATA.map(
  ([size, h, b, tf, tw, A, Iy, Iz, Wpl_y, Wel_y, It, e1]) =>
    ({ size, h, b, tf, tw, A, Iy, Iz, Wpl_y, Wel_y, It, e1 }),
);

export function getUPN(size: number): UPNProfile | undefined {
  return UPN_PROFILES.find((p) => p.size === size);
}

export function getSizesUPN(): number[] {
  return UPN_PROFILES.map((p) => p.size);
}

// ---------------------------------------------------------------------------
// 2UPN cajón cerrado — composite closed-box section (zero gap, flanges welded)
// Webs on the outside (left/right), flanges forming the inner top/bottom walls.
// Box dims: H = h_UPN, B_total = 2 * b_UPN
// ---------------------------------------------------------------------------

export interface UPNBoxProfile {
  isBox: true;
  size: number;
  /** Single UPN flange width (mm) — half the box total width. */
  b_upn: number;
  /** Box total height = h_UPN (mm) */
  h: number;
  /** Box total width = 2 * b_UPN (mm) */
  b: number;
  /** Flange thickness = tf_UPN (mm) */
  tf: number;
  /** Web thickness = tw_UPN (mm) */
  tw: number;
  A: number;     // 2 · A_UPN                                  (cm²)
  Iy: number;    // 2 · Iy_UPN                                 (cm⁴)
  Iz: number;    // 2·Iz_UPN + 2·A_UPN·(b_upn − e1)²          (cm⁴)
  Wpl_y: number; // 2 · Wpl_y_UPN                              (cm³)
  Wpl_z: number; // 2 · A_UPN · (b_upn − e1)                   (cm³)
  Wel_y: number; // Iy_box / (h/2)                             (cm³)
  It: number;    // Bredt 4·Am²/Σ(ds/t)                       (cm⁴)
  Iw: number;    // 0 — closed section                        (cm⁶)
}

export function buildUPNBox(size: number): UPNBoxProfile | undefined {
  const upn = getUPN(size);
  if (!upn) return undefined;

  const { h, b: b_upn, tf, tw, A: A1, Iy: Iy1, Iz: Iz1, Wpl_y: Wply1, e1 } = upn;

  const A = 2 * A1;
  const Iy = 2 * Iy1;

  // Iz: parallel-axis theorem — centroid-to-z-axis distance = (b_upn − e1)
  const d_cm = (b_upn - e1) / 10; // mm → cm
  const Iz = 2 * Iz1 + 2 * A1 * d_cm * d_cm;

  const Wpl_y = 2 * Wply1;

  // Wpl_z = 2·A_UPN·(b_upn − e1) — EXACTO, no aproximado: por simetría el eje
  // plástico de eje débil es el centro del cajón, y cada canal cae ENTERO a un
  // lado, así que su momento estático es área × distancia de su centro de
  // gravedad al eje, la misma d de la fórmula de Iz.
  //
  // Hasta 2026-09-24 upnBox.ts lo calculaba con un rectángulo a mano
  // (2·[b²·tf + tw·(h−2tf)·(b − tw/2)]), que ignora el ala cónica y los
  // acuerdos y por eso situaba el centro de gravedad ~2 mm más lejos del alma
  // de lo que está: salía entre un 2.3 % y un 4.1 % bajo en toda la serie
  // (conservador, pero falso, y era la única propiedad del cajón que no venía
  // del catálogo).
  const Wpl_z = 2 * A1 * d_cm;

  // Wel_y = Iy_box / (h/2 in cm)  →  20·Iy_box / h_mm
  const Wel_y = (20 * Iy) / h;

  // Bredt torsion — using median-line dimensions
  const h_m = h - tf;          // mm — median web height
  const b_m = 2 * b_upn - tw;  // mm — median box width (web-to-web centre)
  const Am_cm2 = (h_m * b_m) / 100; // mm² → cm²
  const sum_ds_t = 2 * h_m / tw + 2 * b_m / tf; // dimensionless (mm/mm)
  const It = (4 * Am_cm2 * Am_cm2) / sum_ds_t;

  return {
    isBox: true,
    size,
    b_upn,
    h, b: 2 * b_upn,
    tf, tw,
    A, Iy, Iz,
    Wpl_y, Wpl_z, Wel_y,
    It, Iw: 0,
  };
}
