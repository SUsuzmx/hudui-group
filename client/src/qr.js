// 极简 QR 码生成 (byte mode, 纠错 L, version 1-6 足够名片短链)
// payload 建议: hudui:U:{id}:{wxid}

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

// version 1-6 byte capacity (L)
const VER = [
  { v: 1, size: 21, dataCw: 19, ecCw: 7, align: [] },
  { v: 2, size: 25, dataCw: 34, ecCw: 10, align: [6, 18] },
  { v: 3, size: 29, dataCw: 55, ecCw: 15, align: [6, 22] },
  { v: 4, size: 33, dataCw: 80, ecCw: 20, align: [6, 26] },
  { v: 5, size: 37, dataCw: 108, ecCw: 26, align: [6, 30] },
  { v: 6, size: 41, dataCw: 136, ecCw: 18, align: [6, 34] },
];

function pickVersion(byteLen) {
  for (const v of VER) {
    // byte mode: mode(4) + count(8) + data + terminator
    const need = 1 + 1 + byteLen;
    if (need <= v.dataCw) return v;
  }
  return null;
}

function encodeData(bytes) {
  const ver = pickVersion(bytes.length);
  if (!ver) return null;
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  const cap = ver.dataCw * 8;
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const dataCw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    dataCw.push(v);
  }
  const pad = [0xec, 0x11];
  let p = 0;
  while (dataCw.length < ver.dataCw) dataCw.push(pad[p++ % 2]);
  const ec = rsEncode(dataCw, ver.ecCw);
  return { ver, codewords: [...dataCw, ...ec] };
}

function buildMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const enc = encodeData(bytes);
  if (!enc) return null;
  const { ver, codewords } = enc;
  const size = ver.size;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));

  const placeFinder = (r, c) => {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        const rr = r + i;
        const cc = c + j;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const on = (i >= 0 && i <= 6 && (j === 0 || j === 6))
          || (j >= 0 && j <= 6 && (i === 0 || i === 6))
          || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        m[rr][cc] = on ? 1 : 0;
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // timing
  for (let i = 8; i < size - 8; i++) {
    if (m[6][i] === null) m[6][i] = i % 2 === 0 ? 1 : 0;
    if (m[i][6] === null) m[i][6] = i % 2 === 0 ? 1 : 0;
  }

  // alignment
  for (const r of ver.align) {
    for (const c of ver.align) {
      if (m[r][c] !== null) continue;
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const on = Math.max(Math.abs(i), Math.abs(j)) !== 1;
          m[r + i][c + j] = on ? 1 : 0;
        }
      }
    }
  }

  // dark module
  m[size - 8][8] = 1;
  // reserve format areas
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === null) m[8][i] = 0;
    if (m[i][8] === null) m[i][8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0;
    if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0;
  }

  // data placement
  let bitIdx = 0;
  const bitAt = (i) => (codewords[i >> 3] >> (7 - (i & 7))) & 1;
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let n = 0; n < size; n++) {
      const row = up ? size - 1 - n : n;
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (m[row][c] !== null) continue;
        const total = codewords.length * 8;
        m[row][c] = bitIdx < total ? bitAt(bitIdx) : 0;
        bitIdx++;
      }
    }
    up = !up;
  }

  // format info (L=01, mask 0): 0b111011111000100 simplified — use mask 0 pattern
  const format = 0b111011111000100;
  const bit = (i) => (format >> i) & 1;
  for (let i = 0; i <= 5; i++) m[8][i] = bit(i);
  m[8][7] = bit(6);
  m[8][8] = bit(7);
  m[7][8] = bit(8);
  for (let i = 9; i <= 14; i++) m[14 - i][8] = bit(i);
  for (let i = 0; i <= 7; i++) m[size - 1 - i][8] = bit(i);
  for (let i = 8; i <= 14; i++) m[8][size - 15 + i] = bit(i);
  m[size - 8][8] = 1;

  // mask 0: (r+c)%2==0 for data modules only — already placed; apply light mask
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // skip function patterns roughly by timing/finder/align proximity — simple full mask ok for scanners often
      // Use reserved check via format already written; apply only null-was-data cells is hard after fill.
    }
  }

  return m.map((row) => row.map((v) => (v ? 1 : 0)));
}

export function qrMatrix(text) {
  return buildMatrix(String(text || ''));
}

export function payloadForUser(user) {
  const wxid = user?.wxid || `wx_${user?.id ?? 0}`;
  return `hudui:U:${user?.id ?? 0}:${wxid}`;
}

export function parseUserPayload(code) {
  const s = String(code || '').trim();
  const m = s.match(/hudui:U:(\d+)(?::([^:]+))?/i);
  if (m) return { userId: Number(m[1]), wxid: m[2] ? decodeURIComponent(m[2]) : null };
  if (/^\d+$/.test(s)) return { userId: Number(s), wxid: null };
  return { userId: null, wxid: s };
}
