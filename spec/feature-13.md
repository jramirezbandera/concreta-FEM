# feature-13 · Cargas, hipótesis y combinaciones

> Tier 3 · UI + normativa · **Dependencias: feature-10, feature-11, feature-12** · Bloquea: 14.

## Objetivo

Definir **hipótesis** y **cargas** (lineales y superficiales) por ámbito, y generar las **combinaciones** que F1 necesita, derivadas de la categoría de uso del grupo. Provee al discretizador (feature-4) las cargas y combos que traducirá a la Capa 2.

## ⚠️ Normativa (verificar contra norma vigente)

- **Combinaciones (CTE DB-SE):** ELU persistente y ELS según las ecuaciones del CTE (la I+D cita 4.3 / 4.6–4.8). Coeficientes γ: permanente desfavorable **1,35** / favorable **0,80**; variable desfavorable **1,50** / favorable **0**; ELS=1,00 (hallazgo #5). **Para F1 basta ELU persistente + ELS característica.**
- **Alcance de variables en F1 (decisión):** F1 maneja **una única acción variable dominante** (la sobrecarga de uso Q del grupo). **No** hay concomitancia de varias variables con ψ₀ (viento/nieve simultáneos) — eso es F2. Las hipótesis de viento/nieve se pueden **declarar** (estructura de datos lista), pero F1 **no** genera combos que las concomiten con ψ₀. Esto simplifica la generación de combos y sus tests.
- **Sobrecargas de uso (CTE DB-SE-AE Tabla 3.1)** y **ψ (Tabla 4.2)** verificados en la I+D contra PDF oficial (hallazgo #7). **Reconfirmar contra la versión vigente del CTE** y tratar como tabla de datos aislada.
- La **categoría de uso** vive en el `Grupo` (feature-10) y deriva `qk` y los `ψ`.

> Implementar valores normativos como tabla de datos con su fuente citada y marca de verificación, igual que en feature-3.

## Alcance

**Incluye** (`/src/ui/dialogos` + normativa en `/src/biblioteca` o `/src/dominio`)
- Gestión de **hipótesis** (`Hipotesis`): permanentes (G), variables de uso (Q), y reservar viento/nieve (datos para combos).
- **Cargas** (`Carga`): `puntual`/`lineal`/`superficial`, `ambito` (barra, paño/área, nudo), `valor`, `hipotesisId`. UI para crear/editar/eliminar (comandos undo/redo).
- Tabla de **categorías de uso → qk y ψ** (CTE), aislada y verificable.
- Generación de **combinaciones F1**: ELU persistente (1,35·G + 1,5·Q…) y ELS característica, con los ψ correctos según categoría. Salida en la forma que consume el discretizador (`{hipotesis: factor}` + tags).

**Excluye**: el reparto fino de paños a vigas por áreas tributarias 45° (hallazgo #16) es lógica del **discretizador** (feature-4); aquí solo se define la carga superficial y su ámbito. Sin armado/comprobación (F4).

## Entradas de I+D

- Hallazgos #5 (combinaciones γ), #7 (sobrecargas/ψ), #16 (reparto — referencia, implementado en feature-4).
- Área 4 §1-2, `CLAUDE.md §6` (`Carga`, `Hipotesis`).

## Criterios de aceptación

- Crear hipótesis y cargas por ámbito, reversible (undo/redo); editar invalida resultados.
- Seleccionar categoría de uso en el grupo asigna `qk` y `ψ` correctos (test contra tabla CTE).
- Se generan ELU persistente + ELS característica con coeficientes correctos (test).
- Valores normativos con fuente citada y marca de verificación; ninguno inventado.
- Component tests (RTL) y unit tests de la generación de combos (node).

## Notas / riesgos

- El error de coeficiente de combinación es silencioso: cubrir con tests numéricos.
- Mantener la dirección de carga (gravedad → global FY negativo) coherente con feature-4.
