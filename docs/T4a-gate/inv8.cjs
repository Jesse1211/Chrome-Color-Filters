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
    attr: de.hasAttribute('data-ccf-on'),
    varVal: de.style.getPropertyValue('--ccf-filter'),
    computedFilter: getComputedStyle(de).filter,
    // 扩展注入的 style / svg 节点(T4a gate 第一项)
    injectedStyle: document.querySelectorAll('style[id*="ccf"],style[data-ccf]').length,
    injectedSvg: document.querySelectorAll('svg[id*="ccf"]').length,
    ccfNodes: document.querySelectorAll('[id*="ccf"],[class*="ccf"]').length,
    // 🔴 两层都要查：T4a 为关上 INV-3 的冷启动缺口接入了 localStorage（跨标签页），
    //    只查 sessionStorage 会让持久层的残留完全逃过 INV-8 判定。
    sessionKeys: (()=>{try{return Object.keys(sessionStorage).filter(k=>k.indexOf('__ccf')===0);}catch(e){return ['ERR'];}})(),
    localKeys: (()=>{try{return Object.keys(localStorage).filter(k=>k.indexOf('__ccf')===0);}catch(e){return ['ERR'];}})(),
  };
})()`;

(async()=>{
  const report={};
  for(const [key,url] of Object.entries(SITES)){
    const udd=path.join(OUT,`i8-${key}`); fs.rmSync(udd,{recursive:true,force:true});
    const b=await launch(udd,{headless:true});
    try{
      // 规则存在,但主开关关闭 —— 这才是 INV-8 的考点(不是「没有规则」)。
      await seed(b,settings([rule('*')],false));
      const p=await b.newPage();
      await p.goto(url,{waitUntil:'networkidle2',timeout:90000});
      await new Promise(r=>setTimeout(r,1000));
      const off=await p.evaluate(AUDIT);
      const shot=await p.screenshot();
      fs.writeFileSync(path.join(OUT,`inv8-${key}-masteroff.png`),Buffer.from(shot));

      // 对照:打开主开关,同一标签页重新导航 —— 证明规则本来是会命中的。
      await seed(b,settings([rule('*')],true));
      await p.goto(url,{waitUntil:'networkidle2',timeout:90000});
      await new Promise(r=>setTimeout(r,1000));
      const on=await p.evaluate(AUDIT);

      report[key]={off,on};
      console.log(key,JSON.stringify(report[key]));
    } finally { await b.close(); }
  }
  fs.writeFileSync(path.join(OUT,'inv8.json'),JSON.stringify(report,null,2));
  let fail=false;
  for(const [k,r] of Object.entries(report)){
    if(r.off.attr){console.log(`FAIL ${k}: 主开关关闭仍打了门控属性`);fail=true;}
    if(r.off.varVal){console.log(`FAIL ${k}: 主开关关闭仍设了 CSS 变量`);fail=true;}
    if(r.off.computedFilter!=='none'){console.log(`FAIL ${k}: 主开关关闭仍有 filter=${r.off.computedFilter}`);fail=true;}
    if(r.off.injectedStyle||r.off.injectedSvg||r.off.ccfNodes){console.log(`FAIL ${k}: 主开关关闭仍有注入节点`);fail=true;}
    if(r.off.sessionKeys.length){console.log(`FAIL ${k}: 主开关关闭仍残留会话层快路径缓存 ${JSON.stringify(r.off.sessionKeys)}`);fail=true;}
    if(r.off.localKeys.length){console.log(`FAIL ${k}: 主开关关闭仍残留持久层快路径缓存 ${JSON.stringify(r.off.localKeys)}`);fail=true;}
    // 对照必须生效,否则上面全是假阴性。
    if(!r.on.attr||r.on.computedFilter==='none'){console.log(`FAIL ${k}: 对照组滤镜未生效,INV-8 断言无意义`);fail=true;}
  }
  console.log(fail?'INV8: FAIL':'INV8: PASS');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
