# 灰阶/去饱和有效性章节 — 事实核查（对抗式）

核查日期：2026-11-25。标签：[V-PRIMARY] 已从一手全文核实 / [V-SECONDARY] 仅二手或被一手文献引述 / [UNVERIFIED] 无法核实 / [WRONG] 原文有误。

**本轮最重要的四个结论（先读这段）**
1. Dekker & Baumgartner 全文已通过 UvA 开放仓库拿到 —— 所有数字逐条命中，且两个"load-bearing"主张都能用原文佐证。但"约半数觉得烦"是**错的**：烦人程度是全样本均值 5.39/7，而"约半数"对应的是「不愿再用」。两件事被合并了，必须拆开。
2. **PRIORITY 6 必须改写。** Dekker 的预注册假设 H2 预测 unlocks **会下降**，结果不显著。"会话变短但拿起次数不变"是作者在数据之后提出的解释，不是先验预测。原报告说"机制预测"属于 post-hoc 包装。
3. **PRIORITY 3 的 WCAG 主张需要加限定条件。** W3C 公式把 0.2126/0.7152/0.0722 用在**线性化后**的 sRGB 值上。只有同样在线性光域做的灰阶变换才严格保留对比度；在 gamma 编码值上直接加权（很多实现这么做）**不**保留。Apple/Android 的具体实现未公开文档化 → 这一限定必须写进报告。
4. Holte & Ferraro 的样本量争议**未能解决**（Sage/T&F/ResearchGate/ouci 全部 403）。73 与 ~220 两个数字都无法证实。建议降级为"约 38 分钟/天，样本量各二手来源不一致"或直接改引 Dekker 对它的转述。

---

## PRIORITY 1a — Dekker & Baumgartner (2024)

### Takeaway
通过 UvA 开放仓库拿到出版版全文，**所有送检数字全部正确**。但"约半数觉得烦"这一句是两个不同数据的混合，须修正。

