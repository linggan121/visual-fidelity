// 图像取证：从一张截图里量出可比较的数字（行高、列位、颜色、内容盒）
// 设计：浏览器只负责把 PNG 解成 RGBA，分析算法是纯函数，可在 Node 里单测。
// 规范来源：protocol.md 第 1 节（图源模式的取证要求）

const dist = (r, g, b, c) => Math.abs(r - c[0]) + Math.abs(g - c[1]) + Math.abs(b - c[2]);

// 用浏览器把 PNG 解成 RGBA（唯一的浏览器依赖，算法本身是纯函数）
export async function decodePng(page, dataUrl) {
  return page.evaluate(async (src) => {
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
}

// 取像素颜色
const px = (data, w, x, y) => {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

// 主色：对采样点做桶计数
export function dominantColor(data, w, h, region) {
  const { x0 = 0, y0 = 0, x1 = w, y1 = h } = region ?? {};
  const buckets = new Map();
  const stepX = Math.max(1, Math.floor((x1 - x0) / 40));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 40));
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const [r, g, b] = px(data, w, x, y);
      const k = `${r >> 3},${g >> 3},${b >> 3}`;
      const v = buckets.get(k) ?? { n: 0, r, g, b };
      v.n++;
      buckets.set(k, v);
    }
  }
  let best = null;
  for (const v of buckets.values()) if (!best || v.n > best.n) best = v;
  return best ? [best.r, best.g, best.b] : [255, 255, 255];
}

// 像素级分析：分隔线、内容盒、列簇、分带主色
export function analyzePixels(data, w, h, opts = {}) {
  const {
    inkTol = 24,          // 与底色差多少算"有内容"
    lineFill = 0.5,       // 一行中有内容像素占比超过它 → 视作分隔线
    clusterGap = 12,      // 列簇合并的最大间隔
    bandFill = 0.02,      // 一列中有内容像素占比超过它 → 视作有内容
  } = opts;

  const pageBg = px(data, w, 0, 0).slice(0, 3);
  const cardBg = dominantColor(data, w, h, { x0: Math.floor(w / 4), y0: Math.floor(h / 2), x1: Math.floor((3 * w) / 4), y1: h });

  // 内容盒：与页面底色不同的像素的包围盒
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(data, w, x, y);
      if (a < 8) continue;
      if (dist(r, g, b, pageBg) > inkTol) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const contentBox = maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;

  // 分隔线：整行有内容像素占比高
  const separators = [];
  for (let y = 0; y < h; y++) {
    let ink = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(data, w, x, y);
      if (dist(r, g, b, cardBg) > inkTol) ink++;
    }
    if (ink / w > lineFill) separators.push(y);
  }
  // 合并相邻行
  const merged = [];
  for (const y of separators) {
    if (merged.length && y - merged[merged.length - 1].end <= 1) merged[merged.length - 1].end = y;
    else merged.push({ start: y, end: y });
  }

  // 分带：分隔线之间的内容区（分隔线本身不计入带高）
  const segments = [];
  let segStart = minY ?? 0;
  for (const m of merged) {
    if (m.start - 1 >= segStart) segments.push({ y0: segStart, y1: m.start - 1 });
    segStart = m.end + 1;
  }
  if ((maxY ?? h - 1) >= segStart) segments.push({ y0: segStart, y1: maxY ?? h - 1 });

  const bands = [];
  for (const seg of segments) {
    const y0 = seg.y0, y1 = seg.y1;
    if (y1 - y0 < 2) continue;
    // 列簇
    const cols = [];
    for (let x = 0; x < w; x++) {
      let ink = 0;
      for (let y = y0; y < y1; y++) {
        const [r, g, b] = px(data, w, x, y);
        if (dist(r, g, b, cardBg) > inkTol) ink++;
      }
      if (ink / (y1 - y0) > bandFill) cols.push(x);
    }
    const clusters = [];
    for (const x of cols) {
      if (clusters.length && x - clusters[clusters.length - 1].end <= clusterGap) clusters[clusters.length - 1].end = x;
      else clusters.push({ start: x, end: x });
    }
    bands.push({ y0, y1, height: y1 - y0 + 1, columns: clusters, bg: dominantColor(data, w, h, { x0: Math.floor(w * 0.45), y0, x1: Math.floor(w * 0.55), y1 }) });
  }

  return {
    size: { w, h },
    pageBg, cardBg, contentBox,
    separators: merged.map((m) => ({ y: m.end, thickness: m.end - m.start + 1 })),
    bands,
  };
}

// 把分析结果和假设的"内容列"对齐，给出可直接用于实现的坐标表
export function summarize(spec) {
  return {
    card: spec.contentBox,
    rowHeights: spec.bands.map((b) => b.height),
    rows: spec.bands.map((b) => ({ y: b.y0, h: b.height, columns: b.columns.map((c) => ({ x: c.start, w: c.end - c.start + 1 })) })),
    colors: { pageBg: spec.pageBg, cardBg: spec.cardBg, bandBgs: spec.bands.map((b) => b.bg) },
  };
}
