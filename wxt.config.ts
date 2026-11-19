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
    permissions: ['storage'],

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
