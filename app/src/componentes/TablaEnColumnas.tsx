/**
 * Una tabla larga y estrecha en varias columnas, como un listado: si el sitio da para más de una al
 * ancho natural de la tabla, sus filas se reparten de arriba abajo y de izquierda a derecha en
 * columnas iguales, cada una con su cabecera, que llenan el ancho. En el panel inferior a 1920 px la
 * tabla de las franjas de una planta ocupaba 640 px de 1 890 y dejaba vacío el resto; las tablas no
 * se estiran a todo el ancho (D-15: los valores de una fila quedaban a 380 px), se reparten.
 *
 * Se envuelve el `<table>` tal cual: se parte su `<tbody>` por sus hijos de primer nivel (un
 * `Fragment` con las filas de un pilar va entero a una columna). Con poco sitio, o pocas filas, la
 * tabla de siempre.
 */
import { Children, cloneElement, isValidElement, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

/** Separación entre columnas, px (la del CSS de `.tb-columnas`). */
const HUECO = 28;

type PropsTabla = { children?: ReactNode; "aria-label"?: string; className?: string };

export function TablaEnColumnas({ children, filasMinimas = 6, maxColumnas = 4 }: { children: ReactElement<PropsTabla>; filasMinimas?: number; maxColumnas?: number }) {
  const caja = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);

  const partes = Children.toArray(children.props.children);
  const tbody = partes.find((p): p is ReactElement<{ children?: ReactNode }> => isValidElement(p) && p.type === "tbody");
  const filas = tbody ? Children.toArray(tbody.props.children) : [];
  const limite = Math.max(1, Math.min(maxColumnas, Math.floor(filas.length / filasMinimas)));

  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const calcular = () => {
      const W = el.clientWidth;
      const tablas = [...el.querySelectorAll<HTMLTableElement>(":scope > table")];
      if (!W || !tablas.length) return;
      // El ancho natural: el de su contenido sin partir líneas, el mayor de las columnas que haya ahora
      let natural = 0;
      for (const t of tablas) {
        const [w, mw, fx] = [t.style.width, t.style.minWidth, t.style.flex];
        t.style.width = "max-content";
        t.style.minWidth = "0";
        t.style.flex = "none";
        natural = Math.max(natural, t.getBoundingClientRect().width);
        t.style.width = w;
        t.style.minWidth = mw;
        t.style.flex = fx;
      }
      const cabe = Math.floor((W + HUECO) / (Math.max(natural, 320) + HUECO));
      setK(Math.max(1, Math.min(limite, cabe)));
    };
    calcular();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(calcular);
    ro.observe(el);
    return () => ro.disconnect();
  }, [limite, filas.length]);

  const n = Math.min(k, limite);
  if (!tbody || n <= 1)
    return (
      <div ref={caja} className="tb-columnas" data-columnas={1}>
        {children}
      </div>
    );
  const porColumna = Math.ceil(filas.length / n);
  const etiqueta = children.props["aria-label"];
  return (
    <div ref={caja} className="tb-columnas" data-columnas={n}>
      {Array.from({ length: n }, (_, c) => {
        const trozo = filas.slice(c * porColumna, (c + 1) * porColumna);
        if (!trozo.length) return null;
        return cloneElement(
          children,
          { key: c, ...(etiqueta ? { "aria-label": c === 0 ? etiqueta : `${etiqueta} (sigue, ${c + 1} de ${n})` } : {}) },
          ...partes.map((p) => (p === tbody ? cloneElement(tbody, { key: "tbody" }, trozo) : p)),
        );
      })}
    </div>
  );
}
