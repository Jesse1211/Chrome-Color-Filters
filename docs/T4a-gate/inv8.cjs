// REAL_STACK_GATE:INV-8 / ADR-027 的可观察断言(真实 Chrome,生产产物)。
// masterEnabled === false 时:页面中不存在扩展注入的 style/svg 节点,
// documentElement 无任何扩展属性/变量,滤镜完全不生效。
const fs=require('fs'), path=require('path');
const { launch, seed, rule, settings } = require('./lib.cjs');
const OUT=path.join(__dirname,'out'); fs.mkdirSync(OUT,{recursive:true});
const SITES={github:'https://github.com/',wikipedia:'https://en.wikipedia.org/wiki/CSS',hn:'https://news.ycombinator.com/'};

const AUDIT=`(() => {
  const de=document.documentElement;
  return {
    // 🔴 ADR-069:真相源是 **class**,不再是 data-ccf-on 属性。
    //    (属性时代的探针在 ADR-069 之后会**空转地通过** —— 属性永不存在,
    //     hasAttribute 恒为 false,于是这一半审计什么都不再测。)
    cls: de.classList.contains('ccf-on'),
    varVal: de.style.getPropertyValue('--ccf-filter'),
    // ADR-069 的第二件注入物:同文档 SVG 滤镜定义容器。
    svgDefs: !!document.getElementById('ccf-svg-defs'),
    // 🔴 预生成 CSS 是否被注册进了本页(INV-8:主开关 OFF 时必须没有)。
    //
    //    此前这里读的是 --ccf-registered 自述标记,但那个标记已随
    //    「静态 content script 读不到动态注册的 CSS」这一实测结论删除
    //    (见 src/injection/filter-file-css.ts 的头注释)。标记没了,
    //    原探针恒为空串 —— **断言会永远通过,变成一条假绿**。
    //
    //    改为直接探测那条规则**本身**:预生成文件的唯一内容就是
    //    html.ccf-on { filter: url("#ccf-…") !important; }。临时给根元素
    //    加上 ccf-on,若计算出的 filter 变成 url(...),就证明该 CSS
    //    确实被注册并注入了本页;随后立刻恢复原状。
    //    这比读标记更强:它测的是**上色能力本身**,而不是一个旁证。
    registeredCss: (()=>{
      const had = de.classList.contains('ccf-on');
      try {
        de.classList.add('ccf-on');
        const f = getComputedStyle(de).filter;
        return f.indexOf('url(') === 0 ? f : '';
      } catch(e) { return 'ERR'; }
      finally { if(!had) de.classList.remove('ccf-on'); }
    })(),
    computedFilter: getComputedStyle(de).filter,
    // 扩展注入的 style / svg 节点(T4a gate 第一项)
    injectedStyle: document.querySelectorAll('style[id*="ccf"],style[data-ccf]').length,
    injectedSvg: document.querySelectorAll('svg[id*="ccf"]').length,
    ccfNodes: document.querySelectorAll('[id*="ccf"],[class*="ccf"]').length,
    // 两层都查。ADR-060 之后快路径缓存**就在 localStorage**,故判据反过来了:
    // 主开关关闭时该键必须被**清掉**(ADR-027「彻底止血」—— 留着它,
    // 下次加载的同步阶段还会照它上色);而 sessionStorage 不再被使用,
    // 出现任何 __ccf 键都说明有残留的旧实现。
    sessionKeys: (()=>{try{return Object.keys(sessionStorage).filter(k=>k.indexOf('__ccf')===0);}catch(e){return ['ERR'];}})(),
    localKeys: (()=>{try{return Object.keys(localStorage).filter(k=>k.indexOf('__ccf')===0);}catch(e){return ['ERR'];}})(),
  };
})()`;

