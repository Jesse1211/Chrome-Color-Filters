/**
 * 锁定 UI 的文案(ADR-047:首版仅中文,不做 i18n)。
 *
 * 集中定义是为了让门禁可以**逐条断言**(§6 T6c gate:
 * 「二次确认(ADR-056)—— **逐条断言文案存在**」)。
 *
 * 🔴 文案权威是 **§5.3 / §5.4 与 ADR**,不是设计稿(ADR-042)。
 * 设计稿 `docs/design/popup-mockup.html` **完全没有锁定界面** ——
 * 这不是冲突,是设计稿的覆盖范围不含锁定。故本节全部文案以 ADR 为准。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **负向约束(ADR-052 / INV-12):本文件不得出现任何**
 * **「解除 / 取消锁定 / 结束 / 缩短」类的控件文案。**
 *
 * §6 T6c gate:
 * > 锁定中 DOM 里不得存在以下任一控件:解除 / 取消 / 结束 / 缩短锁定的任何入口。
 * > **这是 INV-12 最重要的一条门禁**。
 *
 * 唯一出现「取消」二字的是**确认框的取消按钮** —— 它取消的是
 * 「**启动**锁定」这个尚未发生的动作,而不是一个已生效的锁。
 * 该按钮只存在于**未锁定**时的确认框中;锁定中根本不渲染确认框。
 * 静态门禁据此按「锁定中渲染出的 DOM」判定,而不是按源码里的字符串。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

// ───────────────────────── 计时器入口(ADR-058) ─────────────────────────

/** 未锁定时的入口区标题。 */
export const LOCK_SECTION_TITLE = '专注锁定';

/**
 * 入口区的说明。
 *
 * 刻意先说清**单向语义**(ADR-052)——「只能延长、不能提前结束」必须在
 * 用户点开确认框**之前**就可见,而不是等到不可逆的那一步才告知。
 */
export const LOCK_SECTION_HINT = '锁定后无法修改设置,只能延长,不能提前结束';

/** 预设时长按钮区的标签(ADR-058:预设按钮)。 */
export const LOCK_PRESET_LABEL = '锁定时长';

/**
 * 自定义时长输入的标签(ADR-058:数字 + 单位下拉)。
 *
 * 数字框的可见 `<label>` 用 `LOCK_CUSTOM_LABEL`;单位下拉的可见标签会挤占
 * 本就只有 360px 的宽度,故它走 `visually-hidden` + `aria-label`,
 * 用更精确的 `LOCK_UNIT_LABEL` —— 屏幕阅读器仍读得到「时长单位」。
 */
export const LOCK_CUSTOM_LABEL = '自定义时长';
export const LOCK_UNIT_LABEL = '时长单位';

/** 启动按钮 —— 点它只打开确认框,**不写入任何数据**(ADR-056)。 */
export const LOCK_START_LABEL = '启动锁定';

/** 自定义时长非法时的提示(0 / 负数 / 空)。 */
export const LOCK_INVALID_DURATION = '请输入大于 0 的时长';

// ───────────────────────── 二次确认(ADR-056) ─────────────────────────

export const LOCK_CONFIRM_TITLE = '确认启动锁定?';

/**
 * 确认框的三条后果 —— **ADR-056 逐条写明,门禁逐条断言**。
 *
 * > ADR-056:确认文案须写明:**无法修改设置**、**无法关闭滤镜**、
 * > **无法提前结束(可延长)**。
 *
 * 顺序与 ADR 行文一致,便于逐条比对。
 */
export const LOCK_CONSEQUENCE_NO_SETTINGS = '无法修改任何设置';
export const LOCK_CONSEQUENCE_NO_DISABLE = '无法关闭滤镜';
export const LOCK_CONSEQUENCE_NO_EARLY_END = '无法提前结束(只能延长)';

/** 三条后果的有序数组 —— 渲染与门禁共用同一份真相。 */
export const LOCK_CONSEQUENCES: readonly string[] = [
  LOCK_CONSEQUENCE_NO_SETTINGS,
  LOCK_CONSEQUENCE_NO_DISABLE,
  LOCK_CONSEQUENCE_NO_EARLY_END,
];

/** 确认框里对本次时长的陈述,`{duration}` 由调用方代入(如「4 小时」)。 */
export function lockConfirmDurationText(durationText: string): string {
  return `将锁定 ${durationText}`;
}

/**
 * 🔴 **ADR-057 的用户可见告知。**
 *
 * 在 `masterEnabled === false` 时启动锁定,会**原子地**把主开关一并打开。
 * 这是一次用户没有显式请求的状态变化,必须在**不可逆操作之前**说明 ——
 * 否则用户以为自己锁住的是「关闭」状态,醒来发现滤镜开着。
 *
 * > ADR-057:用户点「锁定」的意图显然是「锁住滤镜」,不是「锁住关闭状态」。
 */
export const LOCK_WILL_ENABLE_MASTER = '滤镜当前已关闭,启动锁定将同时开启滤镜';

/** 确认 / 取消。**「取消」取消的是尚未发生的启动动作,不是已生效的锁**(见文件头)。 */
export const LOCK_CONFIRM_OK = '确认锁定';
export const LOCK_CONFIRM_CANCEL = '取消';

// ───────────────────────── 锁定中(ADR-051 / ADR-052) ─────────────────────────

/** 延长 —— 锁定中**唯一**可用的锁定操作(ADR-052:加码可以,反悔不行)。 */
export const LOCK_EXTEND_LABEL = '延长';
export const LOCK_EXTEND_SECTION_LABEL = '延长锁定';

/** 延长用的时长输入标签(同样是 ADR-058 的「数字 + 单位」,不接受裸时间戳)。 */
export const LOCK_EXTEND_AMOUNT_LABEL = '延长时长数值';
export const LOCK_EXTEND_UNIT_LABEL = '延长时长单位';

/** 锁定中列表区的说明 —— §5.4:「规则列表照常可见可滚动但不可编辑」。 */
export const LOCK_LIST_READONLY_HINT = '锁定期间设置不可修改';
