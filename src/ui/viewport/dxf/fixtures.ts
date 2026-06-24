// Fixtures DXF minimos para los tests del parser (feature-15). Construidos como
// pares (codigo de grupo, valor) y unidos por saltos de linea: es el formato DXF
// ASCII. Mantenerlos como datos (no como texto literal con backticks) los hace
// faciles de componer y leer.
//
// Solo se usan en tests; vive junto a ellos para no contaminar el bundle.

function bloque(pares: Array<[string | number, string | number]>): string {
  return pares.map(([c, v]) => `${c}\n${v}`).join("\n");
}

// Envuelve entidades en un DXF completo con header opcional ($INSUNITS).
export function dxfConEntidades(
  entidades: string,
  opts: { insunits?: number } = {},
): string {
  const header =
    opts.insunits === undefined
      ? ""
      : bloque([
          [0, "SECTION"],
          [2, "HEADER"],
          [9, "$INSUNITS"],
          [70, opts.insunits],
          [0, "ENDSEC"],
        ]) + "\n";
  const ent =
    bloque([
      [0, "SECTION"],
      [2, "ENTITIES"],
    ]) +
    "\n" +
    entidades +
    "\n" +
    bloque([[0, "ENDSEC"]]);
  return header + ent + "\n" + bloque([[0, "EOF"]]) + "\n";
}

export function lineDxf(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  return bloque([
    [0, "LINE"],
    [8, "0"],
    [10, x1],
    [20, y1],
    [30, 0],
    [11, x2],
    [21, y2],
    [31, 0],
  ]);
}

export function lwpolylineDxf(
  puntos: Array<[number, number]>,
  cerrada: boolean,
): string {
  const cab: Array<[string | number, string | number]> = [
    [0, "LWPOLYLINE"],
    [8, "0"],
    [90, puntos.length],
    [70, cerrada ? 1 : 0],
  ];
  const verts: Array<[string | number, string | number]> = [];
  for (const [x, y] of puntos) {
    verts.push([10, x], [20, y]);
  }
  return bloque([...cab, ...verts]);
}

export function pointDxf(x: number, y: number): string {
  return bloque([
    [0, "POINT"],
    [8, "0"],
    [10, x],
    [20, y],
    [30, 0],
  ]);
}

export function circleDxf(cx: number, cy: number, r: number): string {
  return bloque([
    [0, "CIRCLE"],
    [8, "0"],
    [10, cx],
    [20, cy],
    [40, r],
  ]);
}

export function arcDxf(
  cx: number,
  cy: number,
  r: number,
  gradoInicio: number,
  gradoFin: number,
): string {
  return bloque([
    [0, "ARC"],
    [8, "0"],
    [10, cx],
    [20, cy],
    [40, r],
    [50, gradoInicio],
    [51, gradoFin],
  ]);
}

// Entidad NO soportada en v1 (para verificar `noSoportadas`).
export function textDxf(x: number, y: number, texto: string): string {
  return bloque([
    [0, "TEXT"],
    [8, "0"],
    [10, x],
    [20, y],
    [30, 0],
    [40, 1],
    [1, texto],
  ]);
}