// 🔴 **加载全程探针** —— 本轮新增,修的是上一轮门禁的真实盲点。
//
// 旧 inv8.cjs 只在导航后 +1000ms 采一次样,那是**异步纠正之后**的状态。
// 于是「同步阶段先上色、异步阶段再撤掉」这种 INV-8 破绽,在旧门禁下
// 永远显示为 PASS —— 评审正是这样指出来的。
//
// 本探针在 document_start 装好(先于页面脚本),高频轮询 documentElement,
// **记录整个加载过程中滤镜是否曾经出现过哪怕一瞬**。
// INV-8 的原文是「不注入」,不是「注入了再纠正」,故判据是「一次都没有」。
//
// 📌 两个实测到的坑(别改回去):
//  1. 探针首次执行时 `document.documentElement` **尚不存在**,
//     故必须每次轮询时重新取,不能在装载时捕获一个引用(捕获会永远读到旧对象)。
//  2. 轮询优于 MutationObserver:观察器要先拿到 documentElement 才能 observe,
//     而那时同步阶段可能已经跑完了。
function earlyProbe(){
  window.__ccfEverOn=false;
  // 📌 第三个坑:同标签页再导航时,新文档的 evaluateOnNewDocument 会在
  //    **旧文档还挂在屏幕上**时就跑起来(实测 t=7ms 读到 readyState:complete
  //    的旧页面,它身上还带着上一次导航留下的滤镜,11ms 后才被正确撤掉)。
  //    把那一下算进 everOn 就是把「上一页的滤镜正在被撤」误判成
  //    「本页被上了色」—— 一个纯粹的测量假阳性。
  //    判别:只统计**本次导航的新文档**(readyState 从 loading 开始的那个)。
  const started=document.readyState==='loading';
  const check=()=>{
    if(!started) return;
    const de=document.documentElement;
    if(!de) return;
    // 🔴 ADR-069:class + SVG 容器 + 变量,三者任一出现即算「上过色」。
    //    旧探针查的 data-ccf-on 属性在 ADR-069 之后压根不存在,
    //    留着它会让这个早期探针**空转地通过**。
    if(de.classList.contains('ccf-on')
       ||de.style.getPropertyValue('--ccf-filter')
       ||document.getElementById('ccf-svg-defs')){
      window.__ccfEverOn=true;
    }
  };
  check();
  const iv=setInterval(check,2);
  setTimeout(()=>clearInterval(iv),5000);
}

