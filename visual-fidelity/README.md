# 视觉还原

把设计稿或参考页面还原成前端实现，并用**像素、几何、归因**三层证据给出可复核的判决。

判决由工具给出，不由自我评价给出。

## 环境要求

- Node.js 18+
- 系统装有 Edge 或 Chrome（不下载浏览器，直接用系统已有的）
- 唯一依赖：`playwright-core`

```bash
pnpm add playwright-core     # 或 npm i playwright-core
```

Windows / macOS / Linux 都可用。浏览器由 Node 自己拉起并通过 CDP 接管；在受限沙箱里首次运行需要授权一次，因为 Chromium 启动要创建命名管道。

连接外部已启动的浏览器时设 `CDP_URL`；浏览器不在标准路径时用 `BROWSER_PATH` 指定。

## 快速开始

```bash
# 1. 取证：图源模式必做；页面模式可跳过
node image-spec.mjs --img 参考.png

# 2. 一次完整对比：渲染 → 配对 → 归因 → 两维判决 → 报告
node run.mjs --ref 参考.png --impl 实现.html --width 1440 --root ".card"

# 页面参考（证据更强，能读 computed style）
node run.mjs --ref 参考页.html --impl 实现.html --root ".card" --device touch

# 3. 卡住时按顺序排查
node text-width.mjs --ref out/ref.png --impl out/impl.png        # 是字号/字重/字族吗
node measure-text.mjs --ref 参考页 --impl 实现页 --sel ".label"    # 是亚像素偏移吗
```

产物写入 `out/<运行名>/`：`ref.png`、`impl.png`、`heatmap.png`、`geometry.md`、`attribution.md`、`report.md`、`report.json`。

退出码：`0` 正常、`2` 参数错误、`3` NOT READY、`4` UNVERIFIED、`1` 运行失败。

## 两种参考形态

| 形态 | 你能拿到 | 判决上限 |
|---|---|---|
| **图源**（只有图） | 像素、图像取证得到的几何 | `READY WITH SUBSTITUTIONS` |
| **页源**（可渲染） | 上述 + computed style + 行为 | `READY` |

图源模式拿不到样式证据，所以永不给 `READY`——这是硬约束，写在判决函数里。
差异集中在文本区且无法再压时，可显式声明地板证据，拿到 `READY WITH DECLARED FLOOR`（见 `protocol.md` 第 11.3 节）。

## 目录

```
SKILL.md          技能入口：规则、用法、判决、失败诊断
protocol.md       唯一规范来源：22 条规则 + 自洽性对照表
run.mjs           一次运行完成对比与判决
spec.mjs          页源取证（几何 + 样式）
image-spec.mjs    图源取证（分隔线、行高、列位、配色）
text-width.mjs    字宽诊断（区分字号 / 字重 / 字族）
measure-text.mjs  文本定位诊断（亚像素偏移）
compare-spec.mjs  规格对规格比对
probe/            探针模块：browser capture diff spec attribute checks verdict image-spec text-width
test/             离线单测 + 浏览器端反例
```

## 测试

```bash
node test/verdict.test.mjs      # 判决逻辑
node test/pair.test.mjs         # 角色配对
node test/attribute.test.mjs    # 差异归因
node test/image-spec.test.mjs   # 图像取证
node test/text-width.test.mjs   # 字宽诊断
node test/checks.test.mjs       # 检查项反例（自己起浏览器）
```

## 已知边界

- **字形栅格地板**：文字宽度、位置、颜色都对齐后，笔画像素仍会不同。报告给出集中度（文本面积占比 vs 差异贡献占比），超过 3 倍即标注。这是度量下限，不是实现缺陷。
- **沙箱环境**：起不了浏览器时只做静态检查，判决为 `UNVERIFIED`，不会静默通过。
- **单页**：按一张参考做一屏或一个组件。不做站点级巡检。

## 不做什么

不做可视化对比界面、不做自动修复循环、不做多页面爬取、不做设计 token 生成器、不做检查项插件机制、不引入图像处理库。理由都写在 `protocol.md` 的自洽性对照表与各节里——每一条都对应一个可验证的取舍。

## 许可证

MIT，见 `LICENSE`。可自由使用、修改、再分发，保留版权声明即可。
