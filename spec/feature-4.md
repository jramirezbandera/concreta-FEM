# feature-4 · El discretizador (Capa 1 → Capa 2) + contrato FEM + validaciones

> Tier 1 · Motor · **EL CORAZÓN** · **Dependencias: feature-2, feature-3** · Bloquea: 5, 6.

## Objetivo

`discretizar(modelo: Modelo): ModeloFEM` — función **pura** (sin React/IO/Pyodide, ejecutable en Node) que traduce la obra (Capa 1) al **JSON contrato que consume PyNite** (Capa 2), con validaciones previas en lenguaje de obra. Es el código más crítico y más testeado del producto.

## Alcance

**Incluye** (`/src/discretizador`)
- `contratoFEM.ts`: tipos de la Capa 2 (`nodes`, `materials`, `sections`, `members`, `supports`, `releases`, `loads`, `combos`, `units`). Esquema Zod de salida.
- `discretizar.ts`:
  - **Nodos** por snapping geométrico con tolerancia explícita `1e-3` m; numeración **determinista**; compartir nudo donde coincide geometría (cabezas/pies de pilar, encuentros de viga).
  - **Mapeo de ejes con Y vertical**: planta `(x,y)` → global `(X,Z)`; cota/altura → `Y`. Gravedad = `FY` negativo. (Hallazgo #18: convención, fijarla y testearla.)
  - **Pilar** → `member` vertical; si `vinculacionExterior` y arranque empotrado → `support` en el nudo de arranque; arranque articulado → support con liberación; elástico (reservar).
  - **Viga** → `member`; `extremoI/J = articulado` → `releases` (liberar **Ry, Rz** del extremo; biarticulado celosía = Ryi,Rzi,Ryj,Rzj). **Nunca liberar Rx (torsión) en ambos extremos.** Firma 12 flags (hallazgo #8).
  - **Cargas por hipótesis** → `add_*_load(case=...)`; **MAYÚSCULAS=global / minúsculas=local** (error nº1, hallazgo #3).
  - **Combos** como `{hipotesis: factor}` con `combo_tags` (detalle de coeficientes en feature-13; aquí el mecanismo).
  - Orden de dependencias: materiales/secciones → nodos → barras → apoyos → releases → cargas → combos.
- `validaciones.ts`: nombres únicos; referencias válidas (barra→nodos/material/sección); **sujeción suficiente** (validar los 6 GDL de sólido rígido, no mecanismo) **antes** del solver; combos que referencian hipótesis con cargas. Errores **en lenguaje de obra** que apuntan al elemento culpable (p. ej. *"El pilar P3 no tiene arranque ni conexión: la estructura no está sujeta"*).

**Excluye**: llamar a PyNite (feature-5), reparto fino de paños (F3; en F1 solo cargas lineales/superficiales sobre barras/ámbitos). I/O, React, Pyodide.

## Entradas de I+D

- Hallazgos #3 (dirección de carga), #4 (puro + golden), #8 (releases canónicos), #16 (áreas tributarias 45° — solo si aplica a cargas superficiales en F1), #18 (Y vertical), #19 (ejes locales pilar vertical, confianza media → test).
- Área 2 completa (`areas/02-discretizador.md`) y su verificación.

## Contrato de salida (Capa 2)

JSON `{ units:"kN-m", nodes, materials, sections, members, supports, releases, loads, combos }` validado con Zod. Ver `PyNite_Guia_Completa.md §11.1`.

## Criterios de aceptación

- `discretizar()` es pura: corre en Node sin tocar DOM/worker. Sin imports de React/Pyodide.
- La salida valida contra su esquema Zod.
- Numeración de nodos determinista (mismo modelo ⇒ misma Capa 2, byte a byte).
- Validaciones devuelven mensajes en lenguaje de obra con id del elemento culpable.
- Cubierto por los golden tests de feature-6 (esta feature deja `discretizar()` listo; feature-6 lo verifica contra fórmula cerrada).

## Notas / riesgos

- **Dirección global/local**: el fallo da resultados plausibles pero erróneos → es lo primero que cubre feature-6.
- **Ejes locales de pilar vertical** (web-vector degenera): documentar la convención elegida; feature-6 la blinda con carga lateral en X y en Z.
- Tolerancia de snapping configurable pero por defecto `1e-3` m.
