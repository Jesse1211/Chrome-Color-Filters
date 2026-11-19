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

/** §5.4 主开关 OFF:提示条变琥珀。 */
export const MASTER_OFF_NOTICE = '已全局关闭,所有规则暂不生效';

/** §5.4 不可注入页(ADR-013):琥珀条,说明原因。 */
export { NOT_INJECTABLE_MESSAGE } from './tab-state.js';

/** §5.4 存储失败(ADR-046):顶部**红色**报错条「保存失败:{原因}」+ 可操作建议。 */
export const SAVE_FAILED_PREFIX = '保存失败:';

/** 底部添加按钮(§5.3)。 */
export const ADD_RULE_LABEL = '+ 添加规则';

/** 主开关的无障碍名(ADR-009:全局单例主开关)。 */
export const MASTER_SWITCH_LABEL = '全局主开关';

export const BRAND_NAME = 'Color Filters';
