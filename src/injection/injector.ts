/**
 * 注入编排器 —— T4a 的核心流程。
 *
 * 把三件事缝在一起,且顺序本身就是不变式:
 *
 * 1. **同步快路径**(`fast-path-cache`)→ 首帧之前就位(INV-3)
 * 2. **异步权威判定**(`SettingsRepository` + `resolveRule`)→ 纠正并回写缓存
 * 3. **INV-8 短路**:`masterEnabled === false` 时**立即退出**,
 *    不读规则、不匹配、不注入(ADR-027)
 * 4. **已打开标签页的实时更新**(`subscribeSettings`)→ 见下方该项的长注释。
 *    ADR-062 的声明式注册只管**下一次导航**;已经打开的页面只有这条 JS 路径
 *    能改,故它是 DESIGN.md §6 T4a 「已打开标签页的实时更新」条款的
 *    **唯一**实现机制。
 *
 * 本模块不碰 `chrome.*`,全部依赖由调用方注入 —— 故可在 Node 下完整单测
 * (INV-8 的 spy 断言正是靠这一点做到「机械可判定」而非「人工看一遍」)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **INV-8 在同步阶段同样成立 —— 本轮修正的核心**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 旧实现的同步快路径**无条件**读缓存并上色,此时 `masterEnabled` 尚不可知
 * (它在异步的 `chrome.storage` 里)。于是主开关 OFF 时,每次冷加载都会
 * 先把页面上色、等异步读完再撤 —— 而 INV-8 的原文是「**不注入**」,
 * 不是「注入了再纠正」;ADR-027 给的理由更直白:「万一某条规则有问题,
 * **关主开关可彻底止血**」。先上色再撤 = 止不住血。
 *
 * 修正:缓存条目自带写入时的 `masterEnabled` 标记,
 * `readFastPath` 只在该标记为 `true` 时才返回命中,否则返回 `unknown`
 * ——「不知道」一律按**什么都不画**处理。于是:
 *
 * - 主开关 OFF 时写入的条目 → 永远不会让任何页面上色;
 * - 主开关从 ON 翻到 OFF 后,异步阶段会 `clearFastPath` 把旧条目**删掉**,
 *   旧条目因此连一次都不会被用上(删除发生在该 host 的本次导航,
 *   而该次导航的同步阶段本就因主开关仍 ON 的旧标记而上过色 ——
 *   见下方 `runInjector` 中对这一格的处理)。
 *
 * 代价是「主开关刚被关掉的那一瞬,已经开着的标签页」仍需异步阶段来撤,
 * 这是不可避免的(那一帧早已画出,无同步手段可干预),且不属于
 * 「content script 是否运行」的范畴 —— INV-8 管的是**新的页面加载**。
 */

import {
  type FilterSettings,
  type ResolvedRule,
  filterCssValue,
  hostFromUrl,
  resolveRule,
} from '../domain/index.js';
import { type FilterTarget } from './apply-filter.js';
import {
  type SyncKeyValueStore,
  clearFastPath,
  readFastPath,
  writeFastPath,
} from './fast-path-cache.js';
import {
  type ComputedStyleReader,
  readRegisteredMarker,
} from './registered-marker.js';
import {
  type OnConnectLike,
  type PreviewReceiverHandle,
  type RenderArbiter,
  createRenderArbiter,
  startPreviewReceiver,
} from './preview-receiver.js';
import {
  type LivenessHandle,
  type MutationObserverFactory,
  startLiveness,
} from './liveness.js';

export interface InjectorDeps {
  /** 注入目标 —— 生产环境恒为 `document.documentElement`(T0 spike §1)。 */
  readonly target: FilterTarget;
  /** 同步缓存存储 —— 生产环境为宿主 origin 的 `localStorage`(ADR-060,见 `fast-path-store.ts`)。 */
  readonly store: SyncKeyValueStore;
  /** 当前页面 URL。 */
  readonly url: string;
  /** 读取权威设置(异步)。 */
  readonly readSettings: () => Promise<FilterSettings>;
  /**
   * 订阅设置变更(可选)。
   *
   * 🔴 **INV-8 的最后一格**:主开关被关掉的**那一刻**就把本 host 的快路径缓存
   * 抹掉,而不是等下一次导航的异步阶段去清。
   *
   * 不接这个订阅会留下一个实测可见的窗口:用户关掉主开关后,缓存条目仍写着
   * 写入时的 `masterEnabled: true`,于是**下一次**导航的同步阶段仍会命中它、
   * 把页面上色,直到该次导航的异步阶段才清掉(实测 news.ycombinator.com
   * 约 2ms 可见,第 2 次之后的导航才干净)。ADR-027 要的是「关主开关可彻底止血」,
   * 2ms 也是血。
   */
  readonly subscribeSettings?: (
    listener: (settings: FilterSettings) => void,
  ) => () => void;
  /** 时钟,默认 `Date.now`(便于测 TTL 边界)。 */
  readonly clock?: () => number;

