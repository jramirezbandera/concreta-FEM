import { useId, useRef } from "react";
import { Dialogo } from "./Dialogo";
import { Segmentado, Boton } from "../primitivas";
import { modeloStore, vistaStore, editarAnalisis } from "../../estado";
import type { OpcionesAnalisis } from "../../dominio";
import "./opcionesAnalisis.css";

// DialogoOpcionesAnalisis (F2.4): configura el analisis de la obra (Capa 1,
// `modelo.analisis`). Tres bloques en jerarquia descendente (D-diseño-3):
//   (1) TIPO de analisis — Segmentado lineal/general/P-Δ (control primario).
//   (2) PESO PROPIO — checkbox, ON por defecto (el discretizador emite w=A·rho).
//   (3) COMPROBAR ESTATICA — checkbox secundario, contextual al tipo.
//
// COMMIT EN VIVO: cada cambio despacha su comando reversible al instante (sin boton
// "Guardar"), igual que DialogoHipotesis/DialogoGruposYPlantas. Editar la obra
// invalida los resultados vigentes (lo hace modeloStore.ejecutar, patron existente).
//
// D-diseño-3 (check_statics bajo P-Δ): al elegir tipo=P-Δ se auto-desmarca Y se
// DESHABILITA "Comprobar estática" (el P-Δ no realiza la comprobacion de equilibrio;
// el glue la fuerza a false bajo P-Δ, F2.2/E6), con una cx-note que lo explica.
// Volver a lineal/general RESTAURA el valor que tenia antes de pasar a P-Δ. a11y:
// aria-disabled + aria-describedby a la nota (la etiqueta no depende solo del color).
//
// VOCABULARIO DE OBRA (CLAUDE.md §17): cero jerga FEM. "Tipo de análisis", "Peso
// propio", "Comprobar estática" son terminos de obra; el usuario nunca ve "PDelta"
// crudo (se rotula "P-Δ") ni "check_statics".
//
// INVARIANTE DEL `base` (CLAUDE.md §10): el comando se construye SIEMPRE contra el
// modelo ACTUAL leido justo antes de ejecutar, nunca contra la copia del render.

const OPCIONES_TIPO = [
  { valor: "lineal", etiqueta: "Lineal", titulo: "Análisis lineal" },
  { valor: "general", etiqueta: "General", titulo: "Análisis general" },
  { valor: "pDelta", etiqueta: "P-Δ", titulo: "Análisis P-Δ (segundo orden)" },
] as const;

const NOTA_PDELTA =
  "El análisis P-Δ no realiza la comprobación de equilibrio.";

// Lee el modelo ACTUAL del store (invariante del `base`).
function leerModelo() {
  return modeloStore.getState().getModelo();
}

