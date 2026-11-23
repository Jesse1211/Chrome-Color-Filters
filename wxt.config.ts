import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // ADR-039:关闭 WXT 的 auto-imports。自动全局注入会让 ADR-036 的
  // 纯度静态检查难以实施与阅读 —— 显式 import 才使分层约束可验证。
  imports: false,

  manifest: {
    name: 'Chrome Color Filters',
    description: '给用户指定的网站套用色觉滤镜',

    // ADR-004:唯一能支撑「打开匹配站点自动套滤镜」的权限模型。
    host_permissions: ['<all_urls>'],

    // ADR-010:规则存于 chrome.storage.local(仅本机,不跨设备同步)。
    //
    // 🔴 `scripting` 是 ADR-062 的**前提** —— 声明式注册
    // (`chrome.scripting.registerContentScripts`)是 INV-3 零闪烁的主路径,
    // 漏了这条权限所有注册调用都会失败,且失败表现是「滤镜静默不生效」。
    // 它**不增加任何用户可见的权限警告**(DESIGN.md §6 第 3 条),
    // 故没有产品侧理由省它。
    // 🔴 `tabs` 是 **ADR-013 + ADR-044 的前提**(本轮返工加入)。
    //
    // ADR-044 把 `reason` 的取值**逐字定死**为
    // `'internal-page' | 'web-store' | 'pdf' | 'new-tab' | 'no-tab'`,
    // 而 ADR-013 把 `chrome://` 与「新标签页」列为**两类不同**的不可注入页
    // (两者的 popup 文案不同 —— 这正是 ADR-013「说明原因」的全部意义)。
    //
    // 实测(docs/T5-gate/tabstate.cjs,真实 Chrome 产物上 A/B):
    // 没有本权限时,`chrome://` 页的 tab 对象里 `url` / `pendingUrl` /
    // `title` / `favIconUrl` **全部被 Chrome 扣留** —— `chrome.tabs.get()`
    // 返回的对象连 key 都没有。`<all_urls>` **不覆盖**特权 scheme,
    // 故 host_permissions 给不了这个信息。
    // 结果是 `chrome://settings` 与 `chrome://newtab` 在 SW 眼里**完全同形**,
    // 判定只能退化成 `new-tab` —— 即 ADR-044 契约字段取值**错误**,
    // 且是 §6 T5 gate「`reason` 字段取值正确」直接判红的那一条。
    // 加上本权限后同一产物上 `url` 变为 `"chrome://settings/"`,reason 恢复
    // 为 `'internal-page'`。
    //
    // ⚠️ **本条会新增一条用户可见警告「读取您的浏览记录」** —— 实测
    // `chrome://extensions` 的权限列表在加它之后多出这一行,它**不**被
    // `<all_urls>` 的站点访问警告吸收(docs/T5-gate/ 的 warning A/B)。
    // 这与 DESIGN.md §6 第 3 条给 `scripting` 的那句「不增加任何用户可见的
    // 权限警告」**不同**,故此处如实记下,已作为 needs-human 事项上报:
    // 契约(ADR-044 的五档 reason)与零新增警告两者不可兼得,本轮按
    // 「ADR 定死的契约优先」处理,未自行放宽 ADR-044。
    // 不违反 ADR-026/§8 第 7 条:那条禁的是**读取/外传页面内容**,
    // 本权限只用于读当前 tab 的 URL 做可注入性分类,不读 DOM、不外传。
    permissions: ['storage', 'scripting', 'tabs'],

    // ADR-045 / ADR-019:图标两态,必须是不同的图片资源。
    // 这里注册的是「未生效态」作为静态默认值;T5 在运行时按 tab 切到
    // public/icon/active/*(ADR-019:亮 = 这页被改色了)。
    icons: {
      16: 'icon/inactive/16.png',
      32: 'icon/inactive/32.png',
      48: 'icon/inactive/48.png',
      128: 'icon/inactive/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/inactive/16.png',
        32: 'icon/inactive/32.png',
        48: 'icon/inactive/48.png',
        128: 'icon/inactive/128.png',
      },
    },
  },
});
