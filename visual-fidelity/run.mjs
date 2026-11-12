// 一次运行完成：确定性门 → 采集（像素/几何/检查）→ 配对 → 两维判决 → 报告
// 规范：protocol.md。用法：
//   node run.mjs --ref <url|file|png> --impl <url|file> [--root .card] [--clip x,y,w,h]
//                [--device desktop|touch] [--full]
import { openBrowser } from './probe/browser.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture } from './probe/capture.mjs';
import { diffPng } from './probe/diff.mjs';
import { pairSpecs, assignRoles } from './probe/spec.mjs';
import { attributeByBoxes, decodeMask, bucketOf } from './probe/attribute.mjs';
import { verdictOf, inheritedChecksOf, geometryDeltasOf, DEFAULT_TOLERANCE } from './probe/verdict.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);

const outDir = resolve(arg('out', join(HERE, 'out')));
mkdirSync(outDir, { recursive: true });

const width = parseInt(arg('width', '1280'), 10);
const heightArg = arg('height', null);
const full = flag('full');
const dpr = parseFloat(arg('dpr', '1'));
const device = arg('device', 'desktop');
const materialArg = arg('material', null);
const floorArg = arg('floor', null);
const root = arg('root', null);
// 图源模式无法自动判定继承性豁免，必须手动声明并附证据：
//   --inherit "no-default-purple-gradient:参考图徽标取色为紫色渐变"
const inheritDecl = (arg('inherit', '') || '').split('|').map((s) => s.trim()).filter(Boolean).map((s) => {
  const i = s.indexOf(':');
  if (i < 0) { console.error(`--inherit 需要 "id:证据" 格式，收到: ${s}`); process.exit(2); }
  return { id: s.slice(0, i).trim(), reason: s.slice(i + 1).trim() };
});
const substitutions = (arg('substitutions', '') || '').split('|').map((s) => s.trim()).filter(Boolean);
const selectors = (arg('selectors', 'h1,h2,p,button,input,.wrap,.container,.card')).split(',').map((s) => s.trim()).filter(Boolean);
const clipArg = arg('clip', null);
const clip = clipArg ? (() => {
  const [x, y, w, h] = clipArg.split(',').map(Number);
  if ([x, y, w, h].some(Number.isNaN)) { console.error('--clip expects x,y,w,h'); process.exit(2); }
  return { x, y, width: w, height: h };
})() : null;

const refArg = arg('ref');
const implArg = arg('impl');
if (!refArg || !implArg) { console.error('need --ref and --impl'); process.exit(2); }

const refIsImage = /\.(png|jpe?g|webp)$/i.test(refArg);
const toTarget = (v) => (/^https?:/i.test(v) ? { type: 'url', value: v } : { type: 'file', value: resolve(v) });

