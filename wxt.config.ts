import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  // 产物目录改为 `build/`(默认是 WXT 的 `.output/`)。
  // 理由:`.output` 是隐藏目录,用户在「加载已解压的扩展程序」的文件选择器里
  // 默认看不到它。`build/` 可见、语义直白,且与多数前端项目的习惯一致。
  //
  // 🔴 改这里必须同步改以下引用(它们按路径找产物,不读本配置):
  //    tests/build-manifest.test.ts、tests/t4b-static-gates.test.ts、
  //    tests/content-script-privacy.test.ts、docs/T4a-gate/lib.cjs、
  //    docs/T7-gate/build-probe.mjs、docs/T7-gate/inv10-pathological.cjs、
  //    .gitignore。漏改的表现是「缺少生产构建产物」或门禁读到旧产物(ADR-038)。
  outDir: 'build',

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
    // 🔴 `alarms` 是 **ADR-077 的前提**(锁定到期自动关闭主开关)。
    //
    // ADR-077 原文:
    // > 自动关闭必须在**到期那一刻**真的发生一次写入,即使 popup 没开、
    // > SW 已休眠。故需 `chrome.alarms` 权限 + 在设置/延长锁定时安排闹钟 +
    // > `onStartup`/`onInstalled` 时重建闹钟(MV3 的 SW 随时会被回收,
    // > `setTimeout` 不可靠)。
    //
    // 漏了这条权限,`chrome.alarms` 整个为 `undefined` → `alarms-port.ts`
    // 降级为「什么都不做」→ 闹钟这条触发线**静默消失**。
    // 表现是「popup 关着时锁定到期后滤镜仍开着,直到下次 SW 偶然被唤醒」,
    // 不是一条报错 —— 故必须在**产物**上核对(ADR-038),
    // 单测见 tests/build-manifest.test.ts。
    //
    // ✅ **本条不新增任何用户可见的权限警告 —— 已在真实 Chrome 上 A/B 实测。**
    // 探针 `docs/T7-gate/alarms-permission-warning.cjs` 用
    // `chrome.management.getPermissionWarningsByManifest()`(它返回的就是
    // 安装/更新对话框里逐行给用户看的那几句)对同一份产物 manifest 做 A/B:
    //   · 基线(storage/scripting/tabs):["Read and change all your data on all websites"]
    //   · +alarms                      :["Read and change all your data on all websites"]  ← 逐字相同
    //   · +history(探针有效性对照)     :多出 "Read and change your browsing history…"
    // 即 `alarms` 新增 0 条、删除 0 条;对照组证明该探针读得出变化
    // (否则「零新增」可能只是因为根本读不到警告)。
    // 证据:docs/T7-gate/out/alarms-permission-warning.json。
    //
    // 📌 顺带实测到的一处**与上方 `tabs` 注释不符**的事实,如实记下:
    // 本版本(Chrome for Testing 158.0.8127.36)上基线警告里**只有一条**
    // 站点访问警告,没有独立的「读取您的浏览记录」那一行 —— 即在
    // `<all_urls>` 已在场时,`tabs` 的警告被站点访问警告吸收了。
    // 上方注释记录的是当时(更早版本)的实测结果,本轮未改动 `tabs`,
    // 故**不修改那段历史记录**,只在此注明两者的差异来源是 Chrome 版本。
    permissions: ['storage', 'scripting', 'tabs', 'alarms'],

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