### Cited Findings
- 开放获取全文（绕过 Sage 403）—— [UvA pure 全文 PDF](https://pure.uva.nl/ws/files/227312734/Is_life_brighter_when_your_phone_is_not.pdf)；[DARE 记录](https://dare.uva.nl/search?identifier=aabe2259-4c55-4b25-968f-43fbcdf1ed8e)
- **N=84，被试内，无对照组，2 周（第 1 周基线、第 2 周灰阶）** [V-PRIMARY]。原文："Participants' smartphone use was tracked for 2 weeks (N = 84). The first week served as a baseline measure"。实际纳入分析为 7 天基线 + 6 天干预；118 人安装 app，26 人中途退出，8 人未完成 T1 被排除。65% 女性，M_age=21.95 (SD=3.55)，**仅 Android 用户**。
- **屏幕时间 −20 分钟/天，d=0.51** [V-PRIMARY]。原文："t(84) = –2.34, p = .022, d = 0.51"；"screen time was reduced by approximately 20 min per day"。均值 287.24 → 267.50 分钟/天。
- **Unlocks 零结果，d=0.04** [V-PRIMARY]。"t(84) = 0.18, p = .860, d = 0.04"。均值 80.03 → 80.33。H2 未获支持。
- **睡眠零结果** [V-PRIMARY]："t(84) = –0.63, p = .529, d = 0.14"。**生产力零结果** [V-PRIMARY]："t(84) = 0.41, p = .686, d = 0.09"。
- **感知过度使用下降 d=0.81** [V-PRIMARY]："participants reported lower perceived overuse during the intervention week, t(84) = –3.72, p < .001, d = 0.81"。均值 3.71 → 3.33。
- **参与者未察觉自己的减少 —— 可用，且原文措辞比报告更强** [V-PRIMARY]。原文："Interestingly, although grayscaling reduced participants' objective screen time, they did not seem to be aware of that effect when asked whether grayscaling had reduced their screen time (M = 4.24, SD = 1.82)"。注意：这是 7 点量表上的中性均值（4.24≈"既不同意也不反对"），**不是**"参与者否认减少"。严谨表述应为"平均而言未表现出察觉"，并注明 SD 很大（作者自己指出 "varied evaluations"）。
- **"烦" = 全样本均值，不是"约半数"** [WRONG — 见下] [V-PRIMARY]："participants did not perceive the grayscaling mode as particularly 'helpful' (M = 3.66, SD = 1.81), but rather as 'annoying' (M = 5.39, SD = 1.63) yet 'easy to use' (M = 4.70, SD = 1.72)"。5.39/7 是**整个样本的平均烦人程度**，没有报告"百分之多少的人觉得烦"。
- **"约半数不愿再用" = 确有其事，且数字精确** [V-PRIMARY]："Half of the sample would never (31.3%) or rarely (20.0%) use it again, whereas a considerable proportion would use it always (2.5%), often (12.5%), or sometimes (27.5%). The remaining 6.3% did not know yet." 31.3+20.0 = 51.3%。
- 其他显著结果（报告可选用）：感知控制 d=0.79；在线警觉三维度 d=0.44/0.69/0.51；压力 d=0.68（唯一被证实的"大众媒体主张"）[V-PRIMARY]。
- 自报依从率 **M=89.73% (SD=19.29)** [V-PRIMARY]。
- **设备替代的反证** [V-PRIMARY]："Participants indicated that they did not use other devices more than normally because of the grayscale mode (M = 3.76, SD = 1.96)" —— 与 Myers 的 6% 方向一致（替代效应小）。
- 图像类 vs 文本/音频类 app 的调节作用**不显著**：t(252) = –0.93, p = .356, d = 0.05。H1b 未获支持。但均值差提示方向性（图像类 −16.29 分钟 vs 文本类 −3.08 分钟）[V-PRIMARY]。
- **作者自己的效应量克制表述**（强烈建议引用）[V-PRIMARY]："despite the medium effect size (d = 0.51), a reduction of 20 min may not be considered substantial when the average daily screen time is still over 4 hr per day"。

### Inferences
- 报告中"约半数觉得烦 / 不愿继续"应拆为两句：烦人程度全样本均值 5.39/7（偏烦）；51.3% 表示今后绝不或很少再用。把二者混为"约半数觉得烦"会被审稿人直接抓住。
- "未察觉"这一点非常适合支撑"灰阶绕过主观意识起作用"的论点，但要诚实标注它是中性均值而非否认。

### Gaps
- 原文未报告"烦人"评分的分布或切分比例，无法算出"X% 觉得烦"。

---

## PRIORITY 1b — Holte & Ferraro (2020), Social Science Journal 60(2):274-290

### Takeaway
**样本量争议未解决。** 一手全文在本轮所有合法开放路径上均 403（T&F、ResearchGate、ouci.dntb.gov.ua）。唯一可靠的"类一手"证据是 Dekker 在同行评审论文中对它的转述，这恰好证实了最关键的 video/browsing 分离。

### Cited Findings
- **video 无下降、browsing 与社交媒体有下降 —— 由同行评审一手文献转述证实** [V-SECONDARY，强]。Dekker & Baumgartner 原文："In one study, participants spent less time on internet browsing and social media when grayscaled, but, surprisingly, no reduction was found in video screen time (Holte & Ferraro, 2020)." —— [UvA 全文](https://pure.uva.nl/ws/files/227312734/Is_life_brighter_when_your_phone_is_not.pdf)
- 同一段还指出其后续研究结果**相冲突**：Holte et al. (2023) 中游戏时间下降，但娱乐与社交媒体无差异。Dekker 评价两研究"somewhat conflicting"[V-PRIMARY]。→ 报告若把 video/browsing 分离当作稳健规律会过度解读。
- **≈37.9 分钟/天下降；对照组 +15 分钟**：仅二手 [V-SECONDARY，弱]。255 → 217 分钟/天 —— [StayGray 博客](https://www.staygray.app/blog/grayscale-college-students-screen-time-study)、[alignmate](https://www.alignmateapp.com/blog/does-grayscale-reduce-screen-time)。**均为商业产品博客，非可靠来源。**
- **样本量矛盾未解决** [UNVERIFIED]：二手来源同时流传 73 与 ~220（后者据称出自 University of Cincinnati 的报道）。无法判定。
- 期刊卷期与 DOI 经 Dekker 参考文献表核实：The Social Science Journal, 60(2), 274–290, DOI 10.1080/03623319.2020.1737461 [V-PRIMARY]。

### Inferences
- 建议处理：报告不要给具体样本量，也不要给 37.9/39.70 这种精确到小数的数字（精度与来源质量不匹配）。改为"另一项大学生研究报告约 38 分钟/天的下降，但该文全文未能取得，各二手来源对其样本量说法不一（73 vs ~220）"。
- video/browsing 分离可以保留，但必须标注为"单一研究、且同一作者团队的后续研究未复制"。

### Gaps
- p 值、效应量、对照组确切变化、研究时长（8-10 天）全部无法核实。

---

## PRIORITY 1c — Hagerty et al. (2026), Frontiers in Digital Health 8:1816095

### Takeaway
开放获取，**全部送检项目逐条命中，无一错误**。这是该章节中方法学最透明的一篇（作者自己承认的局限很多）。

### Cited Findings
全部 [V-PRIMARY] —— [Frontiers 全文](https://www.frontiersin.org/articles/10.3389/fdgth.2026.1816095/full)
- N=61 入组 / 51 完成；流失 10 人（保留率 83.6%）。
- 交叉设计，每条件 1 周，共 2 周。A 组先灰阶后彩色，B 组反之。
- **准随机**："Participants were assigned in a 1:1 alternating sequence based on order of enrollment" —— 按入组顺序交替，确认非真随机。
- **无洗脱期**，作者理由："No washout period was implemented between phases because grayscale mode represents an interface-level visual modification with no anticipated physiological carryover effects"。
- **自报屏幕时间、无截图验证**："Screen time data were self-reported using built-in device tracking features without screenshot verification"。
- 合并效应 −28.42 分钟/天；灰阶 318.87 (SD=113.26) vs 对照 347.29 (SD=153.43)；**t=2.3236, p=0.0243, df=50** ✓
- A 组 β=−28.39, SE=11.53, t(324)=−2.46, **p=0.0143**, 95% CI [−51.0, −5.8] ✓
- B 组 β=−28.44, SE=9.94, t(337)=−2.86, **p=0.0045**, 95% CI [−48.0, −8.9] ✓
- 对照条件均值 **339.09（A 组）与 355.18（B 组）** → 落在报告所说 339–355 区间内 ✓
- 生产力与睡眠零结果："did not demonstrate consistent or statistically significant differences"。
- **作者局限（逐字）**："Screen time data were self-reported using built-in device tracking features without screenshot verification, which may have introduced measurement error due to social desirability bias, incomplete adherence to study instructions, unavailable tracking data, or variation in device settings. The short duration of the intervention limited assessment of longer-term adaptation or habituation effects, and blinding was not feasible due to the visible nature of the grayscale display. Additionally, external factors such as navigation requirements, videoconferencing, and travel may have inflated measured screen time independently of attentional engagement."
- 另外承认：**无正式功效计算**、定性回答仅来自部分子样本、无法完全排除残余行为适应。

### Inferences
- 两组 β 几乎相同（−28.39 / −28.44）说明无明显顺序/遗留效应，这实际上**支持**其"无需洗脱期"的辩解 —— 可作为该研究的加分项写入。
- 预注册状态：全文中未见预注册声明，与报告所称"NOT preregistered"一致，但这是"未发现"而非"明确否认"→ 稳妥写法是"未报告预注册"。

---

## PRIORITY 1d — Myers, Drees & Cain (2022), Am J Pharm Educ 86(4):8717

### Takeaway
开放获取，**全部命中**。6% 的确切措辞已取得，且"四合一 bundle 使灰阶不可分离"的判断完全正确。

### Cited Findings
全部 [V-PRIMARY] —— [PMC10159421](https://pmc.ncbi.nlm.nih.gov/articles/PMC10159421/)
- **N=173 完成分析**（181 参与，8 人因不依从被剔除）。✓
- **四部分 bundle 确认**：(1) 手机改灰阶 (2) 关闭社交媒体通知 (3) 从主屏移除社交媒体图标 (4) 不与手机同睡/不睡在手机旁。时长约三周。→ **灰阶效应不可单独归因，报告的这一限定正确。**
- **6% 设备替代（逐字）**："Two of the lesser-occurring themes revealed no noticeable change (3%) or that participants started using other digital devices (eg, laptops, tablets, etc) more often to compensate (6%)."
- 额外可用的负面主题（逐字）："Several participants cited that grayscale was frustrating because it hampered their ability to use the smartphone productively for activities relying on color (eg, calendars, viewing charts/graphs, etc)" —— 这与 PRIORITY 3 的色度区分破坏论点直接呼应，是很好的实证佐证。

### Inferences
- 6% 是**定性主题编码的出现频率**，不是测量到的替代率。报告若写成"仅 6% 的人转向其他设备"会略微超出证据；应写"6% 的自由回答提到转向其他设备"。
- 这篇是 bundle 研究，不能用来支持灰阶的任何定量效应，只能用于定性/副作用证据。建议报告明确这样限定。

---

## PRIORITY 2 — Fiorillo, Tobler & Schultz (2003), Science 299:1898

### Takeaway
一手 PDF 已取得（剑桥大学开放副本）。报告的句子**在神经科学层面准确**，但**"应用于社交媒体 feed"是类比而非实证延伸**，且有一个重要的反证细节：持续激活也随奖赏量级上升，所以"由不确定性而非量级最大化"这半句**不准确**。

### Cited Findings
全部 [V-PRIMARY] —— [剑桥大学开放 PDF](https://www.pdn.cam.ac.uk/system/files/documents/2003-fiorillo-science.pdf)（亦见 [哈佛副本](https://www.hms.harvard.edu/bss/neuro/bornlab/nb204/final_exam/FiorilloSchultz2003.pdf)）
- **物种：两只猴子**（Pavlovian 条件化）："Two monkeys were conditioned in a Pavlovian procedure with distinct visual stimuli"。共记录 188–241 个神经元。→ 报告应明示这是猴类单细胞电生理。
- **(i)+(ii) 关键区分已证实**：
  - **phasic CS 反应随概率单调变化**（不是在 0.5 达峰）："Conditioned stimuli elicited the typical phasic activations, with their magnitude increasing with increasing reward probability (r²=0.80, P=0.04 ... )"；"the phasic activations varied monotonically with reward probability"。
  - **持续/爬升激活才在 P=0.5 达峰**："There was a sustained increase in activity that grew from the onset of the conditioned stimulus to the expected time of reward"；"the sustained activation was maximal at P = 0.5, less pronounced at P = 0.25 and 0.75, and absent at P = 0.0 and 1.0"。P=0.5 时 188 个神经元中 29% 显著升高，而 P=1.0 时仅 9%。
  - 两者在单个神经元内部也可分离："The phasic and sustained activations differed not only in timing and relation to reward probability, but also in their occurrence in single neurons"。
- **反证原报告措辞的关键句** [WRONG 的依据]："We used distinct visual stimuli to predict the magnitude of potential reward at P = 0.5 and found that the sustained activation of dopamine neurons increased with increasing reward magnitude (n = 84, P < 0.02 in each monkey)" —— **持续激活同时随量级增加**，因此不能说"由不确定性而非奖赏量级最大化"。
- 作者自己留白："The particular function of uncertainty signaled by dopamine neurons is not known"。
- **全文未出现 gambling、slot machine、variable ratio、social media、human 等词**（已 grep 确认）→ 向社交媒体的推广完全是外部类比。
- **"无同行评审一手研究把社交 feed 正式测量为变比率强化程式"这一空缺本轮再次确认** [UNVERIFIED/空缺成立]：本轮检索未找到任何此类一手实证研究。

### Inferences
- 报告原句"奖赏反应的持续性由不确定性（而非奖赏量级）最大化，在 P=0.5 时达到峰值"**有两处需改**：
  1. 删掉"而非奖赏量级"——原文明确显示持续激活也随量级上升。正确说法是"持续激活随不确定性变化、在 P=0.5 达峰，同时也随奖赏量级上升"。
  2. 必须说明是"持续/爬升激活"而非泛指"奖赏反应"；phasic 反应是单调的，不在 0.5 达峰。
- **建议 DOWNGRADE**：把这段明确标注为跨物种类比。可写成"猴类多巴胺神经元中，爬升型激活在 P=0.5 时最强（Fiorillo et al., 2003）；将此机制外推到社交媒体信息流是理论类比，目前尚无一手研究把推荐流正式测量为变比率强化程式。"

### Gaps
- 未检索到把 Fiorillo 机制直接应用于真实 feed 的一手实证研究（这正是报告需要承认的空缺）。

---

## PRIORITY 3 — WCAG / 可访问性

### Takeaway
系数与 SC 1.4.1 均已从 W3C 直接证实，算术正确。但报告"灰阶通常不会降低 WCAG 对比度"**成立的前提是变换在线性光域进行**；对 gamma 编码值加权的实现并不保留对比度。Apple/Android 的实现细节未公开文档化。

### Cited Findings
- **系数确认（直接取自 W3C 规范）** [V-PRIMARY]："For the sRGB colorspace, the relative luminance of a color is defined as L = 0.2126 * R + 0.7152 * G + 0.0722 * B where R, G and B are defined as: if RsRGB <= 0.04045 then R = RsRGB/12.92 else R = ((RsRGB+0.055)/1.055) ^ 2.4"（G、B 同式）—— [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- **关键限定条件：系数作用于线性化后的值** [V-PRIMARY]。上述分段函数先把 gamma 编码的 sRGB 值转为线性光，**之后**才加权。
- 对比度公式：(L1 + 0.05) / (L2 + 0.05) [V-PRIMARY] —— [W3C WCAG 2.1](https://www.w3.org/TR/WCAG21/#dfn-relative-luminance)
- **SC 1.4.1 Use of Color（逐字）** [V-PRIMARY]："Color is not used as the only visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element." —— [W3C WCAG 2.1](https://www.w3.org/TR/WCAG21/#dfn-relative-luminance)
- **算术核实**：0.7152 / 0.0722 = **9.906…** ≈ 9.9 ✓ [V-PRIMARY，已计算]。报告的"约 10:1 绿蓝权重比"正确。
- Apple/Android 灰阶滤镜是否在线性光域运算：**未找到官方文档** [UNVERIFIED]。

### Inferences
- **数学上的真相（务必精确表述）**：若灰阶变换为 Y = 0.2126R + 0.7152G + 0.0722B **在线性化值上**计算，则每个颜色的相对亮度 L 完全不变，因而 WCAG 对比度**精确保留**。若在 gamma 编码值上直接加权（朴素实现），得到的灰度其线性亮度≠原色线性亮度，对比度**会漂移**（通常偏移不大但非零，且可能使临界的 4.5:1 掉到阈值以下）。
- 因此报告的"该算法使用同样的亮度权重"这一括注**只在线性域成立**，建议改为："当灰阶变换采用 WCAG 同一组亮度权重并在线性光域计算时，对比度在数学上被精确保留；若实现直接对 gamma 编码值加权（常见的朴素做法），对比度会轻微漂移。Apple/Android 的具体实现未见官方文档说明。"
- "它破坏的是 WCAG 从未计入的色度区分"**完全正确且有规范依据**：WCAG 对比度公式只含亮度项，不含色度项；而 SC 1.4.1 正是为此单独存在的 —— 两者互补，不是冗余。
- 9.9:1 的含义推论**正确**：等亮度但仅色相不同的编码（典型如红/绿状态指示）在灰阶下坍缩为近乎相同的灰度，而绿色贡献近 10 倍于蓝色意味着蓝色信息在灰阶化中损失最严重。Myers 研究中参与者抱怨"日历、图表"不可用正是此现象的实证。

### Gaps
- Apple iOS「色彩滤镜→灰度」与 Android「Grayscale/Monochromacy」的确切变换矩阵与是否线性化，均无公开技术文档可引。建议报告不要断言厂商实现。

---

## PRIORITY 4 — 后悔 / 截图研究

### Takeaway
论文已精确定位，N=17 与方法均核实。**确认不报告总体"后悔比例"**，因此只能作定性/机制性引用 —— 报告的处理方式正确。

### Cited Findings
全部 [V-PRIMARY] —— [arXiv:2410.11354](https://arxiv.org/abs/2410.11354)
- 标题："What Social Media Use Do People Regret? An Analysis of 34K Smartphone Screenshots with Multimodal LLM"；作者 Longjie Guo, Yue Fu, Xiran Lin, Xuhai "Orson" Xu, Yung-Ju Chang, Alexis Hiniker；**CHI 2025 full paper** ✓（报告的猜测正确）
- **N=17 Android 用户** ✓；方法：每 5 秒被动截屏、持续一周、共 34K 张截图，用多模态 LLM 分析，并以经验采样、问卷、访谈三角验证。
- 核心发现："regret varies based on user intention, with non-intentional and social media use being especially regrettable"；最被后悔的是"viewing algorithmically recommended content and comments"。
- 另一发现：用户常从"直接沟通"意图漂移到社交媒体浏览，这"slightly increased their regret"。
- **未报告总体后悔占比**：确认该文不给"X% 的使用被后悔"这类整体数字。

### Inferences
- N=17 + 单一平台（Android）+ 一周，只能支撑机制性/定性主张。报告标注为"定性/机制性"**恰当**。
- "No Specific Goal"这一标签名建议核对原文术语：已证实的是"non-intentional use"与"算法推荐内容"最被后悔，方向与报告一致；若报告直接引用"No Specific Goal"作为论文中的类别名，建议在正文改用已证实的措辞或标注为意译。

---

## PRIORITY 5 — 对照干预表（逐行核查）

### Takeaway
五行**全部定位成功**，核心主张均成立。但第 5 行（纵向研究）有一个方向性细节必须讲准，否则会被当作因果主张。

### Cited Findings

**第 1 行 — 通知禁用 RCT：核实 ✓** [V-PRIMARY，经机构仓库开放副本]
- 论文：Beyond the Buzz: Investigating the Effects of a Notification-Disabling Intervention on Smartphone Behavior and Digital Well-Being，Media Psychology，DOI 10.1080/15213269.2024.2334025 —— [柏林自由大学开放全文](https://refubium.fu-berlin.de/bitstream/handle/fub188/43549/Beyond%20the%20Buzz%20Investigating%20the%20Effects%20of%20a%20Notification-Disabling%20Intervention%20on%20Smartphone%20Behavior%20and%20Digital%20Well-Being.pdf)
- **预注册 RCT，N=205** ✓，M_age=24.45，52% 女性，含客观记录的手机行为 + 每日日记。干预为关闭通知一周。
- **屏幕时间与查看频率均无效应** ✓："No significant effect of the intervention was found for phone checking frequency or daily screen time"。
- **FOMO 反弹确认** ✓：干预组 notification-FoMO 更高，content-FoMO 显著更高，情境性 FoMO 增加 →"disabling notifications results in drawbacks rather than improvements"。
- 作者推论：通知可能并非手机使用的主要驱动因素。→ 这对报告的论点（灰阶作用于"使用中的吸引力"而非"进入触发"）是很好的对照。
- 注：报告称"五项福祉结果均为零"——检索证实多项福祉零结果 + FOMO 反向，但"恰好五项"未逐项点数 [V-SECONDARY 之于"5"这个数字]。建议写"多项福祉结果为零且 FOMO 反向恶化"以免数字出错。

**第 2 行 — TikTok 去个性化：核实 ✓** [V-PRIMARY，UvA 开放副本]
- 论文："For you vs. for everyone: The effectiveness of algorithmic personalization in driving social media engagement"，Computers in Human Behavior（ScienceDirect S0736585325000620）—— [UvA 开放 PDF](https://pure.uva.nl/ws/files/250001399/For_you_vs._for_everyone.pdf)
- **N=88、预注册、基线周后切换到低个性化 feed 一周** ✓
- 结果：使用频率与时长均下降；使用被感知为更可控但更不愉快；所观看视频的个人相关性显著降低；娱乐体验与 TikTok 警觉（salience、monitoring）下降，自我调节上升。✓「worked」成立。
- 对报告有利的细节：**既降频次又降时长**，与灰阶"只降时长不降频次"形成对照 —— 可用于论证两种干预作用点不同。

**第 3 行 — 自我监测田野研究：核实 ✓** [V-SECONDARY]
- Laura Zimmermann, "'Your Screen-Time App Is Keeping Track': Consumers Are Happy to Monitor but Unlikely to Reduce Smartphone Usage", **Journal of the Association for Consumer Research (JACR)**, 2021, 6(3), 377–382 ✓（报告猜测的 JACR 正确）—— [芝大出版社](https://www.journals.uchicago.edu/doi/full/10.1086/714365)；[RePEc 记录](https://ideas.repec.org/a/ucp/jacres/doi10.1086-714365.html)
- **Study 1 纵向田野研究 N=242** ✓："screen-time tracking improves digital self-awareness but ... is less likely to lead to a reduction of mobile usage" ✓
- 附加（报告可用）：Study 2 在线实验 N=139 发现消费者偏好信息型追踪而非更具限制性的替代方案（屏蔽、数字助推），**尽管他们认为前者减少屏幕时间的效果更差**，在手机依赖度最高者中尤甚。

**第 4 行 — 数字自控工具元分析：定位 ✓，效应量部分取得** [V-SECONDARY]
- 论文：Achieving Digital Wellbeing Through Digital Self-control Tools: A Systematic Review and Meta-analysis，**ACM TOCHI**，DOI 10.1145/3571810 ✓ —— [ACM](https://dl.acm.org/doi/full/10.1145/3571810)（403）；[dx.doi.org 记录](https://dx.doi.org/10.1145/3571810)
- "small to medium effect of contemporary digital self-control tools on the time spent by users on technological sources" ✓
- **合并效应 95% CI 为 0.2657–0.6811**（随机效应模型，Hartung-Knapp-Sidik-Jonkman 方差估计）[V-SECONDARY]。点估计未能取得；由 CI 中点推算约 0.47，但**此推算不应作为引用数字写入报告**。
- 检索结果提到"total of 255 participants"，数量级偏小，疑为某子分析而非全样本 → **不要引用这个数字**。

**第 5 行 — 6 波纵向研究：核实 ✓，但须修正因果措辞** [V-SECONDARY，强]
- 论文：Dekker, Sumter & Baumgartner, "Unraveling the dynamics of perceived smartphone overuse and disconnection strategies: Longitudinal insights", **New Media & Society**, DOI 10.1177/14614448241303113 —— [Sage](https://journals.sagepub.com/doi/10.1177/14614448241303113)；[OSF](https://osf.io/t7235/overview)
- **6 波、Wave 1 的 N=1674、对荷兰人口在年龄/性别/教育上具代表性** ✓
- 核心结果 ✓："Using disconnection strategies in the previous 2 months was related to higher perceived overuse and self-reported screen time"；结论为技术性断连策略**无效于**降低感知过度使用。

### Inferences
- 第 5 行"自选断连策略预测更高的感知过度使用"方向正确，但这几乎必然是**个体间（between-person）相关**，即感觉自己用得多的人更可能去用断连工具（反向因果/选择效应），而非断连工具把人变得更糟。原始摘要用词是"was related to"（相关），不是"caused"。**报告必须用"与……相关"而非"导致/使之恶化"**，否则这个"惊人"结论会被审稿人当作明显的因果误读击穿。
- 整张表的叙事是稳固的：通知禁用无效且有反弹、自我监测无效、自控工具仅小到中等效应、断连策略与更差的主观结果相关 —— 而去个性化与灰阶（降时长）有效。这支持"改变使用中的即时吸引力 > 改变进入门槛或增加自我监控"。

### Gaps
- TOCHI 元分析的合并效应**点估计**与纳入研究数未能取得（ACM 403，scispace PDF 抓取为空）。
- 通知 RCT"恰好五项福祉结果"未逐项核对。

---

## PRIORITY 6 — 「机制预测会话变短但拿起次数不变」是否过度主张

### Takeaway
**这是事后拟合，不是先验预测，必须改写并标注为作者本人的推论。** 最强的反证来自 Dekker 自己：她的预注册假设 H2 预测 unlocks **会下降**，结果不显著；"会话变短"是数据出来之后才给出的解释。

### Cited Findings
全部 [V-PRIMARY] —— [UvA 全文](https://pure.uva.nl/ws/files/227312734/Is_life_brighter_when_your_phone_is_not.pdf)
- **预注册假设方向与报告相反**：Dekker 的 H2 预测干预周的 unlocks 会低于基线周；结果 d=0.04, p=.860，论文明言"H2 was not supported"。→ 若该机制真能先验预测"拿起次数不变"，H2 根本不会被这样预注册。
- **作者将"不变"描述为意外**："Interestingly, the daily number of unlocks was unaffected by the intervention"；"contrary to our expectations, the number of daily phone unlocks did not change"。
- **会话变短的解释是事后提出的**："individuals checked their phones as frequently as in the baseline week, but subsequently used their phones for a shorter duration of time. These findings seem to support the idea that grayscaling makes phone use less enjoyable and thus renders it easier to discontinue use (Holte & Ferraro, 2020)." —— 注意"seem to support"的措辞强度很弱。
- **作者自己把"不变"解释为习惯持续，并预期长期会变**："The grayscale intervention might thus initially only affect the duration of phone sessions ... and might only over time affect use frequency. To establish such long-term effects, studies with longer intervention periods are needed." → 即作者认为"拿起次数不变"是**短期的、可能会随时间改变的**，而非机制的稳定特征预测。
- 作者亦将查看行为归因于习惯而非色彩吸引力："checking behavior often happens subconsciously ... which underlines its known habituality"。
- 未找到任何在数据之前就提出"会话变短 / 拿起不变"这一解离作为机制判别依据的已发表来源 [UNVERIFIED — 空缺]。

### Inferences
- **判定：post-hoc fitting。** 三项发现"确认"该预测的说法不成立 —— 至少 Dekker 这一项是在假设被推翻之后才转为该解释的。
- **建议改写**（并标注为作者推论）："灰阶主要降低使用中的即时吸引力，而非进入手机的触发；因此其效应集中在会话时长而非拿起次数。这一解离在现有数据中是一致的（Dekker 2024 观察到时长下降而拿起次数不变，d=0.04），但需说明：该研究原本预注册了拿起次数会下降的假设，'会话变短'是作者在结果之后提出的解释（原文为 'seem to support'），而非事前预测。本报告将其作为与数据相容的机制解释提出，而非经检验的先验预测。"
- 另一个诚实的加分做法：引用 Dekker 自己的替代解释（查看是无意识习惯、长期可能才影响频次），说明该解离也可由"习惯惯性"解释，而不唯一指向色彩吸引力机制 —— 即该证据**不具机制判别力**。

---

## 需要删除或降级的清单（汇总）

| 项目 | 处置 | 原因 |
|---|---|---|
| "约半数觉得烦 / 不愿继续" | **修正并拆分** | 烦=全样本均值 5.39/7；51.3% 对应"绝不/很少再用"。两者不可合并。 |
| Fiorillo"而非奖赏量级" | **删除该半句** | 原文证实持续激活也随奖赏量级上升（n=84, P<0.02）。 |
| Fiorillo"奖赏反应" | **改为"持续/爬升激活"** | phasic CS 反应是单调的，不在 P=0.5 达峰。 |
| Fiorillo → 社交 feed | **降级为类比** | 原文无 human/gambling/variable-ratio/social media；无一手研究把 feed 测为变比率程式。 |
| PRIORITY 6 的"机制预测" | **改写 + 标注为自有推论** | Dekker 预注册了相反方向的 H2；解释是事后的。 |
| WCAG"通常不会降低对比度" | **加线性光域限定 + 不断言厂商实现** | W3C 系数作用于线性化值；gamma 域朴素实现不保留对比度。 |
| Holte & Ferraro 的样本量与 37.9/39.70 精确值 | **降级/去精度** | 一手全文不可得；二手来源矛盾（73 vs ~220）且多为商业博客。 |
| Holte video/browsing 分离 | **保留但加限定** | 由 Dekker 转述证实，但同团队后续研究未复制，Dekker 称二者"conflicting"。 |
| Myers 6% | **改为"6% 的自由回答提到"** | 属定性主题编码频率，非测得的替代率。 |
| 通知 RCT"五项福祉结果" | **改为"多项"** | "5"未逐项核实。 |
| 6 波纵向"预测更高过度使用" | **改为"与……相关"** | 原文为 "was related to"；几乎必为个体间相关，存在反向因果。 |
| TOCHI 合并效应点估计 | **只引用"小到中等"+CI** | 点估计未取得；勿用 CI 中点反推的 0.47；勿引"255 participants"。 |

## 可以放心保留的（一手证实、无需改动）
- Dekker：N=84、被试内、无对照、2 周；−20 分钟/天 d=0.51；unlocks d=0.04 零结果；睡眠零、生产力零；感知过度使用 d=0.81；参与者平均未察觉自身减少；依从率 89.73%；作者自评"20 分钟相对 4 小时基线未必可观"。
- Hagerty：送检的每一个数字（N、准随机、无洗脱、自报无验证、−28.42、t/df/p、两臂 β 与 CI、对照均值 339–355、生产力睡眠零、作者局限逐字）。
- Myers：N=173、四部分 bundle、灰阶不可分离、6% 逐字措辞。
- WCAG：0.2126/0.7152/0.0722 系数、线性化分段函数、对比度公式、SC 1.4.1 逐字、9.9:1 算术。
- Fiorillo：两只猴子、phasic 单调 vs sustained 在 P=0.5 达峰、29% vs 9%。
- 后悔研究：CHI 2025、N=17、34K 截图/5 秒间隔、算法推荐内容最被后悔、无总体后悔占比。
- 对照表第 1–3、5 行的论文身份、样本量与核心结论。
