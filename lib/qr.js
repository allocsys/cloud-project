// Small QR Code encoder: byte mode, error correction level M, versions 1 to 6
// (up to 106 bytes, plenty for a Bitcoin address). No dependencies.

const EXP = new Array(512).fill(0);
const LOG = new Array(256).fill(0);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = mul(r[j], root);
      if (j + 1 < degree) r[j] ^= r[j + 1];
    }
    root = mul(root, 2);
  }
  return r;
}

function rsRemainder(data, divisor) {
  const r = new Array(divisor.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => {
      r[i] ^= mul(c, f);
    });
  }
  return r;
}

// Level M: [data codewords, EC codewords per block, blocks] for versions 1 to 6.
const VERSIONS = [
  null,
  [16, 10, 1],
  [28, 16, 1],
  [44, 26, 1],
  [64, 18, 2],
  [86, 24, 2],
  [108, 16, 4],
];

const bit = (n, i) => ((n >>> i) & 1) === 1;

export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 0;
  for (let v = 1; v <= 6; v++) {
    if (bytes.length <= VERSIONS[v][0] - 2) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('Text is too long for this QR encoder.');
  const [dataCount, ecPer, blocks] = VERSIONS[version];
  const size = 17 + 4 * version;

  // 1. Bit stream: mode (byte), length, payload, terminator, padding.
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, dataCount * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  }
  for (let pad = 0xec; data.length < dataCount; pad ^= 0xec ^ 0x11) data.push(pad);

  // 2. Reed-Solomon per block, then interleave.
  const blockLen = dataCount / blocks;
  const divisor = rsDivisor(ecPer);
  const dataBlocks = [];
  const ecBlocks = [];
  for (let b = 0; b < blocks; b++) {
    const chunk = data.slice(b * blockLen, (b + 1) * blockLen);
    dataBlocks.push(chunk);
    ecBlocks.push(rsRemainder(chunk, divisor));
  }
  const codewords = [];
  for (let i = 0; i < blockLen; i++) dataBlocks.forEach((blk) => codewords.push(blk[i]));
  for (let i = 0; i < ecPer; i++) ecBlocks.forEach((blk) => codewords.push(blk[i]));

  // 3. Matrix with function patterns.
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => {
    modules[y][x] = dark;
    isFn[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  if (version >= 2) {
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setFn(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  const drawFormat = (mask) => {
    // Error correction level M has format bits 00.
    const d = mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bitsVal = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(bitsVal, i));
    setFn(8, 7, bit(bitsVal, 6));
    setFn(8, 8, bit(bitsVal, 7));
    setFn(7, 8, bit(bitsVal, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bitsVal, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bitsVal, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bitsVal, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);

  // 4. Place codewords in the zigzag order.
  let bitIndex = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && bitIndex < total) {
          modules[y][x] = bit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex++;
        }
      }
    }
  }

  // 5. Pick the mask with the lowest penalty.
  const applyMask = (mask) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let flip;
        switch (mask) {
          case 0: flip = (x + y) % 2 === 0; break;
          case 1: flip = y % 2 === 0; break;
          case 2: flip = x % 3 === 0; break;
          case 3: flip = (x + y) % 3 === 0; break;
          case 4: flip = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: flip = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: flip = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: flip = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!isFn[y][x] && flip) modules[y][x] = !modules[y][x];
      }
    }
  };

  const penalty = () => {
    let score = 0;
    const runs = (line) => {
      let s = 0;
      let run = 1;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) s += 3 + (run - 5);
          run = 1;
        }
      }
      return s;
    };
    for (let y = 0; y < size; y++) score += runs(modules[y]);
    for (let x = 0; x < size; x++) score += runs(modules.map((row) => row[x]));
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
      }
    }
    const pat = [true, false, true, true, true, false, true];
    const scan = (get) => {
      let s = 0;
      for (let a = 0; a < size; a++) {
        for (let b = 0; b <= size - 7; b++) {
          let ok = true;
          for (let k = 0; k < 7 && ok; k++) ok = get(a, b + k) === pat[k];
          if (!ok) continue;
          const light = (i) => i < 0 || i >= size || !get(a, i);
          const before = [1, 2, 3, 4].every((k) => light(b - k));
          const after = [7, 8, 9, 10].every((k) => light(b + k));
          if (before || after) s += 40;
        }
      }
      return s;
    };
    score += scan((y, x) => modules[y][x]);
    score += scan((x, y) => modules[y][x]);
    let dark = 0;
    modules.forEach((row) => row.forEach((c) => { if (c) dark++; }));
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  };

  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty();
    if (s < bestScore) {
      best = m;
      bestScore = s;
    }
    applyMask(m);
  }
  applyMask(best);
  drawFormat(best);
  return modules;
}

// SVG path for the dark modules, merged into horizontal runs.
export function qrPath(matrix) {
  const parts = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      parts.push(`M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return parts.join('');
}
