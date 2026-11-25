import { defineBackground } from 'wxt/utils/define-background';
import { SettingsRepository } from '../src/storage/index.js';
import { Reconciler, defaultScriptingPort } from '../src/injection/index.js';
import {
  BackgroundCoordinator,
  LockExpiryScheduler,
  defaultActionPort,
  defaultAlarmsPort,
  defaultEventsPort,
  defaultMessagingPort,
  defaultTabsPort,
} from '../src/background/index.js';

/**
 * MV3 service worker 入口。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **本文件承载 INV-3(零闪烁)的主路径 —— 声明式注册(ADR-062)。**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 架构要点(完整论证见 `src/injection/reconcile.ts` 头注释):
 * 规则是用户在 popup 里创建的,此刻 SW **必然活着**,于是把
 * 「该用什么滤镜」这件异步工作**挪到规则创建时**完成,并写入浏览器的
 * StateStore(磁盘)。之后首次访问该站,浏览器**从磁盘恢复注册、
 * 不依赖 SW 先启动**,CSS 在首帧之前注入 ——
 * **不再有缓存需要填充,所以不再有「第一次」。**
 *
 * 下面注册的四个触发点**全部必需**(DESIGN.md §6 T4a),逐条理由见
 * `src/injection/reconciler.ts` 的表格。其中 `onInstalled` 是
 * **强制项(ADR-065)**:扩展更新会清除动态注册,漏了会导致
 * 每次更新后滤镜静默失效。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 📌 **T5 的后台协调与图标两态在下方 `BackgroundCoordinator` 中,与上述
 * 声明式注册并存** —— 两者是两件事,刻意都订阅仓储层变更:
 *
 * - `Reconciler`(T4a / ADR-062)→ 改**注册**,影响**下一次导航的首帧**(INV-3)
 * - `BackgroundCoordinator`(T5 / ADR-013/014/019/044)→ 改**图标**、应答
 *   popup 的 `GET_TAB_STATE`,影响**当下已打开的 tab**(INV-4 / INV-8)
 *
 * 职责不重叠:协调器**绝不**调用 `chrome.scripting.*`(注册的唯一写入者是
 * `Reconciler`,两处都写会制造 ADR-064 所防的并发重复注册);
 * `Reconciler` 也绝不碰 `chrome.action`。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
export default defineBackground(() => {
  const repo = new SettingsRepository();
  const reconciler = new Reconciler({
    port: defaultScriptingPort(),
    readSettings: () => repo.read(),
  });

  /*
    ══ 🔒 ADR-077:锁定到期自动关闭主开关 ════════════════════════════════

    与 `reconciler` / `coordinator` **共用同一个 `repo`** —— 于是共用同一条
    `chrome.storage` 读取路径、同一套订阅机制、**同一个锁定强制点**。
    不存在第二份真相,也不存在第二道(可能与仓储层分歧的)锁定判定:
    本类只决定「何时去问一次」,判定与写入都在
    `repo.applyExpiryAutoOff()`(INV-14 / ADR-055)。

    🔴 为什么到期触发器**必须**在 SW 而不是 popup:
    popup 关着时也要生效(ADR-077:「即使 popup 没开、SW 已休眠」)。
    popup 侧另有一条**独立**防线(`src/ui/useLockExpiry.ts`),
    它负责「popup 开着时到期当秒就正确」—— 因为闹钟会迟到,
    迟到量按平台文档**无上界**(见 lock-expiry.ts 的论证)。
  */
  const lockExpiry = new LockExpiryScheduler({
    alarms: defaultAlarmsPort(),
    readSettings: () => repo.read(),
    applyAutoOff: () => repo.applyExpiryAutoOff(),
  });
  lockExpiry.start();

  // ── 触发点 1:onInstalled —— 🔴 强制项(ADR-065) ─────────────────────
  //
  // 扩展**更新**时 Chrome 会清除全部动态注册(已核实:注册能存活
  // 浏览器重启、SW 终止、扩展禁用再启用,但更新时被清除,原因是
  // 注册引用的文件可能在更新中变化)。该事件 install 与 update 都触发,
  // 两种场景都需要建立注册,故不按 reason 分支。
  //
  // `trigger: 'installed'` 会让 reconcile 走**强制重建**而非 diff ——
  // 因为此时 `getRegisteredContentScripts()` 的返回可能仍是陈旧内容,
  // 按 diff 走会误判「都没变」而什么都不做(见 reconcile.ts 的 forceRebuild)。
  chromeRuntime()?.onInstalled?.addListener(() => {
    void reconciler.request('installed');
    // 🔒 ADR-077:扩展**更新**后闹钟不保证存活 → 补做漏掉的到期关闭 + 重建闹钟。
    void lockExpiry.catchUpAndReschedule();
  });

  // ── 触发点 2:onStartup —— 廉价的双重保险 ────────────────────────────
  //
  // 持久化(`persistAcrossSessions: true`)正常工作时这是个 no-op:
  // diff 会判定全部未变,不产生任何平台调用。留着是为了让
  // 「持久化出于任何原因没生效」这种情况能自愈。
  chromeRuntime()?.onStartup?.addListener(() => {
    void reconciler.request('startup');
    /*
      🔒 ADR-077 的**补偿语义**在此(这是「关机过夜」唯一的防线):

      > 浏览器关闭期间闹钟不会触发。SW 下次启动时若发现 `lockUntil` 已过去
      > 且 `masterEnabled` 仍为 `true`,**必须补做这次关闭**。

      这条**不是**上面 reconciler 那种「廉价的双重保险」—— 它是必需的:
      锁定在浏览器关闭期间到期时,没有任何闹钟会响,
      不补做则自动关闭**静默失效**。
    */
    void lockExpiry.catchUpAndReschedule();
  });

  // ── 触发点 3 + 4:规则增删改 / storage.onChanged ─────────────────────
  //
  // 仓储层的 `subscribe()` 同时覆盖这两者:它既接 `chrome.storage.onChanged`
  // (别的窗口改了设置也跟着走),也在本进程的写入后通知。
  // DESIGN.md 把二者列为两个触发点,正常路径上它们**重叠** ——
  // 而重叠无害,因为 reconcile 幂等,第二次是 no-op。
  // 这正是 ADR-064 要求幂等的用途,不是冗余。
  repo.subscribe(() => {
    void reconciler.request('storage-changed');
    /*
      🔒 ADR-077:启动/延长锁定都是一次 `lockUntil` 的写入 → 走到这里
      → 重排闹钟。这是闹钟**被建立**的主路径
      (ADR-077:「在设置/延长锁定时安排闹钟」)。

      🔴 这里只 `reschedule`,**不** `catchUp` —— 后者成功时会产生一次写入,
      再次触发本回调,形成自触发循环(详见
      `LockExpiryScheduler.onSettingsChanged` 的论证)。
    */
    void lockExpiry.onSettingsChanged();
  });

  // ── 冷启动兜底 ───────────────────────────────────────────────────────
  //
  // SW 因任何原因被唤醒(消息、alarm、导航)时都走一次。
  // 与 onStartup 同理:持久化正常时是 no-op,成本只有一次
  // `getRegisteredContentScripts()`。
  //
  // 🔴 这**不是** INV-3 的承担者 —— 首帧保证来自磁盘上已有的注册,
  //    不依赖本次 SW 启动做成任何事(ADR-062)。这里只负责「自愈」。
  void reconciler.request('startup');

  /*
    🔒 ADR-077 冷启动兜底 —— **补偿语义的第二个落点,且是最常走到的那个。**

    `onStartup` 只在**浏览器启动**时触发一次;而 SW 被回收后因消息/导航/闹钟
    被重新唤醒时**不触发** `onStartup`。于是「锁定在 SW 休眠期间到期、
    浏览器一直开着、闹钟又恰好没能送达」这种情况,只有这里能兜住。

    成本:一次 `storage.get`(与上面 reconciler 的冷启动兜底同量级)。
    不该关时仓储层 no-op,不写盘(见 `needsExpiryAutoOff` 的幂等论证)。
  */
  void lockExpiry.catchUpAndReschedule();

  // ══ T5:后台协调与图标状态 ══════════════════════════════════════════
  //
  // §6 T5 的四条职责(tab 导航解析、INV-4 多 tab 同步、ADR-019 图标两态、
  // ADR-013 不可注入上报)全部在 `BackgroundCoordinator` 内,见该类的注释。
  //
  // 🔴 它与上面的 `reconciler` **共用同一个 `repo`**,于是共用同一次
  // `chrome.storage` 读取路径与同一套订阅机制 —— 不存在第二份真相。
  // §6 T5 注明「MV3 service worker 不可以是聚合的真相来源,真相在
  // chrome.storage」:协调器**不持有设置快照**,每个事件回调都重新 read()。
  //
  // 📌 `start()` 幂等(内部 `#started` 守卫):SW 入口在某些时序下可能被
  // 求值多次,装两套监听会让每个 tab 事件被处理两遍。
  const coordinator = new BackgroundCoordinator({
    tabs: defaultTabsPort(),
    action: defaultActionPort(),
    events: defaultEventsPort(),
    messaging: defaultMessagingPort(),
    readSettings: () => repo.read(),
    subscribeSettings: (listener) => repo.subscribe(() => listener()),
  });
  coordinator.start();
});

/**
 * 取 `chrome.runtime`,不可用时返回 null。
 *
 * SW 入口在单测/非扩展上下文里也会被求值(WXT 的入口收集),
 * 直接访问 `chrome.runtime.onInstalled` 会抛 —— 而入口抛异常
 * 会让整个 SW 起不来,连带 T5 的后台协调一起失效。
 */
function chromeRuntime(): {
  onInstalled?: { addListener(cb: () => void): void };
  onStartup?: { addListener(cb: () => void): void };
} | null {
  try {
    const g = globalThis as {
      chrome?: {
        runtime?: {
          onInstalled?: { addListener(cb: () => void): void };
          onStartup?: { addListener(cb: () => void): void };
        };
      };
    };
    return g.chrome?.runtime ?? null;
  } catch {
    return null;
  }
}
