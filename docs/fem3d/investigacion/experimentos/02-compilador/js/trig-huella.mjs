// E5: ¿dan V8 (Node/Chrome) y JavaScriptCore (Bun/Safari) los mismos bits en Math.*?
// ECMA-262 declara sin/cos/atan2/pow/exp... "implementation-approximated".
import { createHash } from 'node:crypto';
const N = 200000;
let s = 123456789;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const xs = Array.from({ length: N }, () => (rnd() - 0.5) * 40);
const fns = {
  sin: (x) => Math.sin(x), cos: (x) => Math.cos(x), atan2: (x) => Math.atan2(x, 1.37), tan: (x) => Math.tan(x),
  exp: (x) => Math.exp(x / 4), log: (x) => Math.log(Math.abs(x) + 1e-3), pow: (x) => Math.pow(Math.abs(x), 1.37),
  cbrt: (x) => Math.cbrt(x), sqrt: (x) => Math.sqrt(Math.abs(x)), hypot: (x) => Math.hypot(x, 2.5),
};
const out = { motor: typeof Bun !== 'undefined' ? `bun ${Bun.version} (JavaScriptCore)` : `node ${process.version} (V8)` };
for (const [k, f] of Object.entries(fns)) {
  const buf = new Float64Array(xs.map(f));
  out[k] = createHash('sha256').update(Buffer.from(buf.buffer)).digest('hex').slice(0, 12);
}
console.log(JSON.stringify(out));
