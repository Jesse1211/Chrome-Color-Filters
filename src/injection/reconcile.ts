/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 声明式注册的 `reconcile()`(ADR-062 / ADR-064 / ADR-065)—— INV-3 的主路径。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 这个模块解决的是一个**架构**问题,不是一个实现缺陷
 *
 * 旧架构是「一个 content script 匹配 `<all_urls>`,**运行时判断**该用什么滤镜」。
 * 「运行时判断」必然要查询设置,`chrome.storage` 全系异步,异步必然赶不上首帧 ——
 * **闪烁是该架构的必然结果**。五次独立测量,失败位置从未移动(ADR-062)。
 * ADR-060 的 `localStorage` 快路径修好了 newTab/restart/hot 三态,但修不了
 * **冷缓存**:缓存必须先被填充才能被读到,而「冷缓存」的定义就是还没有记录。
 *
 * ## 新架构把异步工作**挪到规则创建时**
 *
 * 规则是用户在 popup 里创建的 —— 此刻 service worker **必然活着**,延迟免费。
 * 注册在用户还看着 popup 时就完成,并写入浏览器的 StateStore(磁盘)。
 * 之后首次访问该站,浏览器**从磁盘恢复注册,不依赖 SW 先启动**
 * (已核实 Chromium 源码 `extension_user_script_loader.cc`),
 * CSS 在首帧之前注入。
 *
 * 🔴 **不再有缓存需要填充,所以不再有「第一次」。** 这就是冷缓存场景消失的原因。
 *
 * 已核实的 API 事实(ADR-062,不需重新调研):
 * - `css` 文件「在页面的任何 DOM 被构建**或显示**之前」注入(官方文档原文);
 * - **CSS 不受 `runAt` 约束**,比 `document_start` 的 JS 更早;
 * - `css` 只接受**文件路径,不接受内联字符串** → 必须预生成(ADR-063);
 * - 注册能存活浏览器重启、SW 终止、扩展禁用再启用;
 *   **但扩展更新时被清除** → 必须在 `onInstalled` 重建(ADR-065,强制项)。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 三条设计约束,逐条对应 ADR-064
 * ───────────────────────────────────────────────────────────────────────────
 *
 * **1. 按 `(mode, intensity)` 分组,不按 host。**
 * 共享同一滤镜设置的站点合并进同一条注册的 `matches` 数组。
 * 最坏 20 条(INV-7 的规则上限),通常远少于此。
 * 理由(ADR-064):注册的 match pattern 会对**每一次导航**求值,
 * 少量注册携带多个 pattern 优于大量单 pattern 注册。
 *
 * **2. 必须幂等。** `reconcile()` 有四个触发点,**可能并发**:
 * `onInstalled` / `onStartup` / 规则增删改 / `storage.onChanged`。
 * 幂等的实现方式:它**不记忆任何自己的状态**,每次都把
 * 「`getRegisteredContentScripts()` 读到的实际注册」与
 * 「由当前 settings 算出的期望注册」做对比 —— 期望是设置的**纯函数**
 * (见 `desiredRegistrations`),实际由浏览器提供。于是连续调用两次,
 * 第二次必然是 no-op。
 *
 * **3. 必须基于 diff。** 只对变化的部分调 register/unregister/update,
 * 未变的不动。理由不只是性能:`unregister` + `register` 的组合在
 * 两步之间存在一个**没有注册**的窗口,若此时发生导航,那次导航
 * 就没有首帧 CSS —— 一个由「刷新式 reconcile」自己制造的 INV-3 缺口。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## INV-8 / ADR-027:主开关 OFF 时期望注册为**空集**
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ADR-027 的理由是「万一某条规则有问题,**关主开关可彻底止血**」。
 * 若主开关 OFF 时注册仍在磁盘上,那么下一次导航的首帧**仍会**注入
 * 滤镜 CSS —— 止不住血。故 `desiredRegistrations` 在
 * `masterEnabled === false` 时返回空数组,`reconcile()` 据此把
 * 全部注册 unregister 掉。主开关一开回来,下一次 reconcile 再全部装回。
 *
 * 📌 这**不是**「feature flag 覆盖了 ADR 的保证」:ADR-027 本身就要求
 * 主开关 OFF 时扩展完全不工作,注册留着才是违反它。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ## 本模块不碰 `chrome.*`
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 全部平台能力经 `ScriptingPort` 注入。于是 ADR-062/064/065 的全部断言
 * (幂等、diff、分组、更新恢复)都能在 Node 下**机械判定**,
 * 而不是「在真实 Chrome 里看一眼」。生产装配在 `scripting-port.ts`。
 */

