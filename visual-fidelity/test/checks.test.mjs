// 检查项反例测试：每条检查必须在对应反例上失败，在干净样本上全部通过
// 需要浏览器：由宿主起 Edge 后连 CDP。用法：
//   node test/checks.test.mjs
import { openBrowser } from '../probe/browser.mjs';
import { runChecks, COUNTER_EXAMPLES, CLEAN_FIXTURE } from '../probe/checks.mjs';

const VIEWPORT = { width: 800, height: 600 };

const main = async () => {
  const { browser, close } = await openBrowser().catch((e) => {
    console.error('无法启动或连接浏览器:', e.message);
    process.exit(2);
  });

  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const checkOn = async (html) => {
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
      <style>body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;margin:0;font-size:16px}</style>
      </head><body>${html}</body></html>`, { waitUntil: 'load' });
    return page.evaluate(runChecks);
  };

  let pass = 0, fail = 0;
  const ok = (name) => { pass++; console.log(`PASS  ${name}`); };
  const bad = (name, why) => { fail++; console.log(`FAIL  ${name}\n      ${why}`); };

  // 1. 干净样本：全部通过，证明不误报
  const clean = await checkOn(CLEAN_FIXTURE);
  const falsePositives = clean.filter((c) => !c.ok);
  if (falsePositives.length === 0) ok(`干净样本全部通过（${clean.length} 项）`);
  else bad('干净样本存在误报', falsePositives.map((c) => `${c.id}(${c.detail})`).join(', '));

  // 2. 每个反例：只应触发对应那一项
  for (const [id, html] of Object.entries(COUNTER_EXAMPLES)) {
    const results = await checkOn(html);
    const target = results.find((c) => c.id === id);
    if (!target) { bad(`${id} 未出现在检查结果里`, '检查项缺失'); continue; }
    if (target.ok) { bad(`${id} 未命中反例`, `详情: ${target.detail}`); continue; }

    // 反例应尽量"只犯这一条"，避免测试本身互相污染
    const collateral = results.filter((c) => c.id !== id && !c.ok).map((c) => c.id);
    if (collateral.length === 0) ok(`${id} 命中反例，无连带失败`);
    else ok(`${id} 命中反例（连带: ${collateral.join(', ')}）`);
  }

  await ctx.close();
  await close();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
};

main().catch((e) => { console.error('CHECKS TEST FAILED:', e.message); process.exit(1); });
