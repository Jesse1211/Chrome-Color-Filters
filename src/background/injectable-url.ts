/**
 * 不可注入页面的识别(**ADR-013**)—— T5 的「向 popup 上报原因」的判定核心。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * > ADR-013:不可注入页面(`chrome://`、应用商店、PDF、新标签页)**控件置灰 +
 * > 说明原因**。理由:用户知道发生了什么,不会误以为扩展坏了。
 *
 * `reason` 的取值集合由 **ADR-044** 的 `TabState` 契约逐字定死:
 * `'internal-page' | 'web-store' | 'pdf' | 'new-tab' | 'no-tab'`。
 * 本模块**不得**发明第六种取值 —— popup(T6a)按这五种做文案映射。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * ## 为什么是纯函数、零 `chrome.*`
 *
 * 判定只依赖一个 URL 字符串。做成纯函数后,§6 T5 gate 的那条
 * 「不可注入 URL(`chrome://settings`、应用商店、`file://`、新标签页)
 * 被正确识别,且 `reason` 字段取值正确」可以在 Node 下**机械判定**,
 * 而不是「在真实 Chrome 里逐个打开看一眼」(§8 第 8 条对 mock 绿灯的限制
 * 针对的是 REAL_STACK_GATE 那类端到端断言,不是这种纯字符串分类)。
 *
 * ## 分类口径(逐条对应 ADR-013 列出的四类)
 *
 * | 类别 | 判定 | `reason` |
 * |------|------|----------|
 * | 新标签页 | `chrome://newtab`、`about:newtab`、`edge://newtab`、空 URL | `new-tab` |
 * | 浏览器内部页 | `chrome://`、`chrome-extension://`、`about:`、`devtools://`、`view-source:` 等 | `internal-page` |
 * | 应用商店 | `chromewebstore.google.com`、`chrome.google.com/webstore`、`addons.mozilla.org` | `web-store` |
 * | PDF | 路径以 `.pdf` 结尾(含查询串前的路径部分) | `pdf` |
 *
 * 📌 **`file://` 归入 `internal-page`。** §6 T5 gate 把 `file://` 与
 * `chrome://settings`、应用商店、新标签页并列为「不可注入 URL」,而 ADR-044
 * 的 `reason` 枚举里**没有** `file` 这一项。于是只有两种不自欺的做法:
 * 发明第六种取值(违反 ADR-044「不得各自发挥」),或归入现有取值。
 * 选后者:`file://` 的不可注入原因与 `chrome://` 同源 —— 都是扩展未获授权的
 * 特权 scheme(`file://` 需要用户在 `chrome://extensions` 单独勾选
 * 「允许访问文件网址」,默认关闭),故 `internal-page` 是语义最近的取值。
 * **不是** `pdf`:`file:///x.pdf` 同时命中两类,PDF 判定在 scheme 判定之后
 * 才轮到,见 `classifyUrl` 的顺序注释。
 *
 * ## INV-10:线性时间,不使用 RegExp
 *
 * DESIGN.md §8 第 6 条禁止用 RegExp 做匹配判定。本模块只做常数次
 * `startsWith` / `endsWith` / `indexOf` —— 全部线性且无回溯。
 */

import { type TabStateReason } from '../ui/tab-state.js';

/** 可注入性的分类结果。`injectable === true` 时 `reason` 为 undefined。 */
export interface UrlClassification {
  readonly injectable: boolean;
  readonly reason?: TabStateReason;
}

/** 可注入 —— 单例,避免每次分类都分配对象。 */
const INJECTABLE: UrlClassification = { injectable: true };

function notInjectable(reason: TabStateReason): UrlClassification {
  return { injectable: false, reason };
}

/**
 * 新标签页的 URL 形态。
 *
 * Chrome 的新标签页在 `chrome.tabs` 里可能表现为 `chrome://newtab/`,
 * 也可能是 `about:newtab`(某些渠道)或空字符串(尚未提交导航)。
 * 三者都必须归 `new-tab` 而非 `internal-page` —— ADR-044 把它们列为
 * **不同**的 reason,popup 的文案也不同(「新标签页上没有可滤镜的内容」
 * 比「Chrome 内部页面」更贴切)。
 */
const NEW_TAB_URLS = [
  'chrome://newtab',
  'chrome://new-tab-page',
  'about:newtab',
  'about:blank',
  'edge://newtab',
];

/**
 * 特权 scheme —— 扩展无法注入(平台硬限制,见 ADR-013 的「平台限制」措辞)。
 *
 * `file:` 的归类理由见文件头的 📌 一段。
 */
const INTERNAL_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'chrome-untrusted:',
  'chrome-search:',
  'devtools:',
  'view-source:',
  'about:',
  'edge:',
  'extension:',
  'moz-extension:',
  'file:',
  'data:',
  'blob:',
  'filesystem:',
  'javascript:',
];

/**
 * 应用商店 host —— Chrome **即使授予 `<all_urls>` 也拒绝**在其上运行脚本。
 *
 * 这是一条被硬编码在浏览器里的例外(`chrome.google.com/webstore` 与
 * 新域 `chromewebstore.google.com`),不是权限问题,故必须单独识别,
 * 否则 popup 会显示「规则已生效」而页面毫无变化 —— 正是 ADR-013 要防的
 * 「用户误以为扩展坏了」。
 */
