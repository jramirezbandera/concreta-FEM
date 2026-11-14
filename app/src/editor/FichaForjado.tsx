/**
 * Dos partes de la ficha de un forjado en Propiedades (2026-10-28, a petición del usuario: los
 * multiplicadores «no se entienden ni se sabe cómo cambiarlos» y el peso propio «se podría calcular»):
 *
 * - el peso propio: cómo sale el pp que se usa (el hormigón y el casetón o la bovedilla, con sus
 *   números) y, si hay uno escrito, que manda él y cómo volver al calculado. Desde la revisión del
 *   usuario del 2026-11-05: qué manda (el pp escrito, el relleno dado o el estimado) y su
 *   procedencia, que lo estimado es un peso específico aparente equivalente de predimensionamiento,
 *   y, en un reticular con ábacos, su peso medio, sólo como dato;
 * - la rigidez del aligerado de un reticular: «calculada» (los ocho multiplicadores que usa el cálculo,
 *   con su nombre) o «la mía» (los ocho, rellenos con los calculados para cambiar el que se quiera).
 *
 * Lo que escriben va por `escribir`, como un campo más (un paso de deshacer).
 */
import { fijarAbacosPilares, toleranciaAbacos } from "../../../src/editor/abacos.ts";
import { desnivelEnrasado, forjadosParaEnrasar, type Enrase } from "../../../src/editor/desnivel.ts";
import { useVisor } from "../contexto.ts";
import { useEffect, useMemo, useState } from "react";
import { gammaMaterial } from "../../../src/agente/sensatez.ts";
import { pesoMedioConMacizo } from "../../../src/compilador/pesoForjado.ts";
import { fraccionAbacos, MULTIPLICADORES, rigidezAligerado, textoMultiplicadores, type RigidezAligerado } from "../../../src/editor/ficha.ts";
import { desglosePesoFila, leerProcedencia, ppObligatorio, type Contexto } from "../../../src/editor/tablas.ts";
import { leerNumero, type Fila } from "../../../src/editor/celdas.ts";
import type { MultiplicadoresLamina } from "../../../src/elementos/lamina.ts";
import { Grupo } from "../componentes/Grupo.tsx";

/** Un número a la española con `d` decimales como mucho («0,126», «25»). */
const n = (v: number, d = 3) => String(Number(v.toFixed(d))).replace(".", ",");

interface Props {
  /** El forjado (para sus ábacos ya resueltos en el modelo). */
  id?: string;
  fila: Fila;
  ctx: Contexto;
  /** Escribe un campo de la fila (como si se tecleara). */
  escribir: (clave: string, valor: string) => void;
  /** El error del último intento en cada campo. */
  errores: Readonly<Record<string, string>>;
}

// ─── Ábacos en los pilares ──────────────────────────────────────────────────────────────────────

/**
 * AC: los ábacos de «ábacos en pilares» siguen a sus pilares y no se eligen uno a uno; «Fijar como
 * polígonos» los deja en la columna «ábacos» tal como los calcula el compilador (`fijarAbacosPilares`).
 */
export function FijarAbacos({ losa }: { losa: string }) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion;
  const [error, setError] = useState<string | null>(null);
  if (!ed) return null;
  const fijar = () => {
    const r = fijarAbacosPilares(ed.proyecto.modelo, losa, toleranciaAbacos(ed.proyecto.opciones));
    if (!r.ok) return setError(r.mensaje);
    const a = ed.editar(r.operacion, `Fijar los ábacos de ${losa}`);
    setError(a.ok ? null : a.errores.map((e) => e.mensaje).join(" "));
  };
  return (
    <div className="px-3.5 py-2">
      <p className="nota">Los ábacos en los pilares los pone el cálculo y siguen a los pilares: no se eligen uno a uno. Fijados, quedan como ábacos propios del forjado, que se mueven, se estiran y se unen.</p>
      <button type="button" className="btn" onClick={fijar}>
        Fijar como polígonos
      </button>
      {error && <p className="nota text-state-fail">{error}</p>}
    </div>
  );
}

// ─── Cota (fase DN) ─────────────────────────────────────────────────────────────────────────────

