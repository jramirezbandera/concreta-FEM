/**
 * El tooltip de la app (`auditoria-ui-2.md`, UI2-13). Hasta ahora era el `title` del navegador: 260
 * en el código, que salen tarde, en la letra del sistema, sin tema y nunca con el teclado.
 *
 * Se monta una vez (`main.tsx`) y no hay que tocar ningún `title`: al entrar el ratón o el foco del
 * teclado en un elemento con `title`, se le quita mientras dure (así el navegador no pinta el suyo)
 * y se enseña en un globo con el estilo de la app; al salir, se le devuelve. El DOM queda como
 * estaba, que es lo que leen las pruebas y los bancos.
 *
 * El texto se parte en lo que tiene: «Nombre: explicación» da el nombre en negrita y la explicación
 * debajo, y un atajo al final entre paréntesis («Encuadrar (F)») sale como tecla.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const ESPERA_MS = 450;
/** Tras cerrarse una, la siguiente sale sin espera durante este tiempo (recorrer una barra). */
const SEGUIDAS_MS = 400;
const MARGEN = 8;
const ATAJO = /\s*\(((?:Ctrl|Mayús|Alt|Supr|Esc|Intro|Tab|Espacio|F\d{1,2}|[A-Z0-9])(?:\s?\+\s?[^()]{1,12})?)\)\s*$/;

export interface PartesPista {
  nombre: string;
  resto?: string;
  atajo?: string;
}

/** Las partes de un `title`: el nombre, lo que explica y el atajo. */
export function partesPista(t0: string): PartesPista {
  let t = t0.trim();
  let atajo: string | undefined;
  const m = ATAJO.exec(t);
  if (m) {
    atajo = m[1]!.replace(/\s/g, "");
    t = t.slice(0, m.index).trim();
  }
  const k = t.indexOf(": ");
  if (k > 0 && k <= 48) return { nombre: t.slice(0, k), resto: mayuscula(t.slice(k + 2)), ...(atajo ? { atajo } : {}) };
  // Una frase larga sin nombre: toda como explicación, bajo su primera frase si la hay corta
  const p = t.indexOf(". ");
  if (t.length > 64 && p > 0 && p <= 64) return { nombre: t.slice(0, p), resto: t.slice(p + 2), ...(atajo ? { atajo } : {}) };
  return { nombre: t, ...(atajo ? { atajo } : {}) };
}

const mayuscula = (t: string) => (t ? t[0]!.toUpperCase() + t.slice(1) : t);

interface Abierta {
  el: Element;
  texto: string;
}

