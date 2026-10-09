# Fase A4 — capa de agente: render y revisión visual: resultado

> **Fecha:** 2026-10-09. **Plan:** `agente.md` (§3, A4; §10, lo que se fijó al empezar con el usuario: rasterizado, vistas, criterios y mutaciones visuales).
>
> **Veredicto: A4 pasa sus cinco criterios.**
> - **Fidelidad (criterio 1).** Lo dibujado es exactamente lo del modelo y de las consultas:
>   - los objetos de cada planta y sus cargas;
>   - las bandas de isovalores, sin huecos ni solapes;
>   - los extremos de uz frente a `flechas`, de m11…v13 frente a los campos SPR, de los diagramas frente a `pieza` y `Consultas.diagrama`, y de los axiles frente a `Consultas.pilar`.
> - **Determinismo (criterio 2).** El mismo SVG aunque se inviertan las listas del modelo, y el mismo PNG en Bun y en Node (congelado en un test).
> - **Tamaño (criterio 3).** ≤ 1568 px de lado y ningún texto bajo 11 px. En los cuatro edificios objetivo de 7 plantas, ≤ 1,17 s por planta y vista, e `informe.html` de ≤ 1,39 MB.
> - **Puerta visual (criterio 4).** Diez subagentes con sólo la descripción y las PNG:
>   - encuentran 7 de las 8 mutaciones que sólo se ven en el dibujo (el criterio pide 6);
>   - no dan ninguna discrepancia falsa en los dos proyectos sin mutar.
> - **Informe (criterio 5).** `fem revisar` mete en el HTML, por planta, el modelo y la uz de la combinación de las flechas, y el Markdown da el sha256 de cada SVG: la firma también cubre las figuras.
>
> **Hallazgos principales:**
> - **A4-2:** a la escala de un edificio entero (≈ 21 px/m) no se ve hacia dónde va el canto de un pilar. Su rótulo lleva ahora b×h y hX o hY.
> - **A4-4:** aun así, el revisor no vio el pilar girado (mutación 5): dijo haber comprobado hX/hY fila a fila. Revisar 80 rótulos a ojo no es fiable; una comprobación así va mejor en una consulta.
> - **A4-3:** la mutación 3 que se propuso al empezar (una secundaria que no llega a la principal) ya la avisa A3, como voladizo esbelto. Se cambió por una secundaria desplazada.
>
> **Cómo leerlo:** las tablas resumen los criterios, que se fijaron al empezar (`agente.md` §10). Cada sección da el detalle y la evidencia. Lo que queda para el usuario está en «Pendiente».

## Criterios

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Fidelidad: la escena tiene los objetos de la planta y sólo ellos; las bandas cubren sin huecos ni solapes; los extremos y las ordenadas son los de las consultas | **Pasa.** En la retícula con núcleo, el edificio con losas (2 plantas, con acciones) y el unidireccional (2 plantas), todas las plantas: coinciden a 1e-9 o bit a bit | `src/agente/render/render.test.ts` (7 tests) |
| 2 | Determinismo: el mismo SVG aunque se reordene el JSON; el mismo PNG en Bun, en Node y en el CI | **Pasa.** El SVG de 7 vistas por planta no cambia al invertir todas las listas. El PNG de la retícula con núcleo está congelado y sale igual en Node (vitest) y en Bun (la CLI). El CI lo comprueba en Linux | `render.test.ts`; `src/agente/cli.test.ts` («A4: render») |
| 3 | Tamaño: ≤ 1568 px de lado y texto ≥ 11 px; ≤ 2 s por planta y vista e `informe.html` ≤ 8 MB en el edificio objetivo | **Pasa.** El peor caso, 1,17 s: `vigas-my` en el unidireccional, con 442 viguetas por planta. El informe ocupa de 0,83 a 1,39 MB | `render.test.ts`; `validacion/a4/banco.ts`, `out_banco.txt` |
| 4 | Puerta: con la descripción y las PNG, al menos 6 de 8 mutaciones visuales y ninguna discrepancia falsa | **Pasa.** 7 de 8, todas con confianza alta; la que falta es el pilar girado (A4-4). Ninguna falsa en los dos proyectos sin mutar | `validacion/a4/spike.md`, `mutaciones.ts`, `out_mutaciones.txt`, `claves.json` |
| 5 | Informe: el HTML lleva la planta del modelo y la uz de cada planta; el Markdown, el sha256 de cada SVG | **Pasa** | `cli.test.ts`; `src/agente/revision.ts` (`figurasInforme`) |

