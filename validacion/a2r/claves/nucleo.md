# Clave: retícula con núcleo

Referencia: `reticulaConNucleo()` con `{ tamanoMalla: 1 }` (`validacion/a2/comparar.ts`).

## Trampas

| ID | Tipo | Trampa | Respuesta del ingeniero |
|---|---|---|---|
| N-1 | F | La profundidad de las zapatas («la de siempre») no se da | La cimentación está 1,50 m por debajo de la planta |
| N-2 | C | Pilares de 50 × 50 en el texto y de 40 × 40 en el cuadro resumen | 50 × 50; el cuadro es de otro proyecto |
| N-3 | N | «La sobrecarga de uso de oficinas» sin valor (la de la norma, 2 kN/m², no es la de la referencia) | 3 kN/m² sobre toda la losa, tabiquería incluida |
| N-4 | F | El hueco del núcleo está «a 2,40 m de la esquina suroeste del núcleo»: desde el eje o desde la cara del muro | Desde la esquina de ejes (6, 5): el hueco va de x = 8,40 a 9,40 |

## Lo que se deduce sin preguntar

Se comprueba en el modelo, pero no es trampa:
- **Vigas de fachada:** su eje queda 10 cm hacia dentro del de los pilares (0,25 − 0,15). La losa y las vigas van de −0,25 a 18,25 y de −0,25 a 15,25.
- **Hueco de la losa:** de (6,6, 5,4) a (11,4, 9,6).
- **Viento:** en los cuatro pilares de x = 0, 2 kN/m en +X.

## Otras preguntas

Se responden con la referencia:
- **Casos:** sin acción. Para esta prueba no hacen falta las combinaciones.
- **Material:** HA-25 con el resto de sus propiedades por defecto.
- **Diafragma, modificadores y demás opciones:** por defecto, salvo la malla de 1 m.

## Errata del encargo (detectada en el spike)

**Qué pasó.**
- El encargo dice que las vigas de fachada van «enrasadas por fuera con los pilares», pero la referencia las tiene con el eje 10 cm hacia **dentro**: y = 0,10, x = 0,10, etc.
- Con la cara exterior en el borde, el eje estaría en −0,10.
- El «0,25 − 0,15» de arriba lleva a la cara interior enrasada, no a la exterior.

**Cómo se resolvió.**
- El agente modeló lo que decía el encargo, chocó con C2-c (`losa/borde-en-viga`) y lo declaró.
- La ingeniera corrigió el encargo en la segunda ronda.
- No es una trampa: es un error de quien escribió el encargo.