export function DialogoOpcionesAnalisis() {
  // Lectura reactiva de las opciones de analisis (el dialogo no esta en el bucle del
  // viewport; re-render al editar es aceptable). Selector sobre el sub-objeto analisis.
  const analisis = modeloStore((s) => s.modelo.analisis);

  const dialogoActivo = vistaStore((s) => s.dialogoActivo);
  const cerrarDialogo = vistaStore((s) => s.cerrarDialogo);
  const open = dialogoActivo === "opcionesAnalisis";

  const notaId = useId();

  // Recuerda el valor de "Comprobar estática" ANTES de pasar a P-Δ, para restaurarlo
  // al volver a lineal/general (D-diseño-3). Ref (no estado): no necesita re-render,
  // solo persistir entre cambios de tipo mientras el dialogo esta montado.
  const comprobarPrevio = useRef<boolean>(analisis.comprobarEstatica);

  const bajoPDelta = analisis.tipo === "pDelta";

  // Despacha un comando reversible con los cambios de analisis. No-op si nada cambia
  // (no ensucia el undo): comparamos campo a campo contra el modelo actual.
  const aplicar = (cambios: Partial<OpcionesAnalisis>) => {
    const m = leerModelo();
    const distinto = (Object.keys(cambios) as (keyof OpcionesAnalisis)[]).some(
      (k) => cambios[k] !== m.analisis[k],
    );
    if (!distinto) return;
    modeloStore.getState().ejecutar(editarAnalisis(m, cambios));
  };

  const cambiarTipo = (tipo: OpcionesAnalisis["tipo"]) => {
    if (tipo === analisis.tipo) return; // no-op
    if (tipo === "pDelta") {
      // Pasar a P-Δ: recuerda el valor actual y auto-desmarca + deshabilita la
      // comprobacion en el MISMO comando (un solo paso de undo).
      comprobarPrevio.current = analisis.comprobarEstatica;
      aplicar({ tipo, comprobarEstatica: false });
    } else {
      // Volver a lineal/general: restaura el valor que tenia antes de P-Δ. Si veniamos
      // de P-Δ, comprobarPrevio guarda la eleccion previa; si no, no aplica el cambio
      // (comprobarEstatica ya coincide y `aplicar` lo trata como no-op por campo).
      const comprobarEstatica = bajoPDelta
        ? comprobarPrevio.current
        : analisis.comprobarEstatica;
      aplicar({ tipo, comprobarEstatica });
    }
  };

  const cambiarPesoPropio = (incluir: boolean) => {
    aplicar({ incluirPesoPropio: incluir });
  };

  const cambiarComprobar = (comprobar: boolean) => {
    if (bajoPDelta) return; // deshabilitado bajo P-Δ (no se puede tocar)
    // Mantenemos `comprobarPrevio` en sintonia: si el usuario lo cambia con un tipo
    // lineal/general, ese es el valor a restaurar la proxima vez que salga de P-Δ.
    comprobarPrevio.current = comprobar;
    aplicar({ comprobarEstatica: comprobar });
  };

  const pie = (
    <Boton variante="ghost" onClick={cerrarDialogo}>
      Cerrar
    </Boton>
  );

  return (
    <Dialogo
      open={open}
      onOpenChange={(o) => {
        if (!o) cerrarDialogo();
      }}
      titulo="Opciones de análisis"
      pie={pie}
    >
      <div className="cx-opc">
        {/* (1) Tipo de analisis: control primario. */}
        <div className="cx-opc__bloque">
          <span className="cx-opc__label">Tipo de análisis</span>
          <Segmentado
            aria-label="Tipo de análisis"
            opciones={OPCIONES_TIPO}
            valor={analisis.tipo}
            onValor={cambiarTipo}
          />
        </div>

        {/* (2) Peso propio: ON por defecto. */}
        <div className="cx-opc__bloque">
          <span className="cx-opc__label">Peso propio</span>
          <label className="cx-opc__check">
            <input
              type="checkbox"
              checked={analisis.incluirPesoPropio}
              onChange={(e) => cambiarPesoPropio(e.target.checked)}
            />
            <span className="cx-opc__check-texto">
              <span className="cx-opc__check-titulo">
                Incluir el peso propio de la estructura
              </span>
            </span>
          </label>
        </div>

        {/* (3) Comprobar estatica: secundario, contextual al tipo (D-diseño-3). */}
        <div className="cx-opc__bloque">
          <span className="cx-opc__label">Comprobación</span>
          <label
            className={
              bajoPDelta
                ? "cx-opc__check cx-opc__check--disabled"
                : "cx-opc__check"
            }
          >
            <input
              type="checkbox"
              checked={bajoPDelta ? false : analisis.comprobarEstatica}
              disabled={bajoPDelta}
              aria-disabled={bajoPDelta}
              aria-describedby={bajoPDelta ? notaId : undefined}
              onChange={(e) => cambiarComprobar(e.target.checked)}
            />
            <span className="cx-opc__check-texto">
              <span className="cx-opc__check-titulo">Comprobar estática</span>
            </span>
          </label>
          {bajoPDelta ? (
            <p id={notaId} className="cx-note" role="note">
              {NOTA_PDELTA}
            </p>
          ) : null}
        </div>
      </div>
    </Dialogo>
  );
}
