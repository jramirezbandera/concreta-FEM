#!/bin/sh
# PB-5: antes (árbol de trabajo en el commit de antes, $1) y ahora, con las mallas de medida y las de
# referencia; $2: sólo «despues» si se da
cd "$(dirname "$0")/../.."
W="$1"
for m in 'p45:2x2-{"pilar":0.45}' 'p45i:2x2-{"pilar":0.45,"interiores":true}' 'p50:2x2-{"pilar":0.5}' 'p3050:2x2-{"pilar":[0.3,0.5]}'; do
  n=${m%%:*}; c=${m#*:}
  [ "$2" = "despues" ] || bun validacion/pb/medir.ts "$W" pb5-antes-$n "$c" 0.75 0.5 0.125
  bun validacion/pb/medir.ts . pb5-despues-$n "$c" 0.75 0.5 0.125 0.0625/0.025
done