const main = async () => {
  const t0 = Date.now();
  const height = heightArg ? parseInt(heightArg, 10) : Math.round(width * 0.625);
  const { browser, close } = await openBrowser({ width, height });
  const opts = { viewport: { width, height }, dpr, fullPage: full, selectors, clip, specRoot: root };

  // 1. 参考侧
  let refStyles = null, refChecks = null, refSpec = null, refPng, refRenderMs = null;
  if (refIsImage) {
    refPng = readFileSync(resolve(refArg)).toString('base64');
  } else {
    const r = await capture(browser, toTarget(refArg), opts);
    refPng = r.png; refStyles = r.styles; refChecks = r.checks; refSpec = r.spec; refRenderMs = r.renderMs;
  }

  // 2. 实现侧
  const impl = await capture(browser, toTarget(implArg), opts);

  // 3. 确定性前置门
  const impl2 = await capture(browser, toTarget(implArg), opts);
  const det = await diffPng(browser, impl.png, impl2.png);
  const determinism = {
    ok: det.structuralPixels === 0,
    ratioPercent: +(det.ratio * 100).toFixed(4),
    reasons: det.structuralPixels === 0 ? [] : [`同一实现两次渲染差异 ${(det.ratio * 100).toFixed(4)}%（${det.structuralPixels} 像素）`],
  };

  // 4. 主对比（文本遮罩）+ 几何配对
  const diff = await diffPng(browser, refPng, impl.png, { mask: impl.textRects });
  await close();

  let attribution = null;
  if (impl.spec?.nodes && diff.structuralMask) {
    const boxes = assignRoles(impl.spec.nodes).map((n) => ({ role: n.role, index: n.index, text: n.text, x: n.x, y: n.y, w: n.w, h: n.h }));
    attribution = attributeByBoxes(decodeMask(diff.structuralMask), diff.w, diff.h, boxes);
  }

  let geometry = null;
  let pairs = null;
  if (refSpec?.nodes && impl.spec?.nodes) {
    pairs = pairSpecs(refSpec.nodes, impl.spec.nodes, DEFAULT_TOLERANCE.driftPx);
    geometry = geometryDeltasOf(pairs);
  }

  // 5. 继承性豁免：页源模式自动判定，图源模式靠 --inherit 声明
  const inheritedAuto = refChecks ? inheritedChecksOf(refChecks, impl.checks) : [];
  const inherited = [...new Set([...inheritedAuto, ...inheritDecl.map((d) => d.id)])];
  const declaredSubs = inheritDecl.map((d) => `继承（人工声明）：${d.id} — ${d.reason}`);

  const unverified = [];
  if (refIsImage) unverified.push('参考为静态图，无样式证据');
  if (!geometry) unverified.push('几何维未取得（图源模式或缺 --root）');

  const tolerance = materialArg ? { materialPercent: parseFloat(materialArg) } : undefined;

  const verdict = verdictOf({
    tolerance,
    determinism,
    mode: refIsImage ? 'image' : 'page',
    floor: floorArg ? { evidence: floorArg } : undefined,
    visual: {
      ratioPercent: diff.ratio * 100,
      maskedRatioPercent: diff.unmaskedRatio * 100,
      textShiftPixels: diff.textShiftPixels,
      textSharePercent: diff.structuralPixels ? (diff.textShiftPixels / diff.structuralPixels) * 100 : 0,
      textAreaPercent: diff.totalPixels ? (diff.maskPixels / diff.totalPixels) * 100 : 0,
      maxDelta: diff.maxDelta,
      geometry: geometry
        ? { drift: geometry.drift, unpairedPercent: geometry.unpairedPercent }
        : { drift: 0, unpairedPercent: 0 },
    },
    compliance: { checks: impl.checks, device, inherited, declared: inheritDecl.map((d) => d.id) },
    substitutions: [...substitutions, ...declaredSubs],
    unverified,
  });

  writeFileSync(join(outDir, 'ref.png'), Buffer.from(refPng, 'base64'));
  writeFileSync(join(outDir, 'impl.png'), Buffer.from(impl.png, 'base64'));
  writeFileSync(join(outDir, 'heatmap.png'), Buffer.from(diff.heatmap.split(',')[1], 'base64'));
  if (pairs) {
    writeFileSync(join(outDir, 'geometry.json'), JSON.stringify(pairs, null, 2));
    const lines = [
      `| 角色 | # | 结果 | dx | dy | dw | dh | 文本 |`,
      `|---|---|---|---|---|---|---|---|`,
      ...pairs.map((p) => p.matched
        ? `| ${p.role} | ${p.index} | ${p.drift ? '**漂移**' : 'ok'} | ${p.dx} | ${p.dy} | ${p.dw} | ${p.dh} | ${p.text || ''} |`
        : `| ${p.role} | ${p.index} | ${p.side === 'ref-only' ? '参考独有' : '实现独有'} | - | - | - | - | ${p.text || ''} |`),
    ];
    writeFileSync(join(outDir, 'geometry.md'), lines.join('\n'));
  }

  if (attribution) {
    writeFileSync(join(outDir, 'attribution.json'), JSON.stringify(attribution, null, 2));
    const top = attribution.items.slice(0, 30);
    const lines = [
      `# 差异归因`,
      ``,
      `结构性差异共 ${attribution.total} 像素，其中 ${attribution.outside} 像素落在所有节点之外（卡片底、阴影、边框）。`,
      ``,
      `| 归类 | 角色 | # | 差异像素 | 占总量 | 自身密度 | 尺寸 | 文本 |`,
      `|---|---|---|---|---|---|---|---|`,
      ...top.map((it) => `| ${bucketOf(it.role)} | ${it.role} | ${it.index} | ${it.diffPixels} | ${(it.share * 100).toFixed(1)}% | ${(it.density * 100).toFixed(1)}% | ${it.w}×${it.h} | ${it.text || ''} |`),
    ];
    writeFileSync(join(outDir, 'attribution.md'), lines.join('\n'));
  }

  const report = {
    meta: {
      ref: refArg, impl: implArg, mode: refIsImage ? 'image' : 'page', device, root,
      viewport: `${width}x${opts.viewport.height}`, dpr, fullPage: full,
      clip: clip ? `${clip.x},${clip.y},${clip.width}x${clip.height}` : null,
      elapsedMs: Date.now() - t0, renderRefMs: refRenderMs, renderImplMs: impl.renderMs,
    },
    determinism,
    verdict,
    geometry,
    attribution: attribution
      ? { total: attribution.total, outside: attribution.outside, top: attribution.items.slice(0, 10) }
      : null,
    styles: { ref: refStyles, impl: impl.styles },
    checks: { ref: refChecks, impl: impl.checks, inherited },
    consoleErrors: impl.errors,
    diff: {
      size: `${diff.w}x${diff.h}`,
      structuralPixels: diff.structuralPixels,
      totalPixels: diff.totalPixels,
      ratioPercent: +(diff.ratio * 100).toFixed(3),
      unmaskedPixels: diff.unmaskedPixels,
      unmaskedRatioPercent: +(diff.unmaskedRatio * 100).toFixed(3),
      textShiftPixels: diff.textShiftPixels,
      maskNoisePixels: diff.maskNoisePixels,
      maskPixels: diff.maskPixels,
      maxDelta: Math.round(diff.maxDelta), meanDelta: +diff.meanDelta.toFixed(2),
    },
    artifacts: ['ref.png', 'impl.png', 'heatmap.png', 'report.json', 'report.md', ...(pairs ? ['geometry.md', 'geometry.json'] : [])],
  };
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));

  const driftRows = (pairs || []).filter((p) => p.matched && p.drift);
  const unpairedRows = (pairs || []).filter((p) => !p.matched);

  const md = [
    `# 对比报告`,
    ``,
    `- 参考：\`${refArg}\`（${report.meta.mode} 模式）`,
    `- 实现：\`${implArg}\``,
    `- 设备上下文：${device}`,
    `- 视口：${report.meta.viewport} @ ${dpr}x${dpr}${full ? '（整页）' : ''}${clip ? `，裁切 ${report.meta.clip}` : ''}`,
    `- 几何根节点：${root ? `\`${root}\`` : '未指定'}`,
    `- 耗时：${report.meta.elapsedMs} ms`,
    `- 阈值：像素 ${verdict.tolerance.ratioPercent}% / 实质 ${verdict.tolerance.materialPercent}% / 通道差 ${verdict.tolerance.maxDelta} / 漂移 ${verdict.tolerance.driftPx}px`,
    ``,
    `## 判决：**${verdict.verdict}**`,
    ``,
    ...verdict.reasons.map((r) => `- ${r}`),
    ``,
    `| 维度 | 状态 |`,
    `|---|---|`,
    `| 视觉 | ${verdict.visual.state} |`,
    `| 规范 | ${verdict.compliance.state} |`,
    `| 确定性 | ${determinism.ok ? '通过（0 像素）' : `失败（${determinism.ratioPercent}%）`} |`,
    `| 几何 | ${geometry ? `${geometry.drift} 处漂移 / ${unpairedRows.length} 项未配对` : '未取得'} |`,
    ``,
    `## 像素`,
    ``,
    `| 指标 | 值 |`,
    `|---|---|`,
    `| 结构性差异（判决依据） | ${report.diff.structuralPixels} / ${report.diff.totalPixels} = **${report.diff.ratioPercent}%** |`,
    `| 其中文本区大偏移 | ${report.diff.textShiftPixels} 像素 |`,
    `| 其中遮罩外差异 | ${report.diff.unmaskedPixels} 像素（${report.diff.unmaskedRatioPercent}%） |`,
    `| 文本区抗锯齿噪声（不计入） | ${report.diff.maskNoisePixels} 像素 / 遮罩 ${report.diff.maskPixels} 像素 |`,
    `| 最大通道差 | ${report.diff.maxDelta} |`,
    `| 平均通道差 | ${report.diff.meanDelta} |`,
    ``,
    geometry ? [
      `## 几何配对`,      ``,
      `配对 ${pairs.length} 项，漂移 ${geometry.drift} 项，未配对 ${geometry.unpaired} 项（${geometry.unpairedPercent.toFixed(1)}%）。`,
      ``,
      ...(driftRows.length
        ? [`| 角色 | # | dx | dy | dw | dh | 文本 |`, `|---|---|---|---|---|---|---|`,
          ...driftRows.map((p) => `| ${p.role} | ${p.index} | ${p.dx} | ${p.dy} | ${p.dw} | ${p.dh} | ${p.text || ''} |`)]
        : [`无漂移项。`]),
      ...(unpairedRows.length
        ? [``, `未配对（不参与差值）：${unpairedRows.map((p) => `${p.role}#${p.index}${p.side === 'ref-only' ? '(参考)' : '(实现)'}`).join('、')}`]
        : []),
      ``,
    ].join('\n') : [`## 几何配对`, ``, `未取得几何证据（图源模式或缺 \`--root\`）。`, ``],
    attribution ? [
      `## 差异归因`,
      ``,
      `结构性差异 ${attribution.total} 像素，其中 ${attribution.outside} 像素落在所有节点之外（卡片底、阴影、边框）。`,
      ``,
      `| 归类 | 角色 | # | 差异像素 | 占比 | 密度 | 文本 |`,
      `|---|---|---|---|---|---|---|`,
      ...attribution.items.slice(0, 10).map((it) => `| ${bucketOf(it.role)} | ${it.role} | ${it.index} | ${it.diffPixels} | ${(it.share * 100).toFixed(1)}% | ${(it.density * 100).toFixed(1)}% | ${it.text || ''} |`),
      ``,
    ].join('\n') : [`## 差异归因`, ``, `未取得归因（缺几何清单）。`, ``],
    `## 检查项`,
    ``,
    `| 项 | 结果 | 详情 |`,
    `|---|---|---|`,
    ...impl.checks.map((c) => {
      const ex = inherited.includes(c.id) ? '（继承性豁免）' : '';
      return `| ${c.id} | ${c.ok ? 'PASS' : `**FAIL**${ex}`} | ${c.detail} |`;
    }),
    ``,
    `## 替代与未验证`,
    ``,
    ...(verdict.substitutions.length ? verdict.substitutions.map((s) => `- 替代：${s}`) : ['- 无替代项']),
    ...unverified.map((u) => `- 未验证：${u}`),
    ``,
    `## 证据`,
    ``,
    `- 参考截图：\`ref.png\``,
    `- 实现截图：\`impl.png\``,
    `- 差异热区：\`heatmap.png\`（实心为结构性差异，半透明为文本区噪声）`,
    ...(pairs ? [`- 几何明细：\`geometry.md\``] : []),
    `- 控制台错误：${impl.errors.length}`,
  ].join('\n');
  writeFileSync(join(outDir, 'report.md'), md);

  console.log(`判决: ${verdict.verdict}  [视觉 ${verdict.visual.state} / 规范 ${verdict.compliance.state} / 确定性 ${determinism.ok ? 'ok' : 'FAIL'}]`);
  verdict.reasons.forEach((r) => console.log(`  - ${r}`));
  console.log(`像素: 结构性 ${report.diff.ratioPercent}%（文本大偏移 ${report.diff.textShiftPixels}，噪声剔除 ${report.diff.maskNoisePixels}）`);
  if (geometry) console.log(`几何: ${pairs.length} 项配对，漂移 ${geometry.drift}，未配对 ${geometry.unpaired}（${geometry.unpairedPercent.toFixed(1)}%）`);
  if (attribution) {
    const top3 = attribution.items.slice(0, 3).map((i) => `${bucketOf(i.role)}/${i.role} ${i.diffPixels}px(${(i.share * 100).toFixed(0)}%)`);
    console.log(`归因: 节点外 ${attribution.outside}px | Top ${top3.join(' · ')}`);
  }
  console.log(`报告: ${join(outDir, 'report.md')}`);
  if (verdict.verdict === 'NOT READY') process.exitCode = 3;
  if (verdict.verdict === 'UNVERIFIED') process.exitCode = 4;
};

main().catch((e) => { console.error('RUN FAILED:', e.message); process.exit(1); });
