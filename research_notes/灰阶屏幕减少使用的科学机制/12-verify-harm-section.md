# 屏幕使用危害章节 — 量化主张的一手核查

核查日期：2026-11-25。标签约定：[V-PRIMARY] 已读原文 / [V-SECONDARY] 仅二手互证 / [UNVERIFIED] / [WRONG — 正确值为 X]。

**最高优先级结论（先读这段）**

1. **N=2,844 是错的** → 正确为 2,743（收到报价的人数）；分析样本 1,661。
2. **「停用前中位 WTA ≈ $102」是两处错误**：$102 不是中位数、也不是 WTA，而是 BDM **报价**；真正的中位 WTA 是 **$100**。但「停用前」这个时点描述是**对的**。
3. **把 $102 vs 80% 写成「偏好矛盾」是加工过的解读** → 作者自己称之为 "tensions ... fodder for future research"，并明确说不清楚该以哪个为准。**建议改写**。
4. **第二个 RCT（N>35,000, 0.04–0.06 SD 幸福感）是误植** → 该论文**完全没有测幸福感**，0.04–0.06 SD 是政治类结果。**建议删除或改写**。
5. **「伸手拿手机 OR 9.1」是错的** → 9.1 是「伸手拿**非手机**物品」；伸手拿手机是 **4.8**。
6. **睡眠「22–44 分钟/夜」查无此文** → **建议直接删除**。
7. **近视 OR 1.21 是「患病率/现患」，不是发病率** → 该文发病率分析不显著。措辞须改。
8. **「两项失败的预注册复制」是一项** → FORRT 数据库把预印本与正式版重复计数所致。
9. **四项「推翻」本身过度主张**：(a) 用一个显著的合并效应当「无效应」证据；(d) 不可说该期刊未经同行评审（2014 年确在 MEDLINE 内）；(e) 区间成因归错了对象；(f) 把「probably」这一 GRADE 等级安在了错误的结局上。

**可以放心保留的**：Allcott 的四个效应量（且比你以为的更强——各自显著且经多重检验校正）、Dingus 的拨号/短信/浏览/通话四个 OR、近视 OR 1.21 的四个数字、(b) 打断成本三项子主张（全节最扎实）、(c) 多任务偏倚校正、(g) 诊断地位与 Wegmann 2026。

---

## PRIORITY 1：Allcott, Braghieri, Eichmeyer & Gentzkow, "The Welfare Effects of Social Media", AER 2020, 110(3):629-676

### Takeaway
核心效应量（0.12 / 0.10 / 0.09 / 0.08 SD）**逐项全部核实无误且各自单独显著**，这是本节最扎实的部分。但 N、$102 的性质、以及「矛盾」框架三处需要修正。

本节 [V-PRIMARY]：已下载并全文提取 2019-11-08 工作论文版 PDF（121 页，web.stanford.edu/~gentzkow/research/facebook.pdf），所有引述均为原文逐字。

### Cited Findings

**样本量 N — [WRONG — 正确值为 2,743 / 1,661]**
- 原文："We recruited a sample of **2,743** users through Facebook display ads" — 这是**收到 BDM 报价**的人数。
- 分阶段（原文 Figure 1 流程）：2,897 人有有效基线数据并进入分层随机化 → 154 人在中线调查中途退出 → **"leaving 2,743 who received their price offer"** → **"N=1,661 were in impact evaluation sample"**。
- **1,661 才是效应量估计所依据的样本**：即 WTA < \$102 且被分配到 p=\$102 或 p=\$0 的人。
- **未找到 2,844 这个数字的任何来源**。报告中的 N=2,844 应改为 2,743（招募/报价）或 1,661（分析样本），并注明是哪一阶段。

**设计 — [V-PRIMARY]**
- 时长：**4 周**（2018 年美国中期选举前，中线 10/11，终线 11/8，选举后两天）。正确。
- 核查方式：**"We will verify whether or not you deactivated your account by pinging the Facebook URL"** — 定期检查公开主页。依从率 **>90%**；终线调查流失 **<2%**。
- 对照组：也被要求**停用 24 小时**（非零干预基线），并同样走 BDM 流程，只是报价为 p=\$0、不被要求停用 4 周。**对照组不是「什么都不做」**，这点若报告写成「对照组照常使用」则需修正。
- 报酬结构：处理组因停用 4 周获 **\$102**；另有为保证 BDM 激励相容的额外支付。
- 停用的性质：是 Facebook **账号停用（deactivation）**，非单纯不登录；Messenger 仍可用，好友网络保留。

**WTA 数字 — [WRONG — 中位数是 $100，且 $102 不是 WTA]**
- 原文："Figure 11 presents the histogram of WTA to deactivate Facebook for the four weeks after midline ... **The median is \$100**, and almost 20 percent had valuations greater than \$500. After winsorizing valuations at \$1000, **the mean is \$203**."
- 重新加权至全美 Facebook 用户特征后："the median is still **\$100**, and the winsorized mean is **\$180**"。
- **\$102 是 BDM 的报价（offer price），不是任何一个 WTA 统计量**。作者选 \$102 的理由："We chose \$102 because our pilot data correctly suggested that there would be a point mass of WTAs at \$100" — 即故意设在 \$100 这个尖峰之上，以便把该尖峰纳入处理组。
- **时点：你写「停用前」是对的。** w1（主要的 WTA）在**中线调查、停用开始之前**用 BDM 引出。
- 但论文**另有两次事后引出**，这点报告可补：w2,1（中线、告知报价之后，针对第 5–8 周）与 w2,2（**终线、处理组已停用四周之后**，针对第 5–8 周）。所以「实验后拍卖」确实存在，但它不是 \$100 这个数字的来源。
- 建议表述：「停用前以 BDM 引出的中位 WTA 为 \$100（winsorized 均值 \$203）」。

**「80% 说停用对自己有好处」— [V-PRIMARY]，但需补关键限定**
- 原文："Remarkably, **about 80 percent of the Treatment group** thought that deactivation was **at least somewhat good for them**, and the modal response was the strongest possible agreement that deactivation was good."
- 子群：**仅处理组**（即已实际停用四周者）。
- **关键限定（报告若省略会失真）**：对照组**也**倾向认为停用对自己有好处。-5 到 +5 量表上处理组均值 **-2.3**、对照组 **-1.9**（该量表方向上负值=认为有好处）。两组差异存在但不大。
- 作者自己的警告（脚注 29 逐字）："One should be cautious in interpreting this effect, as it could result both from a change of opinion about Facebook **and from the difference in length of the deactivation they were evaluating**." 对照组评价的是 24 小时停用，处理组评价的是 4 周停用 —— **两组被问的不是同一件事**。
- 另外：处理组回答的**离散度更大**（强烈同意与强烈不同意都更多）。「80%」掩盖了异质性。