(async()=>{
  const report={};
  for(const [key,url] of Object.entries(SITES)){
    const udd=path.join(OUT,`i8-${key}`); fs.rmSync(udd,{recursive:true,force:true});
    const b=await launch(udd,{headless:true});
    try{
      // 🔴 **先把快路径缓存捂热,再关主开关** —— 这才是 ADR-027 讲的那个场景:
      //    「万一某条规则有问题,关主开关可彻底止血」。用户是在滤镜**已经用过**
      //    之后才去关主开关的,此时该 host 的快路径缓存里躺着一条「该上色」的推测。
      //
      //    若直接在全新 profile 上播种 master=false,缓存是空的,
      //    「同步阶段拿陈旧缓存上色」这个缺陷根本没有触发条件 ——
      //    门禁会对着一个不可能失败的场景报 PASS(实测确认:带缺陷的实现
      //    在没有这一步时同样 PASS)。这一步是该断言有效性的前提。
      //    📌 ADR-060 之后快路径缓存在 **localStorage**(按 origin、跨标签页、
      //    跨重启存活),所以捂热不再要求同一个标签页。这里仍沿用同一个
      //    标签页,因为它同时也是最接近真实用户路径的那条。
      const p=await b.newPage();
      await seed(b,settings([rule('*')],true));
      await p.goto(url,{waitUntil:'networkidle2',timeout:90000});
      await new Promise(r=>setTimeout(r,1200));

      // 规则存在,但主开关关闭 —— 这才是 INV-8 的考点(不是「没有规则」)。
      await seed(b,settings([rule('*')],false));
      // 🔴 必须在导航**之前**装好:evaluateOnNewDocument 在 document_start
      //    执行,才能观测到同步阶段的瞬时上色。
      await p.evaluateOnNewDocument(earlyProbe);
      await p.goto(url,{waitUntil:'networkidle2',timeout:90000});
      await new Promise(r=>setTimeout(r,1000));
      const off=await p.evaluate(AUDIT);
      // 整个加载过程中是否曾经上过色(哪怕后来被撤掉)。
      off.everOn=await p.evaluate('window.__ccfEverOn===true');
      const shot=await p.screenshot();
      fs.writeFileSync(path.join(OUT,`inv8-${key}-masteroff.png`),Buffer.from(shot));

      // 对照:打开主开关,同一标签页重新导航 —— 证明规则本来是会命中的。
      await seed(b,settings([rule('*')],true));
      // 探针由 evaluateOnNewDocument 在每个新文档上自动重装并重置标志。
      await p.goto(url,{waitUntil:'networkidle2',timeout:90000});
      await new Promise(r=>setTimeout(r,1000));
      const on=await p.evaluate(AUDIT);
      on.everOn=await p.evaluate('window.__ccfEverOn===true');

      report[key]={off,on};
      console.log(key,JSON.stringify(report[key]));
    } finally { await b.close(); }
  }
  fs.writeFileSync(path.join(OUT,'inv8.json'),JSON.stringify(report,null,2));
  let fail=false;
  for(const [k,r] of Object.entries(report)){
    // 🔴 ADR-069:门控是 class,不是属性。
    if(r.off.cls){console.log(`FAIL ${k}: 主开关关闭仍打了门控 class(ccf-on)`);fail=true;}
    if(r.off.svgDefs){console.log(`FAIL ${k}: 主开关关闭仍留着 SVG 滤镜定义容器(ccf-svg-defs)`);fail=true;}
    // 主开关 OFF → desiredRegistrations() 返回空集 → CSS 文件未注册 →
    // 即便强行加上 ccf-on 也不该有任何 url() 滤镜(INV-8 的强制点仍是「注册与否」)。
    if(r.off.registeredCss){console.log(`FAIL ${k}: 主开关关闭但预生成 CSS 仍被注册(加上 ccf-on 后 filter=${r.off.registeredCss})`);fail=true;}
    if(r.off.varVal){console.log(`FAIL ${k}: 主开关关闭仍设了 CSS 变量`);fail=true;}
    if(r.off.computedFilter!=='none'){console.log(`FAIL ${k}: 主开关关闭仍有 filter=${r.off.computedFilter}`);fail=true;}
    if(r.off.injectedStyle||r.off.injectedSvg||r.off.ccfNodes){console.log(`FAIL ${k}: 主开关关闭仍有注入节点`);fail=true;}
    if(r.off.sessionKeys.length){console.log(`FAIL ${k}: sessionStorage 出现 __ccf 键 —— ADR-060 之后快路径只应使用 localStorage ${JSON.stringify(r.off.sessionKeys)}`);fail=true;}
    // 🔴 ADR-027「关主开关可彻底止血」:主开关关闭时,该 host 的快路径条目
    //    必须被**清掉**。留着它 = 下一次加载的同步阶段仍会照它上色。
    if(r.off.localKeys.length){console.log(`FAIL ${k}: 主开关关闭后快路径缓存未被清除 ${JSON.stringify(r.off.localKeys)} —— 下次加载仍会上色,止不住血`);fail=true;}
    // 对照:主开关开启时缓存**必须**写回,否则 INV-3 的冷启动命中无从谈起,
    // 且上面那条「关闭后为空」会变成假阴性(可能它从来就没写过)。
    if(!r.on.localKeys.length){console.log(`FAIL ${k}: 主开关开启时 localStorage 未写入快路径缓存 —— INV-3 的同步通道没建立(ADR-060)`);fail=true;}
    // 🔴 核心断言:主开关关闭时,滤镜在整个加载过程中**一瞬都不得出现**。
    //    「先上色再纠正」同样是 FAIL —— INV-8 说的是不注入,ADR-027 的理由
    //    是「关主开关可彻底止血」,先上色就止不住。
    if(r.off.everOn){console.log(`FAIL ${k}: 主开关关闭,但加载过程中滤镜曾经出现过(同步快路径在 masterEnabled 可知之前上了色)`);fail=true;}
    // 对照:主开关开启时探针必须抓到 everOn=true,否则上面那条是假阴性。
    if(!r.on.everOn){console.log(`FAIL ${k}: 对照组 everOn=false —— document_start 探针失效,INV-8 的 everOn 断言无意义`);fail=true;}
    // 对照必须生效,否则上面全是假阴性。
    if(!r.on.cls||r.on.computedFilter==='none'){console.log(`FAIL ${k}: 对照组滤镜未生效,INV-8 断言无意义`);fail=true;}
    // 对照组必须真的有 SVG 定义,否则 url("#ccf-…") 引用不到 ——
    // 那正是 ADR-069 要根治的「静默失效」,不能让它冒充 PASS。
    if(!r.on.svgDefs){console.log(`FAIL ${k}: 对照组无 SVG 滤镜定义容器 —— url("#ccf-…") 引用不到,ADR-069 的注入第①步失效`);fail=true;}
  }
  console.log(fail?'INV8: FAIL':'INV8: PASS');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