  /**
   * 计算样式读取器(测试注入用);缺省用全局 `getComputedStyle`。
   *
   * 🔴 **这是 INV-3 在冷缓存下的输入通道**(见 `registered-marker.ts`):
   *    声明式注册(ADR-062)注入的预生成 CSS 自带一行无门控的
   *    `html { --ccf-registered: ccf-gray-100; }`,同步读出它即可知道
   *    「浏览器已判定本 host 该上色」,无需等异步 `chrome.storage`。
   *
   * ⚠️ 它**不是**对任何 ADR 保证的开关:缺省就走生产路径(全局
   *    `getComputedStyle`),传入只为让 Node 下的单测能机械断言编排。
   */
  readonly getComputedStyle?: ComputedStyleReader;

  // ───────────────────────── T4b 新增(全部可选,向后兼容) ─────────────────────────

  /**
   * 预览接收端的接入点(**ADR-049**,T4b)。
   *
   * 传入 `chrome.runtime.onConnect` 即启用实时预览;不传则行为与 T4a 完全一致
   * (`runInjector` 的所有既有调用点因此无需改动 —— 这是「additive」的字面含义)。
   *
   * 🔴 路由由 DESIGN.md §6 T4b **定死**:popup 用
   * `chrome.tabs.connect(tabState.tabId, { name: 'preview' })` **直连**
   * content script,**不经 service worker 中转**。在接收端这一侧,
   * `chrome.tabs.connect` 发起的连接就表现为一次 `chrome.runtime.onConnect`
   * —— 故这里要的正是 `onConnect`,而**不是** `onMessage`。
   */
  readonly onConnect?: OnConnectLike;

  /**
   * 预览接收端开关（T4b）。
   *
   * `true` 且未传 `onConnect` 时，从全局 `chrome.runtime.onConnect`
   * 取用—— 这是生产入口（`entrypoints/content.ts`）走的路。
   *
   * 📌 为何不让入口直写 `onConnect: chrome.runtime.onConnect`：
   *    `chrome` 在本项目的 `tsc` 配置下无全局类型（ADR-066 的
   *    `--noEmit` 会报 TS2304），且在非扩展上下文求值会抛——
   *    同 `entrypoints/background.ts` 里 `chromeRuntime()` 的理由。
   *    按本仓已有约定，平台取用统一收束在 `globalThis` 取值的
   *    软失败辅助函数里（见 `preview-receiver.ts` 的 `defaultOnConnect`）。
   *
   * 它是一个**路径**开关，不是对 ADR-049 保证的开关：生产入口恒为 `true`，
   * 由 `tests/t4b-static-gates.test.ts` 的断言把守。
   */
  readonly preview?: boolean;

  /**
   * 存活性守护开关(**INV-5 / ADR-017**,T4b)。
   *
   * `false`(缺省)= 不启动 observer,行为与 T4a 一致。
   * 生产环境(`entrypoints/content.ts`)传 `true`。
   *
   * 📌 这是一个**路径**开关,不是对 ADR-017 保证的开关:生产入口恒为 `true`,
   * 它存在只为让既有单测与未来的非浏览器宿主能不启动 observer。
   * 把 ADR 的保证藏在一个默认关闭的 flag 后面是不允许的,故见
   * `tests/t4b-static-gates.test.ts` 中那条断言:生产入口必须开着它。
   */
  readonly liveness?: boolean;

  /** 存活性 observer 工厂(测试注入用);缺省用全局 `MutationObserver`。 */
  readonly observerFactory?: MutationObserverFactory;

  /** 存活性速率上限:一个窗口内允许的恢复次数(见 `liveness.ts`)。 */
  readonly maxRestoresPerWindow?: number;

  /** 存活性速率窗口长度(毫秒)。 */
  readonly livenessWindowMs?: number;
}

/** 一次解析的结果:应套用的 filter 值,`null` = 不套。 */
export type Decision = string | null;

