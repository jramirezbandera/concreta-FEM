---
name: fem
description: Modelar, calcular y consultar una estructura con el motor FEM 3D de Concreta mediante la CLI `fem` y un fichero proyecto.json. Úsala cuando haya que crear o editar un modelo estructural (plantas, pilares, vigas, losas, muros, forjados, cargas), validarlo, calcularlo o leer sus resultados (envolventes, flechas, deriva, reacciones, esfuerzos de una pieza o de una banda).
---

# fem: modelar y calcular con Concreta FEM 3D

Trabajas sobre **un único fichero `proyecto.json`**: es la única fuente de verdad. Cada cambio del modelo es una edición de ese fichero. Los resultados se derivan de él y se guardan en `.fem/<huella>/`, junto al fichero.

## Reglas

1. **No produces ningún número de cálculo.** Todo esfuerzo, flecha o reacción que des sale de una salida de `fem`; cítala, con su combinación. Si una consulta no da lo que necesitas, dilo; no lo estimes.
2. **La norma no sale de tu memoria.**
   - Los coeficientes (ψ, cargas de uso, γ) los da quien describe el proyecto.
   - Si faltan, deja los casos sin `accion`: las consultas irán por caso, sin combinaciones.
   - No te inventes cargas que no te han dado.
3. **No decides por el ingeniero.** Si la descripción es ambigua (una luz, una sección, un apoyo), pregunta o dilo; no elijas en silencio. Las opciones de compilación por defecto (`opciones`) ya están decididas: no las cambies si no te lo piden.
4. **Ningún resultado vale si `ok` no es `true`.** Los errores se corrigen en el fichero, por el `id` que nombra cada diagnóstico. Los avisos se leen todos y se explican al usuario si afectan al modelo.

## Flujo

```bash
fem esquema                                  # ruta del JSON Schema (descripciones = convenios)
fem validar proyecto.json                    # esquema + compilación; corrige hasta ok: true
fem resumen proyecto.json                    # comprueba el modelo: plantas, piezas, cargas por planta y caso
fem calcular proyecto.json                   # calcula (o reutiliza los resultados de la misma huella)
fem consultar proyecto.json <consulta> …     # resultados acotados
```

- `fem` es `bun "<repo>/cli/fem.ts"`; dentro del repo, también `bun run fem`.
- Cada orden escribe **un objeto JSON** con `orden`, `ok` y `diagnosticos`. Los diagnósticos repetidos se resumen en `omitidos`.
- **Códigos de salida:** 0 bien; 1 errores del modelo o del cálculo; 2 orden mal dada; 3 error interno.
- **Números:** la salida va a 6 cifras significativas; con `--exacto`, completos.

**Tras validar, lee `fem resumen`** antes de calcular: la carga vertical de cada planta y caso (`cargas`, en kN, con el peso propio) y el total por caso (`casos[].F`) delatan una carga olvidada, duplicada o en otras unidades.

## El fichero

```json
{ "esquema": "concreta-fem/proyecto@1", "nombre": "…", "modelo": { … }, "opciones": { … } }
```

Hay un ejemplo completo y válido en `ejemplo.json`, junto a esta skill. El esquema (`fem esquema`) documenta cada campo. **Un campo que no existe es un error**: el validador propone el nombre más parecido.

### Convenios del modelo

- **Unidades:** kN y m; módulos en kN/m², salvo `fck` y `E` de los materiales, que van en MPa; pesos específicos en kN/m³; cargas de superficie en kN/m², lineales en kN/m.
- **Ejes:** globales X e Y en planta, **Z hacia arriba**. Una carga de gravedad es `q: [0, 0, -valor]`.
- **Plantas, de ARRIBA ABAJO.**
  - Cada una lleva su `altura` hasta la de encima; la primera de la lista (la de arriba) lleva `"altura": null`.
  - El nivel de cimentación es la última planta: los pilares arrancan en él (`desde`) y se empotran por defecto.
  - Las cotas no se escriben; salen de las alturas.
