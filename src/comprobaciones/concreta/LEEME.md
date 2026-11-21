# Copias de Concreta

Módulos de comprobación de [Concreta](https://github.com/wh0am1-dev/concreta), copiados del commit `6fdc7e782113ddc00c67cb29b7978383ca0269f2`
por `scripts/copiar-concreta.ts` (fase CO, `docs/fem3d/comprobaciones.md` §4.1).

- **Un solo cambio, mecánico:** las importaciones relativas llevan la extensión `.ts`, que Node
  exige. El manifiesto guarda el sha256 del original de cada fichero.
- **No se editan a mano.** `manifiesto.json` lleva el origen y el sha256 de cada fichero, y
  `src/comprobaciones/copias.test.ts` los comprueba. Para cambiar algo, se cambia el script.
- **Lo único que no es de Concreta** son los ficheros de `sustituciones` del manifiesto, propios
  de este repositorio y con su motivo.
- **Licencia:** PolyForm Noncommercial 1.0.0 (<https://polyformproject.org/licenses/noncommercial/1.0.0>).

  Required Notice: Copyright Javier Ramírez Bandera

  Publicadas aquí con el permiso de Carlos Aguilar (2026-11-21, CO-a); véase `NOTICE`.