const WEB_STORE_HOSTS = [
  'chromewebstore.google.com',
  'chrome.google.com',
  'addons.mozilla.org',
  'microsoftedge.microsoft.com',
];

/** `chrome.google.com` 只有 `/webstore` 路径是商店;其余路径可正常注入。 */
const WEB_STORE_PATH_PREFIX = '/webstore';

/**
 * 分类一个 URL。
 *
 * **判定顺序是语义的一部分**,不可重排:
 *
 * 1. 空 / 缺失 URL → `new-tab`(tab 尚未提交导航,最常见于刚打开的新标签页)
 * 2. 新标签页的具名 URL → `new-tab`(必须早于 scheme 判定,否则
 *    `chrome://newtab` 会被 `chrome:` 吃掉变成 `internal-page`)
 * 3. 特权 scheme → `internal-page`
 * 4. 应用商店 host → `web-store`
 * 5. 路径以 `.pdf` 结尾 → `pdf`(放在最后:`file:///x.pdf` 的首要原因是
 *    scheme 不可注入,而不是「它是 PDF」)
 * 6. 其余 → 可注入
 *
 * 解析失败(非法 URL)返回 `no-tab` —— 它是 ADR-044 里「什么都不知道」的
 * 那一档,与超时降级同值(`FALLBACK_TAB_STATE`),语义一致。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔴 **URL「缺失」与「空串」不是一回事(本轮返工修正的真实缺陷)**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 原实现把 `null` / `undefined` / `''` 三者**一并**判成 `new-tab`。
 * 这在真实 Chrome 上产生了一个 ADR-044 契约字段的**错值**:
 * `chrome://` 页上 tab 对象的 `url` 被浏览器扣留(见 `wxt.config.ts` 中
 * `tabs` 权限那段的实测记录),于是 `chrome://settings` 被报成 `new-tab` ——
 * popup 会显示「新标签页上没有可滤镜的内容」,而用户正看着设置页。
 *
 * 根因有两层,两层都修:
 * 1. **能力层**:缺 `tabs` 权限导致 URL 根本拿不到 → 已在 `wxt.config.ts` 补。
 * 2. **语义层(本处)**:URL **未知**时不应当断言一个**具体**原因。
 *    `new-tab` 是一条确定的事实陈述(「这是新标签页」),而我们此时
 *    什么都不知道。ADR-044 为「什么都不知道」留的那一档是 `no-tab`
 *    (契约注释里它正是 popup 超时降级用的值)。
 *    故:`null` / `undefined`(= 未被告知)→ `no-tab`;
 *    `''`(= tab 明确报了一个空 URL,尚未提交导航)→ `new-tab`。
 *
 * 第 2 层是**纵深防御**:即使将来某个渠道/某个权限配置下 URL 又一次被扣留,
 * 失效方向也从「自信地说错」退化成「诚实地说不知道」——
 * popup 两种情况都会置灰控件(ADR-013),但不再对用户撒谎。
 */
export function classifyUrl(url: string | null | undefined): UrlClassification {
  // URL 未被告知(权限不足 / tab 已消失)—— 不知道就说不知道,见上注。
  if (url === null || url === undefined) {
    return notInjectable('no-tab');
  }
  // tab 报了一个空 URL:确实是尚未提交导航的新标签页。
  if (typeof url !== 'string' || url.length === 0) {
    return notInjectable('new-tab');
  }

  const lower = url.toLowerCase();

  for (const newTab of NEW_TAB_URLS) {
    // 前缀匹配而非相等:真实 URL 常带尾随 `/` 或查询串。
    if (lower === newTab || lower.startsWith(`${newTab}/`)) {
      return notInjectable('new-tab');
    }
  }

  for (const scheme of INTERNAL_SCHEMES) {
    if (lower.startsWith(scheme)) return notInjectable('internal-page');
  }

  // 到这里 scheme 应当是 http(s);其余(如自定义协议)一律当内部页处理,
  // 因为扩展注入只在 http/https 上被允许。
  if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
    return notInjectable('internal-page');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return notInjectable('no-tab');
  }

  const host = parsed.hostname.toLowerCase();
  for (const storeHost of WEB_STORE_HOSTS) {
    if (host !== storeHost) continue;
    if (storeHost === 'chrome.google.com') {
      if (parsed.pathname.toLowerCase().startsWith(WEB_STORE_PATH_PREFIX)) {
        return notInjectable('web-store');
      }
      continue; // chrome.google.com 的非 /webstore 路径可注入
    }
    if (storeHost === 'microsoftedge.microsoft.com') {
      if (parsed.pathname.toLowerCase().startsWith('/addons')) {
        return notInjectable('web-store');
      }
      continue;
    }
    return notInjectable('web-store');
  }

  if (parsed.pathname.toLowerCase().endsWith('.pdf')) {
    return notInjectable('pdf');
  }

  return INJECTABLE;
}

/** 便捷谓词 —— 等价于 `classifyUrl(url).injectable`。 */
export function isInjectableUrl(url: string | null | undefined): boolean {
  return classifyUrl(url).injectable;
}
