/**
 * 生成预生成滤镜 CSS 文件(ADR-063/075)—— `public/filters/{slug}-{intensity}.css`。
 *
 * **ADR-075:1 模式 × 101 档强度 = 101 个文件**(原 4 × 101 = 404)。
 * 被删掉的 303 个文件里写的是 `filter: url("data:image/svg+xml,…")`,
 * 即 ADR-069/073 记载的 CSP 静默失效载体;ADR-075 后产物里不再有任何 `data:` URI。
 *
 * 🔴 **本脚本不含任何滤镜值公式。** 文件名与内容全部来自
 * `src/injection/filter-file-css.ts` 的 `allFilterCssFiles()`,它内部
 * 复用 `filterCssValue`(领域层)。ADR-063 明文要求复用而非另写一份公式 ——
 * 否则预生成 CSS 与 JS 两条路径会漂移,表现为「首帧一个颜色、JS 跑完变另一个颜色」,
 * 且两边各自自测通过,极难发现。
 *
 * 📌 文件总数由 `FILTER_CSS_FILE_COUNT` 断言(下方两处),本脚本不写死数字 ——
 * 旧值 404 在任何一处残留都会让「恰好 101 个」变成一句没人检查的注释。
 *
 * ## 为什么用 rolldown 现场打包,而不是直接 import .ts
 *
 * Node 无法直接 import TypeScript。即便用 Node 23 的原生类型擦除
 * (`--experimental-strip-types`)也不行:本仓库的 import 一律写
 * `.js` 扩展名(NodeNext 风格),而磁盘上是 `.ts` 文件 ——
 * 类型擦除不做这层重映射,解析会直接失败。
 *
 * 故现场打包。用的是 **rolldown**(vite 7 的打包内核,本仓库已有的
 * 传递依赖),零新增依赖。`bundle` 一步同时解决类型擦除与 `.js`→`.ts`
 * 的解析重映射。
 *
 * ## 运行时机
 *
 * `npm run build` 的 `prebuild` 钩子。产物进 `public/`,WXT 原样拷进
 * `build/chrome-mv3/filters/`,于是
 * `registerContentScripts({ css: ['filters/gray-100.css'] })` 的路径成立。
 *
 * 📌 产物**提交进仓库**(同 ADR-045 的图标做法):
 * 这样 `tests/` 里 ADR-063 的门禁不依赖「先跑过构建」,
 * 且 code review 能看见滤镜值的实际变化。
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'rolldown';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/filters');

/**
 * 把 `filter-file-css.ts` 及其依赖打成一个内存中的 ESM 包再 import。
 *
 * 打包(而非逐文件转译)是必需的:该模块 import 领域层,领域层内部
 * 又有多层 `.js` 扩展名的相对 import —— 只有打包器会做
 * `./foo.js` → `./foo.ts` 的解析重映射。
 *
 * `write: false` → 不落临时文件,产物经 `data:` URL 直接 import。
 */
async function loadFilterCssModule() {
  const result = await build({
    input: resolve(ROOT, 'src/injection/filter-file-css.ts'),
    write: false,
    output: { format: 'esm' },
    platform: 'node',
    logLevel: 'silent',
    resolve: {
      // 源码一律写 `.js` 扩展名(NodeNext 风格),磁盘上是 `.ts`。
      extensions: ['.ts', '.js'],
      extensionAlias: { '.js': ['.ts', '.js'] },
    },
  });
  const chunk = result.output.find((o) => o.type === 'chunk');
  const code = chunk.code;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return import(dataUrl);
}

const { allFilterCssFiles, FILTER_CSS_FILE_COUNT } =
  await loadFilterCssModule();

const files = allFilterCssFiles();

if (files.length !== FILTER_CSS_FILE_COUNT) {
  throw new Error(
    `期望 ${FILTER_CSS_FILE_COUNT} 个文件,实际枚举出 ${files.length} 个`,
  );
}

// 先清空:改了命名规则时不留孤儿文件(孤儿文件会让 ADR-063 的
// 「恰好 FILTER_CSS_FILE_COUNT 个」门禁失败,那正是我们希望它失败的情形)。
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

for (const file of files) {
  // file.path 形如 `filters/gray-100.css`;去掉目录前缀再落到 OUT_DIR。
  const name = file.path.slice(file.path.indexOf('/') + 1);
  writeFileSync(resolve(OUT_DIR, name), file.content, 'utf8');
}

const written = readdirSync(OUT_DIR).filter((f) => f.endsWith('.css'));
if (written.length !== FILTER_CSS_FILE_COUNT) {
  throw new Error(
    `写入后目录内有 ${written.length} 个 .css,期望 ${FILTER_CSS_FILE_COUNT}`,
  );
}

console.log(
  `[generate-filter-css] 已生成 ${written.length} 个滤镜 CSS 文件 → public/filters/`,
);
