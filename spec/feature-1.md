# feature-1 · Andamiaje del proyecto, stack y sistema de unidades

> Tier 0 · Cimientos · **Dependencias: ninguna** · Bloquea: todas.

## Objetivo

Dejar el repo greenfield listo para construir: proyecto Vite + React + TypeScript `strict`, herramientas (Tailwind+tokens, Zustand, lint/format, test), la **estructura de carpetas** del `CLAUDE.md §5`, los scripts de `package.json` y el módulo `/src/unidades` (conversión solo en los bordes).

## Alcance

**Incluye**
- Inicializar Vite (plantilla `react-ts`). TS en modo `strict`, sin `any` salvo justificación.
- Dependencias base: `zustand` + `immer`, `tailwindcss` v4 + `@tailwindcss/vite`, `zod`. (R3F/drei/Plotly/Dexie/Comlink se añaden en sus features para no inflar esta tarea, pero deja documentado dónde irán.)
- Dev tooling: ESLint + Prettier, Vitest configurado con `test.projects` (proyecto `node` y proyecto `jsdom`) — esqueleto, sin tests todavía.
- Estructura de carpetas vacía (con `index.ts` o `.gitkeep`) según `CLAUDE.md §5`: `/src/{dominio,discretizador,solver,estado,biblioteca,persistencia,ui,unidades}` y `/tests/golden`.
- Tailwind con **design tokens como variables CSS** (placeholder de paleta; `--accent` provisional). Lienzo oscuro tipo CAD como base.
- `/src/unidades`: sistema interno **kN-m** y funciones de conversión en los bordes (mm↔m para secciones, MPa↔interno para E, kN/kN·m/kN·m² para cargas). Puras y testeables.
- Scripts en `package.json`: `dev`, `build`, `preview`, `test`, `test:golden`, `e2e`, `lint`, `typecheck`.

**Excluye**: cualquier lógica de dominio, UI real, worker. Solo andamiaje + unidades.

## Entradas de I+D / CLAUDE.md

- `CLAUDE.md §4` (stack cerrado), `§5` (carpetas), `§14` (unidades), `§16` (comandos).
- Hallazgo #22 (Tailwind + CSS variables como tokens).

## Archivos a crear (orientativo)

- `package.json`, `vite.config.ts`, `tsconfig.json` (strict), `.eslintrc`, `.prettierrc`, `vitest.config.ts` (`test.projects`).
- Tailwind v4 **CSS-first** (sin `tailwind.config.js` ni `postcss.config.js`): plugin `@tailwindcss/vite` en `vite.config.ts`, `@import "tailwindcss"` en `src/index.css`, y los design tokens en `src/styles/tokens.css` vía bloque `@theme`.
- `src/main.tsx`, `src/App.tsx` (placeholder mínimo).
- `src/unidades/index.ts`, `src/unidades/conversion.ts` (+ tipos de magnitudes).
- Carpetas con `index.ts` barrel vacíos.

## Contrato de `/src/unidades`

- Sistema interno declarado: `"kN-m"`. Todas las funciones de conversión nombran origen→destino explícitamente (p. ej. `mmToM`, `mpaToInterno`).
- Conversión **idempotente** y **pura**; la UI nunca llama a conversión en mitad de la lógica.

## Criterios de aceptación

- `npm install`, `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint` funcionan sin errores.
- `npm run test` arranca Vitest con dos proyectos (`node`, `jsdom`) aunque no haya tests.
- `tsc --noEmit` pasa con `strict`.
- Conversión de unidades cubierta por un test trivial (ida y vuelta).

## Notas / riesgos

- No añadir dependencias pesadas aquí; cada capa trae las suyas.
- Dejar la paleta Concreta y tipografías como placeholder (decisión abierta del `CLAUDE.md §18`).
