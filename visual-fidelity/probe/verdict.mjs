// 判决：纯函数，无浏览器依赖，可单测
// 规范来源：protocol.md 第 3、4、8、9 节

export const DEFAULT_TOLERANCE = Object.freeze({
  ratioPercent: 0.5,      // 像素差异容差
  materialPercent: 2,     // 实质失败阈值
  maxDelta: 32,           // 单点通道差容差
  driftPx: 1,             // 几何漂移容差
  unpairedPercent: 20,    // 未配对超过此比例，样式维结论作废
  textConcentrationRatio: 3, // 文本区差异占比 / 面积占比 超过此倍数，判为字形栅格地板
});

export const CHECKS = Object.freeze({
  'no-emoji': { contexts: ['desktop', 'touch'], required: true },
  'no-default-purple-gradient': { contexts: ['desktop', 'touch'], required: true },
  'input-font-16': { contexts: ['touch'], required: true },
  'tap-target-44': { contexts: ['touch'], required: true },
  'no-h-overflow': { contexts: ['desktop', 'touch'], required: true },
  'icons-are-svg': { contexts: ['desktop', 'touch'], required: true },
  'no-placeholder-copy': { contexts: ['desktop', 'touch'], required: false },
  'no-pill-pile': { contexts: ['desktop', 'touch'], required: false },
});

export function applicableChecks(device = 'desktop') {
  return Object.entries(CHECKS)
    .filter(([, m]) => m.contexts.includes(device))
    .map(([id, m]) => ({ id, required: m.required }));
}

function visualState(v, tol) {
  const reasons = [];
  if (!v || typeof v.ratioPercent !== 'number') {
    return { state: 'missing', reasons: ['缺少像素证据（未生成对比）'] };
  }
  const ratio = v.ratioPercent;
  const drift = v.geometry?.drift ?? 0;
  const unpaired = v.geometry?.unpairedPercent ?? 0;
  const textShare = v.textSharePercent ?? null;
  const textArea = v.textAreaPercent ?? null;
  const textConcentration = (textShare != null && textArea != null && textArea > 0) ? textShare / textArea : null;
  const numbers = {
    ratioPercent: +ratio.toFixed(3),
    maskedRatioPercent: v.maskedRatioPercent != null ? +v.maskedRatioPercent.toFixed(3) : null,
    textSharePercent: textShare != null ? +textShare.toFixed(1) : null,
    textAreaPercent: textArea != null ? +textArea.toFixed(1) : null,
    textConcentration: textConcentration != null ? +textConcentration.toFixed(1) : null,
    maxDelta: v.maxDelta ?? null,
    drift,
    unpairedPercent: +unpaired.toFixed(1),
  };

  if (unpaired > tol.unpairedPercent) reasons.push(`未配对元素 ${numbers.unpairedPercent}%，超过 ${tol.unpairedPercent}%，样式维结论作废`);

  // 字形栅格地板：文本区面积远小于其差异占比 → 差异来自字形而非布局或颜色
  if (textConcentration != null && textConcentration > tol.textConcentrationRatio) {
    reasons.push(`文本区占面积 ${numbers.textAreaPercent}%，却贡献 ${numbers.textSharePercent}% 的差异（集中度 ${numbers.textConcentration}×），属字形栅格地板`);
  }

  if (ratio > tol.materialPercent || drift > 0) {
    if (ratio > tol.materialPercent) reasons.push(`像素差异 ${numbers.ratioPercent}% 超过实质阈值 ${tol.materialPercent}%`);
    if (drift > 0) reasons.push(`几何漂移 ${drift} 项（任一配对项超 ${tol.driftPx}px 即计入）`);
    return { state: 'fail', reasons, numbers };
  }
  if (ratio > tol.ratioPercent) {
    reasons.push(`像素差异 ${numbers.ratioPercent}% 在容差 ${tol.ratioPercent}% 与实质阈值之间`);
    return { state: 'marginal', reasons, numbers };
  }
  return { state: 'pass', reasons, numbers };
}

function complianceState(c, tol) {
  const checks = c?.checks ?? [];
  const device = c?.device ?? 'desktop';
  const inherited = new Set(c?.inherited ?? []);
  const declared = new Set(c?.declared ?? []);
  const applicable = applicableChecks(device);
  const applicableIds = new Set(applicable.map((a) => a.id));

  const considered = checks.filter((ch) => applicableIds.has(ch.id));
  const exempted = [];
  const failed = [];
  const failedOptional = [];

  for (const ch of considered) {
    const meta = applicable.find((a) => a.id === ch.id);
    if (ch.ok) continue;
    if (inherited.has(ch.id)) { exempted.push(ch.id); continue; }
    if (meta.required) failed.push(ch.id);
    else failedOptional.push(ch.id);
  }

  const ignored = checks.filter((ch) => !applicableIds.has(ch.id)).map((ch) => ch.id);
  const reasons = [];
  if (failed.length) reasons.push(`必检项失败：${failed.join(', ')}`);
  if (failedOptional.length) reasons.push(`建议项失败：${failedOptional.join(', ')}`);
  if (exempted.length) {
    const auto = exempted.filter((id) => !declared.has(id));
    const manual = exempted.filter((id) => declared.has(id));
    if (auto.length) reasons.push(`继承性豁免（自动判定）：${auto.join(', ')}`);
    if (manual.length) reasons.push(`继承性豁免（人工声明，须附证据）：${manual.join(', ')}`);
  }
  if (ignored.length) reasons.push(`按 ${device} 上下文忽略：${ignored.join(', ')}`);

  return {
    state: failed.length ? 'fail' : 'pass',
    reasons,
    failed,
    failedOptional,
    exempted,
    ignored,
    device,
  };
}