- **`id` únicos en todo el modelo** (plantas, materiales, secciones, piezas, casos y cargas).
- **Pilares:** se sitúan con `x`, `y`, `desde` (la planta de su base) y `hasta` (la de su cabeza). Una sección rectangular lleva `b` y `h`; el canto `h` va según X con `giro` 0.
- **Vigas:** se dibujan con `puntos` en planta sobre su eje y con su planta. Se conectan solas a los pilares y a otras vigas que tocan (tolerancia de 5 cm, con aviso).
- **Losas y paños:** su contorno es un polígono simple y no repite el primer punto.
  - **Se dibujan a ejes:** el borde que apoya en una viga va sobre el eje de la viga.
  - El peso propio de una losa maciza se calcula solo (γ·espesor).
  - Un paño unidireccional necesita su `pp`, y un reticular, el `pp` (casetón perdido por defecto).
- **Muros:** verticales, de `desde` a `hasta`, sobre su eje en planta.
- **Casos:** como mucho uno con `pesoPropio: true`.
  - Con `accion` en **todos** los casos, las consultas usan las combinaciones CTE/NCSE.
  - `accion` lleva: `tipo` G, Q, W, S, E…; `psi` como `{ psi0, psi1, psi2 }` con los valores que te den; y, en W y E, `direccion` y `signo`.
- **Cargas:**
  - `superficie`: sobre una `losa`, un `pano` o una `zona` (polígono) de su planta.
  - `lineal`: polilínea sobre una losa o el eje de un muro.
  - `puntual`: `F` y `M` en ejes globales, en un punto de una planta.
  - `viga` y `pilar`: repartidas a lo largo de la pieza.
  - `empuje`: sobre un muro.

  Lo que cae fuera de las losas no carga, y lo avisa.

## Consultas

| Consulta | Da |
|---|---|
| `envolventes [--tipo pilar\|viga\|vigueta] [--planta P]` | Por tipo de pieza y planta: máximos y mínimos de N, Vz y My (y Vy y Mz en pilares), con la pieza, la estación y la combinación |
| `flechas [--losa L]` | Por losa o paño: la flecha máxima absoluta y la relativa a las esquinas del recuadro o a los extremos de la vigueta |
| `deriva [--planta P]` | Por planta: el mayor desplome relativo (d/h) con su pilar, y el desplazamiento del maestro del diafragma |
| `reacciones [--objeto id] [--top N \| --todos]` | Totales por caso (ΣF y ΣM respecto al origen) y los apoyos con más carga |
| `pieza <id> [--estaciones]` | Una viga o vigueta, por vanos (de cara a cara de apoyo); o un pilar, por tramos (base y cabeza, con los esfuerzos concomitantes) |
| `banda <id>` | My máximo y mínimo en cada estación de una banda (caras y vanos) |
| `combinaciones` | Las combinaciones en uso, con sus factores |

**Combinaciones:**
- Por defecto, ELU para los esfuerzos, ELS característica para los desplazamientos y los casos sueltos para las reacciones.
- Para cambiarlas: `--casos`, `--situacion ELU-PT,ELS-C`, `--combinacion "1.35*G+1.5*Q"` (repetible) o `--caso G`.
- `--estaciones` necesita una sola combinación.

**Signos:**
- Esfuerzos [N, Vy, Vz, T, My, Mz] en los ejes locales de la pieza. N > 0 es tracción.
- En una viga, My > 0 tracciona la cara inferior (momento de vano).
- Las flechas son positivas hacia abajo.
- Las estaciones `s` se miden en m desde el primer punto de la viga o desde la base del pilar.

## Cuándo pararte

- Si `validar` sigue dando el mismo error tras dos intentos, relee el mensaje y la descripción del campo en el esquema. Si sigue sin estar claro, pregunta.
- Si el equilibrio de un caso (`calcular` → `casos[].equilibrio`) pasa de 1e-9, o aparece un `motor/…` o un `compilador/error-interno`, es un fallo del programa: para y avisa.