/**
 * 纯判定:给定设置与 URL,算出该页应套用的 filter 值。
 *
 * 🔴 **INV-8 / ADR-027 的强制点之一**:`masterEnabled === false` 时
 * **直接返回 null,不进入 `resolveRule`** —— 即「不读规则、不匹配」。
 * 这里用 `resolveRule` 而非 `resolveActiveRule`,正是为了让主开关的短路
 * 在本文件里**可见且可被 spy 断言**:调用方传入的匹配函数被调用了几次,
 * 是 T4a gate 要机械判定的事项,藏进 `resolveActiveRule` 的 if 里就测不到了。
 */
export function decide(
  settings: FilterSettings,
  url: string,
  match: typeof resolveRule = resolveRule,
): Decision {
  // INV-8:主开关凌驾一切。不读规则、不匹配。
  if (!settings.masterEnabled) return null;

  const resolved = match(settings, url);
  if (resolved === null) return null;

  return filterCssValue(resolved.rule.mode, resolved.rule.intensity);
}

export interface InjectorRunResult {
  /** 同步阶段是否命中缓存并立即应用(INV-3 的可观测证据)。 */
  readonly fastPathHit: boolean;
  /**
   * 同步阶段是否靠**声明式注册的自述标记**(`--ccf-registered`)上了色。
   *
   * 这是 INV-3 在**冷缓存**下的可观测证据 —— 快路径返回 `unknown` 时,
   * 零闪烁全靠这一条(见本文件同步阶段那段注释与 `registered-marker.ts`)。
   */
  readonly registeredHit: boolean;
  /** 同步阶段的推测值。 */
  readonly speculative: Decision;
  /** 异步阶段的权威值。 */
  readonly authoritative: Decision;
  /** 权威值是否推翻了推测值(说明缓存曾经陈旧)。 */
  readonly corrected: boolean;
}

/**
 * 启动注入。
 *
 * **返回的 Promise 只覆盖异步阶段** —— 同步阶段在本函数返回之前就已完成,
 * 这是 INV-3 所依赖的关键性质:调用方(content script 的 `main`)不 await
 * 也能保证快路径已经生效。
 */
