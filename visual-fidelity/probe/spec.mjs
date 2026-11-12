// 取证与配对：把一侧页面量成几何清单，再把两侧按角色对齐
// 规范来源：protocol.md 第 2 节（E2 几何）与第 6 节（配对按角色）

// 角色归类：类名优先，语义标签兜底。目的是让"同一角色的元素"能跨不同 DOM 结构对齐。
export function roleOf(node) {
  const tag = node.tag;
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'button' || tag === 'a') return 'control';
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return 'field';
  const first = (node.cls || '').split('.').filter(Boolean)[0];
  if (first) return `cls:${first}`;
  return `tag:${tag}`;
}

// 在页面里量一组节点（含子树），坐标以 clip 原点为基准
export async function extractSpec(page, { root = 'body', depth = 3, clip = null } = {}) {
  return page.evaluate(({ rootSel, maxDepth, clip }) => {
    const rootEl = document.querySelector(rootSel);
    if (!rootEl) return { error: `root not found: ${rootSel}` };
    const out = [];
    const walk = (el, d) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const cs = getComputedStyle(el);
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(' ')
        .trim();
      out.push({
        depth: d,
        tag: el.tagName.toLowerCase(),
        cls: (el.className && typeof el.className === 'string') ? el.className.split(/\s+/).filter(Boolean).join('.') : '',
        text: own.slice(0, 24),
        x: Math.round(r.left - (clip ? clip.x : 0)),
        y: Math.round(r.top - (clip ? clip.y : 0)),
        w: Math.round(r.width),
        h: Math.round(r.height),
        font: `${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`,
        color: cs.color,
        radius: cs.borderTopLeftRadius,
        pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        gap: cs.gap === 'normal' ? '' : cs.gap,
      });
      if (d < maxDepth && el.tagName.toLowerCase() !== 'svg') for (const c of el.children) walk(c, d + 1);
    };
    walk(rootEl, 0);
    const rr = rootEl.getBoundingClientRect();
    return {
      nodes: out,
      rootRect: {
        x: Math.round(rr.left - (clip ? clip.x : 0)),
        y: Math.round(rr.top - (clip ? clip.y : 0)),
        w: Math.round(rr.width),
        h: Math.round(rr.height),
      },
    };
  }, { rootSel: root, maxDepth: depth, clip });
}

// 给节点打上 (角色, 序号) 标签，配对与归因共用同一套编号
export function assignRoles(nodes = []) {
  const counter = new Map();
  return nodes.map((n) => {
    const role = roleOf(n);
    const index = counter.get(role) ?? 0;
    counter.set(role, index + 1);
    return { ...n, role, index };
  });
}

// 按角色 + 出现顺序配对。配不上的标 unmatched，绝不参与差值。
export function pairSpecs(refNodes = [], implNodes = [], tol = 1) {
  const a = assignRoles(refNodes);
  const b = assignRoles(implNodes);
  const group = (nodes) => {
    const m = new Map();
    for (const n of nodes) {
      if (!m.has(n.role)) m.set(n.role, []);
      m.get(n.role).push(n);
    }
    return m;
  };
  const refG = group(a);
  const implG = group(b);
  const roles = new Set([...refG.keys(), ...implG.keys()]);
  const pairs = [];

  for (const role of roles) {
    const x = refG.get(role) ?? [];
    const y = implG.get(role) ?? [];
    const n = Math.max(x.length, y.length);
    for (let i = 0; i < n; i++) {
      if (!x[i] || !y[i]) {
        pairs.push({ role, index: i, matched: false, side: x[i] ? 'ref-only' : 'impl-only', text: (x[i] || y[i]).text });
        continue;
      }
      pairs.push({
        role, index: i, matched: true,
        dx: y[i].x - x[i].x, dy: y[i].y - x[i].y,
        dw: y[i].w - x[i].w, dh: y[i].h - x[i].h,
        drift: (Math.abs(y[i].x - x[i].x) > tol || Math.abs(y[i].y - x[i].y) > tol
          || Math.abs(y[i].w - x[i].w) > tol || Math.abs(y[i].h - x[i].h) > tol),
        text: x[i].text,
      });
    }
  }
  return pairs;
}
