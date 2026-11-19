import { defineConfig } from 'vitest/config';

/**
 * Vitest 配置(DESIGN.md §7:TEST_CMD = `npm test`)。
 *
 * 环境为 node —— 领域层是纯 TypeScript(ADR-036),不需要 DOM。
 * 📌 DESIGN.md §8 第 8 条:REAL_STACK_GATE 必须在真实 Chrome 中跑,
 * jsdom/mock 下的绿灯不构成通过。本配置下的测试覆盖的是领域层与
 * 静态门禁这类**本就与浏览器无关**的部分,不冒充真实栈验收。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