import {
  type FilterMode,
  type FilterSettings,
  type Intensity,
} from '../domain/index.js';
import { filterCssFilePath } from './filter-file-css.js';
import {
  ALL_URLS_PATTERN,
  globsToMatchPatterns,
  isIntentionallyAllUrls,
} from './match-pattern.js';

/** 本扩展注册的 content script id 统一前缀 —— 便于只清理自己的注册。 */
export const REGISTRATION_ID_PREFIX = 'ccf-';

/**
 * 一条注册的**声明式描述** —— 字段与 `chrome.scripting` 的
 * `RegisteredContentScript` 对齐的那个子集。
 *
 * 刻意只放我们会用到的字段:多声明一个字段就多一个
 * 「浏览器回读时的值与我们写入的值不一致」从而让 diff 永远判定
 * 「变了」的风险(例如 `world`、`matchOriginAsFallback` 在不同
 * Chrome 版本的默认回读值不同)。
 */
export interface Registration {
  readonly id: string;
  readonly matches: readonly string[];
  readonly css: readonly string[];
  readonly runAt: 'document_start';
  /** ADR-016:根元素 filter 天然覆盖同源与跨域 iframe,无需注入子框架。 */
  readonly allFrames: false;
  /** ADR-062 的关键:注册写入磁盘 StateStore,活过浏览器重启与 SW 终止。 */
  readonly persistAcrossSessions: true;
}

/**
 * 平台端口 —— `chrome.scripting` 中本模块用到的那三个方法。
 *
 * 为什么是一个端口而不是直接调 `chrome.scripting`:见文件头「本模块不碰
 * `chrome.*`」。另外 `getRegisteredContentScripts` 返回的对象可能带
 * 额外字段(见 `Registration` 的注释),端口的返回类型刻意写得宽松,
 * 由本模块自己做字段投影。
 */
export interface ScriptingPort {
  getRegisteredContentScripts(): Promise<readonly RegisteredScriptLike[]>;
  registerContentScripts(scripts: readonly Registration[]): Promise<void>;
  unregisterContentScripts(filter: { ids: readonly string[] }): Promise<void>;
  updateContentScripts(scripts: readonly Registration[]): Promise<void>;
}

/** 浏览器回读到的注册 —— 字段可能多于我们写入的,故全部可选。 */
export interface RegisteredScriptLike {
  readonly id: string;
  readonly matches?: readonly string[];
  readonly css?: readonly string[];
  readonly runAt?: string;
  readonly allFrames?: boolean;
  readonly persistAcrossSessions?: boolean;
}

/**
 * 注册 id —— 由 `(mode, intensity)` 唯一决定(ADR-064 的分组键)。
 *
 * 形如 `ccf-gray-100`,与 DESIGN.md §6 T4a 的示例一致。
 * **id 必须是分组键的纯函数**:这是幂等性的基础 ——
 * 同一组设置在任何一次 reconcile 中都必须算出同一个 id,
 * 否则每次 reconcile 都会「删掉一个旧 id、建一个新 id」,
 * 永远不收敛,且每次都制造一个无注册窗口。
 */
export function registrationId(mode: FilterMode, intensity: Intensity): string {
  // 复用 filterCssFilePath 的短名构词,避免两处各写一份映射而漂移。
  const file = filterCssFilePath(mode, intensity);
  const base = file.slice(file.indexOf('/') + 1, -'.css'.length);
  return `${REGISTRATION_ID_PREFIX}${base}`;
}

