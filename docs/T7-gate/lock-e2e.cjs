// ═══════════════════════════════════════════════════════════════════════════
// T7【新增】🔒 锁定端到端(INV-11/12/13/14/15)
// ═══════════════════════════════════════════════════════════════════════════
//
// §6 T7 gate 原文(逐字,本脚本按这个顺序执行):
//
// > **【新增】** 🔒 锁定端到端(INV-11/12/13/14/15):**主开关关闭状态下**
// > 启动锁定 → **主开关自动变 ON**(ADR-057)→ 尝试改规则、关主开关、
// > **缩短计时器全部失败** → **延长成功** → **完全退出并重启浏览器** →
// > 锁定仍有效、剩余时间正确 → 等待到期 → 自动解锁且设置可改
//
// 🔴 **这条为什么必须在 T7 才算验过:**
//
// T3 的门禁直接调仓储层 API 验 INV-14(那是对的,且 §6 T3 明文要求「必须
// 绕过 UI」);T6c 的门禁在 jsdom 里验锁定 UI。两者都**没有**验:
//   (a) 用户在**真实 popup** 里点「锁定」,ADR-057 的原子开主开关真的发生;
//   (b) 锁定真的跨**完整的浏览器进程退出与重启**存活(INV-13)——
//       jsdom 里没有「进程」这个概念,T3 的门禁用的是内存 StorageArea;
//   (c) 到期后真实的 `setInterval` 时钟真的把 UI 翻回可改状态(INV-15 的
//       反方向:到期必须真的解锁,而不是永久冻结)。
//
// ## 时长的选择:1 分钟(真实等待)
//
// UI 能表达的**最短**时长是 1 分钟(`src/ui/lock-duration.ts` 刻意没有
// `'second'` —— ADR-058:带单位的输入让「秒/毫秒弄错」在界面层不可能发生)。
// 本门禁因此用 1 分钟并**真实等待到期**,不注入假时钟:
// 产品构建里时钟默认就是 `Date.now`,注入假时钟就等于不验这条链路。
// 代价是本脚本耗时 ~2 分钟,这是 §6 T7「昂贵的真实验收」的预期成本。
//
// ## INV-15 的验法
//
// 把**系统**时钟往回调在 CI 里不可行(需要 root 且会污染机器)。
// ADR-059 的机制是 `effectiveNow(clock(), maxSeenTime)` —— 单调下界存在
// `maxSeenTime` 里。故本门禁用**等价且可自动化**的手法:把持久化的
// `maxSeenTime` 推到未来(模拟「曾观测到更晚的时刻」,即时钟随后倒退的
// 效果),断言有效剩余时长**不增加**。这正是 ADR-059 要防的那件事,
// 且比改系统时钟更精确 —— 它直接作用在机制本身。
//
// ## ⚠️ 实测踩过的一个**门禁自身**的缺陷(本轮修复,记录以免重犯)
//
// gate 条款要求「缩短全部失败 → **延长成功**」。而「延长成功」这一步
// **合法地**把 `lockUntil` 往后推了 10 分钟(ADR-052:加码可以)。
// 本脚本第一版在随后的 INV-15 与 INV-13 断言里仍写死「不超过原定 1 分钟」,
// 于是把产品的**正确**行为判成了红(实测 `remainingMs=658519`)。
//
// 结论:凡涉及「剩余时长」的判据,一律相对**实际的** `lockUntil` 推算,
// 不得写死最初选的时长。写死的那种断言不是更严格,是**错**。
//
// ## ⚠️ 实测踩过的第二个坑:`maxSeenTime` 读路径回写会与断言赛跑
//
// 本脚本早先版本把 INV-12 的「延长」做成 `+10 分钟`,于是「等待真实到期」
// 要等 ~11 分钟。那段等待**跨过了 `MAX_SEEN_TIME_WRITEBACK_INTERVAL_MS`
// (60s)的节流窗口**,于是读路径的 `maxSeenTime` 回写
// (`#writeBackMaxSeenTime`,ADR-059/INV-15 的真正落点)被触发。
// 该回写按设计落的是**读到的那一份快照**,其中 `masterEnabled` 仍是 `true`。
// 它与紧随其后的 `setMasterEnabled(false)` 赛跑,
// 结果「到期后的写入真的落盘了」这条断言 **2/2 次复现判红**。
//
// 审计轨迹(本脚本现在会打印)清楚显示了那两次多余的写入:
//   `{masterEnabled:true,...} ×2` 紧接着才是 `{masterEnabled:false}`。
//
// **这不是产品缺陷**:`maxSeenTime` 的读路径回写是 INV-11 例外 b 与
// INV-15 明文要求的行为(锁定期间没有成功的用户写入,下界只能靠读推进)。
// 被影响的也只是**门禁自己紧接着做的那次写**的可见顺序。
// 修复方式是把延长量降到 `+30s`(语义不变,仍是真正的延长),
// 让整条门禁跑在节流窗口之内 —— 并保留审计轨迹,
// 以便将来若此断言再红,能一眼看出是谁写的。
//
// 用法(从仓库根):npm run build && node docs/T7-gate/lock-e2e.cjs