**幸福感效应量 — [V-PRIMARY] 四项全部准确，且各自单独显著**
- 原文逐字："The magnitudes are relatively small overall, with the largest and most significant effects on **life satisfaction (0.12 SD), anxiety (0.10 SD), depression (0.09 SD), and happiness (0.08 SD)**. **All of these effects remain significant after adjusting for multiple hypothesis testing.**"
- 所以：**不是「只有指数显著」**。这四项各自显著，且经多重检验校正后仍显著。报告若暗示仅指数显著，是低估了。
- 总指数：**+0.09 SD**。十个点估计中九个为正。
- **但须补一项反向证据**：每日短信测得的实时幸福感**不显著**——"The text message based measures of happiness are not significantly different from zero, with positive point estimates ranging from **0.01 SD to 0.06 SD**." 即**回顾式问卷显著、实时测量不显著**。这是本结果最重要的内部张力，报告应提及。
- 原始单位（作者自己给的尺度感）：快乐 1–7 量表对照组均值 4.47，提升 **0.12**；生活满意度 3–21 量表对照组均值 12.26，提升 **0.56**；抑郁/焦虑 1–4 量表均值 2.99 / 2.60，分别改善 **0.08 / 0.09**。
- 作者给的基准："about **25-40 percent** of the effect of psychological interventions including self-help therapy, group training, and individual therapy"（Bolier et al. 2013 元分析）。
- **精确 SE/CI 未在正文给出**（在 Figure 5 的误差条与附录表中）。若报告需要 CI，应标注来源为图而非正文。[GAP]

**实验后需求下降 — [V-PRIMARY]**
- 后续使用指数：处理组比对照组低 **0.61 SD**（这是全文最大的效应之一）。
- 具体测量：实验结束数周后，处理组自报 Facebook 手机 app 使用量低约 **11 分钟（22%）**；**5%** 的处理组在实验结束九周后账号仍处于停用状态；更可能点击「限制社媒使用工具」的邮件。
- 估值下降：处理组对第 5–8 周的估值相对对照组下降 **\$14–\$18，约 14%**。作者据此说 "traditional metrics may overstate consumer surplus"。

**新闻知识 — [V-PRIMARY]**
- 新闻知识指数下降 **0.19 SD**，**显著**（"Facebook deactivation significantly reduced news knowledge and attention to politics"）。
- 自报新闻消费时间减少 **15%**；且**未**转向任何其他线上或线下新闻来源。

**政治极化 — [V-PRIMARY]**
- 政治极化指数下降 **0.16 SD**。
- **分项须区分显著性**：议题立场极化与极化性新闻暴露**显著下降**；**情感极化（对对立党派的负面情感）与事实信念极化未达统计显著**（点估计方向一致）。党派情感极化点估计 **-0.06 SD，不显著**。
- 作者给的基准：另一项研究测得 1996–2018 年间极化指数上升 0.38 SD；但作者**主动警告**不可据此推论「没有 Facebook 极化就会少三分之一」。

**替代行为 — [V-PRIMARY]**
- 停用为处理组平均每天释放 **60 分钟**。
- 去向：**线下**活动增加（独自看电视、与亲友相处）。
- **反直觉的一点**：处理组在**其他社媒与其他线上活动上花的时间也更少**了（不是转移到别的平台）。

**作者自述的局限 — [V-PRIMARY]，逐字**
- "Our results should be interpreted with caution, for several reasons."
- (1) 效应可能随**时长、时期、规模**而变；更长的停用对新闻知识影响可能更小；**选举前**这一特殊时期可能不可外推；大规模停用会有**网络效应**，故参数「most relevant for individuals independently determining their own Facebook use」。
- (2) **样本不代表总体**："relatively young, well-educated, and left-leaning compared to the average Facebook user"；且**只纳入每天使用 >15 分钟者**；自愿参与者可能在不可观测维度上有别。
- (3) **多数结果变量为自报**，存在测量误差与实验者需求效应（但作者称 5.6 节未发现需求效应证据，且非自报结果方向一致）。
- 另一关键外部效度限制：**分析样本只含 WTA < \$102 者**（约 61%），即**天然排除了最重度/最高估值的用户**。作者做了单调性假设下的外推讨论；并发现极化效应**主要由高于中位 WTA 者驱动**。

**★ 核心解读问题：论文是否把 $102 vs 80% 框定为「偏好矛盾」？— [答案：否]**
- **作者并未称其为矛盾或不一致。** 原文逐字："What do our results imply about the overall net welfare impact of Facebook? **On the one hand**, Facebook deactivation increased subjective well-being, and 80 percent of the Treatment group reported that deactivation was good for them. **On the other hand**, participants were unwilling to give up Facebook unless offered fairly large amounts of money—even after they had deactivated for four weeks, which should have allowed at least some learning or 'detox' from addiction."
- 然后是决定性的一句："**It is not entirely clear whether one should prioritize the survey measures or monetary valuations as normative measures of consumer welfare.**" 作者引 Benjamin et al. (2012) 说主观幸福感**不是**人们决策时所最大化之物的完整度量；同时引 Bohm et al. / Mazar et al. 说货币估值**也**不稳固、易被操纵。
- 结论句："**We think of these tensions as fodder for future research.**"
- 亦即：作者把它呈现为**两种福利度量孰为规范标准的未决问题（a tension）**，而**不是**消费者偏好内部的不一致或非理性。
- **作者确实提供了替代解释**，且是对称的：
  - 支持「需求被扭曲」一侧：投射偏差（projection bias, Loewenstein et al. 2003）、经验品学习模型；实验后估值下降 14% 且该下降「unexpected」，作者说这表明**不能**完全用理性习惯形成模型（Becker-Murphy）解释。
  - 支持「消费者剩余是真实的」一侧：作者仍据此估算 **27 天 Facebook 产生约 \$310 亿消费者剩余**，并明确说即便按 14% 下调，"would still imply that Facebook generates enormous flows of consumer surplus"。
  - 并且作者**明说**不清楚哪个时点的 WTA 更具规范意义："it is not clear whether the WTA before deactivation or after deactivation is more normatively relevant."
- **对报告的处理建议**：把「矛盾/偏好冲突」改为「两种福利度量给出不同答案，作者本人视为未决张力」。若保留对比，必须同时写出：消费者剩余巨大与幸福感改善**在作者的框架里并不互斥**。按现有写法呈现为 contradiction，属于**层加在原文之上的解读**，建议修改。

### Gaps
- 逐项效应量的精确 SE / 95% CI 在正文未给出（存于 Figure 5 误差条及附录表），本次未逐一提取。
- 核查依据为 2019-11-08 工作论文版；AER 2020 刊出版的页码级措辞可能微调（核心数字在二手源中一致，无变动迹象）。

---

## PRIORITY 2：第二项停用 RCT（N>35,000，六周）

### Takeaway
论文本身已精确定位且 N 与时长**核实无误**，但**「效应量 0.04–0.06 SD 的幸福感结果」在该论文中不存在** —— 这篇论文根本没有测量主观幸福感。该主张须删除或彻底改写。

