/**
 * Popup 文案(ADR-047:**首版仅中文,不做 i18n**)。
 *
 * 集中定义是为了让门禁可以**逐字断言**(§6 T6a gate:「逐项断言元素存在性与文案」),
 * 而不是为了日后换语言 —— ADR-047 已把 i18n 记为非目标。
 *
 * 🔴 文案的权威是 **§5.3 / §5.4 与 ADR**(ADR-042),不是设计稿。
 * 涉及的已知冲突见 §6.1:第 2 条(「被遮蔽」→「此页未生效」)。
 */

/** ADR-031:列表顶部**常驻**优先级提示条。 */
export const PRIORITY_HINT_PREFIX = '↓ 从上往下匹配,';
export const PRIORITY_HINT_STRONG = '首个命中的规则生效';
/** 完整文案 —— 门禁按 §5.3 的原文断言。 */
export const PRIORITY_HINT = `${PRIORITY_HINT_PREFIX}${PRIORITY_HINT_STRONG}`;

/** §5.4 空(0 条)。 */
export const EMPTY_TITLE = '尚未添加任何规则';
export const EMPTY_HINT = '添加一条规则,指定哪些网址需要套用滤镜';

/** §5.4 满(20/20):提示条变琥珀色。 */
export const CAPACITY_NOTICE = '已达 20 条上限,请先删除一条再添加';

/*
 * 🔴 **ADR-076:原先这里有一条 `MASTER_OFF_NOTICE`(「已全局关闭,所有规则
 *    暂不生效」),已整条删除 —— 不是停用,是不复存在。**
 *
 * 理由(产品负责人拍板):主开关本身就在顶部且状态可见 ——
 * 开关位置 + 品牌图标变灰 + 规则行置灰,三处同时表达同一件事,
 * 再用一条琥珀横幅复述第四遍是重复信息,还占掉 360×452 里一行高度。
 *
 * 主开关 OFF 现在改由**禁用「添加规则」与「时间锁定」入口**来表达
 * (ADR-076 的另一半):说不了「所有规则暂不生效」,就让用户点不动
 * 「对一个已停用的系统做配置」的那两个入口。
 */

/** §5.4 不可注入页(ADR-013):琥珀条,说明原因。 */
export { NOT_INJECTABLE_MESSAGE } from './tab-state.js';

/** §5.4 存储失败(ADR-046):顶部**红色**报错条「保存失败:{原因}」+ 可操作建议。 */
export const SAVE_FAILED_PREFIX = '保存失败:';

/** 底部添加按钮(§5.3)。 */
export const ADD_RULE_LABEL = '+ 添加规则';

/**
 * 🔴 **ADR-076:主开关 OFF 时,被禁用的入口要说得出**为什么**被禁用。**
 *
 * 一个只是变灰的按钮对所有人都是谜题,对屏幕阅读器用户更是 ——
 * `disabled` 只播报「不可用」,不播报原因。这句文案同时用于
 * 「+ 添加规则」与「🔒 时间锁定」两个入口的 `title`。
 *
 * 文案刻意给出**出路**(「请先开启」),而不只是陈述事实 ——
 * ADR-076 的全部意思就是「路径唯一:要用先开主开关」。
 */
export const MASTER_OFF_DISABLED_REASON = '已全局关闭,请先开启主开关';

/**
 * 锁定期间的禁用原因(ADR-051)。
 *
 * 🔴 措辞只说「不可修改」,**绝不**暗示有提前结束的途径
 * (ADR-052 / INV-12)。
 */
export const LOCKED_DISABLED_REASON = '锁定期间设置不可修改';

/** 主开关的无障碍名(ADR-009:全局单例主开关)。 */
export const MASTER_SWITCH_LABEL = '全局主开关';

export const BRAND_NAME = 'Color Filters';