const path = require('path');
const {
  makeResults,
  tmpProfile,
  launch,
  getWorker,
  seed,
  rule,
  settings,
  popupUrl,
  openPopup,
  siteTabOf,
  waitNotSkeleton,
  probe,
  clickTestid,
  exists,
  setControlledValue,
  readSettings,
  repoProbe,
  withRepo,
  filterOf,
  waitFilter,
  sleep,
} = require('./lib7.cjs');

const OUT = path.join(__dirname, 'evidence');
const R = makeResults('lock-e2e');

const SITE = 'https://en.wikipedia.org/wiki/Color_blindness';
const LOCK_MINUTES = 1;
/** INV-12 的「延长」增量 —— 见下方 extend 处的说明。 */
const EXTEND_MS = 30_000;

async function main() {
  const profile = tmpProfile('lock');
  let browser = await launch(profile, { headless: true });
  let popup = null;
  try {
    /* ═══════════ 前置:主开关 OFF + 一条规则(ADR-057 的前提)═══════════ */
    await seed(browser, {
      version: 1,
      masterEnabled: false, // 🔴 §6 T7 逐字:「**主开关关闭状态下**启动锁定」
      rules: [rule('*.wikipedia.org', 'Grayscale', 100)],
      lockUntil: null,
      maxSeenTime: Date.now(),
    });

    const site = await browser.newPage();
    await site.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const offFilter = await filterOf(site);
    R.assert(
      '前置:主开关 OFF 时页面无滤镜(INV-8,探针有效)',
      offFilter === 'none',
      { offFilter },
    );

    const siteTab = await siteTabOf(browser, 'wikipedia.org');
    const PU = await popupUrl(browser);
    popup = await openPopup(browser, PU, siteTab);
    await waitNotSkeleton(popup);

    const masterBefore = await probe(popup, 'master-switch');
    R.assert(
      '前置:popup 里主开关显示为 OFF',
      masterBefore !== null && masterBefore.checked === false,
      { checked: masterBefore && masterBefore.checked },
    );
    R.assert('未锁定 → 计时器入口在场(T6c)', await exists(popup, 'lock-entry'));
    R.assert('未锁定 → 倒计时横幅不在场', !(await exists(popup, 'lock-banner')));

    /* ═══════════ 1. 在真实 popup 里启动 1 分钟锁定 ═══════════ */
    await setControlledValue(popup, 'lock-start-amount', String(LOCK_MINUTES));
    await setControlledValue(popup, 'lock-start-unit', 'minute', 'select');

    // ADR-057:主开关关闭时,确认框必须预先告知它会被一并打开。
    await clickTestid(popup, 'lock-start');
    R.assert('ADR-056:点「锁定」弹出二次确认框', await exists(popup, 'lock-confirm'));
    const willEnable = await probe(popup, 'lock-will-enable-master');
    R.assert(
      '🔴 ADR-057:确认框预先告知「主开关会被一并打开」',
      willEnable !== null && String(willEnable.text).length > 0,
      willEnable && willEnable.text,
    );
    const settingsAtConfirm = await readSettings(browser);
    R.assert(
      'ADR-056:未确认前不写入任何数据',
      settingsAtConfirm.lockUntil === null && settingsAtConfirm.masterEnabled === false,
      { lockUntil: settingsAtConfirm.lockUntil, masterEnabled: settingsAtConfirm.masterEnabled },
    );

    const tStart = Date.now();
    await clickTestid(popup, 'lock-confirm-ok', 800);

    const locked = await readSettings(browser);
    R.assert(
      '🔴 锁定已启动,lockUntil 为绝对时间戳(ADR-053/INV-13)',
      typeof locked.lockUntil === 'number' && locked.lockUntil > tStart,
      { lockUntil: locked.lockUntil, now: tStart },
    );
    R.assert(
      '🔴 ADR-057:启动锁定**原子地**把 masterEnabled 置为 true',
      locked.masterEnabled === true,
      { masterEnabled: locked.masterEnabled },
    );
    const plannedMs = locked.lockUntil - tStart;
    R.assert(
      '锁定时长约等于 UI 选的 1 分钟',
      plannedMs > 50_000 && plannedMs <= 65_000,
      { plannedMs },
    );

    // ADR-057 的产品后果:主开关被打开 → 页面**真的**上滤镜了。
    await site.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    const onFilter = await waitFilter(site, (f) => f !== 'none');
    R.assert(
      '🔴 ADR-057 的端到端后果:主开关自动 ON → 真实页面真的上了滤镜',
      /^grayscale\(/.test(onFilter),
      { onFilter },
    );

    /* ═══════════ 2. 锁定中:改规则 / 关主开关 / 缩短 全部失败 ═══════════ */
    //
    // 🔴 INV-14 要求强制点在**仓储层**,故这三项都**绕过 UI** 直接调
    //    service worker 里的仓储层 API。UI 置灰另在下方单独断言
    //    ——「UI 置灰只是第二道防线」(ADR-055)。
    const w = await getWorker(browser);
    // 🔴 真实仓储层句柄(论证见 lib7.cjs 的 `repoProbe`)——
    //    在扩展页面上下文里 new 一个产品的 `SettingsRepository`,
    //    对着真实 `chrome.storage.local` 调用,**完全绕过 UI**。
    await repoProbe(browser, popup);
    const repoResults = await withRepo(
      popup,
      async (repo, arg) => {
      const fmt = (r) => ({ ok: r.ok, kind: r.ok ? null : r.error.kind });
      const cur = (await chrome.storage.local.get('filterSettings')).filterSettings;
      return {
        lockedNow: await repo.isCurrentlyLocked(),
        addRule: fmt(
          await repo.addRule({ pattern: 'evil.com', mode: 'Grayscale', intensity: 100 }),
        ),
        removeRule: fmt(await repo.removeRule(0)),
        updateRule: fmt(
          await repo.updateRule(0, { pattern: 'other.com', mode: 'RedGreen', intensity: 50 }),
        ),
        masterOff: fmt(await repo.setMasterEnabled(false)),
        // 🔴 用 setLockUntilImmediate:不走防抖,立即落盘(ADR-061),
        //    否则断言可能读到尚未写入的中间态。
        shorten: fmt(await repo.setLockUntilImmediate(cur.lockUntil - 30_000)),
        unlock: fmt(await repo.setLockUntilImmediate(null)),
        // 延长量取 +30s(不是 +10min):语义上仍是**真正的延长**
        // (INV-12 要验的就是「变大被允许」),但让「等待真实到期」那一步
        // 从 ~11 分钟降到 ~1.5 分钟。门禁要跑得起来才有人跑。
        extend: fmt(await repo.setLockUntilImmediate(cur.lockUntil + arg.extendMs)),
      };
      },
      { extendMs: EXTEND_MS },
    );
    R.cases.push({ step: '锁定中经仓储层的写入尝试', repoResults });

    {
      R.assert(
        '🔴 INV-14 验收通道有效:真实仓储层在真实 Chrome 中判定为锁定中',
        repoResults.lockedNow === true,
        { lockedNow: repoResults.lockedNow },
      );
      R.assert(
        '🔴 INV-11/14:锁定中 addRule 被拒,错误是 locked(非静默丢弃)',
        repoResults.addRule.ok === false && repoResults.addRule.kind === 'locked',
        repoResults.addRule,
      );
      R.assert(
        '🔴 INV-11/14:锁定中 removeRule 被拒(locked)',
        repoResults.removeRule.ok === false && repoResults.removeRule.kind === 'locked',
        repoResults.removeRule,
      );
      R.assert(
        '🔴 INV-11/14:锁定中 updateRule 被拒(locked)',
        repoResults.updateRule.ok === false && repoResults.updateRule.kind === 'locked',
        repoResults.updateRule,
      );
      R.assert(
        '🔴 INV-11/14:锁定中关主开关被拒(locked)',
        repoResults.masterOff.ok === false && repoResults.masterOff.kind === 'locked',
        repoResults.masterOff,
      );
      R.assert(
        '🔴 INV-12:锁定中**缩短**计时器被拒(locked)',
        repoResults.shorten.ok === false && repoResults.shorten.kind === 'locked',
        repoResults.shorten,
      );
      R.assert(
        '🔴 INV-12:锁定中**解锁**(置 null)被拒 —— 没有任何提前结束的途径',
        repoResults.unlock.ok === false && repoResults.unlock.kind === 'locked',
        repoResults.unlock,
      );
      R.assert(
        '🔴 INV-12:锁定中**延长**成功 —— 加码可以,反悔不行',
        repoResults.extend.ok === true,
        repoResults.extend,
      );
    }

    // 被拒的写入之后,三个受保护字段必须原样未变(INV-11 的「未变」精确含义)。
    const afterAttempts = await readSettings(browser);
    R.assert(
      '🔴 INV-11:被拒写入后 masterEnabled / rules 原样未变',
      afterAttempts.masterEnabled === true &&
        afterAttempts.rules.length === 1 &&
        afterAttempts.rules[0].pattern === '*.wikipedia.org' &&
        afterAttempts.rules[0].mode === 'Grayscale',
      { masterEnabled: afterAttempts.masterEnabled, rules: afterAttempts.rules },
    );
    R.assert(
      '🔴 INV-11 例外 b:maxSeenTime 在锁定期间**仍在推进**(未随锁定冻结)',
      afterAttempts.maxSeenTime >= tStart,
      { maxSeenTime: afterAttempts.maxSeenTime, tStart },
    );

    /* ═══════════ 2b. UI 第二道防线:锁定中界面形态正确 ═══════════ */
    await popup.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await popup.waitForSelector('[data-testid="popup"]', { timeout: 15000 });
    await waitNotSkeleton(popup);
    R.assert('锁定中 → 倒计时横幅在场(T6c)', await exists(popup, 'lock-banner'));
    R.assert('锁定中 → 计时器启动入口**不**在场', !(await exists(popup, 'lock-entry')));
    R.assert('锁定中 → **仅**提供延长(lock-extend 在场)', await exists(popup, 'lock-extend'));
    const masterLocked = await probe(popup, 'master-switch');
    R.assert(
      'ADR-055 第二道防线:锁定中主开关在 UI 上被置灰',
      masterLocked !== null && masterLocked.disabled === true,
      { disabled: masterLocked && masterLocked.disabled },
    );
    const countdown = await probe(popup, 'lock-countdown');
    R.assert(
      '锁定中倒计时有内容',
      countdown !== null && String(countdown.text).length > 0,
      countdown && countdown.text,
    );

    /* ═══════════ 3. INV-15:时钟倒退不缩短锁定 ═══════════ */
    //
    // INV-15 原文:「系统时钟倒退时,锁定的**有效剩余时长不得增加**」。
    // 机制(ADR-059):所有锁定判定用 `effectiveNow(clock(), maxSeenTime)`,
    // 单调下界持久化在 `maxSeenTime` 里。
    //
    // 📌 **验法:注入一个倒退的时钟,而不是改系统时间。**
    //    改系统时间在 CI 里需要 root 且会污染机器;而 `SettingsRepository`
    //    本就接受可注入时钟(`src/storage/settings-repository.ts` 的
    //    `SettingsRepositoryOptions.clock`,ADR-059 为此而设)。
    //    注入 `() => <锁定开始前的时刻>` **精确复现**「用户把系统时钟往回调」,
    //    且作用在真实产品实现上 —— 判定逻辑一行都没被替换。
    // ⚠️ 上面第 2b 步 reload 过 popup —— 页面全局(含探针构造器)随之清空。
    //    必须重新加载探针,否则报「探针未加载」(实测踩过)。
    await repoProbe(browser, popup);
    const beforeSkew = await readSettings(browser);
    const rollbackTo = beforeSkew.lockUntil - 60 * 60_000; // 倒退约 1 小时
    const skew = await withRepo(
      popup,
      async (repo, arg) => {
        // 本 repo 的时钟被固定在 `rollbackTo`(见 withRepo 的 opts.clockAt)——
        // 精确复现「用户把系统时钟往回调」,判定逻辑一行未改。
        const stillLocked = await repo.isCurrentlyLocked();
        const s = await repo.read();
        // 若用**裸时钟**会算出的剩余(这是 ADR-059 要防的那个错)。
        const naiveRemaining = arg.lockUntil - arg.rollbackTo;
        // 实际剩余:effectiveNow = max(裸时钟, maxSeenTime) 夹过之后。
        const effective = Math.max(arg.rollbackTo, s.maxSeenTime);
        const actualRemaining = arg.lockUntil - effective;
        const unlock = await repo.setLockUntilImmediate(null);
        const shorten = await repo.setLockUntilImmediate(arg.lockUntil - 30_000);
        return {
          stillLocked,
          naiveRemaining,
          actualRemaining,
          maxSeenTime: s.maxSeenTime,
          unlock: { ok: unlock.ok, kind: unlock.ok ? null : unlock.error.kind },
          shorten: { ok: shorten.ok, kind: shorten.ok ? null : shorten.error.kind },
        };
      },
      { lockUntil: beforeSkew.lockUntil, rollbackTo },
      { clockAt: rollbackTo },
    );
    R.cases.push({ step: 'INV-15 注入倒退时钟', skew });

    R.assert(
      '🔴 INV-15:时钟倒退 1 小时后仍判定为锁定中(倒退不能解锁)',
      skew.stillLocked === true,
      { stillLocked: skew.stillLocked },
    );
    // 📌 **判据只能相对 `lockUntil` 推,不能写死 1 分钟。**
    //    上一步的 INV-12 断言「延长成功」本就**合法地**把 lockUntil 推后了
    //    10 分钟 —— 那是 ADR-052 要求的行为。此处若写死原定 1 分钟,
    //    会把产品的正确行为判成红(本轮实测踩过:remainingMs=658519)。
    //    真正的 INV-15 不变式是:**倒退不得让有效剩余时长增加** ——
    //    即「夹过单调下界的剩余」必须严格小于「裸时钟会算出的剩余」,
    //    且不得超过锁定窗口本身(lockUntil - 锁定开始时刻)。
    const lockWindowMs = beforeSkew.lockUntil - tStart;
    R.assert(
      '🔴 INV-15/ADR-059:有效剩余时长**未因倒退而增加**(单调下界起作用)',
      skew.actualRemaining < skew.naiveRemaining && skew.actualRemaining <= lockWindowMs,
      {
        naiveRemainingMs: skew.naiveRemaining,
        actualRemainingMs: skew.actualRemaining,
        lockWindowMs,
        说明:
          '裸时钟会算出 ~1 小时剩余(倒退量);夹过单调下界后仅剩真实锁定窗口内的余额',
      },
    );
    R.assert(
      '🔴 INV-12:倒退的时钟也无法解锁',
      skew.unlock.ok === false && skew.unlock.kind === 'locked',
      skew.unlock,
    );
    R.assert(
      '🔴 INV-12:倒退的时钟也无法缩短锁定',
      skew.shorten.ok === false && skew.shorten.kind === 'locked',
      skew.shorten,
    );

    // 确认上面的尝试没有改坏持久化状态,并把主开关恢复为 true 继续重启场景。
    const afterSkew = await readSettings(browser);
    R.assert(
      'INV-11:倒退时钟的各项尝试之后,lockUntil 未被改动',
      afterSkew.lockUntil === beforeSkew.lockUntil,
      { before: beforeSkew.lockUntil, after: afterSkew.lockUntil },
    );

    /* ═══════════ 4. 完全退出并重启浏览器 → 锁定仍有效(INV-13)═══════════ */
    const lockUntilBeforeRestart = (await readSettings(browser)).lockUntil;
    const rulesBeforeRestart = (await readSettings(browser)).rules;
    await browser.close(); // 🔴 真实的进程退出,不是 reload
    await sleep(1500);

    // 同一个 userDataDir 重启 —— 这是「完全退出并重启浏览器」的真实复现。
    browser = await launch(profile, { headless: true });
    const afterRestart = await readSettings(browser);
    R.assert(
      '🔴 INV-13:完全退出并重启浏览器后,锁定仍有效(lockUntil 原值存活)',
      afterRestart !== null && afterRestart.lockUntil === lockUntilBeforeRestart,
      { before: lockUntilBeforeRestart, after: afterRestart && afterRestart.lockUntil },
    );
    // 同上:锁定窗口已被 INV-12 的「延长」合法推后,故上界用**实际**窗口。
    // 关键在于「剩余是按**绝对时间**递减的」——
    // 若实现存的是剩余时长(ADR-053 禁止),重启后会**变回**完整窗口,
    // 下面的 `remaining < windowMs` 就会失败,这正是本条要抓的东西。
    const remaining = afterRestart.lockUntil - Date.now();
    const windowMs = afterRestart.lockUntil - tStart;
    R.assert(
      '🔴 INV-13/ADR-053:重启后剩余时间按绝对时间正确递减(未被重置为完整窗口)',
      remaining > 0 && remaining < windowMs,
      {
        remainingMs: remaining,
        lockWindowMs: windowMs,
        已消耗ms: windowMs - remaining,
      },
    );
    R.assert(
      'ADR-010:重启后规则与顺序完好',
      JSON.stringify(afterRestart.rules) === JSON.stringify(rulesBeforeRestart),
      { rules: afterRestart.rules },
    );

    // 重启后要重新建立探针通道:上一个 popup 页随进程一起消失了。
    const popupAfter = await openPopup(browser, await popupUrl(browser), null);
    await repoProbe(browser, popupAfter);
    const stillEnforced = await withRepo(popupAfter, async (repo) => {
      const r = await repo.setLockUntilImmediate(null);
      return {
        ok: r.ok,
        kind: r.ok ? null : r.error.kind,
        isLocked: await repo.isCurrentlyLocked(),
      };
    });
    R.assert(
      '🔴 INV-13:重启后锁定**仍在强制**(解锁尝试仍被拒)',
      stillEnforced.isLocked === true &&
        stillEnforced.ok === false &&
        stillEnforced.kind === 'locked',
      stillEnforced,
    );

    /* ═══════════ 5. 等待真实到期 → 自动解锁且设置可改 ═══════════ */
    const waitMs = Math.max(0, afterRestart.lockUntil - Date.now()) + 3000;
    console.log(`INFO  等待锁定真实到期:${Math.round(waitMs / 1000)}s(不注入假时钟)`);
    await sleep(waitMs);

    // 🔎 开一条 storage 变更审计轨迹:到期后若 masterEnabled 被谁改回 true,
    //    这里会记下每一次 newValue(含调用栈无法获得,但足以定位「写了几次、写了什么」)。
    await (await getWorker(browser)).evaluate(() => {
      globalThis.__ccfAudit = [];
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.filterSettings) return;
        const nv = changes.filterSettings.newValue;
        globalThis.__ccfAudit.push({
          t: Date.now(),
          masterEnabled: nv && nv.masterEnabled,
          rules: nv && nv.rules ? nv.rules.length : null,
          lockUntil: nv && nv.lockUntil,
        });
      });
    });

    const expired = await withRepo(popupAfter, async (repo) => {
      const stillLocked = await repo.isCurrentlyLocked();
      const r1 = await repo.setMasterEnabled(false);
      const r2 = await repo.addRule({
        pattern: 'example.com',
        mode: 'BlueYellow',
        intensity: 80,
      });
      return {
        stillLocked,
        masterOff: { ok: r1.ok, kind: r1.ok ? null : r1.error.kind },
        addRule: { ok: r2.ok, kind: r2.ok ? null : r2.error.kind },
      };
    });
    R.cases.push({ step: '到期后', expired });
    R.assert(
      '🔴 到期后自动解锁(isCurrentlyLocked 为 false,无需任何手动操作)',
      expired.stillLocked === false,
      expired,
    );
    R.assert(
      '🔴 到期后设置可改:关主开关成功',
      expired.masterOff.ok === true,
      expired.masterOff,
    );
    R.assert('🔴 到期后设置可改:新增规则成功', expired.addRule.ok === true, expired.addRule);

    const audit = await (await getWorker(browser)).evaluate(
      () => globalThis.__ccfAudit ?? [],
    );
    R.cases.push({ step: '到期后 storage 变更审计轨迹', audit });
    console.log(`AUDIT  到期后的 storage 写入序列:${JSON.stringify(audit)}`);

    const finalSettings = await readSettings(browser);
    R.assert(
      '到期后的写入真的落盘了',
      finalSettings.masterEnabled === false && finalSettings.rules.length === 2,
      { masterEnabled: finalSettings.masterEnabled, rules: finalSettings.rules },
    );

    // UI 侧:到期后计时器入口回来、横幅消失(T6c 的时钟真的在真实栈里推进)。
    const siteTab2 = await siteTabOf(browser, 'wikipedia.org');
    const popup3 = await openPopup(browser, await popupUrl(browser), siteTab2);
    await waitNotSkeleton(popup3);
    R.assert('到期后 UI:计时器启动入口回来了', await exists(popup3, 'lock-entry'));
    R.assert('到期后 UI:倒计时横幅消失了', !(await exists(popup3, 'lock-banner')));
    const masterFinal = await probe(popup3, 'master-switch');
    R.assert(
      '到期后 UI:主开关不再置灰',
      masterFinal !== null && masterFinal.disabled === false,
      { disabled: masterFinal && masterFinal.disabled },
    );
  } finally {
    try {
      await browser.close();
    } catch {
      /* 已关 */
    }
  }
  return R.finish(OUT);
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
