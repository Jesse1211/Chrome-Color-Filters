import { defineBackground } from 'wxt/utils/define-background';
import { SettingsRepository } from '../src/storage/index.js';
import { Reconciler, defaultScriptingPort } from '../src/injection/index.js';

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
 * 📌 后台协调与图标两态(ADR-019 / ADR-045)仍由 T5 实现,本文件不涉及。
 */
export default defineBackground(() => {
  const repo = new SettingsRepository();
  const reconciler = new Reconciler({
    port: defaultScriptingPort(),
    readSettings: () => repo.read(),
  });

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
  });

  // ── 触发点 2:onStartup —— 廉价的双重保险 ────────────────────────────
  //
  // 持久化(`persistAcrossSessions: true`)正常工作时这是个 no-op:
  // diff 会判定全部未变,不产生任何平台调用。留着是为了让
  // 「持久化出于任何原因没生效」这种情况能自愈。
  chromeRuntime()?.onStartup?.addListener(() => {
    void reconciler.request('startup');
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
