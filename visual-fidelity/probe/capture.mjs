// 页面采集：截图 + computed style + 检查 + 控制台错误 + 文本包围盒 + 几何清单
import { extractSpec } from './spec.mjs';
import { runChecks } from './checks.mjs';

export async function capture(browser, target, opts = {}) {
  const { viewport = { width: 1280, height: 800 }, dpr = 1, fullPage = false, selectors = [':root'], clip = null, specRoot = null, specDepth = 4 } = opts;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  const t0 = Date.now();
  if (target.type === 'html') await page.setContent(target.value, { waitUntil: 'load' });
  else if (target.type === 'file') await page.goto('file:///' + target.value.replace(/\\/g, '/'), { waitUntil: 'load' });
  else await page.goto(target.value, { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const renderMs = Date.now() - t0;

  const styles = await page.evaluate(({ sels, clip }) => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        sel, fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing, fontFamily: cs.fontFamily.slice(0, 48),
        color: cs.color, radius: cs.borderTopLeftRadius,
        w: Math.round(r.width), h: Math.round(r.height),
        top: Math.round(r.top - (clip ? clip.y : 0)),
        left: Math.round(r.left - (clip ? clip.x : 0)),
      };
    };
    const out = {};
    for (const s of sels) out[s] = pick(s);
    return out;
  }, { sels: selectors, clip });

  const checks = await page.evaluate(runChecks);

  const textRects = await page.evaluate((clip) => {
    const rects = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent || !n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        rects.push({
          x: Math.round(r.left - (clip ? clip.x : 0)),
          y: Math.round(r.top - (clip ? clip.y : 0)),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return rects;
  }, clip);

  const png = await page.screenshot(clip ? { clip } : { fullPage });
  const spec = specRoot ? await extractSpec(page, { root: specRoot, depth: specDepth, clip }) : null;
  await ctx.close();
  return { styles, checks, errors, renderMs, textRects, spec, png: png.toString('base64') };
}
