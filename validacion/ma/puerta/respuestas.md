# Puerta de MA: las respuestas del ingeniero (en un solo texto)

> Criterio 1 de `docs/fem3d/modelado.md` §3. Se mandan enteras, una vez, como respuesta a la ronda de preguntas de cada agente, contesten o no a lo que pregunta.
>
> **Reconstruidas** a partir de lo que el usuario dijo al modelar la vivienda (2026-10-15: las tres rondas de `modelado.md` §1, la corrección de los zunchos y la de la carga muerta y los petos de CY-d) y de lo que quedó en `ejemplos/vivienda/proyecto.json`. No son sus palabras literales: la conversación no se guardó.

---

Te contesto todo de una vez; lo que no esté aquí, decídelo tú y dímelo.

**Plantas y cotas** (cara superior de forjado):

- Cimentación: ±0,00, pilares empotrados.
- Cubierta baja: +3,40.
- Cubierta alta: +4,30. Va 0,90 m por encima de la baja: es un escalón de cubierta, no una planta.

**Material y pilares:**

- Hormigón HA-30 en todo.
- Todos los pilares, de 30 × 30 cm, de la cimentación a la cubierta que les toca: los que están bajo la cubierta alta (también los del lado común de las dos cubiertas) y los de la pérgola suben hasta la alta; el resto acaba en la baja.
- Los rectángulos sin cruz de la capa de los pilares no son pilares: son fábrica y carpintería.
- El dibujo tiene descuadres de un par de centímetros: ponlo bien.

**Forjados** (las dos cubiertas iguales):

- Reticular 25 + 5 (canto total 0,30 m, capa de compresión 0,05 m).
- Intereje 72 cm y nervio 12 cm.
- Casetón perdido; su peso, el de la zona aligerada, es 4,5 kN/m².
- Ábacos macizos de 2,00 × 2,00 m centrados en cada pilar; si dos se pisan, uno solo.
- Todos los bordes llevan zuncho de 30 × 30 cm.

**Petos:** 3,0 kN/m por todo el borde de las dos cubiertas, salvo en el lado de la cubierta baja que da a la alta (x = 4,26): ahí sólo de y = 0 a y = 1,87.

**Pérgola:**

- Dos vigas de 30 × 30 a la cota de la cubierta alta (+4,30): una en y = 1,87, de x = 4,26 a x = 14,26; la otra en x = 14,26, de y = 1,87 a y = 5,79, donde llega a la cubierta alta.
- Las lamas: 1,0 kN/m sobre cada viga, como permanente.

**Cargas:**

- Permanentes (solado, formación de pendientes, impermeabilización): 2,0 kN/m² en las dos cubiertas.
- Uso: cubierta accesible sólo para conservación (categoría G), 1,0 kN/m².
- Nieve: 0,2 kN/m², a menos de 1 000 m de altitud.
- El viento y el sismo, para después.
