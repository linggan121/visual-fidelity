// 字宽比对 CLI：参考图 vs 渲染图，逐段量文字宽度并给出诊断
// 用法：node text-width.mjs --ref <png> --impl <png> [--out dir]
import { openBrowser } from './probe/browser.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePixels, decodePng } from './probe/image-spec.mjs';
import { compareRegions, diagnosis } from './probe/text-width.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };

const refPath = arg('ref'); const implPath = arg('impl');
if (!refPath || !implPath) { console.error('need --ref and --impl'); process.exit(2); }
const outDir = resolve(arg('out', join(HERE, 'out', 'text-width')));
mkdirSync(outDir, { recursive: true });

const load = (p) => `data:image/png;base64,${readFileSync(resolve(p)).toString('base64')}`;

const main = async () => {
  const { browser, close } = await openBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const ref = await decodePng(page, load(refPath));
  const impl = await decodePng(page, load(implPath));
  await ctx.close();
  await close();

  if (ref.w !== impl.w || ref.h !== impl.h) {
    console.error(`尺寸不一致：参考 ${ref.w}×${ref.h}，实现 ${impl.w}×${impl.h}。请先对齐画布。`);
    process.exit(2);
  }

  const refData = Buffer.from(ref.b64, 'base64');
  const implData = Buffer.from(impl.b64, 'base64');
  const spec = analyzePixels(refData, ref.w, ref.h, { inkTol: 24 });

  // 区域 = 每段带的每个列簇
  const regions = [];
  spec.bands.forEach((b, bi) => {
    b.columns.forEach((c, ci) => {
      if (c.end - c.start < 4) return;           // 太窄，跳过竖线/边框
      regions.push({ name: `带${bi}·列${ci}`, x0: c.start, y0: b.y0, x1: c.end, y1: b.y1 });
    });
  });

  const rows = compareRegions(refData, implData, ref.w, ref.h, regions);
  const diag = diagnosis(rows);

  writeFileSync(join(outDir, 'text-width.json'), JSON.stringify({ diagnosis: diag, rows }, null, 2));
  const lines = [
    `# 字宽比对`,
    ``,
    `- 参考：\`${refPath}\`　实现：\`${implPath}\``,
    `- 尺寸：${ref.w}×${ref.h}`,
    `- 区域数：${rows.length}`,
    `- 诊断：**${diag.kind}** — ${diag.note}`,
    ``,
    `| 区域 | 参考宽 | 实现宽 | 差 | 比值 | dx | dy |`,
    `|---|---|---|---|---|---|---|`,
    ...rows.filter((r) => r.status === 'ok').map((r) => `| ${r.name} | ${r.refW} | ${r.implW} | ${r.dW > 0 ? '+' : ''}${r.dW} | ${r.ratio?.toFixed(3)} | ${r.dX} | ${r.dY} |`),
  ];
  writeFileSync(join(outDir, 'text-width.md'), lines.join('\n'));

  console.log(`尺寸 ${ref.w}×${ref.h}　区域 ${rows.length}`);
  console.log(`诊断：${diag.kind} — ${diag.note}`);
  rows.filter((r) => r.status === 'ok').slice(0, 12).forEach((r) => {
    console.log(`  ${r.name.padEnd(10)} 参考 ${String(r.refW).padStart(4)}  实现 ${String(r.implW).padStart(4)}  差 ${String(r.dW).padStart(3)}  比值 ${r.ratio.toFixed(3)}`);
  });
  console.log(`输出：${join(outDir, 'text-width.md')}`);
};

main().catch((e) => { console.error('TEXT WIDTH FAILED:', e.message); process.exit(1); });
