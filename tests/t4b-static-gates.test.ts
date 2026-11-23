/**
 * T4b 的**静态**门禁 —— DESIGN.md §6 T4b gate 中「机械可判定」的那些条款。
 *
 * 分两类:
 *
 * **(一) 非侵入审计(INV-9 / ADR-026)** —— gate 原文:
 *
 * > - **非侵入审计(机械可判定,ADR-026)** — 不接受「人工看一遍」,三项全做:
 * >   - **(a) 静态断言**:content script 产物源码中不含 `fetch`、`XMLHttpRequest`、
 * >     `sendBeacon`、`WebSocket`、`navigator.sendBeacon`、**向外部扩展 ID 发送的
 * >     `chrome.runtime.sendMessage`/`connect`**、**`new Image()` / `.src` 赋值**
 * >     (图片信标)、**动态 `import()`**
 * >   - **(b) 静态断言**:不读取 `innerText` / `innerHTML` / `textContent` /
 * >     `document.body` 的内容
 *
 * (c)(真实 Chrome 的 Network 实测)属于 REAL_STACK_GATE,见
 * `docs/T4b-gate/README.md` —— 静态断言挡不住运行时才构造的外传,
 * 故那一项不可省,本文件也不冒充它(DESIGN.md §8 第 8 条)。
 *
 * **(二) 不得把 ADR 的保证藏在默认关闭的开关后面** —— `InjectorDeps` 的
 * `liveness` / `preview` 是**路径**开关(为既有单测与非浏览器宿主留的),
 * 生产入口必须开着它们。否则 INV-5 与 ADR-049 会在产物里静默缺失,
 * 而所有单测照样全绿。
 *
 * 📌 既有的 `tests/content-script-privacy.test.ts` 覆盖了 T4a 时期能断言的
 * 子集(含 ADR-060 窄口例外的守护),本文件**补齐** gate 点名而那边尚未覆盖的项,
 * 不重复、不替代。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CS = resolve(ROOT, '.output/chrome-mv3/content-scripts/content.js');
const built = existsSync(CS);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * 去掉注释后的源码。
 *
 * ⚠️ **这不是放宽门禁,而是把它瞄准正确的目标**(同 `t6a-static-gates.test.ts`
 * 里那段说明的理由):本项目要求在代码里引用 ADR 编号并写明理由(§8 第 1、3 条),
 * 于是注释里**必然**出现「不得 fetch」「不读 innerText」这类字样 ——
 * 不剥注释,这些门禁会被自己的文档触发,变成假红。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** 注入层 + content script 入口的**产品**源码(不含测试)。 */
const INJECTION_SOURCES = [
  ...walk(resolve(ROOT, 'src/injection')),
  resolve(ROOT, 'entrypoints/content.ts'),
].filter((f) => !f.includes('__tests__') && /\.(ts|tsx)$/.test(f));

// ══════════════════ (一) 非侵入审计(INV-9 / ADR-026) ══════════════════

