/**
 * 倒计时的格式化(§5.4 锁定中行 / ADR-051)。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **按 `lockUntil - now` 计算,而不是自减计数器。**
 *
 * §6 T6c gate 逐字要求:
 * > 格式 `🔒 锁定中 HH:MM:SS`,每秒刷新;**按 `lockUntil - now` 计算而非自减计数器**
 * > (否则 popup 重开或丢帧会漂移)。
 *
 * 自减计数器有两个必然的失真:
 * 1. popup 重开时计数器从头来过 —— 它没有任何持久化的起点;
 * 2. `setInterval` 在后台节流/丢帧时少减几次 —— 误差只增不减,永不自愈。
 *
 * 本模块因此是**纯函数**:每一帧都从两个绝对时间戳重新算差值。
 * 丢多少帧都不影响下一帧的正确性 —— 它根本不记忆上一帧。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 纯 TypeScript —— 零 React、零 chrome.*,`now` 一律注入,内部绝不调 `Date.now()`。
 */

/** §5.4:倒计时条的前缀。`🔒 锁定中 02:14:07` 中的「🔒 锁定中」。 */
export const LOCK_COUNTDOWN_PREFIX = '🔒 锁定中';

const MS_PER_SECOND = 1000;

function pad2(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/**
 * 剩余毫秒 → `HH:MM:SS`。
 *
 * - 负数与 0 一律渲染为 `00:00:00`(到期即归零,不出现负号)
 * - 小时位**不截断到 24** —— ADR-054 不设时长上限,锁 3 天就该显示 `72:00:00`。
 *   若对 24 取模,一个三天的锁会显示成 `00:00:00`,正好是「已解锁」的样子。
 * - 剩余时间**向上取整到秒**:还剩 0.4 秒时显示 `00:00:01` 而非 `00:00:00` ——
 *   `00:00:00` 必须恰好意味着「锁已解除」,不能提前出现在仍被锁的那一秒里。
 */
export function formatRemaining(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '00:00:00';

  const totalSeconds = Math.ceil(remainingMs / MS_PER_SECOND);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * 剩余毫秒 —— `lockUntil - now`,下限夹到 0。
 *
 * `lockUntil === null` 视为 0(未锁定)。
 * `now` 应当是 `effectiveNow(Date.now(), maxSeenTime)` 的结果(ADR-059/INV-15),
 * 否则把系统时钟往回调会让倒计时变长。
 */
export function remainingMs(lockUntil: number | null, now: number): number {
  if (lockUntil === null || !Number.isFinite(lockUntil)) return 0;
  if (!Number.isFinite(now)) return 0;
  const left = lockUntil - now;
  return left > 0 ? left : 0;
}

/**
 * 完整的倒计时文案 —— `🔒 锁定中 HH:MM:SS`(§5.4)。
 *
 * 每次调用都重新从 `lockUntil` 与 `now` 算起(见文件头)。
 */
export function formatCountdown(lockUntil: number | null, now: number): string {
  return `${LOCK_COUNTDOWN_PREFIX} ${formatRemaining(remainingMs(lockUntil, now))}`;
}
