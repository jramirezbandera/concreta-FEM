import { writeFileSync } from 'node:fs';
const N = 200000; let s = 123456789;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const xs = Array.from({ length: N }, () => (rnd() - 0.5) * 40);
const fns = { sin: (x) => Math.sin(x), cos: (x) => Math.cos(x), atan2: (x) => Math.atan2(x, 1.37), exp: (x) => Math.exp(x / 4), log: (x) => Math.log(Math.abs(x) + 1e-3), cbrt: (x) => Math.cbrt(x), hypot: (x) => Math.hypot(x, 2.5) };
const eng = typeof Bun !== 'undefined' ? 'bun' : 'node';
for (const [k, f] of Object.entries(fns)) writeFileSync(`dump-${eng}-${k}.bin`, Buffer.from(new Float64Array(xs.map(f)).buffer));