describe.skipIf(!built)(
  '🔴 T4b gate (a) · content script 产物不含任何外传通道(ADR-026)',
  () => {
    const code = built ? readFileSync(CS, 'utf8') : '';

    it('不含网络外传 API', () => {
      // gate 逐字点名的全集。`fetch(`/`XMLHttpRequest`/`sendBeacon`/`WebSocket`
      // 与既有 privacy 测试重叠是**有意**的 —— 两处都红才好诊断。
      for (const bad of [
        'fetch(',
        'XMLHttpRequest',
        'sendBeacon',
        'navigator.sendBeacon',
        'WebSocket',
        'EventSource',
        'RTCPeerConnection',
        'navigator.connection',
      ]) {
        expect(code, `产物中出现了外传通道 ${bad}`).not.toContain(bad);
      }
    });

    it('🔴 不含图片信标(`new Image()` / `.src` 赋值)', () => {
      expect(code).not.toContain('new Image(');
      // `.src =` 是图片信标最常见的形态(也可用于 script/iframe 注入)。
      // 产物经压缩后标识符会改名,但 `.src` 这个**属性名**不会被改
      // (它是平台 API 的一部分),故这条断言在压缩产物上依然有效。
      expect(code).not.toMatch(/\.src\s*=/);
      expect(code).not.toContain('createElement');
    });

    it('🔴 不含动态 import()', () => {
      // 动态 import 能在运行时从任意 URL 拉代码,等于给静态审计开了后门 ——
      // 这正是 gate 点名它的原因。
      expect(code).not.toMatch(/\bimport\s*\(/);
      expect(code).not.toContain('importScripts');
    });

    it('🔴 不向外部扩展 ID 发送 sendMessage / connect', () => {
      // 跨扩展通道(`chrome.runtime.sendMessage(extensionId, ...)` /
      // `chrome.runtime.connect(extensionId, ...)`)是一条真实的外传路径:
      // 另一个扩展可以有任意权限。
      expect(code).not.toContain('sendMessage');
      expect(code).not.toContain('sendNativeMessage');
      expect(code).not.toContain('connectNative');
      // 🔴 本产物**只应**出现 `onConnect`(被动接听,ADR-049 的预览接收端),
      //    绝不应出现**主动发起**的 `.connect(`。
      expect(code).not.toMatch(/\.connect\s*\(/);
    });

    it('🔴 产物里的 chrome API 面是一份**白名单**,全部被动/自有存储', () => {
      // 这条是上面各条的**正向**对偶,也是本组断言里最有价值的一条:
      // 与其逐一列举禁词(永远可能漏一个新 API),不如把**允许的全集**钉死。
      // 今后任何人在 content script 里新增一个 chrome API 都会让这里变红,
      // 迫使他显式论证它不违反 ADR-026。
      const surfaces = new Set(
        [...code.matchAll(/chrome\??\.?\s*[\w.?]*/g)]
          .map((m) => m[0])
          .filter((s) => s.length > 'chrome'.length),
      );
      expect([...surfaces].sort()).toEqual(
        [
          // ADR-049 预览接收端:**只接听**,不主动发起(见上面 connect 那条)。
          'chrome?.runtime?.onConnect',
          // ADR-010:扩展自有设置,不是页面数据。
          'chrome?.storage?.local',
          // INV-4:多 tab 即时同步。
          'chrome?.storage?.onChanged',
          // ⚠️ 这一处**不是** API 调用,而是 `storage/storage-area.ts` 里那条
          //    错误消息的字面量(「chrome.storage.local 不可用 ——
          //    本适配器只能在扩展上下文中使用(ADR-010)」)。实测确认,
          //    不要当成第四个 API 面去「清理」。
          'chrome.storage.local',
        ].sort(),
      );
      // 尤其:content script 里不该有 `chrome.tabs`(它拿不到,也不需要 ——
      // 预览路由在**popup 侧**用 `chrome.tabs.connect`,接收端只需 onConnect)。
      expect(code).not.toContain('chrome.tabs');
      expect(code).not.toContain('.tabs.');
    });
  },
);

describe.skipIf(!built)(
  '🔴 T4b gate (b) · content script 产物不读取页面内容(ADR-026)',
  () => {
    const code = built ? readFileSync(CS, 'utf8') : '';

    it('不读 innerText / innerHTML / textContent / outerHTML', () => {
      for (const bad of [
        'innerText',
        'innerHTML',
        'outerHTML',
        'textConten', // 故意少一个字符以同时覆盖 textContent/textContents
      ]) {
        expect(code, `产物中出现了页面内容读取 ${bad}`).not.toContain(bad);
      }
    });

    it('🔴 不读 document.body', () => {
      // gate 逐字点名。注入目标恒为 `documentElement`(T0 spike §1),
      // 碰 body 既无必要,也是 INV-1 最脆弱的那个点(`body{filter}` 会让
      // 固定头部跳到 y=-1000)。
      expect(code).not.toContain('document.body');
      expect(code).not.toContain('.body');
    });

    it('不遍历/不查询页面元素', () => {
      for (const bad of [
        'querySelector',
        'getElementsBy',
        'children',
        'childNodes',
        'firstChild',
        'nextSibling',
        'getAttributeNames',
      ]) {
        expect(code, `产物中出现了页面遍历 ${bad}`).not.toContain(bad);
      }
    });

    it('🔴 不读取表单值、cookie、选区、计算样式', () => {
      for (const bad of [
        'document.cookie',
        'document.forms',
        'FormData',
        'getSelection',
        'elementFromPoint',
        'getComputedStyle',
      ]) {
        expect(code, `产物中出现了 ${bad}`).not.toContain(bad);
      }
    });

    it('🔴 不读元素的 `.value`(表单输入)', () => {
      // ⚠️ 这条断言的形状是被**实测纠正**过的,不要改回裸 `.value`。
      //
      // 第一版写的是 `expect(code).not.toContain('.value')`,当场假红:
      // 领域层的 `Result<T>` 形如 `{ ok: true, value }`,压缩产物里有一处
      // `rules: r.value` —— 那是解包自家的结果类型,与「读页面表单」毫无关系。
      // 裸 `.value` 区分不了这两件事,于是它无法成为门禁:
      // 要么永远假红,要么被人删掉。两种结局都比「瞄准正确目标」差。
      //
      // 改为钉「读表单值」真正需要的**前置能力**:拿到一个表单元素。
      // 本扩展的注入目标恒为 `document.documentElement`(T0 spike §1),
      // 取元素的 API 已由上面「不遍历/不查询页面元素」那条全部封死;
      // 这里补上「通过事件拿元素」这条路。
      expect(code).not.toContain('addEventListener(`input`');
      expect(code).not.toContain('addEventListener(`change`');
      expect(code).not.toContain('addEventListener(`submit`');
      expect(code).not.toMatch(/\.(target|currentTarget)\s*\.\s*value/);
      // 正向对偶:产物里 `.value` 的出现次数被钉死。新增任何一处都会让
      // 这里变红,迫使后续任务显式论证它的来历(而不是悄悄多一处)。
      expect((code.match(/\.value\b/g) ?? []).length).toBe(1);
    });

    it('🔴 MutationObserver 的 observe 选项里 characterData 为 false', () => {
      // 存活性(INV-5)用了 MutationObserver。`characterData: true`
      // 等同于观察页面**文本内容** —— ADR-026 的红线。
      // 压缩后属性名不变(它们是平台 API 的一部分),故可直接断言。
      expect(code).toContain('MutationObserver');
      expect(code).toMatch(/characterData\s*:\s*(!1|false)/);
      expect(code).toMatch(/subtree\s*:\s*(!1|false)/);
      expect(code).toMatch(/childList\s*:\s*(!1|false)/);
      // 属性白名单必须在位 —— 否则会观察 `<html>` 上的**所有**属性变化。
      expect(code).toContain('attributeFilter');
    });
  },
);

describe('🔴 T4b · 注入层源码层面的非侵入约束(不依赖产物是否已构建)', () => {
  it('注入层产品源码不含任何外传通道与页面内容读取', () => {
    // 产物断言会在未构建时 skip;这一条**永远**跑,使门禁不依赖构建顺序。
    for (const file of INJECTION_SOURCES) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const bad of [
        'fetch(',
        'XMLHttpRequest',
        'sendBeacon',
        'WebSocket',
        'new Image(',
        'innerText',
        'innerHTML',
        'outerHTML',
        'document.body',
        'document.cookie',
        'querySelectorAll',
        'sendMessage',
      ]) {
        expect(code, `${file} 含 ${bad}`).not.toContain(bad);
      }
    }
  });

  it('🔴 ADR-026 不被 ADR-060 的窄口例外撑宽:快路径是**写**,不是**读页面**', () => {
    // DESIGN.md §6 T4b 对此有明确澄清:
    //
    // > 注意 ADR-060 的 localStorage 快路径是**写**滤镜参数,
    // > 不是**读**页面内容,不违反 ADR-026。
    //
    // 机械把守的落点:只碰自家前缀的那一个键,且**从不枚举** ——
    // 枚举等同于读取站点写入的数据。
    const store = readFileSync(
      resolve(ROOT, 'src/injection/fast-path-store.ts'),
      'utf8',
    );
    const code = stripComments(store);
    expect(code).not.toMatch(/\.key\s*\(/);
    expect(code).not.toMatch(/\.length/);
    expect(code).not.toMatch(/Object\.(keys|values|entries)\s*\(/);
    const cache = stripComments(
      readFileSync(resolve(ROOT, 'src/injection/fast-path-cache.ts'), 'utf8'),
    );
    expect(cache).toContain('__ccf_fp_');
    expect(cache).not.toMatch(/Object\.(keys|values|entries)\s*\(/);
  });
});

// ══════════════ (二) ADR 的保证不得藏在默认关闭的开关后 ══════════════

describe('🔴 T4b · 生产入口必须真的启用存活性与预览(反「flag 掉 ADR 保证」)', () => {
  const entry = readFileSync(resolve(ROOT, 'entrypoints/content.ts'), 'utf8');
  const code = stripComments(entry);

  it('🔴 content script 入口启用存活性(INV-5 / ADR-017)', () => {
    // `InjectorDeps.liveness` 缺省为 false(为既有单测与非浏览器宿主留的
    // **路径**开关)。若生产入口忘了打开,INV-5 会在产物里静默缺失,
    // 而所有单测照样全绿 —— 这正是本断言存在的理由。
    expect(code).toMatch(/liveness:\s*true/);
  });

  it('🔴 content script 入口启用预览接收端(ADR-049)', () => {
    // 同理:T6b 依赖 T4b 的接收端。接收端没接上时,T6b 的表现是
    // 「拖动滑块无反应」—— 一个在 T6b 才暴露、却源于 T4b 的缺陷。
    expect(code).toMatch(/preview:\s*true/);
  });

  it('🔴 预览路由是直连 content script,不经 service worker 中转(ADR-049)', () => {
    // DESIGN.md §6 T4b:「不经 service worker 中转 —— 否则 T5 进入预览路径,
    // 而 T5 并非 T6b 的上游」。
    //
    // 接收端这一侧的可判定形态:用 `onConnect`(被动接听由
    // `chrome.tabs.connect` 发起的直连),而**不是** `onMessage`
    // (那意味着经 runtime 消息总线/SW 中转)。
    const receiver = stripComments(
      readFileSync(resolve(ROOT, 'src/injection/preview-receiver.ts'), 'utf8'),
    );
    expect(receiver).toContain('onConnect');
    expect(receiver).not.toContain('runtime.onMessage');
    // service worker 入口**不得**出现预览消息常量 —— 它不该在预览路径上。
    const bg = stripComments(
      readFileSync(resolve(ROOT, 'entrypoints/background.ts'), 'utf8'),
    );
    expect(bg).not.toContain('PREVIEW_FILTER');
    expect(bg).not.toContain('PREVIEW_CLEAR');
    expect(bg).not.toContain('preview');
  });

  it('🔴 预览接收端模块不接触任何存储 —— 预览值物理上无处落盘(ADR-049)', () => {
    // gate 的 spy 断言(「storage 无写入」)在 `preview.test.ts` 里;
    // 这一条是它的**结构**对偶:连能写的东西都不 import。
    const receiver = stripComments(
      readFileSync(resolve(ROOT, 'src/injection/preview-receiver.ts'), 'utf8'),
    );
    for (const bad of [
      'localStorage',
      'sessionStorage',
      'chrome.storage',
      'SettingsRepository',
      'fast-path',
      'writeFastPath',
    ]) {
      expect(receiver, `preview-receiver.ts 接触了 ${bad}`).not.toContain(bad);
    }
  });

  it('🔴 ADR-049 的消息字面量只在契约文件里定义一次', () => {
    // ADR-044/049 的全部意义是「不得各自发挥」。两处各写一个字面量
    // 就是分叉的开始(DESIGN.md §6.2 为此列了一行风险)。
    const hits = INJECTION_SOURCES.filter((f) => {
      const code = stripComments(readFileSync(f, 'utf8'));
      return /['"]PREVIEW_FILTER['"]/.test(code);
    });
    expect(hits.map((f) => f.replace(`${ROOT}/`, ''))).toEqual([
      'src/injection/preview-contract.ts',
    ]);
  });
});
