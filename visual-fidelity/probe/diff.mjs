// 像素 diff：浏览器内 canvas 完成，零图像库。
// 文本遮罩（protocol.md 第 11 节）：
//   - 遮罩内的小差异（<= maskThreshold）视为抗锯齿噪声，不计入判决
//   - 遮罩内的大差异（> maskThreshold）说明文字真的错位/错字，必须计入
export async function diffPng(browser, aB64, bB64, opts = {}) {
  const { threshold = 4, mask = null, maskThreshold = 24 } = opts;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.evaluate(async ({ a, b, th, mask, maskTh }) => {
    const load = (src) => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, w, h).data;
    g.clearRect(0, 0, w, h); g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, w, h).data;

    const inMask = new Uint8Array(w * h);
    let maskPixels = 0;
    if (mask && mask.length) {
      for (const r of mask) {
        const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
        const x1 = Math.min(w, r.x + r.w), y1 = Math.min(h, r.y + r.h);
        for (let y = y0; y < y1; y++) {
          const row = y * w;
          for (let x = x0; x < x1; x++) if (!inMask[row + x]) { inMask[row + x] = 1; maskPixels++; }
        }
      }
    }

    let structural = 0, unmaskedDiff = 0, textShift = 0, maskNoise = 0;
    let maxDelta = 0, sum = 0;
    const heat = g.createImageData(w, h);
    const total = w * h;
    const bits = new Uint8Array(Math.ceil(total / 8));

    for (let i = 0, p = 0; i < da.length; i += 4, p++) {
      const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
      sum += d;
      if (d > maxDelta) maxDelta = d;
      const masked = inMask[p] === 1;

      if (masked) {
        if (d > maskTh) { textShift++; structural++; bits[p >> 3] |= 1 << (p & 7); }
        else if (d > th) maskNoise++;
      } else {
        if (d > th) { unmaskedDiff++; structural++; bits[p >> 3] |= 1 << (p & 7); }
      }

      if (d > th) {
        const strong = d > maskTh;
        heat.data[i] = strong ? 255 : 255;
        heat.data[i + 1] = Math.max(0, 200 - d * 3);
        heat.data[i + 2] = 0;
        heat.data[i + 3] = masked && !strong ? 60 : 220;
      } else heat.data[i + 3] = 0;
    }
    g.putImageData(heat, 0, 0);

    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bits.length; i += CHUNK) bin += String.fromCharCode.apply(null, bits.subarray(i, i + CHUNK));

    return {
      w, h, totalPixels: total,
      structuralPixels: structural,
      ratio: structural / total,
      unmaskedRatio: unmaskedDiff / total,
      unmaskedPixels: unmaskedDiff,
      textShiftPixels: textShift,
      maskNoisePixels: maskNoise,
      maskPixels,
      maxDelta, meanDelta: sum / total,
      structuralMask: btoa(bin),
      heatmap: c.toDataURL('image/png'),
    };
  }, { a: `data:image/png;base64,${aB64}`, b: `data:image/png;base64,${bB64}`, th: threshold, mask, maskTh: maskThreshold });
  await ctx.close();
  return res;
}
