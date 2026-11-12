// 图像取证单测：合成像素，验证分隔线、分带、列簇、底色提取
import assert from 'node:assert/strict';
import { analyzePixels, dominantColor, summarize } from '../probe/image-spec.mjs';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

// 造一张图：底色 bg，可在指定区域刷色
function makeImage(w, h, bg, paint = []) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      buf[i] = bg[0]; buf[i + 1] = bg[1]; buf[i + 2] = bg[2]; buf[i + 3] = 255;
    }
  }
  for (const p of paint) {
    const { x0, y0, x1, y1, color } = p;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4;
        buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2];
      }
    }
  }
  return buf;
}

const WHITE = [255, 255, 255];
const DARK = [23, 24, 33];

t('底色提取取主导色', () => {
  const img = makeImage(40, 20, WHITE);
  assert.deepEqual(dominantColor(img, 40, 20), WHITE);
});

t('整行有内容 → 识别为分隔线', () => {
  const img = makeImage(40, 20, WHITE, [{ x0: 0, y0: 10, x1: 39, y1: 10, color: [241, 238, 245] }]);
  const r = analyzePixels(img, 40, 20, { inkTol: 12 });
  assert.deepEqual(r.separators.map((s) => s.y), [10]);
});

t('只有一小段内容 → 不算分隔线', () => {
  const img = makeImage(40, 20, WHITE, [{ x0: 5, y0: 10, x1: 15, y1: 10, color: DARK }]);
  const r = analyzePixels(img, 40, 20, { inkTol: 12, lineFill: 0.5 });
  assert.equal(r.separators.length, 0);
});

t('分带切在分隔线之间', () => {
  const img = makeImage(40, 30, WHITE, [
    { x0: 2, y0: 1, x1: 2, y1: 1, color: DARK },
    { x0: 0, y0: 10, x1: 39, y1: 10, color: [241, 238, 245] },
    { x0: 2, y0: 15, x1: 2, y1: 15, color: DARK },
    { x0: 0, y0: 20, x1: 39, y1: 20, color: [241, 238, 245] },
    { x0: 2, y0: 25, x1: 2, y1: 25, color: DARK },
    { x0: 2, y0: 29, x1: 2, y1: 29, color: DARK },
  ]);
  const r = analyzePixels(img, 40, 30, { inkTol: 12 });
  // 内容从 y=1 开始，分隔线在 10 与 20，因此三条带从 1 / 11 / 21 起
  assert.deepEqual(r.bands.map((b) => b.y0), [1, 11, 21]);
  assert.deepEqual(r.bands.map((b) => b.height), [9, 9, 9]);
});

t('列簇按间隔合并', () => {
  const img = makeImage(60, 20, WHITE, [
    { x0: 5, y0: 5, x1: 9, y1: 9, color: DARK },
    { x0: 9, y0: 5, x1: 12, y1: 9, color: DARK },
    { x0: 40, y0: 5, x1: 45, y1: 9, color: DARK },
  ]);
  const r = analyzePixels(img, 60, 20, { inkTol: 24, clusterGap: 4 });
  const band = r.bands[0];
  assert.equal(band.columns.length, 2);
  assert.equal(band.columns[0].start, 5);
  assert.equal(band.columns[1].start, 40);
});

t('内容盒包住所有非底色像素', () => {
  const img = makeImage(50, 30, [242, 240, 244], [{ x0: 10, y0: 8, x1: 20, y1: 18, color: WHITE }]);
  const r = analyzePixels(img, 50, 30, { inkTol: 8 });
  assert.equal(r.contentBox.x, 10);
  assert.equal(r.contentBox.y, 8);
  assert.equal(r.contentBox.w, 11);
  assert.equal(r.contentBox.h, 11);
});

t('全空图不崩', () => {
  const img = makeImage(20, 20, WHITE);
  const r = analyzePixels(img, 20, 20);
  assert.equal(r.separators.length, 0);
});

t('summarize 输出可直接用的行高表', () => {
  const img = makeImage(40, 30, WHITE, [
    { x0: 2, y0: 1, x1: 2, y1: 1, color: DARK },
    { x0: 0, y0: 10, x1: 39, y1: 10, color: [241, 238, 245] },
    { x0: 2, y0: 15, x1: 2, y1: 15, color: DARK },
    { x0: 0, y0: 20, x1: 39, y1: 20, color: [241, 238, 245] },
    { x0: 2, y0: 25, x1: 2, y1: 25, color: DARK },
    { x0: 2, y0: 29, x1: 2, y1: 29, color: DARK },
  ]);
  const s = summarize(analyzePixels(img, 40, 30, { inkTol: 12 }));
  assert.deepEqual(s.rowHeights, [9, 9, 9]);
  assert.equal(s.rows[0].y, 1);
});

console.log(`\n${pass} passed`);
