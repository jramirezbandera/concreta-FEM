**De:** Javier
**Asunto:** Residencial calle Mayor: modelo para predimensionar

Hola:

Necesito el modelo del residencial de la calle Mayor para empezar a predimensionar. Te resumo lo que hay; los planos los tengo yo.

**Plantas.** Siete plantas de vivienda, de 3,00 m de suelo a suelo. Las zapatas están a −1,50 respecto a la planta primera. Llama a las plantas N1 (la primera) … N7 y a la cimentación C.

**Ejes.** Diez ejes en X, numerados 1 a 10, cada 6 m: el eje 1 en x = 0 y el 10 en x = 54. Ocho ejes en Y, con letras A a H, cada 5 m: A en y = 0 y H en y = 35. Hay un pilar en cada cruce, 80 en total, de la cimentación a la cubierta (N7) y empotrados.

**Pilares.**
- En los ejes A, C, E y G: rectangulares de 30 × 50 (30 de ancho y 50 de canto).
- En B, D, F y H: cuadrados de 40 × 40.
- Los rectangulares van con el canto alternado, uno según X y el siguiente según Y, para repartir la rigidez.
- Hormigón HA-30 en toda la estructura.

**Vigas, en cada planta.**
- Vigas de 30 × 60 continuas por todos los ejes, en las dos direcciones, de fachada a fachada.
- Vigas de atado de 25 × 40 en el centro de cada vano en X (x = 3, 9, … 51), de eje a eje de pilares en Y: una por vano, 63 por planta.

**Forjado.** Losa maciza de 25 cm a ejes en toda la planta, de (0, 0) a (54, 35). Lleva el hueco de la escalera: 4,80 × 4,20 m, centrado en el recuadro de los ejes 5–6 y D–E.

**Cargas, en todas las plantas.**
- **Peso propio:** que lo calcule el programa, en el caso G.
- **Solado y falso techo:** 2 kN/m² en toda la losa, en G.
- **Tabiquería pesada del pasillo:** 7 kN/m en G, por la polilínea (1,50, 7,50) → (22,50, 7,50) → (22,50, 21,50).
- **Sobrecarga de uso de vivienda** en toda la losa, en el caso Q.
- **Zona de biblioteca comunitaria:** entre x = 6,80 y 17,20 e y = 2,60 y 12,40, 300 kg/m² más de sobrecarga, también en Q.
- **Viento según el CTE** en las dos direcciones, en los casos Vx y Vy, aplicado como carga repartida en los pilares de la fachada de barlovento.

**Cuadro de características:**

| Elemento | Valor |
|---|---|
| Forjado | Losa maciza, canto 30 cm |
| Hormigón | HA-30 |
| Acero | B500S |

Gracias.
