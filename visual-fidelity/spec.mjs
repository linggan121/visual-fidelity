// 取证：从可渲染页面量出几何与样式，输出 spec.md / spec.json
// 用法：node spec.mjs --url <page> --root ".card" [--clip x,y,w,h] [--depth 3]
import { openBrowser } from './probe/browser.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSpec } from './probe/spec.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };

const url = arg('url');
const root = arg('root', 'body');
const depth = parseInt(arg('depth', '3'), 10);
const clipArg = arg('clip', null);
const clip = clipArg ? (() => { const [x, y, w, h] = clipArg.split(',').map(Number); return { x, y, width: w, height: h }; })() : null;
const outDir = resolve(arg('out', join(HERE, 'out', 'spec')));
if (!url) { console.error('need --url'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const isUrl = /^https?:/i.test(url);

const main = async () => {
  const { browser, close } = await openBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  if (isUrl) await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  else await page.goto('file:///' + resolve(url).replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  const spec = await extractSpec(page, { root, depth, clip });
  await close();

  if (spec.error) { console.error(spec.error); process.exit(1); }

  writeFileSync(join(outDir, 'spec.json'), JSON.stringify(spec, null, 2));
  const lines = [
    `# 取证规格`,
    ``,
    `- 来源：\`${url}\``,
    `- 根节点：\`${root}\` → ${spec.rootRect.w}×${spec.rootRect.h} @ (${spec.rootRect.x}, ${spec.rootRect.y})`,
    `- 深度：${depth}，节点数：${spec.nodes.length}`,
    ``,
    `| 深度 | 元素 | 位置 | 尺寸 | 字体 | 圆角 | 内边距 | 间距 | 文本 |`,
    `|---|---|---|---|---|---|---|---|---|`,
    ...spec.nodes.map((n) => `| ${n.depth} | \`${n.tag}${n.cls ? '.' + n.cls : ''}\` | ${n.x},${n.y} | ${n.w}×${n.h} | ${n.font} | ${n.radius} | ${n.pad} | ${n.gap} | ${n.text ? n.text.replace(/\|/g, '\\|') : ''} |`),
  ];
  writeFileSync(join(outDir, 'spec.md'), lines.join('\n'));
  console.log(`nodes: ${spec.nodes.length}`);
  console.log(`root: ${spec.rootRect.w}x${spec.rootRect.h} at ${spec.rootRect.x},${spec.rootRect.y}`);
  console.log(`spec: ${join(outDir, 'spec.md')}`);
};

main().catch((e) => { console.error('SPEC FAILED:', e.message); process.exit(1); });