### Cited Findings
- **论文** [V-PRIMARY]（已下载 eScholarship 开放版全文提取）：Allcott H, Gentzkow M, Mason W, Wilkins A, Barberá P, et al. "The effects of Facebook and Instagram on the 2020 election: A deactivation experiment." *PNAS* 2024;121(21):e2321584121. DOI 10.1073/pnas.2321584121. 开放全文：https://escholarship.org/content/qt6d3272zm/qt6d3272zm.pdf
- **N — [V-PRIMARY] 与「>35,000」相符**：逐字 "randomizing a subset of **19,857 Facebook users and 15,585 Instagram users** to deactivate their accounts for **6 wk** before the 2020 U.S. election"。合计 35,442。Facebook 与 Instagram 是**两个分开的实验**，不是一个 35,442 人的样本——报告若写成单一 N 需注明。
- **时长 — [V-PRIMARY] 六周，正确。**
- **预注册 — [V-PRIMARY] 是**：逐字 "the analysis plan was **preregistered** prior to data availability"；且正文多次提及 "our preregistered significance threshold"。研究为学术界与 Meta 的合作，但 "Meta could not block any results from being published"，学者未获报酬。
- **★ 幸福感效应量 — [WRONG / 误植]**：对全文做关键词穷举，**"well-being" / "wellbeing" / "happiness" / "happy" / "emotional" / "depress" / "mental health" 命中数均为 0**（"anxi" 的 3 次命中全部出现在参考文献的书名 "Anxieties of Democracy" 中）。该论文的主要结局是**政治性的**：政治知识、政治参与、情感极化、议题极化、选举合法性感知、候选人好感度、投票率、Trump 投票。
- 报告中 **0.04–0.06 SD** 这一区间**对应的是政治类结果**，例如：情感极化点估计 Facebook **-0.031 SD**、Instagram **-0.030 SD**（**均不显著**；Facebook P=0.049 但 Q=0.189）；议题极化「95% CI bounds rule out effects of ±0.04 SD」；事实知识 +0.042 SD（不显著，Q=0.132）；对 Facebook 政治信息的信任 -0.040 SD（显著）。另外 "−0.06 / −0.03 / 0.00 / 0.03 / 0.06" 还是图 3 的**坐标轴刻度**。
- **方向性**：该研究的总体结论与「停用改善幸福感」**并不构成同向佐证**——其政治类结局 "were all precisely estimated and **close to zero**"；总体知识指数效应 "small and insignificant"。
- **⚠ 另有一则 2026 年更正** [V-SECONDARY，仅凭书目元数据]：Correction for Allcott et al., *PNAS* 2026 Mar 24, DOI 10.1073/pnas.2607249123, PMID 41849406。**更正的具体内容本次未能取得**（PNAS 403、PMC reCAPTCHA 拦截）。引用该文前应先确认更正是否触及所引数字。

### Inferences
- 「另一项独立 RCT（N>35,000，停用六周）方向一致，效应量 0.04–0.06 SD」这句话里，**N 与时长对、"方向一致" 与效应量错**。最可能的成因是把政治类效应量误读为幸福感效应量。
- 若报告需要一项大样本幸福感停用证据，这篇**不能**充当；应另寻，或老实说明大样本停用实验测的是政治结局而非幸福感。

### Gaps
- 未能取得 2026 年更正通知的正文内容。
- 未在 PubMed 中找到该 US2020 系列里任何报告幸福感结局的停用实验姊妹篇（以 "deactivation[Title] AND (Facebook OR Instagram)" 检索仅得该文与其更正）。

---

## PRIORITY 3：驾驶撞车风险（Dingus et al. 2016 PNAS, SHRP 2）

### Takeaway
点估计**全部核实无误，唯独 9.1 是张冠李戴**：9.1 属于「伸手拿非手机物品」，伸手拿**手机**是 4.8。95% CI 已全部取得。所有被引项均统计显著，但手机拨号与阅读/书写的 CI 极宽。

### Cited Findings
[V-PRIMARY]：Dingus TA, Guo F, Lee S, Antin JF, Perez M, Buchanan-King M, Hankey J. "Driver crash risk factors and prevalence evaluation using naturalistic driving data." *PNAS* 2016;113(10):2636-2641. DOI 10.1073/pnas.1513271113. PMC4790996 / PMID 26903657。CI 取自论文 **Figure 2**（正文仅给点估计），已下载原图读取。

**比较基准 — [V-PRIMARY]**：**"model driving"**，操作化定义为 **"alert, attentive, and sober"** 的驾驶片段，取自 **19,732 个基线事件**的分层随机抽样（按各参与者驾驶小时数分层）。原文强调："the resulting odds ratios reflect the elevated driving risk for a contributing factor compared with the model driving condition" —— **不是与「平均驾驶」比，而是与「理想驾驶」比，这会系统性放大 OR**。报告若写成「相比正常驾驶」应改为「相比专注清醒的理想驾驶状态」。

**样本 — [V-PRIMARY]**：**905 起**造成伤害或财产损失的撞车事件；**3,542 名**驾驶员（原文 "3,542 drivers participating 1–2 y at six data collection sites"）；**超过 3,500 万英里**连续自然驾驶数据；SHRP 2 自然驾驶研究，数据采集横跨 **3 年**。本研究是首个**仅用真实撞车**（不借助近撞等替代指标）的同类分析。

**指标性质 — [V-PRIMARY]**：**odds ratio（比值比）**，原文称 "unadjusted crash odds ratios"，采用撞车事件 vs 基线事件的病例-对照式比较。**不是风险比**。报告若写成「风险高 N 倍」在严格意义上是 OR 的通俗化；因撞车为罕见事件，OR 近似 RR 尚可接受，但措辞宜用「发生撞车的比值」。

**OR 与 95% CI 全表（Figure 2，手机与相关项）— [V-PRIMARY]**

| 行为 | OR (95% CI) | 基线普及率 | 显著性 |
|---|---|---|---|
| 手持手机**拨号** | **12.2 (5.6 – 26.4)** | 0.14% | 显著（CI 极宽） |
| 伸手拿**非手机**物品 | **9.1 (6.5 – 12.6)** | 1.08% | 显著 |
| 阅读/书写（含平板） | 9.9 (3.6 – 26.9) | 0.09% | 显著（CI 极宽） |
| 对车外物体的长时间注视 | 7.1 (4.8 – 10.4) | 0.93% | 显著 |
| 手持手机**发短信** | **6.1 (4.5 – 8.2)** | 1.91% | 显著 |
| **伸手拿手机** | **4.8 (2.7 – 8.4)** | 0.58% | 显著 |
| 车载设备（非收音机/空调） | 4.6 (2.9 – 7.4) | 0.83% | 显著 |
| 手机**浏览** | **2.7 (1.5 – 5.1)** | 0.73% | 显著 |
| 车内空调控制 | 2.3 (1.1 – 5.0) | 0.56% | 显著 |
| 手持手机**通话** | **2.2 (1.6 – 3.1)** | 3.24% | 显著 |
| **手持手机交互合计** | **3.6 (2.9 – 4.5)** | 6.40% | 显著 |
| 分心行为总体 | 2.0 (1.8 – 2.4) | 51.93% | 显著 |
| 车载收音机 | 1.9 (1.2 – 3.0) | 2.21% | 显著 |
| 与成人/青少年乘客互动 | 1.4 (1.1 – 1.8) | 14.58% | 显著 |

**未达显著的项（CI 跨 1）— 报告若提及需注意**：个人仪容 1.4 (0.8 – 2.5)；随音乐摇摆 1.0 (0.4 – 2.3)；喝饮料（非酒精）1.8 (1.0 – 3.3)（下限触 1.0）；**与后座儿童互动 0.5 (0.1 – 1.9)** —— 正文称其为「保护性」，但**其 CI 跨越 1，严格说不显著**，原文「significantly less than 1.0」的措辞与自身 CI 不符，若引用此项须谨慎。

