// 检查项：单一定义，生产路径与测试共用同一份实现
// 规范来源：protocol.md 第 5 节。每条检查必须有：判定代码、反例样本、设备上下文。

// 在页面上下文里执行（会被序列化传给 page.evaluate，不能引用外部变量）
export function runChecks() {
  const out = [];
  const push = (id, ok, detail) => out.push({ id, ok, detail });
  const text = document.body.innerText;

  const emoji = text.match(/\p{Extended_Pictographic}/gu);
  push('no-emoji', !emoji, emoji ? emoji.join('') : 'none');

  const grads = [...document.querySelectorAll('*')]
    .map((el) => getComputedStyle(el).backgroundImage)
    .filter((bg) => bg.includes('gradient'));
  const purple = grads.filter((bg) => {
    const nums = bg.match(/rgba?\(([^)]+)\)/g) || [];
    const hues = nums.map((s) => {
      const [r, g, b] = s.replace(/rgba?\(|\)/g, '').split(',').map(Number);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max === min) return -1;
      let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      h = (h * 60 + 360) % 360;
      const sat = (max - min) / (255 - Math.abs(max + min - 255) || 1);
      return sat > 0.45 && h >= 250 && h <= 290 ? h : -1;
    });
    return hues.some((h) => h >= 0);
  });
  push('no-default-purple-gradient', purple.length === 0, purple[0]?.slice(0, 60) || 'none');

  const small = [...document.querySelectorAll('input,select,textarea')]
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
    .map((el) => getComputedStyle(el).fontSize);
  push('input-font-16', small.length === 0, small.slice(0, 3).join(',') || 'ok');

  const tap = [...document.querySelectorAll('button,a,input[type=submit]')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
    .map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`);
  push('tap-target-44', tap.length === 0, tap.slice(0, 3).join(',') || 'ok');

  push('no-h-overflow', document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    `scroll=${document.documentElement.scrollWidth} client=${document.documentElement.clientWidth}`);

  const raster = [...document.querySelectorAll('img')]
    .filter((i) => /\.(png|jpe?g|webp|gif)$/i.test(i.currentSrc || i.src) && i.width <= 32);
  push('icons-are-svg', raster.length === 0, `${raster.length} raster icon(s)`);

  const ph = text.match(/lorem ipsum|example\.com|your text here/gi);
  push('no-placeholder-copy', !ph, ph ? ph.slice(0, 2).join(',') : 'none');

  const pills = [...document.querySelectorAll('*')]
    .filter((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) >= 16 && el.getBoundingClientRect().height > 40);
  push('no-pill-pile', pills.length <= 2, `${pills.length} elements with radius>=16`);

  return out;
}

// 每个检查项的最小反例：只违反这一条，其余保持干净
export const COUNTER_EXAMPLES = {
  'no-emoji': `<p>发布成功 🚀</p>`,
  'no-default-purple-gradient': `<div style="height:60px;background:linear-gradient(135deg,#6366f1,#8b5cf6)"></div>`,
  'input-font-16': `<input placeholder="邮箱" style="font-size:13px;padding:8px">`,
  'tap-target-44': `<button style="padding:0;width:40px;height:24px;border:0">x</button>`,
  'no-h-overflow': `<div style="width:1600px;height:8px;background:#eee"></div>`,
  'icons-are-svg': `<img src="icon.png" width="16" height="16" alt="">`,
  'no-placeholder-copy': `<p>lorem ipsum dolor sit amet</p>`,
  'no-pill-pile': `<div style="height:60px;border-radius:20px;background:#eee;margin:4px 0"></div>`.repeat(4),
};

// 干净样本：所有检查必须同时通过，用来证明不误报
export const CLEAN_FIXTURE = `
  <h1>正常页面</h1>
  <p>一段普通文案，没有占位符，也没有表情符号。</p>
  <input placeholder="邮箱" style="font-size:16px;padding:10px;width:200px">
  <button style="padding:12px 20px;min-height:44px;min-width:44px">提交</button>
  <div style="height:60px;border-radius:12px;background:#f4f4f6"></div>
`;
