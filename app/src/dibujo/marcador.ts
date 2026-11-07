/**
 * El marcador de un enganche (el de dibujar, `controlador.ts`, y el de medir, `vista2d.ts`).
 */
import type { TipoEnganche } from "../../../src/editor/dibujo/enganches.ts";
import type { Colores } from "../vistas/motor.ts";

/** Un símbolo por tipo de enganche, como el «referencia a objetos» de los CAD. */
export function marcador(ctx: CanvasRenderingContext2D, t: TipoEnganche, [x, y]: [number, number], c: Colores): void {
  const r = 6;
  ctx.beginPath();
  switch (t) {
    case "fijo":
    case "extremo":
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      break;
    case "centro":
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      break;
    case "esquina":
    case "vertice":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case "cruce":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      break;
    case "medio":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r * 0.8);
      ctx.lineTo(x - r, y + r * 0.8);
      ctx.closePath();
      break;
    case "cara":
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      break;
    case "perpendicular":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + r);
      break;
    case "cercano":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.closePath();
      break;
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = c.fondo;
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = c.acento;
  ctx.stroke();
}