**五项被引数字的裁定**
- 手持拨号 12.2 — [V-PRIMARY] 正确，CI **5.6–26.4**（极宽，且基线普及率仅 0.14%，样本极少）。
- **伸手拿手机 9.1 — [WRONG — 正确值为 4.8 (2.7–8.4)]**。9.1 (6.5–12.6) 是 "Reaching for object (non-cell phone)"。**必须修正**：要么把 9.1 的标签改为「伸手拿非手机物品」，要么把「伸手拿手机」的值改为 4.8。
- 发短信 6.1 — [V-PRIMARY] 正确，CI 4.5–8.2（本组中最稳健者之一）。
- 浏览 2.7 — [V-PRIMARY] 正确，CI 1.5–5.1。
- 手持通话 2.2 — [V-PRIMARY] 正确，CI 1.6–3.1。

### Inferences
- 拨号 12.2 虽是最醒目的数字，却建立在 0.14% 的基线普及率上，CI 跨越近五倍（5.6–26.4）。报告若以此为主打数字，应同时给出 CI，否则有夸大之嫌。相较之下**发短信 6.1 (4.5–8.2)** 与**手持手机合计 3.6 (2.9–4.5)** 更稳健，更适合承重。
- 该文另有独立批评：Young KL (2017, *Safety* 3(4):28, DOI 10.3390/safety3040028) 认为 SHRP 2 以「model driving」为基准会高估 OR，并指出其通话 OR 的构造方式存在效度问题。报告若要稳妥，可提一句基准选择的影响。[V-SECONDARY]

---

## PRIORITY 4：睡眠挤占

### Takeaway
2025 Frontiers 的两个数字都能核到，但 **−0.05 的单位在报告中若写成 SD 或小时都是错的**（它是每多 1 小时屏幕时间的标准化 β，作者自己的口径是「少睡约 3–5 分钟」）；**「22–44 分钟/夜」查无此文，建议删除**。

本节由子代理核查，方法为抓取出版方 PDF 后用 pypdf 提取正文（A、C、D 为 [V-PRIMARY]）。

### Cited Findings

**A) 2025 Frontiers in Psychiatry 元分析 — 论文已定位**
- He X, Pan B, Ma N, Li D, Kong W, Liu Q, Liu X, Wang X, Deng X, Yang K. "The association of screen time and the risk of sleep outcomes: a systematic review and meta-analysis." *Frontiers in Psychiatry* 2025;16:1640263. DOI 10.3389/fpsyt.2025.1640263
- **短睡眠 OR 1.25 (1.08–1.40) — [V-PRIMARY] 与摘要一致，但原文自相矛盾**：摘要与结果正文作 "OR = 1.25, 95% CI, 1.08 to 1.40"；**但该文 Table 2 与敏感性分析段落均作 1.08 to 1.41**。你引的 1.08–1.40 可据摘要立住，但**矛盾出在原文、不在你**。（对数尺度上 1.08–1.40 的不对称对随机效应合并 OR 属正常，不构成错误证据。）
- **★ −0.05 的单位 — [需修正措辞]**：它是**每日屏幕时间每增加 1 小时**所对应的**标准化 β 系数**，**既不是 SD、也不是小时**。方法逐字："Standardized coefficients (β) and odds ratios (OR) were used to quantify effect sizes"；连续结局 "standardized to a 1-hour increase in daily screen time"。
- **作者自己的通俗口径（建议直接采用）**，摘要逐字："**Each additional hour of daily screen time was associated with approximately 3 to 5 minutes shorter total sleep duration** (β = −0.05, 95% CI: −0.08 to −0.03) in 11 studies reporting continuous outcomes."
- 另一个可用数字：每小时屏幕时间对应**就寝时间推迟 13.2 分钟**。
- **人群 — [需修正]**：**21 项队列研究、548,338 人**，年龄自**婴儿至成人**，中位年龄 **12.76 岁**。**这不是一项青少年专属研究**，报告若如此描述需改（作者仅在结论中说青少年「particular vulnerability」）。曝露为**自报或家长代报**，非客观记录。
- 连续结局池：11 项研究 / 48,560 人；二分类短睡眠池：9 项研究 / 498,689 人。
- **必须随行的质量警告**：连续睡眠时长估计的 **GRADE 为 "Very Low"**；短睡眠 OR 的 GRADE 为 "Moderate" 但 **I² = 96.5–97.2%**，且作者逐字报告 **"a 95% prediction interval ranging from 0.87 to 1.79, encompassing the null value (OR = 1)"** —— **预测区间跨越无效线**，故 1.25 不应被呈现为已定论的效应。

**B) 「22–44 分钟/夜」— [UNVERIFIED — 建议删除]**
- 以精确短语多轮检索（"22 to 44 minutes"、"22-44 minutes" 配合 sleep / phone / bedtime / screen 等），**在 Sleep Medicine Reviews 及任何期刊均未找到报告此区间的论文**。该数字疑似不存在于文献中。
- 最可能被误指的论文：Hill VM, Rebar AL, Ferguson SA, Shriane AE, Vincent GE. "Go to bed! A systematic review and meta-analysis of bedtime procrastination correlates and sleep outcomes." *Sleep Medicine Reviews* 2022;66:101697. DOI 10.1016/j.smrv.2022.101697 [V-SECONDARY，ScienceDirect 403 未能读原文]
- 但该文**根本不报告任何以分钟为单位的数字**，其结局为 Fisher's z 相关（睡眠时长 z=−0.31；睡眠质量 z=−0.35；日间疲劳 z=+0.32），共 43 项研究；且主题是**就寝拖延这一意志性构念本身，而非手机/屏幕使用**。用它支撑一个手机挤占睡眠的分钟数，会同时犯**构念错配**与**数字杜撰**两个错。
- **替代方案**：改用上面 He et al. 2025 的「每多 1 小时屏幕时间少睡约 3–5 分钟、就寝推迟 13.2 分钟」，该文你已在引用。

### Gaps
- Hill et al. 2022 原文未能直接读取（出版方 403），其识别与效应量为二手互证；但「22–44 分钟不存在」这一结论是靠精确短语检索确立的，不依赖于读到该文。

---

## PRIORITY 5：近视

### Takeaway
OR 1.21 的四个数字**全部核实无误**，曝露确为**屏幕时间**（非泛指近距离用眼）——但**结局是现患率而非发病率**，报告措辞须改；户外 OR 0.53 属实但须补 CI 并确认出处。

### Cited Findings