export function Pistas() {
  const [abierta, setAbierta] = useState<Abierta | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arriba: boolean; flecha: number } | null>(null);
  const globo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let actual: Element | null = null;
    let guardado = "";
    let nombrePuesto = false;
    let espera = 0;
    let cerradaEn = 0;

    const soltar = () => {
      clearTimeout(espera);
      if (actual) {
        // Si React le ha puesto otro `title` entretanto, manda el suyo
        if (!actual.hasAttribute("title") && actual.isConnected) actual.setAttribute("title", guardado);
        if (nombrePuesto) actual.removeAttribute("aria-label");
        actual = null;
        nombrePuesto = false;
        cerradaEn = performance.now();
      }
      setAbierta(null);
      setPos(null);
    };

    const tomar = (el: Element, ya: boolean) => {
      const texto = el.getAttribute("title") ?? "";
      if (el === actual) {
        // El mismo elemento con un `title` nuevo (cambió con un clic): se pone al día
        if (!texto) return;
        guardado = texto;
        el.removeAttribute("title");
        setAbierta((a) => (a ? { el, texto } : a));
        return;
      }
      soltar();
      if (!texto.trim()) return;
      actual = el;
      guardado = texto;
      el.removeAttribute("title");
      // Un botón sólo con icono se llamaba por su `title`: mientras no lo tiene, por `aria-label`
      if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby") && !(el.textContent ?? "").trim()) {
        el.setAttribute("aria-label", texto);
        nombrePuesto = true;
      }
      // Lo que ya dice el propio elemento no se repite en un globo
      if (texto.trim() === (el.textContent ?? "").trim()) return;
      const abrir = () => setAbierta({ el, texto });
      if (ya || performance.now() - cerradaEn < SEGUIDAS_MS) abrir();
      else espera = window.setTimeout(abrir, ESPERA_MS);
    };

    const conTitulo = (t: EventTarget | null): Element | null => (t instanceof Element ? (t.closest("[title]") ?? (actual && actual.contains(t) ? actual : null)) : null);

    const entra = (e: MouseEvent) => {
      const el = conTitulo(e.target);
      if (el) tomar(el, false);
      else if (actual) soltar();
    };
    const sale = (e: MouseEvent) => {
      if (actual && !(e.relatedTarget instanceof Node && actual.contains(e.relatedTarget))) soltar();
    };
    const foco = (e: FocusEvent) => {
      const el = conTitulo(e.target);
      // Sólo con el teclado: tras un clic, el globo estorba
      if (el && e.target instanceof Element && e.target.matches(":focus-visible")) tomar(el, true);
    };
    const sinFoco = () => {
      if (actual && !actual.matches(":hover")) soltar();
    };
    const ocultar = () => {
      clearTimeout(espera);
      setAbierta(null);
      setPos(null);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") ocultar();
    };

    document.addEventListener("mouseover", entra);
    document.addEventListener("mouseout", sale);
    document.addEventListener("focusin", foco);
    document.addEventListener("focusout", sinFoco);
    document.addEventListener("mousedown", ocultar, true);
    document.addEventListener("keydown", tecla, true);
    window.addEventListener("scroll", ocultar, true);
    window.addEventListener("resize", ocultar);
    window.addEventListener("blur", soltar);
    return () => {
      soltar();
      document.removeEventListener("mouseover", entra);
      document.removeEventListener("mouseout", sale);
      document.removeEventListener("focusin", foco);
      document.removeEventListener("focusout", sinFoco);
      document.removeEventListener("mousedown", ocultar, true);
      document.removeEventListener("keydown", tecla, true);
      window.removeEventListener("scroll", ocultar, true);
      window.removeEventListener("resize", ocultar);
      window.removeEventListener("blur", soltar);
    };
  }, []);

  // Medido ya pintado (invisible): debajo y, si no cabe, encima; nunca fuera de la ventana
  useLayoutEffect(() => {
    if (!abierta || !globo.current) return;
    if (!abierta.el.isConnected) {
      setAbierta(null);
      return;
    }
    const a = abierta.el.getBoundingClientRect();
    const g = globo.current.getBoundingClientRect();
    const cx = a.left + a.width / 2;
    const left = Math.min(Math.max(MARGEN, cx - g.width / 2), window.innerWidth - g.width - MARGEN);
    const arriba = a.bottom + 7 + g.height > window.innerHeight - MARGEN && a.top - 7 - g.height >= MARGEN;
    setPos({ left, top: arriba ? a.top - 7 - g.height : a.bottom + 7, arriba, flecha: Math.min(Math.max(12, cx - left), g.width - 12) });
  }, [abierta]);

  if (!abierta) return null;
  const p = partesPista(abierta.texto);
  return createPortal(
    <div ref={globo} className="globo-ayuda pista" role="tooltip" data-arriba={pos?.arriba || undefined} style={pos ? { left: pos.left, top: pos.top, ["--flecha" as string]: `${pos.flecha}px` } : { left: 0, top: 0, visibility: "hidden" }}>
      <span className="pista-nombre">
        {p.nombre}
        {p.atajo && <kbd>{p.atajo}</kbd>}
      </span>
      {p.resto && <span className="pista-resto">{p.resto}</span>}
    </div>,
    document.body,
  );
}
