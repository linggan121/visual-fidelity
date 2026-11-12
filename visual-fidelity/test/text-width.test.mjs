// 字宽比对单测
import assert from 'node:assert/strict';
import { inkBox, compareRegions, diagnosis } from '../probe/text-width.mjs';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

// 白底上刷一段"文字"（深色矩形）
function makeImage(w, h, rects, bg = [255, 255, 255]) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    buf[i] = bg[0]; buf[i + 1] = bg[1]; buf[i + 2] = bg[2]; buf[i + 3] = 255;
  }
  for (const r of rects) {
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      buf[i] = r.color[0]; buf[i + 1] = r.color[1]; buf[i + 2] = r.color[2];
    }
  }
  return buf;
}

const DARK = [23, 24, 33];

t('量出墨水包围盒', () => {
  const img = makeImage(60, 20, [{ x0: 10, y0: 5, x1: 29, y1: 12, color: DARK }]);
  const b = inkBox(img, 60, 20, { x0: 0, y0: 0, x1: 59, y1: 19 });
  assert.equal(b.w, 20);
  assert.equal(b.h, 8);
  assert.equal(b.x, 10);
});

t('空白区域返回 null', () => {
  const img = makeImage(20, 20, []);
  assert.equal(inkBox(img, 20, 20, { x0: 0, y0: 0, x1: 19, y1: 19 }), null);
});

t('区域裁切后才量，不越界', () => {
  const img = makeImage(60, 20, [{ x0: 12, y0: 6, x1: 45, y1: 13, color: DARK }]);
  const b = inkBox(img, 60, 20, { x0: 10, y0: 5, x1: 20, y1: 9 });
  assert.equal(b.w, 9);   // 墨迹从 x=12 起，裁到 x=20 共 9 列
  assert.equal(b.h, 4);   // y 6..9
});

t('整片都是墨迹时明确返回 null（无对比度可量）', () => {
  const img = makeImage(20, 20, [{ x0: 0, y0: 0, x1: 19, y1: 19, color: DARK }]);
  assert.equal(inkBox(img, 20, 20, { x0: 0, y0: 0, x1: 19, y1: 19 }), null);
});

t('两侧宽度差可读出', () => {
  const a = makeImage(60, 20, [{ x0: 10, y0: 5, x1: 29, y1: 12, color: DARK }]);
  const b = makeImage(60, 20, [{ x0: 10, y0: 5, x1: 34, y1: 12, color: DARK }]);
  const rows = compareRegions(a, b, 60, 20, [{ name: 'x', x0: 0, y0: 0, x1: 59, y1: 19 }]);
  assert.equal(rows[0].refW, 20);
  assert.equal(rows[0].implW, 25);
  assert.equal(rows[0].dW, 5);
});

t('缺一侧时标 missing 而不是崩', () => {
  const a = makeImage(60, 20, [{ x0: 10, y0: 5, x1: 29, y1: 12, color: DARK }]);
  const b = makeImage(60, 20, []);
  const rows = compareRegions(a, b, 60, 20, [{ name: 'x', x0: 0, y0: 0, x1: 59, y1: 19 }]);
  assert.equal(rows[0].status, 'missing');
});

t('等比偏差判为字号/字族', () => {
  const rows = [
    { status: 'ok', refW: 100, implW: 110, ratio: 1.1 },
    { status: 'ok', refW: 50, implW: 55, ratio: 1.1 },
    { status: 'ok', refW: 40, implW: 44, ratio: 1.1 },
  ];
  const d = diagnosis(rows);
  assert.equal(d.kind, 'uniform');
});

t('偏差不一致判为字重/字距', () => {
  const rows = [
    { status: 'ok', refW: 100, implW: 130, ratio: 1.3 },
    { status: 'ok', refW: 50, implW: 52, ratio: 1.04 },
    { status: 'ok', refW: 40, implW: 41, ratio: 1.025 },
  ];
  assert.equal(diagnosis(rows).kind, 'nonuniform');
});

t('宽度一致判为 match', () => {
  const rows = [
    { status: 'ok', refW: 100, implW: 100, ratio: 1 },
    { status: 'ok', refW: 50, implW: 50, ratio: 1 },
  ];
  assert.equal(diagnosis(rows).kind, 'match');
});

t('样本不足时明确说明', () => {
  assert.equal(diagnosis([{ status: 'ok', refW: 100, implW: 100, ratio: 1 }]).kind, 'insufficient');
});

console.log(`\n${pass} passed`);
