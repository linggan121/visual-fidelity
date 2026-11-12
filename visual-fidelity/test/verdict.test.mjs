// 判决逻辑单测：每条用例对应 protocol.md 的一条规则
import assert from 'node:assert/strict';
import {
  verdictOf, DEFAULT_TOLERANCE, applicableChecks, inheritedChecksOf, geometryDeltasOf,
} from '../probe/verdict.mjs';

let pass = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

const det = { ok: true };
const clean = { ratioPercent: 0.0012, maxDelta: 8, geometry: { drift: 0, unpairedPercent: 0 } };
const dirty = { ratioPercent: 6.18, maxDelta: 240, geometry: { drift: 0, unpairedPercent: 0 } };
const marginal = { ratioPercent: 1.2, maxDelta: 60, geometry: { drift: 0, unpairedPercent: 5 } };
const allPass = ['no-emoji', 'no-h-overflow', 'icons-are-svg', 'no-default-purple-gradient']
  .map((id) => ({ id, ok: true }));

const base = (over = {}) => ({
  determinism: det,
  mode: 'page',
  visual: clean,
  compliance: { checks: allPass, device: 'desktop', inherited: [] },
  ...over,
});

// §3.3 优先级：证据缺失压过一切
t('确定性前置门失败 → UNVERIFIED', () => {
  const r = verdictOf(base({ determinism: { ok: false } }));
  assert.equal(r.verdict, 'UNVERIFIED');
  assert.match(r.reasons.join(' '), /确定性/);
});

t('没有像素证据 → UNVERIFIED，即使检查全过', () => {
  const r = verdictOf(base({ visual: null }));
  assert.equal(r.verdict, 'UNVERIFIED');
});

t('视觉与规范都通过 → READY', () => {
  assert.equal(verdictOf(base()).verdict, 'READY');
});

// §3.1
t('像素超过实质阈值 → NOT READY', () => {
  const r = verdictOf(base({ visual: dirty }));
  assert.equal(r.verdict, 'NOT READY');
  assert.equal(r.visual.state, 'fail');
});

t('任一几何漂移即 NOT READY（即使像素很小）', () => {
  const r = verdictOf(base({ visual: { ratioPercent: 0.1, maxDelta: 4, geometry: { drift: 1, unpairedPercent: 0 } } }));
  assert.equal(r.verdict, 'NOT READY');
  assert.match(r.visual.reasons.join(' '), /几何漂移/);
});

t('边际视觉 → READY WITH SUBSTITUTIONS', () => {
  const r = verdictOf(base({ visual: marginal }));
  assert.equal(r.verdict, 'READY WITH SUBSTITUTIONS');
  assert.match(r.reasons.join(' '), /边际/);
});

t('未配对超过 20% → 样式维作废并说明', () => {
  const r = verdictOf(base({ visual: { ratioPercent: 0.1, maxDelta: 4, geometry: { drift: 0, unpairedPercent: 35 } } }));
  assert.match(r.visual.reasons.join(' '), /未配对/);
});

// §3.2 + §5 设备上下文
t('桌面上下文不启用触屏项', () => {
  const checks = [...allPass, { id: 'tap-target-44', ok: false }, { id: 'input-font-16', ok: false }];
  const r = verdictOf(base({ compliance: { checks, device: 'desktop', inherited: [] } }));
  assert.equal(r.verdict, 'READY');
  assert.deepEqual(r.compliance.ignored.sort(), ['input-font-16', 'tap-target-44']);
});

t('触屏上下文启用触屏项，失败即 NOT READY', () => {
  const checks = [...allPass, { id: 'tap-target-44', ok: false }];
  const r = verdictOf(base({ compliance: { checks, device: 'touch', inherited: [] } }));
  assert.equal(r.verdict, 'NOT READY');
  assert.deepEqual(r.compliance.failed, ['tap-target-44']);
});

// §4 继承性豁免
t('继承性违规被豁免，但仍不给 READY', () => {
  const checks = [...allPass, { id: 'tap-target-44', ok: false }];
  const r = verdictOf(base({ compliance: { checks, device: 'touch', inherited: ['tap-target-44'] } }));
  assert.equal(r.verdict, 'READY WITH SUBSTITUTIONS');
  assert.deepEqual(r.compliance.exempted, ['tap-target-44']);
  assert.ok(r.substitutions.some((s) => s.includes('继承')));
});

t('继承性判定只认参考侧同样失败的项', () => {
  const ref = [{ id: 'tap-target-44', ok: false }, { id: 'no-emoji', ok: true }];
  const impl = [{ id: 'tap-target-44', ok: false }, { id: 'no-emoji', ok: false }];
  assert.deepEqual(inheritedChecksOf(ref, impl), ['tap-target-44']);
});

t('参考稿没问题的项不得豁免', () => {
  const checks = [...allPass, { id: 'no-h-overflow', ok: false }];
  const r = verdictOf(base({ compliance: { checks, device: 'desktop', inherited: ['tap-target-44'] } }));
  assert.equal(r.verdict, 'NOT READY');
});