**C) 屏幕时间与近视 — [V-PRIMARY]**
- Ha A, Lee YJ, Lee M, Shim SR, Kim YK. "Digital Screen Time and Myopia: A Systematic Review and Dose-Response Meta-Analysis." *JAMA Network Open* 2025;8(2):e2460026. DOI 10.1001/jamanetworkopen.2024.60026
- 逐字："An additional hour of daily screen time was associated with higher odds of myopia (**OR, 1.21; 95% CI, 1.13-1.30**)" —— **45 项研究、335,524 人**，平均年龄 9.3 岁。**四个数字全对。**
- **曝露 = 屏幕时间，不是泛指近距离用眼 — [已澄清，你的写法安全]**：智能手机、平板、游戏机、电脑、电视。作者在讨论中提及 near work 与户外时间，但那是建议部分，**不是曝露定义**，不应混入主张。
- **★ 结局 = 现患（prevalence），非发病（incidence）、亦非进展 — [需修正]**：合并 OR 来自以**横断面研究为主**的证据池；该文的**发病率分析不显著**。
  - 不可写成「每多一小时，**罹患**近视的几率上升 21%」（发病率主张，原文不支持）；也不可写成屈光度**加深/进展**。
  - 正确措辞：「每日屏幕时间每多 1 小时，近视**现患**的比值高 21%」，并注明证据以横断面为主、属**关联而非因果**。
- **剂量反应/阈值（原文有、报告尚未使用，建议补）**：逐字 "The dose-response curve showed myopia risk increasing significantly between 1 to 4 hours of daily screen time, and then rising more gradually after 4 hours"（34 项研究 / 314,910 人）。曲线点估计：1 h/日 **OR 1.05 (1.01–1.09)** → 4 h/日 **OR 1.97 (1.56–2.40)**。且关联在**每日 1 小时以内不显著**，作者称其为 "a potential safety threshold"。若报告要论证「多少算多」，这是全文最有力且目前未被使用的材料。

**D) 户外时间保护作用 OR 0.53 — [V-PRIMARY]，但须补 CI 并核对脚注**
- Li D, Min S, Li X. "Is Spending More Time Outdoors Able to Prevent and Control Myopia in Children and Adolescents? A Meta-Analysis." *Ophthalmic Research* 2024;67(1):393-404. DOI 10.1159/000539229
- 逐字："Comparing the highest with the lowest exposure levels of time spent outdoors, the highest outdoor time was strongly associated with a reduced risk of myopia onset (**odds ratio [OR]: 0.53; 95% confidence interval [CI]: 0.34, 0.82**)" —— **"highest vs lowest" 框架确认无误**。
- **须补 CI**：报告目前省略了 **0.34–0.82**，该区间很宽，不应把 0.53 呈现为精确值。
- **证据基础很薄**：该合并 OR 仅建立在 **3 项队列研究、6,152 名儿童青少年**之上（全元分析为 8 项 / 12,922 人）。不应描述为已确立的结论。
- **⚠ 出处混淆风险**：更出名的户外时间元分析是 Xiong S, Sankaridurg P, Naduvilath T, et al. *Acta Ophthalmologica* 2017;95(6):551-566（DOI 10.1111/aos.13403），其高-低对比报告的是 **RR = 0.574 (95% CI 0.395–0.834)** —— **不同指标、不同数值**。若报告脚注指向 Xiong 2017，则为误引；0.53 属于 Li 等 2024。**请核对脚注。**

---

## PRIORITY 6：六项「已被推翻」主张 —— 对推翻本身的核查

### Takeaway
**(b) 与 (c) 的推翻完全站得住，是全报告最扎实的部分。但 (a)、(d)、(e)、(f) 四项的推翻本身存在过度主张或事实错误，须修正后才可发表。** 最严重的三处：(a) 把一篇复制研究算成两篇、且用一个「显著」的合并效应当作「无效应」的证据；(e) 把区间的成因归错了对象；(f) 把「probably」这一 GRADE 等级用错了结局。

---

### a) 「脑力流失 / Brain drain」（Ward et al. 2017）— **推翻 OVERSTATED，且含一处事实错误**

- **原研究** [V-PRIMARY]：Ward AF, Duke K, Gneezy A, Bos MW. "Brain Drain: The Mere Presence of One's Own Smartphone Reduces Available Cognitive Capacity." *Journal of the Association for Consumer Research* 2017;2(2):140-154. DOI 10.1086/691462。实验一最终 N=520（招募 548）；实验二最终 N=275（招募 296）。效应很小：OSpan 偏 η²=.014–.026。
- **★ 「两项失败的预注册复制（Ruiz Pardo & Minda）」— [WRONG — 实为一篇论文、一项研究]**
  - 真实文献只有一项：Ruiz Pardo AC, Minda JP. "Reexamining the 'brain drain' effect: A replication of Ward et al. (2017)." *Acta Psychologica* 2022;230:103717. DOI 10.1016/j.actpsy.2022.103717. PMID 36007374。摘要逐字："**a pre-registered direct replication** of Ward et al.'s (2017) second experiment ... the 'brain drain' effect did not replicate: there was no difference between smartphone location conditions on performance on either the o-span task or the go/no-go task."
  - **「两项」的来源已查明**：FORRT Replication Atlas 对该 DOI 显示 "2 replications: failed"，但其两行是**同一研究的预印本与正式版**（预印本 PsyArXiv 2021, DOI 10.31234/osf.io/5y34g；正式版即上述 2022 Acta Psychologica）。属数据库重复计数。
  - **若要保留「两项」，第二项应改引另一组作者**：Hartmann M, Martarelli CS, et al. (2020) "Does a smartphone on the desk drain our brain? ..." *Consciousness and Cognition* —— 预注册、**概念性**（非直接）复制，未发现手机在场的显著总体效应。[V-SECONDARY，N 与统计量未核]
  - Ruiz Pardo & Minda 的 N：二手称 383（排除 44），**[UNVERIFIED]**，Elsevier 403 未能读原文。**要么核实、要么不写这个数字。**
- **★ 元分析 g=−0.14 — 数字完全正确，但用法 OVERSTATED** [V-PRIMARY]
  - Böttger T, Poschik M, Zierer K. "Does the Brain Drain Effect Really Exist? A Meta-Analysis." *Behavioral Sciences* 2023;13(9):751. DOI 10.3390/bs13090751。**22 项研究、43 个效应量。**
  - 逐字："The pooled effect across all studies was *g* = −0.14, with a 95% confidence interval (CI) of −0.24 to −0.03, at *p* < 0.05." —— 你引的数字与 CI **分毫不差**。
  - **但两点必须修正**：(1) **−0.14 是跨全部结局域的总合并效应，不是注意力的估计值**；注意力是 **g=−0.07, CI [−0.21, 0.06], p=0.29（确为零结果，你对）**；记忆是 **g=−0.23, CI [−0.36,−0.10], p<0.001（显著）**。(2) **−0.14 本身是统计显著的（p<0.05）**，若报告用它来证明「无效应」则是误用。另：该文称漏斗图**未显示发表偏倚**，所以这里不存在 (c) 那种偏倚校正后归零的情况。
  - 调节效应：亚洲样本 g=−0.39 (p<0.001)，欧洲与北美子集均不显著。
- **第三点须注意**：「注意力效应为零」**本就是 Ward et al. 自己报告的结果**，不是后人的反驳。原文逐字："no effects of Location, Power, or their interaction on either of these measures (all F < 1.05, all p > .35)"。把它写成后续研究推翻了 Ward，是误述。
- **公允的表述建议**：「唯一一项预注册直接复制未能重复出该效应；元分析上效应仍然存在但很小（g=−0.14），且由记忆类结局承载，注意力类为零。」