/** 本扩展自己的注册 id(用于只清理/只比对自己的那些)。 */
export function isOwnRegistrationId(id: string): boolean {
  return id.startsWith(REGISTRATION_ID_PREFIX);
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 组合不变式(converter × reconcile)—— 本轮缺陷的防回归锚点。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * **不变式:** 一条注册的 `matches` 为 `*://* / *`(全网)**当且仅当**
 * 产生它的那组 glob 里**确实有一个本身就匹配任意 host 的 glob**
 * (`*`、`*.*`)。
 *
 * ## 为什么这条断言必须在这里,而不只是在转换器的单测里
 *
 * 被发现的缺陷**不在转换器里,也不在 reconcile 里,而在两者的接缝上**:
 *
 * 1. `filter-file-css.ts` 产出**裸 `html`** 的滤镜表(ADR-063 的明文规格,
 *    且真实 Chrome 实测证明门控版本会让 ADR-062 收益归零)——  本身正确;
 * 2. 转换器把表达不出来的 glob **兜底成 `*://* / *`** —— 单独看「只是放宽」;
 * 3. `desiredRegistrations()` 把两者**组合**起来 → `matches: ['*://* / *']`
 *    + 一张无条件生效的滤镜表 = **用户配一条 `*.baidu.*`,全网首帧变灰。**
 *
 * 每一层单独测都是绿的;缺陷只在组合处可见。转换器单测只验转换,
 * reconcile 单测历来只喂**精确** glob,于是这个状态
 * **从未被任何门禁驱动到**。修掉第 2 步之后,必须留一条
 * **跨越该接缝**的机械断言,否则下次有人「顺手给降级加个兜底」时,
 * 同样的缺陷会以同样的方式重现 —— 而且同样不会被发现。
 *
 * ## 为什么是 throw 而不是静默过滤
 *
 * 静默过滤会把「转换器出了个不该出的 pattern」变成一条**无声的**
 * INV-3 缺口(该组规则悄悄不注册了)。而 throw 会在单测里当场炸 ——
 * 本函数是纯函数且全部输入来自本地设置,生产环境走到这里意味着
 * 代码被改坏了,不是用户输入异常。`reconcile()` 的调用点有 try/catch
 * (见下方),所以即使在生产炸了,也只是记一条 error、本轮 reconcile
 * 失败,而**不会**让 service worker 崩溃。
 *
 * DESIGN.md §1 匹配语义第 4 条(「无规则命中 → 不套滤镜」)与 INV-1 是
 * 这条不变式的依据。
 */
export function assertNoUnintendedAllUrls(
  registration: Registration,
  sourceGlobs: readonly string[],
): void {
  if (!registration.matches.includes(ALL_URLS_PATTERN)) return;
  if (isIntentionallyAllUrls(sourceGlobs)) return;
  throw new Error(
    `[ccf] 注册 ${registration.id} 的 matches 含 ${ALL_URLS_PATTERN},` +
      `但源 glob ${JSON.stringify(sourceGlobs)} 中没有任何一个本身匹配任意 host。` +
      '这会让一条规则给全网的首帧上色(违反 DESIGN.md §1 匹配语义第 4 条与 INV-1)。' +
      '表达不出来的 glob 必须返回 inexpressible 而不是兜底成全网 —— ' +
      '见 match-pattern.ts 的 MatchPatternConversion.inexpressible。',
  );
}

/**
 * **期望注册集** —— 当前 settings 的纯函数(幂等性的来源)。
 *
 * 1. INV-8 / ADR-027:主开关 OFF → 空集(见文件头)。
 * 2. 按 `(mode, intensity)` 分组(ADR-064),同组的 glob 合并进一个
 *    `matches` 数组。
 * 3. 组内 glob 经 `globsToMatchPatterns` 转换 —— 它**去重且排序**,
 *    于是用户重排规则不会让 diff 误判「变了」。
 * 4. 结果按 id 排序:同上,消掉顺序这个自由度。
 *
 * ⚠️ **被遮蔽的规则(ADR-032 / INV-6)仍然参与注册。**
 * 原因:遮蔽是**按 host** 判定的(`shadowedFlags`),而注册是**按组**的;
 * 一条规则对某个 host 被遮蔽,对另一个 host 可能正是赢家。
 * 真正的「谁赢」由 JS 路径的 `resolveRule` 判定 —— 它才是权威(INV-6)。
 *
 * 📌 这里「注册多一点」的代价**不是零**(本轮更正):预生成 CSS 是裸 `html`、
 * 无条件生效,所以多匹配进来的站点**会有一个已上色的首帧**。
 * 但本条的多匹配是**同一组内的 glob 合并**,每个 glob 仍只匹配它自己该匹配的
 * host —— 合并不扩大任何单条 glob 的匹配集,故这里确实无额外代价。
 * 会扩大匹配集的是 `match-pattern.ts` 的放宽,那里已被限定为**有界**放宽。
 *
 * ⚠️ **`intensity === 0` 的规则同样注册。** 它在视觉上等价于恒等变换,
 * 看似可以省掉,但省掉会让「用户把强度从 0 调到 50」变成
 * 「从无注册到有注册」,而注册生效要等下一次导航 —— 省掉反而制造了
 * 一个强度档位上的时序不一致。统一注册,成本是一个不改变像素的样式表。
 */
export function desiredRegistrations(
  settings: FilterSettings,
): readonly Registration[] {
  // INV-8 / ADR-027:主开关凌驾一切,不读规则、不注册。
  if (!settings.masterEnabled) return [];

  // 分组键 → 该组的全部 glob。用 Map 保序只是为了确定性,最终仍会排序。
  const groups = new Map<
    string,
    { mode: FilterMode; intensity: Intensity; globs: string[] }
  >();

  for (const rule of settings.rules) {
    if (rule === undefined) continue;
    const id = registrationId(rule.mode, rule.intensity);
    const group = groups.get(id);
    if (group === undefined) {
      groups.set(id, {
        mode: rule.mode,
        intensity: rule.intensity,
        globs: [rule.pattern],
      });
    } else {
      group.globs.push(rule.pattern);
    }
  }

  const result: Registration[] = [];
  for (const [id, group] of groups) {
    const matches = globsToMatchPatterns(group.globs);
    // 全部 glob 都非法(`invalid`)或都没有有界超集(`inexpressible`)
    // → 无可注册的 pattern。Chrome 会拒绝 matches 为空的注册(抛错),
    // 而抛错会让整批 register 失败、连带好的那些也装不上。
    //
    // ⚠️ `inexpressible` 落到这里是**刻意的**:该组规则不走声明式首帧路径,
    // 由 JS 路径 + ADR-060 快路径承接。替代方案(兜底成全网)会给整个
    // 互联网的首帧上色 —— 见 match-pattern.ts 的 inexpressible 论证。
    if (matches.length === 0) continue;
    const registration: Registration = {
      id,
      matches,
      css: [filterCssFilePath(group.mode, group.intensity)],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
    };
    // 🔴 跨越 converter × reconcile 接缝的组合不变式(见该函数的注释)。
    assertNoUnintendedAllUrls(registration, group.globs);
    result.push(registration);
  }

  return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** `reconcile()` 算出的 diff —— 返回给调用方便于诊断与断言。 */
export interface ReconcilePlan {
  readonly toRegister: readonly Registration[];
  readonly toUpdate: readonly Registration[];
  readonly toUnregisterIds: readonly string[];
  /** 已存在且与期望一致 —— **不动**(diff 的意义所在)。 */
  readonly unchangedIds: readonly string[];
}

/** 空 plan —— 幂等的可观测证据:第二次 reconcile 应当返回这个。 */
export function isNoOpPlan(plan: ReconcilePlan): boolean {
  return (
    plan.toRegister.length === 0 &&
    plan.toUpdate.length === 0 &&
    plan.toUnregisterIds.length === 0
  );
}

/**
 * 判断一条已存在的注册是否与期望**等值**。
 *
 * 只比对我们自己写入过的字段(见 `Registration` 的注释)。
 * `matches`/`css` 逐元素比,顺序敏感 —— 期望侧已排序,
 * 而浏览器回读保持写入顺序,故顺序敏感不会造成假阳性。
 */
function sameRegistration(
  actual: RegisteredScriptLike,
  desired: Registration,
): boolean {
  const sameList = (
    a: readonly string[] | undefined,
    b: readonly string[],
  ): boolean =>
    a !== undefined && a.length === b.length && a.every((v, i) => v === b[i]);

  return (
    sameList(actual.matches, desired.matches) &&
    sameList(actual.css, desired.css) &&
    actual.runAt === desired.runAt &&
    actual.allFrames === desired.allFrames &&
    actual.persistAcrossSessions === desired.persistAcrossSessions
  );
}

/**
 * 算出 diff。纯函数 —— 不碰平台,故能被直接单测。
 *
 * `forceRebuild` 用于 ADR-065 的扩展更新恢复:`onInstalled` 之后
 * 磁盘上的注册**已被 Chrome 清除**,但 `getRegisteredContentScripts()`
 * 在某些时序下可能仍返回陈旧内容。此时按 diff 走会判定「都没变」而什么都不做,
 * 滤镜**静默失效**,且要等到下一次规则变更才恢复 —— 这正是 ADR-065
 * 把重建列为**强制项**的那个故障。forceRebuild 时一律走
 * 「先 unregister 自己的全部、再 register 期望的全部」。
 */
export function planReconcile(
  actual: readonly RegisteredScriptLike[],
  desired: readonly Registration[],
  forceRebuild = false,
): ReconcilePlan {
  const own = actual.filter((s) => isOwnRegistrationId(s.id));

  if (forceRebuild) {
    return {
      toRegister: desired,
      toUpdate: [],
      toUnregisterIds: own.map((s) => s.id),
      unchangedIds: [],
    };
  }

  const actualById = new Map(own.map((s) => [s.id, s]));
  const desiredIds = new Set(desired.map((d) => d.id));

  const toRegister: Registration[] = [];
  const toUpdate: Registration[] = [];
  const unchangedIds: string[] = [];

  for (const want of desired) {
    const have = actualById.get(want.id);
    if (have === undefined) {
      toRegister.push(want);
    } else if (sameRegistration(have, want)) {
      unchangedIds.push(want.id);
    } else {
      // 🔴 用 update 而非 unregister+register:后者在两步之间存在一个
      //    **没有注册**的窗口,此时发生的导航就没有首帧 CSS(INV-3 缺口)。
      //    规则改强度正是走这条路(css 路径被 update 到新文件)。
      toUpdate.push(want);
    }
  }

  // 期望里没有的,说明规则被删了 / 主开关被关了 / 改了 mode 导致换组。
  const toUnregisterIds = own
    .map((s) => s.id)
    .filter((id) => !desiredIds.has(id))
    .sort();

  return { toRegister, toUpdate, toUnregisterIds, unchangedIds };
}

/** `reconcile()` 的结果。 */
export interface ReconcileResult {
  readonly plan: ReconcilePlan;
  /**
   * 平台调用是否全部成功。
   *
   * 失败**不抛异常**:reconcile 跑在 SW 的事件回调里,抛出去只会变成
   * 一条无人处理的 unhandled rejection。滤镜是辅助功能 ——
   * 注册失败时 JS 路径仍能让已打开与后续页面生效(只是首帧可能闪),
   * 让整个 SW 回调崩掉只会连带破坏别的功能。
   */
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * 幂等、基于 diff 的 reconcile(ADR-062/064)。
 *
 * **顺序是有意的**:先 `register`/`update`(把该有的装上),
 * 再 `unregister`(把不该有的拆掉)。反过来会在两者之间留一个
 * 「旧的已拆、新的未装」的窗口。按此顺序,窗口期内最坏情况是
 * **多**一条注册,而不是**少**一条(后者破 INV-3)。
 *
 * 📌 「多一条」在这里为何可接受(本轮更正了旧表述):多出来的那条是
 * **上一版的同组注册**(同一批用户已配置的站点,只是 mode/intensity 旧),
 * 窗口期为两次 await 之间。代价是该窗口内导航到这些站点可能拿到旧强度的
 * 首帧 —— 一个颜色值的短暂偏差,**不是**给未配置站点上色。
 * (旧注释引用 `match-pattern.ts` 的「超集无可观察影响」论证,
 * 那个论证的前提已被证伪并更正,见该文件头。)
 *
 * 📌 `forceRebuild` 下只能先拆后装(id 相同,不拆无法装),
 * 那是 ADR-065 的更新恢复路径 —— 此时磁盘上的注册**本就已被 Chrome 清除**,
 * 不存在「拆掉一个还在生效的注册」的问题。
 */
export async function reconcile(
  port: ScriptingPort,
  settings: FilterSettings,
  options: { readonly forceRebuild?: boolean } = {},
): Promise<ReconcileResult> {
  const forceRebuild = options.forceRebuild ?? false;
  const errors: string[] = [];

  let actual: readonly RegisteredScriptLike[];
  try {
    actual = await port.getRegisteredContentScripts();
  } catch (error) {
    // 读不到实际状态时无法安全地做 diff。退化为强制重建:
    // 它不依赖「实际状态」的准确性,只依赖期望集。
    errors.push(`getRegisteredContentScripts: ${describeError(error)}`);
    return runPlan(
      port,
      planReconcile([], desiredRegistrations(settings), true),
      errors,
      true,
    );
  }

  const desired = desiredRegistrations(settings);
  const plan = planReconcile(actual, desired, forceRebuild);
  return runPlan(port, plan, errors, forceRebuild);
}

/** 执行 plan。顺序见 `reconcile` 的注释。 */
async function runPlan(
  port: ScriptingPort,
  plan: ReconcilePlan,
  errors: string[],
  unregisterFirst: boolean,
): Promise<ReconcileResult> {
  const unregister = async (): Promise<void> => {
    if (plan.toUnregisterIds.length === 0) return;
    try {
      await port.unregisterContentScripts({ ids: plan.toUnregisterIds });
    } catch (error) {
      errors.push(`unregisterContentScripts: ${describeError(error)}`);
    }
  };

  const install = async (): Promise<void> => {
    if (plan.toUpdate.length > 0) {
      try {
        await port.updateContentScripts(plan.toUpdate);
      } catch (error) {
        errors.push(`updateContentScripts: ${describeError(error)}`);
      }
    }
    if (plan.toRegister.length > 0) {
      try {
        await port.registerContentScripts(plan.toRegister);
      } catch (error) {
        errors.push(`registerContentScripts: ${describeError(error)}`);
      }
    }
  };

  if (unregisterFirst) {
    await unregister();
    await install();
  } else {
    await install();
    await unregister();
  }

  return { plan, ok: errors.length === 0, errors };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
