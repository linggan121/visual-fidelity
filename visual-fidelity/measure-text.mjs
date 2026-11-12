// 文本定位诊断：比较参考与实现里同一段文字的布局盒与字形盒
// 用法：node measure-text.mjs --ref <page> --impl <page> --sel ".cfg-n" [--clip x,y,w,h]
import { openBrowser } from './probe/browser.mjs';
import { resolve } from 'node:path';

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const refArg = arg('ref'); const implArg = arg('impl'); const sel = arg('sel', '.cfg-n');
const clipArg = arg('clip', null);
const clip = clipArg ? (() => { const [x, y, width, height] = clipArg.split(',').map(Number); return { x, y, width, height }; })() : null;
if (!refArg || !implArg) { console.error('need --ref and --impl'); process.exit(2); }

const toTarget = (v) => (/^https?:/i.test(v) ? { type: 'url', value: v } : { type: 'file', value: resolve(v) });

const probe = async (page) => page.evaluate(({ sel, clip }) => {
  const el = document.querySelector(sel);
  if (!el) return { error: `not found: ${sel}` };
  const cs = getComputedStyle(el);
  const er = el.getBoundingClientRect();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = null;
  while ((node = walker.nextNode())) if (node.textContent.trim()) break;
  let range = null;
  if (node) {
    const r = document.createRange();
    r.selectNodeContents(node);
    const rr = r.getBoundingClientRect();
    range = { top: +(rr.top - (clip ? clip.y : 0)).toFixed(2), height: +rr.height.toFixed(2), left: +(rr.left - (clip ? clip.x : 0)).toFixed(2), width: +rr.width.toFixed(2) };
  }
  // 用 canvas 量同一字体的度量，判断基线来源
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = ctx.measureText('子类月搜索量');
  return {
    el: {
      top: +(er.top - (clip ? clip.y : 0)).toFixed(2),
      left: +(er.left - (clip ? clip.x : 0)).toFixed(2),
      w: +er.width.toFixed(2), h: +er.height.toFixed(2),
    },
    style: { fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily, display: cs.display, alignItems: cs.alignItems },
    range,
    metrics: { ascent: +m.actualBoundingBoxAscent.toFixed(2), descent: +m.actualBoundingBoxDescent.toFixed(2), width: +m.width.toFixed(2) },
  };
}, { sel, clip });

const main = async () => {
  const { browser, close } = await openBrowser();
  const out = {};
  for (const [name, target] of [['ref', refArg], ['impl', implArg]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const t = toTarget(target);
    if (t.type === 'url') await page.goto(t.value, { waitUntil: 'load' });
    else await page.goto('file:///' + t.value.replace(/\\/g, '/'), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    out[name] = await probe(page);
    await ctx.close();
  }
  await close();

  console.log(JSON.stringify(out, null, 2));
  const a = out.ref, b = out.impl;
  if (a.range && b.range) {
    console.log(`\n范围盒: top 差 ${(b.range.top - a.range.top).toFixed(2)}px, height 差 ${(b.range.height - a.range.height).toFixed(2)}px`);
    console.log(`元素盒: top 差 ${(b.el.top - a.el.top).toFixed(2)}px, h 差 ${(b.el.h - a.el.h).toFixed(2)}px`);
    console.log(`字体度量: ascent 差 ${(b.metrics.ascent - a.metrics.ascent).toFixed(2)}, descent 差 ${(b.metrics.descent - a.metrics.descent).toFixed(2)}, width 差 ${(b.metrics.width - a.metrics.width).toFixed(2)}`);
    console.log(`line-height: ref ${a.style.lineHeight} / impl ${b.style.lineHeight}`);
  }
};

main().catch((e) => { console.error('MEASURE FAILED:', e.message); process.exit(1); });