export function verdictOf(input = {}) {
  const tol = { ...DEFAULT_TOLERANCE, ...(input.tolerance || {}) };
  const reasons = [];

  // 优先级：证据缺失 > 环境不稳 > 维度失败 > 替代项
  if (!input.determinism || input.determinism.ok !== true) {
    return {
      verdict: 'UNVERIFIED',
      reasons: ['确定性前置门未通过：同一页面两次渲染不一致，环境不稳，不得出结论',
        ...(input.determinism?.reasons ?? [])],
      visual: { state: 'unknown', reasons: [] },
      compliance: { state: 'unknown', reasons: [] },
      tolerance: tol,
    };
  }

  const visual = visualState(input.visual, tol);
  const compliance = complianceState(input.compliance, tol);

  if (visual.state === 'missing') {
    return { verdict: 'UNVERIFIED', reasons: [...visual.reasons, '没有 E1 证据不得下视觉结论'], visual, compliance, tolerance: tol };
  }

  const substitutions = [...(input.substitutions ?? [])];
  if (compliance.exempted?.length) {
    substitutions.push(...compliance.exempted.map((id) => `继承：${id} — 参考稿同样存在`));
  }
  if (input.mode === 'image') {
    substitutions.push('图源模式：无样式证据可对照，样式一致性未验证');
  }

  reasons.push(...visual.reasons, ...compliance.reasons);

  if (visual.state === 'fail' || compliance.state === 'fail') {
    // 地板声明：只救"仅像素超阈值 + 差异集中在文本 + 几何零漂移 + 规范通过"这一种情况
    const conc = visual.numbers?.textConcentration;
    const drift = visual.numbers?.drift ?? 0;
    const evidence = String(input.floor?.evidence ?? '').trim();
    const floorApplies = Boolean(evidence) && compliance.state === 'pass' && drift === 0
      && conc != null && conc > tol.textConcentrationRatio;

    if (floorApplies) {
      return {
        verdict: 'READY WITH DECLARED FLOOR',
        reasons: [...reasons, `已声明字形栅格地板（证据：${evidence}）`],
        visual,
        compliance,
        substitutions: [...substitutions, `地板声明：${evidence}`],
        tolerance: tol,
      };
    }

    const hint = (visual.state === 'fail' && conc != null && conc > tol.textConcentrationRatio && !evidence)
      ? ['差异集中在文本区但未声明地板证据（--floor "证据"）']
      : [];
    return { verdict: 'NOT READY', reasons: [...reasons, ...hint], visual, compliance, substitutions, tolerance: tol };
  }

  if (visual.state === 'marginal') {
    return { verdict: 'READY WITH SUBSTITUTIONS', reasons: [...reasons, '视觉为边际，作为已知偏差记录'], visual, compliance, substitutions, tolerance: tol };
  }

  // 图源模式没有样式证据，永不给 READY
  if (input.mode === 'image') {
    return { verdict: 'READY WITH SUBSTITUTIONS', reasons, visual, compliance, substitutions, tolerance: tol };
  }

  if (substitutions.length || (input.unverified ?? []).length) {
    return {
      verdict: 'READY WITH SUBSTITUTIONS',
      reasons: [...reasons, ...(input.unverified ?? []).map((u) => `未验证：${u}`)],
      visual, compliance, substitutions, tolerance: tol,
    };
  }

  return { verdict: 'READY', reasons, visual, compliance, substitutions: [], tolerance: tol };
}

// 几何配对差值：只统计配对成功且差值超阈的项
export function geometryDeltasOf(pairs, tol = DEFAULT_TOLERANCE) {
  const drift = pairs.filter((p) => p.matched && (Math.abs(p.dx) > tol.driftPx || Math.abs(p.dy) > tol.driftPx || Math.abs(p.dw) > tol.driftPx || Math.abs(p.dh) > tol.driftPx));
  const unpaired = pairs.filter((p) => !p.matched);
  return {
    drift: drift.length,
    unpaired: unpaired.length,
    unpairedPercent: pairs.length ? (unpaired.length / pairs.length) * 100 : 0,
    details: drift.map((p) => ({ role: p.role, dx: p.dx, dy: p.dy, dw: p.dw, dh: p.dh })),
  };
}

// 继承性判定：实现失败且参考同样失败的项，才算继承
export function inheritedChecksOf(refChecks = [], implChecks = []) {
  const refFail = new Set(refChecks.filter((c) => !c.ok).map((c) => c.id));
  return implChecks.filter((c) => !c.ok && refFail.has(c.id)).map((c) => c.id);
}
