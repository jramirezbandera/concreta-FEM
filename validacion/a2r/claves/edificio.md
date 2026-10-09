# Clave: edificio objetivo

Referencia: `edificioObjetivoLosas(7)` con las opciones por defecto (`validacion/a2/comparar.ts`).

## Trampas

| ID | Tipo | Trampa | Respuesta del ingeniero |
|---|---|---|---|
| E-1 | N | «Sobrecarga de uso de vivienda» sin valor | 2 kN/m² en toda la losa, en Q |
| E-2 | F | «300 kg/m²»: la conversión a kN (g = 9,81 o el habitual 1 kN = 100 kg) cambia el resultado un 2 % | 3 kN/m² (1 kN = 100 kg) |
| E-3 | C | Losa de 25 cm en el texto y «canto 30 cm» en el cuadro | 25 cm; el cuadro está mal |
| E-4 | F | «Canto alternado, uno según X y el siguiente según Y»: no dice si alterna por ejes en X o en Y ni por dónde empieza | Por ejes en X. En los ejes 1, 3, 5, 7 y 9 (x = 0, 12, …, 48), el canto va según X. En los ejes 2, 4, 6, 8 y 10 (x = 6, 18, …, 54), según Y, y también los cuadrados de esos ejes van girados 90° |
| E-5 | N | «Viento según el CTE» sin valores (calcularlo de memoria está prohibido, regla 2) | Vx: 3 kN/m en +X en los 8 pilares de la fachada x = 0. Vy: 3 kN/m en +Y en los 10 pilares de la fachada y = 0. Los dos en toda la altura del pilar (de C a N7) |

## Lo que se deduce sin preguntar

- **Hueco:** de (24,6, 15,4) a (29,4, 19,6).
- **Fila y sección:** los ejes A, C, E y G son y = 0, 10, 20 y 30, con pilares de 30 × 50 (b = 0,30, h = 0,50). Los ejes B, D, F y H son y = 5, 15, 25 y 35, con pilares de 40 × 40.
- **Zona de la biblioteca:** el rectángulo de (6,8, 2,6) a (17,2, 12,4), sobre la losa de cada planta.

## Otras preguntas

Se responden con la referencia:
- **Casos:** sin acción. Para esta prueba no hacen falta las combinaciones; si pregunta por ψ o por la categoría de uso, se le dice que deje los casos sin acción.
- **Opciones:** por defecto.
- **Peso de los acabados y la tabiquería:** los dados, en G.
