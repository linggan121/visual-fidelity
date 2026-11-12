// 配对逻辑单测：对应 protocol.md 第 6 节
import assert from 'node:assert/strict';
import { roleOf, pairSpecs } from '../probe/spec.mjs';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

const node = (over) => ({ tag: 'div', cls: '', x: 0, y: 0, w: 10, h: 10, text: '', ...over });

t('角色归类：标题按语义，不按标签', () => {
  assert.equal(roleOf(node({ tag: 'h1' })), 'heading');
  assert.equal(roleOf(node({ tag: 'h4' })), 'heading');
});

t('角色归类：可点元素与输入类元素分开', () => {
  assert.equal(roleOf(node({ tag: 'button' })), 'control');
  assert.equal(roleOf(node({ tag: 'a' })), 'control');
  assert.equal(roleOf(node({ tag: 'input' })), 'field');
  assert.equal(roleOf(node({ tag: 'select' })), 'field');
});

t('角色归类：类名优先，状态类不影响配对', () => {
  assert.equal(roleOf(node({ cls: 'cfg-row.off' })), 'cls:cfg-row');
  assert.equal(roleOf(node({ cls: 'cfg-row' })), 'cls:cfg-row');
});

t('角色归类：无类名时退回标签', () => {
  assert.equal(roleOf(node({ tag: 'span' })), 'tag:span');
});

t('同角色按出现顺序配对', () => {
  const ref = [node({ cls: 'row', y: 10 }), node({ cls: 'row', y: 20 })];
  const impl = [node({ cls: 'row', y: 11 }), node({ cls: 'row', y: 20 })];
  const pairs = pairSpecs(ref, impl, 1);
  assert.equal(pairs.length, 2);
  assert.ok(pairs.every((p) => p.matched));
  assert.equal(pairs[0].dy, 1);
  assert.equal(pairs[0].drift, false);
  assert.equal(pairs[1].drift, false);
});

t('差值超过容差标记漂移', () => {
  const pairs = pairSpecs([node({ cls: 'row', y: 10 })], [node({ cls: 'row', y: 14 })], 1);
  assert.equal(pairs[0].drift, true);
  assert.equal(pairs[0].dy, 4);
});

t('配不上的元素标未配对，不产生差值', () => {
  const ref = [node({ cls: 'row' }), node({ cls: 'extra' })];
  const impl = [node({ cls: 'row' })];
  const pairs = pairSpecs(ref, impl, 1);
  const orphan = pairs.find((p) => !p.matched);
  assert.ok(orphan);
  assert.equal(orphan.side, 'ref-only');
  assert.equal(orphan.dx, undefined);
});

t('实现侧多出的元素同样是未配对', () => {
  const pairs = pairSpecs([node({ cls: 'row' })], [node({ cls: 'row' }), node({ cls: 'row' })], 1);
  assert.equal(pairs.filter((p) => !p.matched).length, 1);
  assert.equal(pairs.find((p) => !p.matched).side, 'impl-only');
});

t('不同角色不会互相配对', () => {
  const pairs = pairSpecs([node({ tag: 'button' })], [node({ tag: 'input' })], 1);
  assert.equal(pairs.filter((p) => p.matched).length, 0);
  assert.equal(pairs.length, 2);
});

t('宽度差也能触发漂移', () => {
  const pairs = pairSpecs([node({ cls: 'row', w: 100 })], [node({ cls: 'row', w: 100 })], 1);
  assert.equal(pairs[0].dw, 0);
  assert.equal(pairs[0].drift, false);
  const p2 = pairSpecs([node({ cls: 'row', w: 100 })], [node({ cls: 'row', w: 97 })], 1);
  assert.equal(p2[0].drift, true);
});

console.log(`\n${pass} passed`);