// §3.3 图源模式硬约束
t('图源模式下永不 READY', () => {
  const r = verdictOf(base({ mode: 'image' }));
  assert.equal(r.verdict, 'READY WITH SUBSTITUTIONS');
  assert.ok(r.substitutions.some((s) => s.includes('图源')));
});

t('图源模式 + 替代项 → 仍是 WITH SUBSTITUTIONS，不是 READY', () => {
  const r = verdictOf(base({ mode: 'image', substitutions: ['字体 A→B'] }));
  assert.equal(r.verdict, 'READY WITH SUBSTITUTIONS');
});

// 其它
t('阈值随判决一起输出', () => {
  const r = verdictOf(base());
  assert.deepEqual(r.tolerance, DEFAULT_TOLERANCE);
});

t('文本集中度超阈值 → 提示字形栅格地板（不改变状态）', () => {
  const r = verdictOf(base({ visual: { ratioPercent: 4.2, maxDelta: 240, geometry: { drift: 0, unpairedPercent: 0 }, textSharePercent: 48, textAreaPercent: 6 } }));
  assert.equal(r.verdict, 'NOT READY');
  assert.match(r.reasons.join(' '), /字形栅格地板/);
  assert.equal(r.visual.numbers.textConcentration, 8);
});

t('文本集中度正常时不给地板提示', () => {
  const r = verdictOf(base({ visual: { ratioPercent: 4.2, maxDelta: 240, geometry: { drift: 0, unpairedPercent: 0 }, textSharePercent: 10, textAreaPercent: 20 } }));
  assert.doesNotMatch(r.reasons.join(' '), /字形栅格地板/);
});

t('缺少文本面积时不计算集中度', () => {
  const r = verdictOf(base({ visual: { ratioPercent: 0.1, maxDelta: 4, geometry: { drift: 0, unpairedPercent: 0 }, textSharePercent: 50 } }));
  assert.equal(r.visual.numbers.textConcentration, null);
});

t('阈值可覆盖', () => {
  const r = verdictOf(base({ visual: { ratioPercent: 3, maxDelta: 9, geometry: { drift: 0, unpairedPercent: 0 } }, tolerance: { materialPercent: 5 } }));
  assert.notEqual(r.verdict, 'NOT READY');
});

t('适用检查按上下文计算', () => {
  assert.equal(applicableChecks('desktop').length, 6);
  assert.equal(applicableChecks('touch').length, 8);
});

t('几何配对：漂移与未配对分别统计', () => {
  const g = geometryDeltasOf([
    { role: 'row', matched: true, dx: 3, dy: 0, dw: 0, dh: 0 },
    { role: 'btn', matched: true, dx: 0, dy: 0, dw: 1, dh: 0 },
    { role: 'x', matched: false },
  ]);
  assert.equal(g.drift, 1);
  assert.equal(g.unpaired, 1);
  assert.equal(Math.round(g.unpairedPercent), 33);
});

// §11.3 地板声明
const textHeavy = {
  ratioPercent: 4.155, maxDelta: 228,
  geometry: { drift: 0, unpairedPercent: 4.8 },
  textSharePercent: 48.3, textAreaPercent: 6.4,
};

t('地板声明 + 集中度超阈 + 零漂移 → READY WITH DECLARED FLOOR', () => {
  const r = verdictOf(base({ mode: 'image', visual: textHeavy, floor: { evidence: '字宽 30 区域比值 1.000；颜色逐段取样一致' } }));
  assert.equal(r.verdict, 'READY WITH DECLARED FLOOR');
  assert.match(r.reasons.join(' '), /已声明字形栅格地板/);
});

t('有集中度但未声明证据 → NOT READY，并提示用 --floor', () => {
  const r = verdictOf(base({ mode: 'image', visual: textHeavy }));
  assert.equal(r.verdict, 'NOT READY');
  assert.match(r.reasons.join(' '), /未声明地板证据/);
});

t('有几何漂移时地板声明无效', () => {
  const r = verdictOf(base({
    mode: 'image',
    visual: { ...textHeavy, geometry: { drift: 2, unpairedPercent: 4.8 } },
    floor: { evidence: '字宽一致' },
  }));
  assert.equal(r.verdict, 'NOT READY');
});

t('规范不通过时地板声明无效', () => {
  const r = verdictOf(base({
    mode: 'image',
    visual: textHeavy,
    compliance: { checks: [{ id: 'no-emoji', ok: false }], device: 'desktop', inherited: [] },
    floor: { evidence: '字宽一致' },
  }));
  assert.equal(r.verdict, 'NOT READY');
});

t('集中度不足时地板声明无效', () => {
  const r = verdictOf(base({
    mode: 'image',
    visual: { ...textHeavy, textSharePercent: 10, textAreaPercent: 20 },
    floor: { evidence: '字宽一致' },
  }));
  assert.equal(r.verdict, 'NOT READY');
});

console.log(`\n${pass} passed`);
