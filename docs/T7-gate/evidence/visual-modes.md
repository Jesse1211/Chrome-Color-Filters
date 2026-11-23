# T7 · 四个滤镜在真实网页上的视觉证据

> §6 T7【新增】:「四个滤镜在真实网页上视觉正确(截图留档,
> **供人类复核色彩矩阵是否合理**)」。
>
> 🔴 **机器只能判「生效了 / 变了 / 灰不灰」—— 矩阵是否*合理*必须由人看。**
> 请逐张对比同一站点的 OFF 与四个模式,确认:
> 1. 布局与 OFF 完全一致(INV-1;几何另有 `docs/T4a-gate/geometry.cjs` 的机械门禁);
> 2. 三种 daltonization 模式**重映射**了色彩而非抹掉色彩;
> 3. 文字与背景的对比度没有被破坏到不可读;
> 4. Ishihara 检测图(wikipedia 页内)在对应模式下的变化方向合理。

生成时间:2026-11-23T13:05:21.852Z

| 站点 | 模式 | 截图 | maxSpread | 有彩像素比 | 与 OFF 平均差 |
|---|---|---|---|---|---|
| wikipedia | OFF | [wikipedia-00-OFF.png](visual/wikipedia-00-OFF.png) | 178 | 0.0596 | — |
| wikipedia | Grayscale | [wikipedia-Grayscale.png](visual/wikipedia-Grayscale.png) | 0 | 0 | 2.14 |
| wikipedia | RedGreen | [wikipedia-RedGreen.png](visual/wikipedia-RedGreen.png) | 134 | 0.0584 | 0.93 |
| wikipedia | GreenRed | [wikipedia-GreenRed.png](visual/wikipedia-GreenRed.png) | 208 | 0.0611 | 0.42 |
| wikipedia | BlueYellow | [wikipedia-BlueYellow.png](visual/wikipedia-BlueYellow.png) | 95 | 0.0548 | 1.23 |
| hn | OFF | [hn-00-OFF.png](visual/hn-00-OFF.png) | 255 | 0.0217 | — |
| hn | Grayscale | [hn-Grayscale.png](visual/hn-Grayscale.png) | 0 | 0 | 3.98 |
| hn | RedGreen | [hn-RedGreen.png](visual/hn-RedGreen.png) | 255 | 0.0217 | 0 |
| hn | GreenRed | [hn-GreenRed.png](visual/hn-GreenRed.png) | 255 | 0.0221 | 16.35 |
| hn | BlueYellow | [hn-BlueYellow.png](visual/hn-BlueYellow.png) | 255 | 0.0217 | 0 |

## 判读提示

- `maxSpread` = 整图单像素 RGB 通道极差的最大值。**Grayscale 必为 0**。
- `有彩像素比` = 通道极差 > 8 的采样像素占比。辅助模式应**显著大于 0**
  —— 若接近 0,说明该模式把页面灰化了,矩阵有误。
- `与 OFF 平均差` = 与无滤镜基线的平均逐通道差。应显著大于 0,否则滤镜没起作用。
