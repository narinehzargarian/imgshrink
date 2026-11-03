// The same Lanczos3 resize as core/src/resize.cpp, written in plain TypeScript. It exists only
// for the speed comparison, so both sides do exactly the same math.

const LOBES = 3;

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (x: number) => (Math.abs(x) < LOBES ? sinc(x) * sinc(x / LOBES) : 0);

const TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const TO_SRGB = new Uint8Array(4096).map((_, i) => {
  const l = i / 4095;
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
});

function contributions(source: number, target: number) {
  const scale = target / source;
  const filterScale = Math.max(1, 1 / scale);
  const support = LOBES * filterScale;
  const stride = Math.ceil(support * 2) + 2;
  const first = new Int32Array(target);
  const count = new Int32Array(target);
  const weights = new Float32Array(target * stride);
  for (let i = 0; i < target; i++) {
    const center = (i + 0.5) / scale;
    const start = Math.max(0, Math.floor(center - support));
    const end = Math.min(source, Math.ceil(center + support));
    let total = 0;
    let n = 0;
    for (let j = start; j < end && n < stride; j++, n++) {
      const w = lanczos((j + 0.5 - center) / filterScale);
      weights[i * stride + n] = w;
      total += w;
    }
    first[i] = start;
    count[i] = n;
    if (total !== 0) for (let k = 0; k < n; k++) weights[i * stride + k]! /= total;
  }
  return { first, count, weights, stride };
}

export function resizeJs(rgba: Uint8ClampedArray, sw: number, sh: number, width: number, height: number): Uint8ClampedArray {
  const h = contributions(sw, width);
  const mid = new Float32Array(width * sh * 4);
  const row = new Float32Array(sw * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const p = (y * sw + x) * 4;
      const a = rgba[p + 3]! / 255;
      row[x * 4] = TO_LINEAR[rgba[p]!]! * a;
      row[x * 4 + 1] = TO_LINEAR[rgba[p + 1]!]! * a;
      row[x * 4 + 2] = TO_LINEAR[rgba[p + 2]!]! * a;
      row[x * 4 + 3] = a;
    }
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      const base = x * h.stride;
      let i = h.first[x]! * 4;
      for (let k = 0; k < h.count[x]!; k++, i += 4) {
        const w = h.weights[base + k]!;
        r += row[i]! * w;
        g += row[i + 1]! * w;
        b += row[i + 2]! * w;
        al += row[i + 3]! * w;
      }
      const o = (y * width + x) * 4;
      mid[o] = r;
      mid[o + 1] = g;
      mid[o + 2] = b;
      mid[o + 3] = al;
    }
  }

  const v = contributions(sh, height);
  const out = new Uint8ClampedArray(width * height * 4);
  const acc = new Float32Array(width * 4);
  for (let y = 0; y < height; y++) {
    acc.fill(0);
    for (let k = 0; k < v.count[y]!; k++) {
      const w = v.weights[y * v.stride + k]!;
      const offset = (v.first[y]! + k) * width * 4;
      for (let i = 0; i < width * 4; i++) acc[i]! += mid[offset + i]! * w;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const a = Math.min(1, Math.max(0, acc[x * 4 + 3]!));
      if (a <= 0) continue;
      const toSrgb = (l: number) => TO_SRGB[Math.trunc(Math.min(1, Math.max(0, l)) * 4095 + 0.5)]!;
      out[o] = toSrgb(acc[x * 4]! / a);
      out[o + 1] = toSrgb(acc[x * 4 + 1]! / a);
      out[o + 2] = toSrgb(acc[x * 4 + 2]! / a);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}
