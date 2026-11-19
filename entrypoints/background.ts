import { defineBackground } from 'wxt/utils/define-background';

/**
 * MV3 service worker 入口。
 *
 * 后台协调与图标两态(ADR-019 / ADR-045)由 T5 实现。
 */
export default defineBackground(() => {
  // T5 实现:tab 状态协调、GET_TAB_STATE 消息(ADR-044)、图标两态切换。
});