export function runInjector(deps: InjectorDeps): {
  readonly fastPathHit: boolean;
  /**
   * 同步阶段是否靠注册自述标记上了色 —— **同步可读**,
   * 与 `fastPathHit` 并列,便于调用方与 gate 立刻观测 INV-3 的承担者。
   */
  readonly registeredHit: boolean;
  readonly settled: Promise<InjectorRunResult>;
  /**
   * 渲染仲裁器 —— 本次运行中**唯一**的 DOM 写入点(T4b)。
   *
   * 暴露出来是为了让预览(ADR-049)与存活性(INV-5)挂在同一个真相上:
   * 三条路径(规则解析 / 预览覆盖 / 存活性恢复)若各自直接写 DOM,
   * ADR-049 的「覆盖优先、底层不重绘」就只能靠每个调用点记得判断 ——
   * 那是会漏的。改为结构保证:谁都只能经过它。
   */
  readonly arbiter: RenderArbiter;
  /** 预览接收端(未传 `onConnect` 时为 `null`)。 */
  readonly preview: PreviewReceiverHandle | null;
  /** 存活性守护(未开启时为 `null`)。 */
  readonly liveness: LivenessHandle | null;
} {
  const clock = deps.clock ?? Date.now;
  const host = hostFromUrl(deps.url);

  // 🔴 T4b:仲裁器就地创建,随后**所有**对 target 的写入都走它。
  //    初始底层值为 `null`,但注意它**不会**因此立刻把 `data-ccf-off` 写上去 ——
  //    `createRenderArbiter` 只在 `setBase`/`setOverride`/`clearOverride`
  //    被调用时才渲染。这一点对 INV-3 是**致命重要**的:
  //    构造时就渲染 `null` 等于在首帧把预生成 CSS(ADR-063)压掉
  //    (见 apply-filter.ts 对 SUPPRESS_ATTR 的实测记录:首帧 `filter: none`)。
  const arbiter = createRenderArbiter(deps.target, null);

  // ── 同步阶段:首帧之前 ───────────────────────────────────────────────
  //
  // 🔴 只有在缓存**明确**告知「写入时主开关是开的」时才动页面。
  //    `unknown`(无缓存 / 过期 / 损坏 / 写入时主开关是关的)一律
  //    **什么都不做** —— INV-8 要的是不注入,不是注入后纠正。
  let speculative: Decision = null;
  let fastPathHit = false;
  let registeredHit = false;

  if (host !== null) {
    const cached = readFastPath(deps.store, host, clock());
    if (cached.kind === 'filter') {
      fastPathHit = true;
      speculative = cached.filterValue;
      // 命中即刻应用 —— 与静态 CSS 同处首帧之前(INV-3)。
      // 走仲裁器:此刻必然还没有预览覆盖(端口尚未连上),故等价于直接
      // `syncFilter`,但保持了「唯一写入点」这条不变式。
      arbiter.setBase(speculative);
    } else if (cached.kind === 'none') {
      // 明确「该 host 不匹配」:这也是一次有效命中,但**无需任何 DOM 写入**
      // (默认态本就是不滤镜)。记为命中是为了让 INV-3 的观测区分
      //「知道不该上色」与「不知道」。
      fastPathHit = true;
      speculative = null;
    }
    // cached.kind === 'unknown' → 落到下面的注册自述探测。
  }

  // ── 🔴 声明式注册的同步自述(INV-3 的冷缓存承担者)────────────────────
  //
  // **这一段修的是 ADR-069 的 class 门控带来的一个实测回归。**
  //
  // 门控之前,预生成 CSS 是无条件的 `html { filter: … }` —— 首帧上色
  // **零 JS 依赖**,这正是 ADR-062 零闪烁保证的基础。加了 `.ccf-on`
  // 之后,上色需要 JS 加 class;而上面那段在**冷缓存**下
  // (`cached.kind === 'unknown'`)什么都不做,class 于是要等异步
  // `chrome.storage` 读完 —— JS 被重新放回了页面加载的关键路径。
  //
  // 真实 Chrome 逐帧录屏抓到:`coldCache 1/4`、`1/3`、`1/5`、`2/127`
  // 帧带色(完整渲染的未滤镜页面),而门控之前同一套 harness
  // 「连续 5 次全绿」。与 `filter-file-css.ts` 记载的那次
  // `html[data-ccf-on]` 失败是**同一个根因**:门控等异步结果。
  //
  // 🔴 修法不是撤门控(那会把前向引用的不确定性放回来),而是
  //    **补上冷缓存下缺失的那个同步输入**:预生成文件自带一行无门控的
  //    `html { --ccf-registered: ccf-gray-100; }`,而该文件是按
  //    **用户规则算出的 `matches`** 注册的 —— 它出现在文档里,就等于
  //    浏览器已经判定过「本 host 该上色,用这个 (mode,intensity)」。
  //    `getComputedStyle` 读它**完全同步、零存储、零 await**。
  //
  // 📌 只在快路径**没给出肯定答案**时才探测(`speculative === null`):
  //    快路径命中时值已经写上去了,再探一次是无谓的样式计算。
  //    两者是**或**的关系 —— 各自覆盖对方的盲区,见
  //    `registered-marker.ts` 中那张分工表。
  //
  // ⚠️ 这里**不**短路 INV-8:主开关 OFF 时 `desiredRegistrations()` 返回
  //    空集、`reconcile()` unregister 全部,CSS 文件压根不会被注入,
  //    于是本探测读到空串、什么都不做。主开关的强制点仍是「注册与否」。
  if (speculative === null) {
    const registered = readRegisteredMarker(
      deps.target,
      deps.getComputedStyle,
    );
    if (registered !== null) {
      registeredHit = true;
      speculative = filterCssValue(registered.mode, registered.intensity);
      // 🔴 经仲裁器写入 —— ADR-069 的两步序列(先 SVG 后 class)由
      //    `syncFilter` 独家实现,这里只提供值,不重新实现顺序。
      arbiter.setBase(speculative);
    }
  }

  // ── 变更订阅:已打开标签页的实时更新 ────────────────────────────────
  //
  // 🔴 **ADR-062 下这条路径是 gate 的独立条款,不再只为 INV-8 服务。**
  //
  //    声明式注册(ADR-062)管的是**下一次导航**:Chrome 的既定行为是
  //    「取消注册不会移除已注入的样式」,`registerContentScripts` /
  //    `unregister` / `update` 对**已经打开**的标签页一概无效
  //    (真实 Chrome 实测:删掉规则后已打开页面的 `filter` 不变,
  //    必须重新加载才会消失)。于是 DESIGN.md §6 T4a 明文要求:
  //
  //      > 已打开标签页的实时更新:注册变更**不影响**已打开页面
  //      > (这是 Chrome 的既定行为),故 JS content script 仍须能对
  //      > 已打开页面即时生效
  //
  //    JS 路径是该条款**唯一**的实现机制。时序在这里无关紧要 ——
  //    页面早已画完,没有首帧可赶。
  //
  // 🔴 **上一轮的真实缺陷**:这个监听器只分支 `!settings.masterEnabled`,
  //    于是除主开关外的任何设置变更对已打开的标签页都是 no-op。
  //    真实 Chrome 实测(example.com,标签页保持打开、不导航):
  //    强度 100→30 仍 `grayscale(1)`;模式 Grayscale→RedGreen 仍 `grayscale(1)`;
  //    匹配规则被**整条删除**后仍 `grayscale(1)`(不重载就撤不掉)。
  //    只有 masterEnabled=false 正常工作 —— 因为它是唯一被分支到的情况。
  //
  //    修正:**重新做一次完整判定**(`decide`,它内部已含 INV-8 短路),
  //    再交给幂等的 `syncFilter`。于是四个方向全部覆盖:
  //    强度变、模式变、规则增删、主开关翻转。
  //
  // 📌 为什么用 `syncFilter` 而不是 `applyFilter`/`removeFilter` 二选一:
  //    `syncFilter` 在已处于期望状态时**零 DOM 写入**(INV-1:不给站点的
  //    attribute MutationObserver 制造无意义回调),且 `null` 分支会显式
  //    设上 `data-ccf-off` —— 预生成 CSS(ADR-063)用裸 `html` 选择器,
  //    只摘自家属性压不掉它(见 apply-filter.ts)。
  //    (T4b 起这一步经由 `arbiter.setBase`,它内部用的正是 `syncFilter`。)
  if (deps.subscribeSettings) {
    deps.subscribeSettings((settings) => {
      const next = decide(settings, deps.url);

      // 🔴 **ADR-049 的优先级条款就落在这一行**(T4b)。
      //
      //    `setBase` 在预览覆盖活动时**只更新底层值、不重绘**;
      //    覆盖撤掉时才按这里存下的最新底层值渲染。
      //
      //    为什么必须如此:popup 的编辑视图里,滑块走预览通道(每次拖动都渲染),
      //    而**别处**的变更(另一个窗口、T5 的同步、锁定到期)仍会经
      //    `chrome.storage.onChanged` 到达这里。若它直接重绘,用户会看到
      //    DESIGN.md 点名的那个 bug:
      //    「拖到 70 → 旧的 50 迟到 → 页面闪回 50 再跳到 70」。
      //
      //    注意**缓存簿记照常进行**(下面几行):`onChanged` 带来的是
      //    权威的规则变更,它该进快路径缓存;被压住的只有**重绘**。
      //    预览值本身从不进入这条路径 —— 它压根不经过 storage(ADR-049)。
      arbiter.setBase(next);

      if (host === null) return;

      if (!settings.masterEnabled) {
        // 🔴 INV-8 / ADR-027「关主开关可彻底止血」:条目记录的是**写入时**的
        //    主开关状态,无法预知用户之后会关掉它。若只靠「下次导航的异步
        //    阶段再清」,那次导航的**同步阶段**已按陈旧推测上过色
        //    (实测约 2ms 可见)。故在主开关变化的那一刻就删掉。
        clearFastPath(deps.store, host);
        return;
      }

      // 主开关仍开:把新判定**回写**成快路径条目,使下一次导航的同步阶段
      // 直接命中新值,而不是先按旧值上色再被异步阶段纠正(ADR-060)。
      const resolved = resolveRule(settings, deps.url);
      writeFastPath(
        deps.store,
        host,
        true,
        resolved === null
          ? null
          : { mode: resolved.rule.mode, intensity: resolved.rule.intensity },
        clock(),
      );
    });
  }

  // ── 异步阶段:权威判定 + 纠正 + 回写 ────────────────────────────────
  const settled = (async (): Promise<InjectorRunResult> => {
    const settings = await deps.readSettings();

    // 🔴 INV-8 / ADR-027:主开关关闭时 content script 立即退出 ——
    // 不读规则、不匹配、不注入。
    //
    // 连带把该 host 的缓存**删掉**,使「关主开关可彻底止血」(ADR-027 的理由)
    // 对后续的每一次加载都成立:条目不存在 → `readFastPath` 返回 unknown
    // → 同步阶段什么都不画。
    if (!settings.masterEnabled) {
      if (host !== null) clearFastPath(deps.store, host);
      // T4b:经仲裁器撤除(`setBase(null)` 内部即 `syncFilter(target, null)`,
      // 等价于旧的 `removeFilter` 但保持唯一写入点)。
      //
      // 📌 主开关 OFF 时预览覆盖**不该**还活着:ADR-049 明文把
      //    `masterEnabled == false` 列为 popup 侧的「一律不发送」情形
      //    (INV-8:content script 根本没运行,没有接收方)。但接收端不能
      //    依赖发送端守规矩 —— 若此刻仍有覆盖活动,`setBase` 会按 ADR-049
      //    的优先级压住重绘,页面会停在预览色上,而 INV-8 要求的是
      //    「主开关可彻底止血」。故这里**显式撤掉覆盖**,让主开关赢。
      //    这不是违反 ADR-049 的优先级 —— 那条优先级裁决的是
      //    「预览 vs 规则解析结果」,而 INV-8/ADR-027 的主开关凌驾一切
      //    (decide() 第一行即是此意)。
      arbiter.clearOverride();
      arbiter.setBase(null);
      return {
        fastPathHit,
        registeredHit,
        speculative,
        authoritative: null,
        corrected: speculative !== null,
      };
    }

    const resolved: ResolvedRule | null = resolveRule(settings, deps.url);
    const authoritative: Decision =
      resolved === null
        ? null
        : filterCssValue(resolved.rule.mode, resolved.rule.intensity);
    // T4b:同 `onChanged` 路径 —— 预览覆盖活动时只更新底层值、不重绘(ADR-049)。
    //
    // 这一格也是真实存在的时序:用户在 A 站打开 popup 进编辑视图并开始拖动,
    // 此时**本页的异步权威读取**可能才刚返回(MV3 冷启动下
    // `chrome.storage` 的首次读取是百毫秒级)。若它直接重绘,
    // 刚拖出来的预览色会被规则色盖掉一帧。
    arbiter.setBase(authoritative);

    if (host !== null) {
      // 🔴 ADR-025:回写的是 `(mode,intensity)` 这两个**用户设置值**,
      //    不是 `filterCssValue` 算出的派生串(签名里根本没有那个参数)。
      writeFastPath(
        deps.store,
        host,
        true,
        resolved === null
          ? null
          : { mode: resolved.rule.mode, intensity: resolved.rule.intensity },
        clock(),
      );
    }

    return {
      fastPathHit,
      registeredHit,
      speculative,
      authoritative,
      corrected: speculative !== authoritative,
    };
  })();

  // ── T4b:预览接收端(ADR-049) ──────────────────────────────────────
  //
  // 🔴 挂在**同步阶段之后、异步阶段之外**是有意的:接听端口不需要等设置读完。
  //    popup 可能在页面刚开始加载时就已打开并连上来,此时若还没接听,
  //    那次 `connect` 会直接失败(Chrome:无接收方 → 端口立即 disconnect),
  //    表现为「第一下拖动没反应」。
  //
  // 📌 预览覆盖优先于底层值,所以即便此刻异步权威结果尚未返回,
  //    用户拖动滑块也会立刻看到效果 —— 随后到达的权威结果走 `setBase`,
  //    被优先级条款压住不重绘。这正是 ADR-049 想要的顺序。
  const preview =
    deps.onConnect === undefined && deps.preview !== true
      ? null
      : startPreviewReceiver({
          arbiter,
          // 未显式传入时由 `startPreviewReceiver` 从全局 `chrome.runtime`
          // 取用（取不到则降级为不接入，不抛异常）。
          ...(deps.onConnect ? { onConnect: deps.onConnect } : {}),
        });

  // ── T4b:存活性守护(INV-5 / ADR-017) ─────────────────────────────
  //
  // 🔴 `desired` 传的是 `arbiter.current` 而不是一个固定值 —— 恢复必须按
  //    **当前**真相来,而当前真相可能是预览覆盖。否则会出现:
  //    预览中站点脚本摘掉属性 → 我们按规则值恢复 → 用户拖动的预览色丢了。
  const liveness = deps.liveness
    ? startLiveness({
        target: deps.target,
        desired: () => arbiter.current(),
        ...(deps.observerFactory
          ? { observerFactory: deps.observerFactory }
          : {}),
        ...(deps.maxRestoresPerWindow !== undefined
          ? { maxRestoresPerWindow: deps.maxRestoresPerWindow }
          : {}),
        ...(deps.livenessWindowMs !== undefined
          ? { windowMs: deps.livenessWindowMs }
          : {}),
        ...(deps.clock ? { clock: deps.clock } : {}),
      })
    : null;

  return { fastPathHit, registeredHit, settled, arbiter, preview, liveness };
}
