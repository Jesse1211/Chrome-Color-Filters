/**
 * 🔴 门禁专用:把**产品自己的** `matchGlob` 以 IIFE 形式导出到全局。
 *
 * 供 `inv10-pathological.cjs` 在**扩展的 isolated world** 里直接测它的耗时
 * (INV-10:匹配实现必须具有线性时间复杂度上界)。
 *
 * ⚠️ 本文件**不进产品**,`npm run build` 清空 `.output` 时一并消失。
 * 它 import 的是 `src/domain/glob.ts` —— 与 content script 用的是同一份源码,
 * 故测到的就是产品的真实实现,不是手抄的近似物。
 */
export { matchGlob } from '../../../src/domain/glob.js';