## 1. Qué hay nuevo

| Dónde | Qué |
|---|---|
| `src/agente/render/escena.ts` | La escena: primitivas en coordenadas del modelo, con su estilo y su objeto físico, y los extremos rotulados (lo que la CLI devuelve en JSON) |
| `src/agente/render/svg.ts` | Encuadre, cabecera, leyenda con escala y ejes, y rótulos sin solapes (por prioridad, con posiciones alternativas). Determinista |
| `src/agente/render/modelo.ts` | Vistas `modelo`, `cargas` y `diagnosticos`: sólo el modelo físico, también si no compila |
| `src/agente/render/isovalores.ts` | Bandas por triángulos con cortes canónicos, fundidas en un contorno por banda; paleta divergente por signo |
| `src/agente/render/resultados.ts` | Vistas `malla`, `uz`, `m11`, `m22`, `m12`, `v13`, `v23`, `vigas-my`, `vigas-vz` y `pilares-n` |
| `cli/png.ts` | SVG → PNG con `@resvg/resvg-wasm` 2.6.2 (MPL-2.0) y Roboto 2.138 (Apache-2.0), versionada en `cli/fuentes/` y comprobada por sha256 |
| `fem render` | `--vista` y `--planta` (varias), `--caso`, `--combinacion` y `--situacion`. Escribe en `.fem/<huella>/render/` y devuelve las figuras con sus extremos (los 10 mayores) |
| `fem revisar` | El informe lleva las figuras (criterio 5) |
| `.claude/skills/fem/SKILL.md` | La orden `render`, qué mirar antes de calcular y la regla 7: un número nunca se lee de una imagen |

**Uso:**

```bash
fem render proyecto.json                                 # vista «modelo» de todas las plantas
fem render proyecto.json --vista modelo,cargas --planta N3
fem render proyecto.json --vista uz,m11 --caso G         # isovalores de un caso
fem render proyecto.json --vista vigas-my,pilares-n      # envolventes ELU (o la «gravedad» sin acciones)
```

## 2. Cómo se hacen

**Escena y SVG.**
- Cada vista arma una escena pura. El SVG la encuadra a la izquierda, con la leyenda, la escala y las notas a la derecha.
- Las coordenadas van en px con un decimal.
- Todo se dibuja por id, así que el orden de las listas del modelo no cambia ni el SVG ni qué rótulo gana un solape.
- Los rótulos que no caben se omiten y se cuentan (`rotulosOmitidos`); la pieza sigue dibujada.

**Qué hay en una planta.**
- Sus losas, paños, vigas, apoyos y bandas.
- Los pilares y muros que llegan a ella, rellenos; los que sólo arrancan de ella, en contorno.
- Los huecos de un muro que caen en el piso de debajo.

**Isovalores.**
- Cada lámina se parte en dos triángulos con sus valores nodales:
  - uz, de los desplazamientos;
  - m11…v23, de los campos SPR en los ejes de la lámina.

  Los campos se evalúan una vez por caso y planta y se combinan linealmente.
- Un corte se calcula siempre desde los extremos ordenados de su lado, así que dos triángulos vecinos dan el mismo punto bit a bit. Los lados repetidos en sentidos opuestos se cancelan y el resto se encadena en anillos («nonzero»).
- Hay como mucho diez bandas, con límites redondos que incluyen el 0. Rojos los positivos y azules los negativos, más oscuros cuanto más lejos del 0; dos bandas nunca tienen el mismo color.
- Con varias combinaciones, el mapa es el de la que da el mayor |valor| en la planta.