### b) 「23 分 15 秒」— **推翻 FAIR，三项子主张全部一手核实无误**

- **出处 [V-PRIMARY]，你对**：Robison J. "Too Many Interruptions at Work?" *Gallup Business Journal*, 2006-06-08 —— 对 Gloria Mark 的**访谈问答**，**非同行评审论文**。https://news.gallup.com/businessjournal/23146/too-many-interruptions-work.aspx
  - Mark 原话逐字："most interrupted work was resumed on the same day -- **81.9 percent** -- and it was resumed, on average, in **23 minutes and 15 seconds**, which I guess is not so long."
  - **值得一提的反讽**：Mark 本人的评语是 "which I guess is **not so long**"，流行用法把她的意思**用反了**。
- **「同行评审的真实数字是 25 分 26 秒，SD 54 分 48 秒」— [V-PRIMARY]，完全正确**：Mark G, Gonzalez VM, Harris J. "No Task Left Behind? Examining the Nature of Fragmented Work." *CHI 2005*:321-330。逐字："When people did resume work on the same day, it took an average length of time of **25 min. 26 sec (sd=54 min. 48 sec.)**... before resuming work, our informants worked in an average of **2.26 (sd=2.79)** working spheres."
  - **N=24** 名信息工作者，实地跟随观察。
  - **测的是什么**：从被打断到**回到原工作域**的挂钟时间，**包含中间插入的 2.26 件其他任务**。**它不是「重新聚焦」的认知耗时。** 你的刻画正确——这是整节最有力的一点。
  - **SD(54:48) 大于均值(25:26)**，分布严重右偏，单一「平均数」本就不适合概括，更不能据以推出每次打断的「成本」。
- **Mark, Gudith & Klocke (CHI 2008) — [V-PRIMARY]，你对**："The Cost of Interrupted Work: More Speed and Stress." *CHI 2008*:107-110。**N=48**。
  - **更快**：耗时 baseline 22.77 分 > 同情境打断 20.31 > 异情境打断 20.60（F(2,77.98)=3.36, p<.05），**且质量无差异**（错误率 p<.19）。
  - **但压力更高**：压力 6.92→9.46/9.13，挫折 4.73→6.63/6.48，时间压力、努力程度均 **p<.01**。
  - 摘要逐字："people completed interrupted tasks in less time with no difference in quality... but this comes at a price: experiencing more stress, higher frustration, time pressure and effort."
  - 限定：N=48、德国学生、短时实验室邮件任务。支持「此情境下无时间成本但有情绪成本」，不支持「打断从不拖慢工作」的普遍主张。

### c) 媒体多任务（Ophir et al. 2009）— **推翻 FAIR，数字精确无误**

- **原研究** [V-PRIMARY]：Ophir E, Nass C, Wagner AD. *PNAS* 2009;106(37):15583-15587。262 人填 MMI，取 ±1 SD 极端组；**各子实验每组仅 15–22 人**（这本身就是核心弱点，建议写进报告）。
- **偏倚校正后转为不显著 — [V-PRIMARY]，你对，且具体文献已定位**：Wiradhany W, Nieuwenstein MR. "Cognitive control in media multitaskers: Two replication studies and a meta-analysis." *Attention, Perception, & Psychophysics* 2017;79(8):2620-2641. DOI 10.3758/s13414-017-1408-4. PMC5662702。
  - 校正前逐字："a small but significant, positive association between media multitasking and distractibility, with ***d* = .17, 95% CI [.165, .173], *p* = .007**"；I²=57.02%。
  - 偏倚检验逐字：漏斗图 "clearly asymmetrical"；Egger 检验 "***Z* = 2.83, *p* = .005**"。
  - 校正后逐字：trim-and-fill —— "turned **nonsignificant** after correction, with **Cohen's *d* = .07, and *p* = .81**"；回归法 "**Cohen's *d* = .001**"。总结句："changed the estimate of the overall effect size from a significant Cohen's *d* of .17 to a nonsignificant effect of **.01–.07**."
  - 作者结论逐字："these findings lead us to question the existence of an association between media multitasking and distractibility in laboratory tasks of information processing."
  - **公允性补充（建议纳入）**：作者**自己**提出另一种读法——该关联「does exist, but that it is very weak」，并算出要在 80% 效能下检出 d=.17 需**每组 428 人**。严谨的推翻应纳入此点，而非宣称已证明无效应。
  - **范围限定**：结论仅适用于**实验室分心任务**，不可推广到媒体多任务的所有结局。
  - **Parry & le Roux：[UNVERIFIED]**，未能确认存在符合描述的该作者元分析。**此主张完全由 Wiradhany & Nieuwenstein (2017) 承载，不要引 Parry & le Roux。**

### d) 「颈椎承重 27 kg / 60 lb」— **推翻在实质上 FAIR，但须修正单位与两处过度主张**

- **出处 [V-PRIMARY]**：Hansraj KK. "Assessment of stresses in the cervical spine caused by posture and position of the head." *Surgical Technology International* 2014;25:277-9. PMID 25393825。单作者，无 DOI。
- **确系计算模型而非测量 — 确认**。PubMed 上**只有一段 "Preamble"，没有方法、结果、统计**。是**静态二维力矩计算**：假设头重 13.2 磅、假设力臂与支点，**无尸体、无体内测力、无 EMG、无影像、无受试者、无验证步骤、无不确定度**。
- **★ 单位冲突 — 须修正**：60 lb **=** 27.2 kg，所以「27 kg」与「60 lb」**是同一个数**（60° 屈曲值），不是两个。而 27 **磅**（12.2 kg）另是 **15°** 的值。各角度序列（[V-SECONDARY]，转引自对该文的二手综述，未获原文）：0°≈12 lb / 15°=27 lb / 30°=40 lb / 45°=49 lb / **60°=60 lb (27.2 kg)**。**报告须写明角度**；若写成「15° 时 27 kg」则 [WRONG — 15° 为 12.2 kg]。
- **★ 须让步的一点**：该力矩**算术本身是合理的静力学输出**，方向与量级与第一性原理一致（头部前伸于支点之外，伸肌反力随屈曲角陡增，60° 时达头重 4–5 倍并不荒谬）。**不可声称这个数字是凭空捏造或算错了。** 可攻击的是：模型未经验证、从静态瞬时载荷跳跃到累积剂量（该文外推出「每年 700–1400 小时异常应力」）、以及**退变推论纯属作者臆测**（原文用的是 "**may** lead to early wear, tear, degeneration"）。另该文还夹带了「好姿势提升睾酮/血清素、降低皮质醇」等 power-posing 式主张，而该文献多已复制失败——这反而是更有力的质疑点。
- **★ 不可声称期刊未经同行评审或未被收录** [V-PRIMARY，NLM Catalog 9604509]：*Surg Technol Int* **在 2014 年确在 MEDLINE 收录期内**（收录 v10 2002–v45 2025年7月；该文为 v25），仅**当前**状态为 "Not currently indexed for MEDLINE"。公允的批评应限于：小众半年刊、单作者、无 DOI、无结构化结果、方法细节不足以复现。
- **已发表的正式驳文：[UNVERIFIED，疑无]**。PubMed 检索未找到针对 Hansraj 的驳文、勘误或来信。**应表述为「未见正式学术驳斥」，而非「已被学界广泛推翻」。**

