#!/bin/sh
# PB-11: antes (árbol de trabajo en el commit de antes, $1) y ahora, con las mallas de medida y, ahora,
# las de referencia. Las salidas, en validacion/pb/out_pb11-*.json (sin versionar)
cd "$(dirname "$0")/../.."
W="$1"
for m in 'p3050:2x2-{"pilar":[0.3,0.5]}' 'p45:2x2-{"pilar":0.45}' 'p45i:2x2-{"pilar":0.45,"interiores":true}' 'p50:2x2-{"pilar":0.5}' 'p30:2x2' 'p30i:2x2-{"interiores":true}' 'pf:ej11-pf' 'ej11:ej11'; do
  n=${m%%:*}; c=${m#*:}
  bun validacion/pb/medir.ts "$W" pb11-antes-$n "$c" 0.75 0.5
  bun validacion/pb/medir.ts . pb11-ahora-$n "$c" 0.75 0.5 0.125 0.0625/0.025
done