**Diagramas y axiles.**
- La envolvente de cada pieza se toma en las estaciones de su diagrama en cada combinación (las de `Consultas.diagrama`) y en 12 partes iguales de cada tramo flexible, por los dos lados de cada estación.
- Los extremos rotulados de cada vano son los de `Consultas.vano`.
- El axil, de la base y la cabeza del tramo (`Consultas.pilar`).

**Combinaciones por defecto:** las de las consultas de A1. Si los casos no llevan acción, la «gravedad» de A3: ×1 en uz y ×1,4 en los esfuerzos.

## 3. Hallazgos

| # | Hallazgo |
|---|---|
| A4-1 | resvg-wasm con Roboto versionada y sin fuentes del sistema da los mismos bytes en Bun y en Node. Roboto 2.138 no tiene ⊙, ⊗ ni flechas (↔, ↕): la leyenda va en palabras y la orientación de los pilares, en texto |
| A4-2 | A la escala de un edificio entero (≈ 21 px/m), un pilar de 30 × 50 mide 6 × 11 px y no se ve hacia dónde va su canto. Se vio al preparar la puerta, antes de lanzarla. El rótulo de un pilar rectangular no cuadrado lleva ahora b×h y hX, hY o el ángulo |
| A4-3 | La mutación 3 propuesta al empezar (una secundaria que acaba 0,6 m antes de la principal) ya la avisa A3: queda en voladizo y su luz/canto pasa de 18 (`sensatez/esbeltez-viga`). Se cambió por una secundaria desplazada 2 m: con +2 m el compilador avisa de la calidad de la malla; con −2 m, nada |
| A4-4 | El revisor del pilar girado no lo vio, aunque su rótulo decía «hX» en una columna de «hY»: dijo haber comprobado la orientación fila a fila. Comparar a ojo 80 rótulos parecidos no es fiable. Lo que es una lista (secciones y giros de los pilares por columna) se comprueba mejor con una consulta que con una imagen |
| A4-5 | Los revisores no dieron ninguna discrepancia falsa y señalaron dos dudas reales del encargo: la descripción del núcleo de A2 se contradice (la cara exterior de la viga de fachada no queda en el borde de la losa con su eje 10 cm hacia dentro), y una secundaria cruza el hueco de la escalera |
| A4-6 | El coste de revisar a ojo: unos 150 000 tokens y 2 minutos por subagente en el edificio de 7 plantas (40 imágenes), y unos 87 000 en el núcleo (8 imágenes) |
| A4-7 | Los rótulos de una planta densa se omiten por solape (en la vista `modelo` del edificio, 43 de 162). Los revisores lo tomaron bien, porque la pieza sigue dibujada; para leer un valor está el JSON |
| A4-8 | Las vistas del modelo dibujan los polígonos tal como se dan: un ábaco que sale de la losa (los de las esquinas del reticular de C4) se dibuja entero. No se ha comprobado aquí cómo lo trata el compilador |

## 4. Pendiente

**Del usuario:**
- Mirar las imágenes del edificio y del núcleo (`fem render … --vista modelo,cargas,uz,vigas-my`) y decir si la leyenda, los colores y los rótulos le sirven para revisar.
- Corregir la errata de la descripción del núcleo de A2 (A4-5), si se va a volver a usar.

**Técnico:**
- Una consulta de pilares por columna (sección y giro), para lo que la imagen no da con fiabilidad (A4-4).
- Las vistas en alzado (muros, pórticos) y la axonometría quedaron fuera de A4 (§10).
- El plano de fondo va con A5.

**Siguiente:** A5 (entrada desde planos), con la decisión A-e (confidencialidad) antes, según `agente.md` §6.

## Cómo reproducir

```bash
bunx vitest run src/agente/render src/agente/cli.test.ts           # criterios 1, 2, 3 y 5
bun validacion/a4/banco.ts > validacion/a4/out_banco.txt           # criterio 3 en los edificios objetivo
bun validacion/a4/mutaciones.ts > validacion/a4/out_mutaciones.txt # el compilador acepta las mutaciones y A3 no avisa
bun validacion/a4/mutaciones.ts --imagenes <carpeta>               # las PNG de la puerta y claves.json
```
