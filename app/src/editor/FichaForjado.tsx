/**
 * Dos partes de la ficha de un forjado en Propiedades (2026-10-28, a petición del usuario: los
 * multiplicadores «no se entienden ni se sabe cómo cambiarlos» y el peso propio «se podría calcular»):
 *
 * - el peso propio: cómo sale el pp que se usa (el hormigón y el casetón o la bovedilla, con sus
 *   números) y, si hay uno escrito, que manda él y cómo volver al calculado;
 * - la rigidez del aligerado de un reticular: «calculada» (los ocho multiplicadores que usa el cálculo,
 *   con su nombre) o «la mía» (los ocho, rellenos con los calculados para cambiar el que se quiera).
 *
 * Lo que escriben va por `escribir`, como un campo más (un paso de deshacer).
 */
import { useEffect, useState } from "react";
import { MULTIPLICADORES, rigidezAligerado, textoMultiplicadores, type RigidezAligerado } from "../../../src/editor/ficha.ts";
import { desglosePesoFila, ppObligatorio, type Contexto } from "../../../src/editor/tablas.ts";
import type { Fila } from "../../../src/editor/celdas.ts";
import type { MultiplicadoresLamina } from "../../../src/elementos/lamina.ts";

/** Un número a la española con `d` decimales como mucho («0,126», «25»). */
const n = (v: number, d = 3) => String(Number(v.toFixed(d))).replace(".", ",");

interface Props {
  fila: Fila;
  ctx: Contexto;
  /** Escribe un campo de la fila (como si se tecleara). */
  escribir: (clave: string, valor: string) => void;
  /** El error del último intento en cada campo. */
  errores: Readonly<Record<string, string>>;
}

// ─── Peso propio ────────────────────────────────────────────────────────────────────────────────

export function PesoForjado({ fila, ctx, escribir }: Props) {
  const tipo = (fila.tipo ?? "").trim().toLowerCase() || "maciza";
  const d = desglosePesoFila(fila, ctx);
  const texto = (fila.pp ?? "").trim();
  const escrito = texto ? Number(texto.replace(",", ".")) : undefined;
  if (!d) {
    if (!ppObligatorio(fila, ctx)) return null;
    return (
      <p className="nota">
        {tipo === "reticular" ? "Con un casetón perdido de otro material" : "Con una vigueta que no es una T más estrecha que el intereje"} el peso propio no sale solo: escríbalo
        {tipo === "unidireccional" ? ", con las bovedillas" : ""}.
      </p>
    );
  }
  const hueco = tipo === "reticular" ? "casetón" : "bovedilla";
  return (
    <div className="nota" data-testid="peso-forjado">
      {tipo === "maciza" ? (
        <p>
          Peso propio: γ·canto = {n(d.gamma)} × {n(d.hormigon)} = <b>{n(d.pp, 2)} kN/m²</b>.
        </p>
      ) : (
        <p>
          Peso propio{tipo === "reticular" ? " de lo aligerado" : ""}: hormigón {n(d.gamma)} kN/m³ × {n(d.hormigon)} m³/m²
          {d.pesoHueco > 0 ? ` + ${hueco} ${n(d.pesoHueco)} kN/m³ × ${n(d.hueco)} m³/m²` : ` (el ${hueco} no pesa)`} = <b>{n(d.pp, 2)} kN/m²</b>
          {tipo === "reticular" ? `; los ábacos, macizos: ${n(d.gamma)} × canto.` : "."}
        </p>
      )}
      {escrito !== undefined && Number.isFinite(escrito) && (
        <p className="mt-1">
          Manda el escrito, {n(escrito, 2)} kN/m²{tipo === "reticular" ? ", en toda la losa con los ábacos" : ""}.{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => escribir("pp", "")}>
            Usar el calculado
          </button>
        </p>
      )}
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
      <div className="seg mb-1.5" role="radiogroup" aria-label="Rigidez del aligerado">
        <button type="button" role="radio" aria-checked={!mia} data-on={!mia} onClick={() => mia && escribir("multiplicadores", "")}>
          Calculada
        </button>
        <button type="button" role="radio" aria-checked={mia} data-on={mia} onClick={() => !mia && escribir("multiplicadores", textoMultiplicadores(r.calculados))}>
          La mía
        </button>
      </div>
      <p className="text-[12px] leading-snug text-text-secondary mb-1.5">
        Cada número multiplica la rigidez de la losa maciza del mismo canto (1 = maciza).
        {mia ? " Cambie el que quiera; vacío o 1 es la maciza." : " Para cambiar alguno, pase a «La mía»: empieza con éstos."}
      </p>
      <TablaMultiplicadores r={r} mia={mia} escribir={escribir} />
      {errores.multiplicadores && <p className="error">{errores.multiplicadores}</p>}
      <p className="text-[11.5px] leading-snug text-text-secondary mt-1.5">
        {mia ? (
          <>
            Van sobre la maciza con el ν del hormigón ({n(r.nu, 2)}), los ábacos son macizos (1) y las vigas planas a sus lados no se rebajan.
          </>
        ) : r.rigidez === "uniforme" ? (
          <>
            Rigidez «uniforme» (CY3): la flexión, ½ de la maciza en las dos direcciones, y la torsión, ½ con el G del hormigón, en lo aligerado y en los ábacos; el axil y los cortantes, los de la T del nervio (en los ábacos, macizos). Sin efecto Poisson
            (ν = 0, como un emparrillado). Las vigas planas a sus lados van con la flexión ×0,6 (RV-a).
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
              {m.nombre} <span className="font-mono text-[10.5px] text-text-secondary">{m.clave}</span>
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
  const v = mostrado.trim() === "" ? 1 : Number(mostrado.trim().replace(",", "."));
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
      title={mal ? "Un número en (0, 100]" : undefined}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={poner}
      onKeyDown={(e) => {
        if (e.key === "Enter") poner();
        if (e.key === "Escape") setTexto(null);
      }}
    />
  );
}