/**
 * El desnivel del forjado: dónde quedan sus dos caras respecto a la cota de la planta, y «Enrasar con…»
 * otro forjado de su planta, por arriba (la misma cara superior) o por abajo (la misma cara inferior).
 * Escribe el número con los cantos de ahora (DN-c: una orden, no un modo), como si se tecleara.
 */
export function CotaForjado({ id, fila, ctx, escribir }: Props) {
  const otros = useMemo(() => (id ? forjadosParaEnrasar(ctx.modelo, id) : []), [id, ctx.modelo]);
  const [con, setCon] = useState("");
  const [error, setError] = useState<string | null>(null);
  const elegido = otros.some((o) => o.id === con) ? con : (otros[0]?.id ?? "");
  const d = Number((fila.desnivel ?? "").trim().replace(",", ".") || "0");
  const e = Number((fila.espesor ?? "").replace(",", "."));
  const m = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${n(Math.abs(v), 3)} m`;
  const enrasar = (como: Enrase) => {
    if (!id || !elegido) return;
    const r = desnivelEnrasado(ctx.modelo, id, elegido, como);
    if (!r.ok) return setError(r.mensaje);
    setError(null);
    escribir("desnivel", r.desnivel === 0 ? "" : n(r.desnivel, 9));
  };
  return (
    <div className="nota" data-testid="cota-forjado">
      {Number.isFinite(d) && (
        <p>
          Cara superior a {d === 0 ? "la cota de la planta" : `${m(d)} de la cota`}
          {e > 0 ? `; la inferior, a ${m(d - e)}` : ""}.
        </p>
      )}
      {otros.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span>Enrasar con</span>
          <select className="rounded border border-border-main bg-bg-primary px-1 py-px text-[12px]" aria-label="Forjado con el que enrasar" value={elegido} onChange={(ev) => setCon(ev.target.value)}>
            {otros.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id}
                {o.toca ? "" : " (no toca su borde)"}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => enrasar("arriba")} title="La misma cara superior que el otro forjado">
            Por arriba
          </button>
          <button type="button" className="btn" onClick={() => enrasar("abajo")} title="La misma cara inferior que el otro forjado (una maciza junto a un reticular más grueso)">
            Por abajo
          </button>
        </div>
      )}
      {error && <p className="nota text-state-fail">{error}</p>}
    </div>
  );
}

// ─── Peso propio ────────────────────────────────────────────────────────────────────────────────

export function PesoForjado({ id, fila, ctx, escribir }: Props) {
  const tipo = (fila.tipo ?? "").trim().toLowerCase() || "maciza";
  const d = desglosePesoFila(fila, ctx);
  const texto = (fila.pp ?? "").trim();
  const escrito = texto ? Number(texto.replace(",", ".")) : undefined;
  const conRelleno = !!(fila.relleno ?? "").trim();
  const pr = (fila.procedencia ?? "").trim() ? leerProcedencia(fila.procedencia!) : undefined;
  const procedencia = pr && typeof pr !== "string" ? `${pr.origen === "fabricante" ? "de fabricante" : pr.origen === "usuario" ? "del usuario" : "estimado"}${pr.fuente ? `: ${pr.fuente}` : ""}` : null;
  // El peso medio con los ábacos, sólo como dato (con los del modelo, también los de los pilares)
  const f = useMemo(() => (tipo === "reticular" && id ? fraccionAbacos(ctx.modelo, id) : null), [tipo, id, ctx.modelo]);
  const mat = ctx.modelo.materiales.find((x) => x.id === (fila.material ?? "").trim());
  const canto = Number((fila.espesor ?? "").replace(",", "."));
  const conEscrito = escrito !== undefined && Number.isFinite(escrito);
  const medio = (pp: number) =>
    f !== null && mat && canto > 0 ? (
      <p className="mt-1" data-testid="peso-medio">
        Peso medio con los ábacos ({n(100 * f, 1)} % del área): {n(pesoMedioConMacizo(pp, gammaMaterial(mat) * canto, f), 2)} kN/m², sólo como dato. El cálculo pesa cada zona con lo suyo: repartir este medio contaría los ábacos dos veces.
      </p>
    ) : null;
  // Sin cálculo posible (casetón «perdido», vigueta que no es una T) pero con el pp escrito: manda él
  if (!d && conEscrito)
    return (
      <div className="nota" data-testid="peso-forjado">
        <p>
          Manda el escrito, {n(escrito!, 2)} kN/m²{procedencia ? ` (${procedencia})` : ""}
          {tipo === "reticular" ? ", en la zona aligerada (los ábacos, γ·canto)" : ""}.
        </p>
        {medio(escrito!)}
      </div>
    );
  if (!d) {
    if (!ppObligatorio(fila, ctx)) return null;
    return (
      <p className="nota">
        {tipo === "reticular" ? "Con un casetón perdido de otro material" : "Con una vigueta que no es una T más estrecha que el intereje"} el peso propio no sale solo: escríbalo
        {tipo === "unidireccional" ? ", con las bovedillas" : ", o dé el relleno de su ficha"}.
      </p>
    );
  }
  const pieza = tipo === "reticular" ? "casetón" : "bovedilla";
  const relleno =
    d.metodo === "piezas"
      ? `relleno dado por piezas, ${n(d.piezas!.pesoPieza)} kg × ${n(d.piezas!.piezasM2)} piezas/m² × g = ${n(d.relleno)} kN/m²`
      : d.pesoHueco > 0
        ? `${d.metodo === "aparente" ? "relleno dado" : `${pieza} estimado`}, ${n(d.pesoHueco)} kN/m³ aparente equivalente × ${n(d.hueco)} m³/m² de hueco`
        : `el ${pieza} no pesa`;
  return (
    <div className="nota" data-testid="peso-forjado">
      {tipo === "maciza" ? (
        <p>
          Peso propio: γ·canto = {n(d.gamma)} × {n(d.hormigon)} = <b>{n(d.pp, 2)} kN/m²</b>.
        </p>
      ) : (
        <>
          <p>
            Peso propio{tipo === "reticular" ? " de lo aligerado" : ""}: hormigón {n(d.gamma)} kN/m³ × {n(d.hormigon)} m³/m² + {relleno} = <b>{n(d.pp, 2)} kN/m²</b>
            {tipo === "reticular" ? `; los ábacos, macizos: ${n(d.gamma)} × canto.` : "."}
          </p>
          {d.metodo === "estimado" && d.pesoHueco > 0 && !conEscrito && (
            <p className="mt-1" data-testid="peso-estimado">
              El {n(d.pesoHueco)} kN/m³ es un peso específico aparente equivalente (kN por m³ del hueco entre nervios, no la densidad del material de la pieza), estimado para predimensionar: no es un peso certificado ni de norma. Con la ficha del fabricante, escriba su relleno.
            </p>
          )}
          {d.metodo !== "estimado" && !conEscrito && procedencia && <p className="mt-1">El relleno es {procedencia}.</p>}
        </>
      )}
      {conEscrito && (
        <p className="mt-1">
          Manda el escrito, {n(escrito!, 2)} kN/m²{procedencia ? ` (${procedencia})` : ""}
          {tipo === "reticular" ? ", en la zona aligerada (los ábacos, γ·canto)" : ""}
          {conRelleno ? "; el relleno no se usa: no se suman" : ""}.{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => escribir("pp", "")}>
            Usar el calculado
          </button>
        </p>
      )}
      {medio(conEscrito ? escrito! : d.pp)}
    </div>
  );
}

// ─── Rigidez del aligerado ──────────────────────────────────────────────────────────────────────

export function RigidezAligeradoPanel({ fila, ctx, escribir, errores, rigidez }: Props & { rigidez: "uniforme" | "bruta" }) {
  const r = rigidezAligerado(fila, ctx, rigidez);
  if (!r)
    return (
      <p className="nota">
        Con el canto, el intereje, el nervio, la capa y el material, aquí sale la rigidez de la zona aligerada frente a una losa maciza del mismo canto.
      </p>
    );
  const mia = r.modo === "dada";
  return (
    <div className="mx-3.5 mb-2" data-testid="rigidez-aligerado">
      <Grupo rol="radiogroup" etiqueta="Rigidez del aligerado" className="seg mb-1.5">
        <button type="button" role="radio" aria-checked={!mia} data-on={!mia} onClick={() => mia && escribir("multiplicadores", "")}>
          Calculada
        </button>
        <button type="button" role="radio" aria-checked={mia} data-on={mia} onClick={() => !mia && escribir("multiplicadores", textoMultiplicadores(r.calculados))}>
          La mía
        </button>
      </Grupo>
      <p className="text-[12px] leading-snug text-text-secondary mb-1.5">
        Cada número multiplica la rigidez de la losa maciza del mismo canto (1 = maciza).
        {mia ? " Cambie el que quiera; vacío o 1 es la maciza." : " Para cambiar alguno, pase a «La mía»: empieza con éstos."}
      </p>
      <TablaMultiplicadores r={r} mia={mia} escribir={escribir} />
      {errores.multiplicadores && <p className="error">{errores.multiplicadores}</p>}
      <p className="text-[12px] leading-snug text-text-secondary mt-1.5">
        {mia ? (
          <>
            Van sobre la maciza con el ν del hormigón ({n(r.nu, 2)}), los ábacos son macizos (1) y las vigas planas a sus lados no se rebajan.
          </>
        ) : r.rigidez === "uniforme" ? (
          <>
            Rigidez «uniforme»: la flexión, ½ de la maciza en las dos direcciones, y la torsión, ½ con el G del hormigón, en lo aligerado y en los ábacos; el axil y los cortantes, los de la T del nervio (en los ábacos, macizos). Sin efecto Poisson
            (ν = 0, como un emparrillado). Las vigas planas a sus lados van con la flexión ×0,6.
          </>
        ) : (
          <>Los de la T bruta del nervio (opción «bruta»), sin efecto Poisson (ν = 0, como un emparrillado); los ábacos, macizos.</>
        )}
      </p>
    </div>
  );
}

function TablaMultiplicadores({ r, mia, escribir }: { r: RigidezAligerado; mia: boolean; escribir: Props["escribir"] }) {
  return (
    <table className="w-full text-[12px] tabular-nums" aria-label="Multiplicadores del aligerado">
      <thead>
        <tr className="text-text-secondary text-[11px]">
          <th className="text-left font-normal py-0.5">rigidez a</th>
          <th className="text-right font-normal">{mia ? "calculado" : "valor"}</th>
          {mia && <th className="text-right font-normal pl-2">el suyo</th>}
        </tr>
      </thead>
      <tbody>
        {MULTIPLICADORES.map((m) => (
          <tr key={m.clave} title={m.que} className="border-t border-border-sub">
            <td className="py-0.5">
              {m.nombre} <span className="font-mono text-[11px] text-text-secondary">{m.clave}</span>
            </td>
            <td className={`text-right ${mia ? "text-text-secondary" : ""}`}>{n(r.calculados[m.clave])}</td>
            {mia && (
              <td className="text-right pl-2">
                <CeldaMultiplicador clave={m.clave} r={r} escribir={escribir} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Un multiplicador de «la mía»: al salir o con Intro se escriben los ocho (los no escritos, 1). */
function CeldaMultiplicador({ clave, r, escribir }: { clave: keyof MultiplicadoresLamina; r: RigidezAligerado; escribir: Props["escribir"] }) {
  const actual = r.dados[clave];
  const [texto, setTexto] = useState<string | null>(null);
  useEffect(() => setTexto(null), [actual]);
  const mostrado = texto ?? (actual === undefined ? "" : n(actual, 4));
  const leido = mostrado.trim() === "" ? 1 : leerNumero(mostrado);
  const v = typeof leido === "number" ? leido : NaN;
  const mal = !(v > 0 && v <= 100);
  const poner = () => {
    if (texto === null || mal) return;
    escribir("multiplicadores", textoMultiplicadores({ ...r.usados, [clave]: v }));
  };
  return (
    <input
      className="w-[64px] text-right rounded border border-border-main bg-bg-primary px-1 py-px font-mono text-[12px] data-[error=true]:border-state-fail"
      value={mostrado}
      placeholder="1"
      data-error={mal}
      aria-label={`multiplicador ${clave}`}
      aria-invalid={mal}
      title={mal ? (typeof leido === "string" ? `${leido}: un número en (0, 100]` : "Un número en (0, 100]") : undefined}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={poner}
      onKeyDown={(e) => {
        if (e.key === "Enter") poner();
        if (e.key === "Escape") setTexto(null);
      }}
    />
  );
}
