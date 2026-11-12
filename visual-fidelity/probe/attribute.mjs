// 归因：把结构性差异像素分配到具体的 DOM 节点
// 纯函数，可在 Node 里单测；浏览器只负责输出位图（见 probe/diff.mjs）
// 规范来源：protocol.md 第 2 节 E1/E2 与第 11 节

const bitAt = (buf, p) => (buf[p >> 3] >> (p & 7)) & 1;

// 把位图与盒子列表对齐：每个像素归属"包含它的最小盒子"
export function attributeByBoxes(maskBuf, w, h, boxes) {
  const owners = new Int32Array(w * h).fill(-1);

  // 面积大的先画，小的后画覆盖上去 → 最内层胜出
  const order = boxes
    .map((b, i) => ({ i, area: Math.max(0, b.w) * Math.max(0, b.h) }))
    .sort((a, b) => b.area - a.area);

  for (const { i } of order) {
    const b = boxes[i];
    const x0 = Math.max(0, Math.min(w, Math.round(b.x)));
    const y0 = Math.max(0, Math.min(h, Math.round(b.y)));
    const x1 = Math.max(0, Math.min(w, Math.round(b.x + b.w)));
    const y1 = Math.max(0, Math.min(h, Math.round(b.y + b.h)));
    for (let y = y0; y < y1; y++) {
      const row = y * w;
      for (let x = x0; x < x1; x++) owners[row + x] = i;
    }
  }

  const counts = new Int32Array(boxes.length);
  let total = 0, outside = 0;
  for (let p = 0; p < w * h; p++) {
    if (!bitAt(maskBuf, p)) continue;
    total++;
    const o = owners[p];
    if (o < 0) outside++;
    else counts[o]++;
  }

  const items = boxes.map((b, i) => {
    const area = Math.max(1, Math.round(b.w) * Math.round(b.h));
    return {
      role: b.role, index: b.index, text: b.text || '',
      x: b.x, y: b.y, w: b.w, h: b.h,
      diffPixels: counts[i],
      area,
      density: counts[i] / area,
      share: total ? counts[i] / total : 0,
    };
  }).filter((it) => it.diffPixels > 0)
    .sort((a, b) => b.diffPixels - a.diffPixels);

  return { total, outside, items };
}

// 从浏览器返回的 base64 位图还原成 Buffer（Node 侧）
export function decodeMask(b64) {
  return Buffer.from(b64, 'base64');
}

// 归类：文本节点、控件、容器，便于阅读
export function bucketOf(role) {
  if (role === 'heading') return '文本';
  if (role === 'control') return '控件';
  if (role === 'field') return '输入';
  return '容器';
}
