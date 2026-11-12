// 字宽比对：量每段文字的墨水包围盒，判断是字号、字重还是字族差异
// 纯函数，可在 Node 里单测；浏览器只负责解码 PNG。
// 规范来源：protocol.md 第 2 节 E1/E2，第 6 节配对思想

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// 区域内墨迹包围盒：与区域底色差超过阈值的像素算墨迹
export function inkBox(data, w, h, region, opts = {}) {
  const { tol = 40 } = opts;
  const x0 = Math.max(0, Math.floor(region.x0));
  const y0 = Math.max(0, Math.floor(region.y0));
  const x1 = Math.min(w - 1, Math.floor(region.x1));
  const y1 = Math.min(h - 1, Math.floor(region.y1));
  if (x1 < x0 || y1 < y0) return null;

  // 区域底色：优先取四角一致的亮度（文字很少同时盖住四个角），四角不一时退回主色
  const cornerKeys = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => {
    const i = (y * w + x) * 4;
    return Math.round(lum(data[i], data[i + 1], data[i + 2]) / 16);
  });
  const cornerVotes = new Map();
  for (const k of cornerKeys) cornerVotes.set(k, (cornerVotes.get(k) ?? 0) + 1);

  const buckets = new Map();
  const stepX = Math.max(1, Math.floor((x1 - x0) / 24));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 24));
  for (let y = y0; y <= y1; y += stepY) {
    for (let x = x0; x <= x1; x += stepX) {
      const i = (y * w + x) * 4;
      const k = Math.round(lum(data[i], data[i + 1], data[i + 2]) / 16);
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
  }
  const ranked = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  const cornerPick = [...cornerVotes.entries()].sort((a, b) => b[1] - a[1])[0];
  // 四角至少两个一致时才采信四角，否则用主色
  const bgKey = cornerPick[1] >= 2 ? cornerPick[0] : ranked[0][0];
  const bg = bgKey * 16;

  let minX = x1 + 1, minY = y1 + 1, maxX = -1, maxY = -1, count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      const l = lum(data[i], data[i + 1], data[i + 2]);
      if (Math.abs(l - bg) > tol) {
        count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, ink: count };
}

// 对数个区域做两侧比对
export function compareRegions(refData, implData, w, h, regions, opts = {}) {
  const out = [];
  for (const r of regions) {
    const a = inkBox(refData, w, h, r, opts);
    const b = inkBox(implData, w, h, r, opts);
    if (!a || !b) { out.push({ ...r, status: 'missing', refW: a?.w ?? null, implW: b?.w ?? null }); continue; }
    out.push({
      ...r,
      status: 'ok',
      refW: a.w, implW: b.w,
      dW: b.w - a.w,
      ratio: a.w ? b.w / a.w : null,
      dX: b.x - a.x, dY: b.y - a.y,
      refH: a.h, implH: b.h,
    });
  }
  return out;
}

// 判断倾向：等比偏差 → 字号/字族；非等比 → 字重或局部字距
export function diagnosis(rows) {
  const valid = rows.filter((r) => r.status === 'ok' && r.refW >= 8);
  if (valid.length < 2) return { kind: 'insufficient', note: '样本不足，至少需要两段文字' };
  const ratios = valid.map((r) => r.ratio);
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const spread = Math.max(...ratios) - Math.min(...ratios);

  if (Math.abs(mean - 1) < 0.01) return { kind: 'match', mean, spread, note: '宽度基本一致，差异应来自位置或颜色' };
  if (spread < 0.03) return { kind: 'uniform', mean, spread, note: `等比偏差 ${(mean * 100 - 100).toFixed(1)}%：字号或字族不同（不是字重）` };
  return { kind: 'nonuniform', mean, spread, note: `偏差不一致（幅度 ${(spread * 100).toFixed(1)}%）：更像字重、字距或个别字符回退` };
}