### e) 视疲劳患病率「8.2%–100%」— **推翻 OVERSTATED：区间可引，但归因错了**

- **出处 [V-PRIMARY]**：Pucker AD, Kerr AM, Sanderson J, Lievens C. "Digital Eye Strain: Updated Perspectives." *Clinical Optometry* 2024;16:233-246. DOI 10.2147/OPTO.S412382。
- 摘要逐字确有此区间："The world-wide prevalence of DES ranges from **8.2% to 100%** depending upon **the subjects evaluated and the method used to evaluate them**."
- **★ 归因错误 — [WRONG]**：你写的成因是**「缺乏标准化诊断标准」**，但原文给的成因是**「受试人群不同 + 测量工具不同」**。全文检索 `standard`/`criteri`/`definition` **未见任何「缺乏标准化诊断标准」的表述**；相反该文明确指出**已有两种经验证的专用量表**（CVS-Q 与 CVSS17）："two DES-specific questionnaires developed to reliably measure ... and diagnose the condition"。**若报告把此因果归于 Pucker，该引用不支持该主张。**（「缺乏标准化标准」的说法在本领域真实存在，但属于**别的**文献，如 Sheppard & Wolffsohn 2018。）
- **★ 该区间是两类工具的拼接**：经验证量表臂为 **8.2%–95.8%**；研究者自编量表臂（凡有任一症状即判为病例）为 **48.2%–100%**。「8.2%–100%」是跨两类**不可比**测量的外包络。**把它当作单一区间引用，正是报告在别处所批评的那种拼接。**
- **且原文明确拒绝「所以这个数字没有意义」的读法**，逐字："even the lower range of the prevalences suggests that practitioners should be regularly screening all patients for DES."
- **建议改写为**：「8.2%–100% 的跨度反映的是人群与测量工具的异质性；若限定在经验证量表则收窄为 8.2%–95.8%，而 100% 的上限来自把任何症状都计为病例的自编问卷。」

### f) Cochrane 2023 防蓝光镜片 — **推翻 FAIR，但 GRADE 等级用错了结局**

- **文献 [V-PRIMARY]**：Singh S, Keller PR, Busija L, McMillan P, Makrai E, Lawrenson JG, Hull CC, **Downie LE**. "Blue-light filtering spectacle lenses for visual performance, sleep, and macular health in adults." *Cochrane Database Syst Rev* 2023 Aug 18;8(8):CD013244. DOI 10.1002/14651858.CD013244.pub2. PMID 37593770。
  - **引用形式须改**：第一作者是 **Singh**，Downie 是**末位通讯作者**。宜作「Singh et al. 2023」。（流传「Downie et al.」是因 2019 年的**研究方案**由 Downie 领衔——注意**别把方案当成综述引用**。）
- **「17 项 RCT」— [V-PRIMARY] 正确**：逐字 "We included **17 RCTs**, with sample sizes ranging from **five to 156** participants, and intervention follow-up periods from less than one day to five weeks."
  - **总人数 619 需谨慎**：该数字只见于 Cochrane 的**通俗摘要页**，**综述摘要本身未给总 N**。若要用须注明出处，否则宜只写「17 项 RCT，单项样本 5–156 人」。
- **★ 「probably makes no difference」用在视疲劳上 = 把 GRADE 等级上调了一级 — 须修正**
  - 作者对**视疲劳**的原话是：「There **may be no difference** in subjective visual fatigue scores ... (**low-certainty evidence**)」——**low**。
  - "**probably** little or no effect" 这一措辞属于**矫正视力 BCVA**（MD 0.00 logMAR, 95% CI −0.02 到 0.02；1 项研究 156 人；**moderate-certainty**）。
  - 在 Cochrane 的 GRADE 惯例里，"**probably**"=中等确定性、"**may**"=低确定性。「probably makes no difference 适用于视疲劳」这一说法**只能作为 Cochrane 新闻稿的转引**，不是作者对该结局的结论。**建议改引 Cochrane 的 key message：「may not reduce short-term eyestrain」。**
- **睡眠「very low certainty」— [V-PRIMARY] 正确**，逐字："We **do not know** if blue-light filtering spectacle lenses are equivalent or superior ... with respect to sleep quality (**very low-certainty evidence**)"；6 项 RCT 148 人中**3 项报告改善、3 项报告无差异**。
  - **注意**：作者立场是「**不知道 / 不确定**」，**不是「已证明无效」**。把它读成零结果属于过度主张。
- **各结局 GRADE**：视疲劳 Low／闪烁融合频率 Low／**BCVA Moderate**／日间警觉 Very low／**睡眠质量 Very low**／器械相关不良反应 Low；对比敏感度、色觉、眩光不适、**黄斑健康**、血清褪黑素等**完全无 RCT 证据**。
- **不可称之为「元分析」**：逐字 "We did **not perform meta-analyses** for any of the outcome measures"。是**未作合并的系统综述**。
- 偏倚：无一研究在全部七个域低风险；65% 因结局评估者未盲而高风险；仅 35% 预注册。
- **该节最强的一点**是黄斑保护主张——**该结局的 RCT 证据为零**。

### g) 「手机成瘾」的诊断地位 — **推翻 FAIR，且 2026 这个年份是对的**

- **DSM-5/DSM-5-TR 与 ICD-11 均无「手机成瘾」/「屏幕成瘾」— 确认。** 精确表述：
  - **ICD-11**「物质使用或成瘾行为所致障碍」下的成瘾行为类，仅含 **6C50 赌博障碍**与 **6C51 游戏障碍**，外加残余类目 **6C5Y**（问题性手机使用若要编码只能落在此）。[V-SECONDARY——WHO 浏览器为 JS 单页应用、API 需 OAuth，未能一手读取；但在数十篇索引文献中一致互证]
  - **DSM-5/DSM-5-TR**：**网络游戏障碍仅列于第三部分「有待进一步研究的状况」，不是可编码诊断**；DSM-5 中**唯一**正式承认的行为成瘾是**赌博障碍**。网络成瘾、手机成瘾、社交媒体成瘾均未收录。**你的表述精确且正确。**
- **★ Wegmann 2026 论文确实存在，年份正确 [V-PRIMARY]**：
  - Wegmann E, Behrendt S, Cousijn J. "**Does smartphone addiction exist? A critical evaluation of the validity of behavioural addiction symptoms in problematic smartphone use.**" *Addiction*, **online ahead of print 2026-10-27**. DOI **10.1111/add.70688**. PMID 42947466。
  - **作者仅三位**（非大型团队）；**尚无卷号、期号、页码**——**须按「在线预发表」引用，不可编造卷页**。
  - **★ 论证范围须精确**：它否定的是**「作为一种独立的行为成瘾」**，**不是**说该现象不存在。摘要逐字："The assumption that problematic smartphone use **is a distinct behavioural addiction** is not valid."；以及："Future research should use more robust methods to clarify **whether it can be conceptualised within the addiction framework or as an alternative mechanism or medium for a different type of disorder.**"
  - 即作者**把成瘾框架留作悬而未决**，并提出手机可能只是**其他障碍的媒介/载体**。
  - **措辞红线**：写「Wegmann 等否定其构念效度」**可以**；写成「证明手机成瘾不存在」「是个神话」则**过度主张**。
  - 谱系补充（若需）：Montag, Wegmann, Sariyska, Demetrovics, Brand (2020, *J Behav Addict*) 主张问题性手机使用宜视为**网络使用障碍的移动端亚型**，而非独立成瘾——这是「宜以别种方式概念化」的代表作，与 2026 这篇**不是同一篇**。

