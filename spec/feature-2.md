# feature-2 · Modelo de dominio (Capa 1) + validación Zod

> Tier 0 · Cimientos · **Dependencias: feature-1** · Bloquea: 3, 4, 7, 8.

## Objetivo

Definir la **Capa 1** (modelo constructivo) como tipos puros, serializables, en **español ASCII**, con sus esquemas **Zod** como fuente única de verdad (tipos vía `z.infer`). Es lo único que se persiste.

## Alcance

**Incluye** (`/src/dominio`)
- Tipos: `Modelo`, `Grupo`, `Planta`, `Pilar`, `Viga`, `Carga`, `Hipotesis`, `Seccion`, `Material`, `OpcionesAnalisis`. (`Pano`/`Muro` son F3: declarar tipos **mínimos vacíos** `Pano`/`Muro` y campos `panos: Pano[]`/`muros: Muro[]` —no el literal `[]`— para poder ensanchar en F3 sin romper el esquema Zod ni Immer.)
- `CategoriaUso` como **enum** que deriva `qk` y `ψ` (los valores numéricos viven en la biblioteca/normativa de feature-3/feature-13; aquí solo el enum y su forma).
- Relaciones por `id` (sin referencias a objetos, sin clases con lógica).
- Esquemas Zod por entidad y un `ModeloSchema` raíz. Tipos derivados con `z.infer` (no duplicar tipos a mano).
- Helpers puros de consulta sobre el modelo (p. ej. `plantasDeGrupo`, `pilaresDePlanta`) sin estado.

**Excluye**: stores Zustand (feature-7), persistencia (feature-8), valores normativos concretos (feature-3/13), discretización (feature-4).

## Entradas de I+D / CLAUDE.md

- `CLAUDE.md §6` (modelo de dominio, tipos bosquejados), `§9` (convenciones idioma).
- Hallazgo #15 (Zod en los bordes: `safeParse`, `z.infer`, `.issues`).
- Hallazgo #7 (`CategoriaUso` deriva qk y ψ).

## Forma de los tipos (base; ajustar a F1)

```ts
type Modelo = {
  unidades: "kN-m";
  schemaVersion: number;          // para migración (ver feature-8)
  grupos: Grupo[]; plantas: Planta[];
  pilares: Pilar[]; vigas: Viga[];
  panos: Pano[]; muros: Muro[];   // reservado F3 (tipos mínimos vacíos)
  cargas: Carga[]; hipotesis: Hipotesis[];
  analisis: OpcionesAnalisis;
};
```

(Ver `CLAUDE.md §6` para `Grupo/Planta/Pilar/Viga/Carga`. Mantener `arranque`, `extremoI/J`, `vinculacionExterior`, `tirante`.)

## Criterios de aceptación

- Todos los identificadores de dominio en español ASCII (sin tildes/ñ).
- `ModeloSchema.safeParse(modeloValido)` ⇒ ok; con datos corruptos ⇒ `success:false` y `error.issues` mapeable.
- Tipos = `z.infer<typeof XSchema>` (una sola fuente). `tsc --noEmit` limpio.
- Unit tests de `dominio` y de los esquemas (válido/ inválido) en proyecto Vitest `node`.
- El modelo es JSON-serializable (round-trip `JSON.parse(JSON.stringify(m))` estable).

## Notas / riesgos

- No meter lógica de UI ni de cálculo en el dominio (puro y serializable).
- Reservar `schemaVersion` desde ya: feature-8 lo usa para migración.
- `CategoriaUso`: el enum aquí; la tabla de valores (CTE/Código Estructural) en feature-3/13, marcada como verificable.
