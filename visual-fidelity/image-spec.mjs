// 图像取证 CLI：PNG → 结构表
// 用法：node image-spec.mjs --img <png> [--out dir] [--ink 24] [--line 0.5]
import { openBrowser } from './probe/browser.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzePixels, summarize } from './probe/image-spec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };

const img = arg('img');
if (!img) { console.error('need --img'); process.exit(2); }
const outDir = resolve(arg('out', join(HERE, 'out', 'image-spec')));
mkdirSync(outDir, { recursive: true });

const decode = async (page, dataUrl) => page.evaluate(async (src) => {
  const im = new Image();
  im.src = src;
  await im.decode();
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const bytes = new Uint8Array(d.data.buffer);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return { w: c.width, h: c.height, b64: btoa(bin) };
}, dataUrl);

const main = async () => {
  const b64 = readFileSync(resolve(img)).toString('base64');
  const dataUrl = `data:image/png;base64,${b64}`;
  const { browser, close } = await openBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const { w, h, b64: rgba64 } = await decode(page, dataUrl);
  await ctx.close();
  await close();

  const rgba = Buffer.from(rgba64, 'base64');
  const spec = analyzePixels(rgba, w, h, {
    inkTol: parseInt(arg('ink', '24'), 10),
    lineFill: parseFloat(arg('line', '0.5')),
  });
  const sum = summarize(spec);

  writeFileSync(join(outDir, 'image-spec.json'), JSON.stringify({ spec, summary: sum }, null, 2));

  const lines = [
    `# 图像取证`,
    ``,
    `- 来源：\`${img}\``,
    `- 尺寸：${w}×${h}`,
    `- 页面底色：rgb(${spec.pageBg.join(',')})　卡片底色：rgb(${spec.cardBg.join(',')})`,
    `- 内容盒：${spec.contentBox ? `${spec.contentBox.w}×${spec.contentBox.h} @ (${spec.contentBox.x}, ${spec.contentBox.y})` : '未检出'}`,
    `- 分隔线：${spec.separators.map((s) => s.y).join(', ') || '无'}`,
    ``,
    `| # | y | 高 | 底色 | 列簇（x, 宽） |`,
    `|---|---|---|---|---|`,
    ...spec.bands.map((b, i) => `| ${i} | ${b.y0} | ${b.height} | rgb(${b.bg.join(',')}) | ${b.columns.map((c) => `${c.start}(${c.end - c.start + 1})`).join(', ')} |`),
  ];
  writeFileSync(join(outDir, 'image-spec.md'), lines.join('\n'));

  console.log(`尺寸 ${w}×${h}　内容盒 ${spec.contentBox ? `${spec.contentBox.w}×${spec.contentBox.h} @ (${spec.contentBox.x},${spec.contentBox.y})` : '未检出'}`);
  console.log(`分隔线 ${spec.separators.length} 条：${spec.separators.map((s) => s.y).join(', ')}`);
  console.log(`分带 ${spec.bands.length} 段，行高：${spec.bands.map((b) => b.height).join(', ')}`);
  spec.bands.slice(0, 6).forEach((b, i) => {
    console.log(`  #${i} y=${b.y0} h=${b.height} 列：${b.columns.map((c) => `${c.start}(${c.end - c.start + 1})`).join(' ')}`);
  });
  console.log(`输出：${join(outDir, 'image-spec.md')}`);
};

main().catch((e) => { console.error('IMAGE SPEC FAILED:', e.message); process.exit(1); });
