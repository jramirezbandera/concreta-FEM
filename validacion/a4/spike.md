# Puerta de A4: detección visual (criterio 4) — registro

> **Fecha:** 2026-10-09. **Protocolo:** `docs/fem3d/agente.md` §10. **Mutaciones:** `mutaciones.ts` (`out_mutaciones.txt`: el compilador acepta las ocho y ni él ni A3 avisan). **Clave:** `claves.json`.

## Montaje

- **Encargos:** diez, `encargo-A`…`encargo-J`, en orden al azar con semilla fija:
  - los ocho mutados y los dos proyectos sin mutar de los agentes de A2 (el edificio objetivo con losas y la retícula con núcleo);
  - cada uno, en una carpeta con su descripción de A2 y las PNG de `modelo` y `cargas` (un caso por imagen) de cada planta: 40 imágenes en el edificio y 8 en el núcleo.
- **Revisores:** un subagente de Claude Code por encargo, que sólo podía leer su carpeta y no ejecutar nada. No sabía si había errores ni cuántos.
  - **Tarea:** listar las discrepancias con el encargo, cada una con su confianza, y los ficheros que ha leído.
  - Todos dicen haber leído sólo su carpeta.

## Resultado

| Encargo | Qué es | Lo que dice el revisor | Clase |
|---|---|---|---|
| A | Mutación 2: falta el hueco de la escalera en N4 | El hueco de N4 no está; en las demás plantas, sí. Confianza alta | Detectada |
| B | Edificio sin mutar | Ninguna discrepancia | Sin falsos avisos |
| C | Mutación 6: tabiquería de N5 con un vértice errado | El tramo vertical de N5 acaba en y ≈ 15,5 y no en 21,5; faltan unos 6 m y 42 kN. Confianza alta | Detectada |
| D | Mutación 1: pilar P-x36-y15 desplazado 1 m en X | P-x36-y15 está en x ≈ 37, fuera de los ejes de sus vigas. Confianza alta | Detectada |
| E | Mutación 5: pilar P-x18-y10 de 30 × 50 con giro 0 | Ninguna discrepancia. Dice que comprobó hX/hY fila a fila, pero el rótulo «P-x18-y10 30×50 hX» está en una columna de «hY» | **No detectada** |
| F | Mutación 7: hueco de la losa fuera del núcleo | El hueco está en el vano de al lado, desplazado +6 m en X. Confianza alta | Detectada |
| G | Núcleo sin mutar | Ninguna discrepancia en el modelo. Señala una contradicción de la descripción (abajo) | Sin falsos avisos |
| H | Mutación 3: secundaria VS-x15-y10-N3 desplazada 2 m | La secundaria de ese vano de N3 está en x ≈ 13 y no en 15. Confianza alta | Detectada |
| I | Mutación 4: zona de Q de N2 desplazada un vano | La zona de N2 va de x ≈ 12,8 a 23,2. Confianza alta | Detectada |
| J | Mutación 8: puerta del núcleo en el tercer lado | La puerta está en el lado y = 10, medida desde (12, 10). Confianza alta | Detectada |

**7 de 8 mutaciones detectadas** (el criterio pide 6), todas con confianza alta y bien localizadas. **Ninguna discrepancia falsa** en los dos proyectos sin mutar.

## Observaciones de los revisores que no son del modelo

- **La descripción del núcleo se contradice** (G, y verificado):
  - dice que la cara exterior de las vigas de fachada queda en el borde de la losa y que su eje está 10 cm hacia dentro del de los pilares;
  - con 30 cm de ancho y el eje en y = 0,10, la cara exterior queda en y = −0,05, 20 cm por dentro del borde (−0,25);
  - para que la cara quedara en el borde, el eje tendría que estar 10 cm hacia fuera.

  Viene de A2, y el modelo sigue la tabla de la descripción.
- **La secundaria VS-x27-y15 cruza el hueco de la escalera** (B, H, I y D): es lo que dice la descripción (63 secundarias por planta), pero un revisor real lo preguntaría.
- **Rótulos omitidos por solape** (todos los del edificio): por ejemplo, sólo 4 de las 10 cargas de Vy y algunas secundarias llevan rótulo. Los revisores lo notaron y no lo tomaron por un error, porque la pieza sí está dibujada.

## Coste

| Encargo | Tokens del subagente | Herramientas | Segundos |
|---|---:|---:|---:|
| Núcleo (F, G, J) | 86 210 – 87 698 | 11 | 39 – 56 |
| Edificio (A, B, C, D, E, H, I) | 150 672 – 154 304 | 43 | 108 – 152 |
| **Total** | **1 322 335** | | |