---

## 汇总：建议的处置

| 主张 | 裁定 | 处置 |
|---|---|---|
| Allcott N=2,844 | [WRONG — 2,743 / 分析样本 1,661] | **改数字并注明阶段** |
| 停用 4 周、依从 >90%、停用前 BDM | [V-PRIMARY] 正确 | 保留 |
| 中位 WTA ≈ \$102 | [WRONG — 中位 \$100；\$102 是报价非 WTA] | **改写** |
| 80% 说停用有好处 | [V-PRIMARY] 属实 | 保留，**但须补：对照组亦倾向认同；两组评价的停用时长不同** |
| 生活满意度 +0.12 / 焦虑 −0.10 / 抑郁 −0.09 / 快乐 +0.08 SD | [V-PRIMARY] **四项全对且各自显著（经多重检验校正）** | 保留，**可加强**；但须补「实时短信测量不显著」 |
| 实验后需求下降 | [V-PRIMARY] 指数 −0.61 SD；app 时长 −11 分钟/−22%；估值 −14% | 保留 |
| 新闻知识 −0.19 SD | [V-PRIMARY] 显著 | 保留 |
| $102 vs 80% = 「偏好矛盾」 | **解读层加，作者称 "tensions...fodder for future research"** | **改写为「两种福利度量未决的张力」** |
| 第二 RCT N>35,000 / 六周 / 预注册 | [V-PRIMARY] 正确 | 保留 |
| 第二 RCT「幸福感 0.04–0.06 SD 方向一致」 | **[WRONG — 该论文未测幸福感]** | **删除或彻底改写** |
| 拨号 12.2 / 短信 6.1 / 浏览 2.7 / 通话 2.2 | [V-PRIMARY] 正确 | 保留，**补 CI** |
| 伸手拿手机 9.1 | **[WRONG — 正确值 4.8 (2.7–8.4)；9.1 是非手机物品]** | **必须修正** |
| 短睡眠 OR 1.25 (1.08–1.40) | [V-PRIMARY] 合摘要；原文 Table 2 作 1.41 | 保留，**须带 I²≈97% 与预测区间跨 1** |
| 连续效应 −0.05 | [V-PRIMARY] 但**单位非 SD 非小时** | **改用作者口径「少睡约 3–5 分钟/每多 1 小时」** |
| 22–44 分钟/夜（Sleep Medicine Reviews） | **[UNVERIFIED — 查无此文]** | **删除** |
| 近视 OR 1.21 (1.13–1.30), 45 项, 335,524 | [V-PRIMARY] 四数全对 | 保留 |
| 近视结局表述 | **结局为现患，发病率分析不显著** | **改措辞，勿写「罹患/进展」** |
| 户外 OR 0.53 | [V-PRIMARY] 属实 | **补 CI 0.34–0.82；核对脚注是否误指 Xiong 2017；注明仅 3 项队列** |
| (a) 「两项失败复制 Ruiz Pardo & Minda」 | **[WRONG — 实为一篇、一项研究；「两项」源于 FORRT 把预印本与正式版重复计数]** | **改为「一项」，或以 Hartmann 2020 充第二项并注明是概念性复制** |
| (a) 元分析 g=−0.14 (−0.24,−0.03), 22 项 | [V-PRIMARY] 数字分毫不差 | 保留，**但须标明这是跨全域总效应且 p<0.05 显著**；注意力为 −0.07 (p=.29)、记忆为 −0.23 (p<.001) |
| (a) 「注意力效应为零」 | 属实，**但这是 Ward 自己报告的结果** | 改述，勿写成后人推翻 Ward |
| (b) 23分15秒源自 2006 Gallup 访谈 | [V-PRIMARY] 正确 | 保留（可加 Mark 本人「not so long」的反讽） |
| (b) 25分26秒 / SD 54分48秒 | [V-PRIMARY] **完全正确** | 保留，**补：含中间 2.26 件插入任务，非认知重聚焦耗时；N=24** |
| (b) CHI 2008 更快但更有压力 | [V-PRIMARY] 正确，N=48 | 保留 |
| (c) 多任务偏倚校正后不显著 | [V-PRIMARY] d=.17→.07 (p=.81) / .001 | 保留，**限定为「实验室分心任务」，并纳入作者「可能很弱但真实」的让步** |
| (c) Parry & le Roux | **[UNVERIFIED]** | **不要引用**；该主张由 Wiradhany & Nieuwenstein 2017 独力承载 |
| (d) Hansraj 2014 是计算模型非测量 | [V-PRIMARY] 正确 | 保留 |
| (d) 「27 kg / 60 lb」 | **单位冲突：两者是同一个数（60°）；27 磅=12.2kg 是 15°** | **写明角度** |
| (d) 期刊非同行评审/未收录 | **[WRONG — 2014 年确在 MEDLINE 收录期内]** | **删除此攻击点**；改攻未验证模型＋退变推论为臆测＋静态外推累积剂量 |
| (d) 「已被广泛驳斥」 | **未找到任何正式驳文** | **改为「未见正式学术驳斥」** |
| (e) 8.2%–100% 区间 | [V-PRIMARY] 摘要逐字确有 | 保留区间，**但须披露它拼接了经验证(8.2–95.8%)与自编(48.2–100%)两类工具** |
| (e) 成因＝缺乏标准化诊断标准 | **[WRONG — 原文归因于「人群不同＋工具不同」，且明确指出已有两种经验证量表]** | **改写归因** |
| (f) 17 项 RCT | [V-PRIMARY] 正确（单项样本 5–156） | 保留；619 总人数仅见于通俗摘要页，**须注明或略去** |
| (f) 「probably makes no difference」用于视疲劳 | **[WRONG — 视疲劳是 "may be no difference"，low certainty；"probably" 属 BCVA/moderate]** | **改引 "may not reduce short-term eyestrain"** |
| (f) 睡眠「very low certainty」 | [V-PRIMARY] 正确（3 项改善 vs 3 项无差异） | 保留，**但须写成「不确定」而非「已证无效」** |
| (f) 称其为「元分析」 | **[WRONG — 未作任何合并]** | 改为「系统综述」 |
| (f) 引用作 Downie et al. | 宽松但不准确 | 改为 **Singh et al. 2023** |
| (g) 手机成瘾不在 DSM-5 与 ICD-11 | [V-PRIMARY/V-SECONDARY] **精确正确** | 保留 |
| (g) Wegmann et al. 2026 *Addiction* | [V-PRIMARY] **存在，2026 年份正确**，DOI 10.1111/add.70688，三作者 | 保留，**按在线预发表引用（无卷页）；且其否定的是「作为独立行为成瘾」，不是否定现象本身** |
