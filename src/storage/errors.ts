/**
 * 仓储层的**结构化写入错误**(ADR-046)。
 *
 * T3 gate 逐字要求:
 * > 写入失败返回结构化错误供 UI 渲染(ADR-046):区分 `quota` / `locked` / `other`
 * > (后者携带原始错误文案)。**不得只 throw 或只 console.error**
 *
 * ---
 *
 * ## 为什么 `locked` 必须是独立分类(T3 gate 的 I1 澄清)
 *
 * > 锁定拒绝**不是故障**,是设计中的预期行为。
 * > 若落入 `other`,UI 会弹出红色「保存失败」条并建议「请删除几条规则后重试」——
 * > 而锁定期间根本删不了。对一次预期内的拒绝报错是虚假警报。
 *
 * 即 ADR-046 的红色报错条(§5.4 第五种状态变体)只应由 `quota` / `other` 触发;
 * `locked` 由 T6c 的锁定态 UI 自行呈现。
 *
 * ## 为什么没有 `offline` / `rate-limit` 分类
 *
 * T3 gate 同样逐字澄清:
 * > 原表述含「离线 / 频率限制」—— 那是 `storage.sync` 的失败模式,
 * > `storage.local`(ADR-010)**不存在**这两种错误。
 * > 要求 Dev 为不可能发生的分支写测试会逼出伪造的测试替身。
 *
 * 故本文件**刻意只有三个分类**。
 */

/** 写入失败的分类(ADR-046)。三者互斥且穷尽。 */
export type WriteErrorKind =
  /** `chrome.storage.local` 配额(10MB)耗尽。真故障,触发红色报错条。 */
  | 'quota'
  /** 锁定期内的预期拒绝(INV-11/INV-14/ADR-055)。**不是故障**,不触发报错条。 */
  | 'locked'
  /** 其余一切失败,携带原始错误文案。真故障,触发红色报错条。 */
  | 'other';

/**
 * 被拒绝的具体原因 —— 供 UI 选择文案,**不替代** `kind`。
 *
 * UI 只需读 `kind` 即可正确分流;`reason` 是可选的精细化信息。
 */
export type WriteErrorReason =
  /** 容量硬上限 20 条(INV-7/ADR-011/ADR-012):提示并引导删除,绝不静默淘汰。 */
  | 'capacity-exceeded'
  /** 锁定期冻结 `masterEnabled`(ADR-051)。 */
  | 'locked-master-enabled'
  /** 锁定期冻结 `rules` 的增删改重排(INV-11)。 */
  | 'locked-rules'
  /** `lockUntil` 的写入被 `canSetLockUntil` 判定非法(ADR-052/INV-12)。 */
  | 'lock-write-rejected'
  /** 入参本身非法(如非法 pattern、越界索引)。 */
  | 'invalid-input'
  /** 底层 `chrome.storage.local` 抛错。 */
  | 'storage-failure';

/** 结构化写入错误(ADR-046)。**仓储层返回它,而不是 throw。** */
export interface WriteError {
  readonly kind: WriteErrorKind;
  readonly reason: WriteErrorReason;
  /** 面向用户的中文说明(ADR-047:首版仅中文)。 */
  readonly message: string;
  /**
   * `kind === 'other'` 时携带的**原始**错误文案(gate 要求)。
   * 其余分类下为 `undefined`。
   */
  readonly cause?: string;
}

/** 写入方法的统一返回类型。成功时携带写入后的完整设置,便于 UI 直接渲染。 */
export type WriteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WriteError };

export function writeOk<T>(value: T): WriteResult<T> {
  return { ok: true, value };
}

export function writeFail<T>(error: WriteError): WriteResult<T> {
  return { ok: false, error };
}

/**
 * 构造 `locked` 分类错误。
 *
 * **调用点必须是仓储层的写入方法本身**(INV-14/ADR-055)——
 * 锁定检查在数据层强制,UI 置灰只是第二道防线。
 */
export function lockedError(
  reason: 'locked-master-enabled' | 'locked-rules' | 'lock-write-rejected',
  message: string,
): WriteError {
  return { kind: 'locked', reason, message };
}

/** 构造 `capacity-exceeded` 错误(INV-7/ADR-012)。分类为 `other` —— 它是真的需要用户处理。 */
export function capacityError(): WriteError {
  return {
    kind: 'other',
    reason: 'capacity-exceeded',
    message: '规则数量已达上限 20 条,请先删除几条再添加。',
    cause: 'rules.length >= 20 (INV-7)',
  };
}

/** 构造入参非法错误。 */
export function invalidInputError(message: string): WriteError {
  return { kind: 'other', reason: 'invalid-input', message, cause: message };
}

/**
 * 把底层 `chrome.storage.local` 抛出的异常归类。
 *
 * 配额错误在 Chrome 中的文案含 `QUOTA_BYTES`(或 `quota exceeded`),据此识别。
 * 其余一概归为 `other` 并**原样保留**原始文案。
 */
export function classifyStorageError(cause: unknown): WriteError {
  const text =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : String(cause);

  if (/quota/i.test(text) || /QUOTA_BYTES/.test(text)) {
    return {
      kind: 'quota',
      reason: 'storage-failure',
      message: '存储空间已满,保存失败。请删除几条规则后重试。',
      cause: text,
    };
  }

  return {
    kind: 'other',
    reason: 'storage-failure',
    message: '保存失败,设置未被写入。',
    cause: text,
  };
}
