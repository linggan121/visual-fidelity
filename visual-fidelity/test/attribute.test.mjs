// 归因单测：像素归属到节点的规则
import assert from 'node:assert/strict';
import { attributeByBoxes, bucketOf } from '../probe/attribute.mjs';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

// 构造位图：set 一组像素
function maskOf(w, h, points) {
  const buf = Buffer.alloc(Math.ceil((w * h) / 8));
  for (const [x, y] of points) {
    const p = y * w + x;
    buf[p >> 3] |= 1 << (p & 7);
  }
  return buf;
}

const box = (over) => ({ role: 'cls:x', index: 0, x: 0, y: 0, w: 10, h: 10, text: '', ...over });

t('单个盒子覆盖全部像素', () => {
  const r = attributeByBoxes(maskOf(10, 10, [[1, 1], [5, 5]]), 10, 10, [box({ w: 10, h: 10 })]);
  assert.equal(r.total, 2);
  assert.equal(r.outside, 0);
  assert.equal(r.items[0].diffPixels, 2);
});

t('嵌套时最内层胜出', () => {
  const outer = box({ role: 'cls:card', w: 10, h: 10 });
  const inner = box({ role: 'cls:row', x: 2, y: 2, w: 4, h: 4 });
  const r = attributeByBoxes(maskOf(10, 10, [[3, 3]]), 10, 10, [outer, inner]);
  assert.equal(r.items.find((i) => i.role === 'cls:row').diffPixels, 1);
  assert.equal(r.items.find((i) => i.role === 'cls:card'), undefined);
});

t('盒子外的像素记为 outside', () => {
  const r = attributeByBoxes(maskOf(10, 10, [[9, 9]]), 10, 10, [box({ x: 0, y: 0, w: 3, h: 3 })]);
  assert.equal(r.outside, 1);
  assert.equal(r.items.length, 0);
});

t('超出画布的盒子会被裁切，不越界', () => {
  const r = attributeByBoxes(maskOf(5, 5, [[4, 4]]), 5, 5, [box({ x: 3, y: 3, w: 100, h: 100 })]);
  assert.equal(r.total, 1);
  assert.equal(r.items[0].diffPixels, 1);
});

t('负坐标不会崩', () => {
  const r = attributeByBoxes(maskOf(5, 5, [[0, 0]]), 5, 5, [box({ x: -5, y: -5, w: 8, h: 8 })]);
  assert.equal(r.total, 1);
});

t('结果按贡献像素降序', () => {
  const a = box({ role: 'cls:a', x: 0, y: 0, w: 5, h: 5 });
  const b = box({ role: 'cls:b', x: 5, y: 0, w: 5, h: 5 });
  const r = attributeByBoxes(maskOf(10, 5, [[0, 0], [6, 0], [7, 0], [8, 0]]), 10, 5, [a, b]);
  assert.equal(r.items[0].role, 'cls:b');
  assert.equal(r.items[0].diffPixels, 3);
});

t('密度按自身面积算，便于找出小而重的差异', () => {
  const big = box({ role: 'cls:big', w: 10, h: 10 });
  const small = box({ role: 'cls:small', x: 0, y: 0, w: 2, h: 2 });
  const r = attributeByBoxes(maskOf(10, 10, [[0, 0], [1, 1]]), 10, 10, [big, small]);
  const s = r.items.find((i) => i.role === 'cls:small');
  assert.equal(s.diffPixels, 2);
  assert.equal(s.density, 0.5);
});

t('占比 share 归一化到总量', () => {
  const r = attributeByBoxes(maskOf(10, 10, [[0, 0], [5, 5], [6, 6]]), 10, 10, [box({ w: 10, h: 10 })]);
  assert.equal(r.items[0].share, 1);
});

t('bucketOf 归类', () => {
  assert.equal(bucketOf('heading'), '文本');
  assert.equal(bucketOf('control'), '控件');
  assert.equal(bucketOf('field'), '输入');
  assert.equal(bucketOf('cls:card'), '容器');
});

console.log(`\n${pass} passed`);
