// REAL_STACK_GATE:INV-1 的另两项 —— 计算样式一致 + 移除后无残留。
// 范围按 T4a gate 逐字规定:position / top,left,right,bottom / width,height /
// display / transform / z-index / overflow,**排除注入目标自身的 filter**。
const fs=require('fs'), path=require('path');
const { launch, seed, rule, settings } = require('./lib.cjs');
const OUT=path.join(__dirname,'out'); fs.mkdirSync(OUT,{recursive:true});

const PROPS=['position','top','left','right','bottom','width','height','display','transform','zIndex','overflow'];


const SITES={github:'https://github.com/',wikipedia:'https://en.wikipedia.org/wiki/CSS',hn:'https://news.ycombinator.com/'};

(async()=>{
  const report={};
  for(const [key,url] of Object.entries(SITES)){
    const udd=path.join(OUT,`st-${key}`);
    fs.rmSync(udd,{recursive:true,force:true});
    const b=await launch(udd,{headless:true});
    try{
      await seed(b,settings([rule('*')],true));
      const page=await b.newPage();
      await page.goto(url,{waitUntil:'networkidle2',timeout:90000});
      await new Promise(r=>setTimeout(r,800));

      // 🔴 ADR-069:class 门控(属性已废止)。
      const onState=await page.evaluate(()=>document.documentElement.classList.contains('ccf-on'));

      // ── 方法论：**同步配对**（animation-immune paired comparison）──────────
      // 页面自身的动画会伪装成 INV-1 违规：github 首页有常驻横向滚动动画，
      // 完全不动滤镜、隔 300ms 再拍一次即可产生上千处差异。
      //
      // 旧实现用「control（滤镜不变）/ treat（切换滤镜）」两组各自隔 300ms 取样，
      // 再取 treat \ control。这有两个结构性缺陷，实测会**随机**误报：
      //   1. 差异按**数组下标**计键 —— 页面在两次取样间插入/删除节点就整体错位；
      //   2. control 与 treat 的 300ms 窗口落在动画的不同相位，
      //      control 覆盖不到 treat 那一拍恰好前进的那些元素。
      // 判别器：把滤镜**全程不动**跑同样的结构（placebo），旧实现仍报出
      // 6 处「可归因」差异 —— 纯假阳性。实测 github 4/4 次 FAIL（6/12/38/11 处）。
      //
      // 本实现改为：两份快照在**同一个 evaluate() 内同步采集**，中间只做
      // 「移除滤镜」这一个同步操作，**不跨任何 timer/await** —— 浏览器在同一个
      // 任务内不会推进动画、也不会重排 DOM 顺序，故动画相位天然相同。
      // 元素身份直接用同一个 NodeList 的同一个元素对象，不靠下标跨快照配对。
      const probe = await page.evaluate(`(() => {
        const props=${JSON.stringify(PROPS)};
        const de=document.documentElement;
        const all=document.querySelectorAll('*');
        const snap=(el)=>{
          const cs=getComputedStyle(el);
          const rec={};
          for(const p of props) rec[p]=cs[p];
          const r=el.getBoundingClientRect();
          rec._r=[Math.round(r.x*100)/100,Math.round(r.y*100)/100,
                  Math.round(r.width*100)/100,Math.round(r.height*100)/100];
          return rec;
        };
        // 1) 滤镜态快照（先强制 reflow，确保样式已结算）。
        void de.offsetHeight;
        const withF=[]; for(let i=0;i<all.length;i++) withF.push(snap(all[i]));
        // 2) 同步移除滤镜。
        de.classList.remove('ccf-on');
        de.style.removeProperty('--ccf-filter');
        void de.offsetHeight;
        // 3) 立即再拍 —— 与 (1) 同处一个任务，动画不可能前进。
        const without=[]; for(let i=0;i<all.length;i++) without.push(snap(all[i]));
        const diffs=[];
        for(let i=0;i<all.length;i++){
          for(const p of props) if(withF[i][p]!==without[i][p]) diffs.push(all[i].tagName+'#'+i+'|'+p);
          for(let k=0;k<4;k++) if(withF[i]._r[k]!==without[i]._r[k]) diffs.push(all[i].tagName+'#'+i+'|rect'+k);
        }
        return { count: all.length, diffs };
      })()`);
      const attributable=probe.diffs;

      // ── 残留检查:必须走**产品自己的**移除路径 ─────────────────────────
      //
      // 🔴 此前这里直接复用上面那个同步探针留下的状态 —— 而那个探针是在
      //    页内手工 `classList.remove('ccf-on')` + `removeProperty('--ccf-filter')`
      //    来模拟移除的,**从不调用产品的 removeFilter()**。于是必然三连红:
      //      (1) SVG 容器子树(ccf-svg-defs + filter + feColorMatrix = 3 节点)
      //          当然不会被摘掉 —— 手工移除压根没碰它;
      //      (2) 产品的 liveness MutationObserver 正确地观察 class/style,
      //          把 --ccf-filter 复原(这是 INV-5 的**正确**行为)。
      //    那是探针在测自己的模拟动作,不是在测产品。
      //
      // 改为触发真实的移除路径:关主开关 → content script 的 onChanged
      // 监听器走 decide() → syncFilter(null) → removeFilter(),
      // 它会摘 class、清变量、**并摘掉 SVG 容器**(apply-filter.ts 的顺序)。
      await seed(b,settings([rule('*')],false));
      await new Promise(r=>setTimeout(r,800));
      const residue=await page.evaluate(()=>{
        const de=document.documentElement;
        return {
          attrs:[...de.attributes].map(a=>a.name).filter(n=>n.includes('ccf')),
          classHasCcf: de.classList.contains('ccf-on'),
          styleHasVar: !!(de.getAttribute('style')||'').includes('--ccf-filter'),
          injectedNodes: document.querySelectorAll('[id*="ccf"],[class*="ccf"],style[data-ccf],svg[id*="ccf"]').length,
          computedFilter: getComputedStyle(de).filter,
        };
      });

      report[key]={onState,count:probe.count,
        attributable:attributable.length, attributableSample:attributable.slice(0,20), residue};
      console.log(key,JSON.stringify({onState,count:probe.count,
        attributable:attributable.length,residue}));
      if(attributable.length) console.log('  归因于滤镜的差异:',JSON.stringify(attributable.slice(0,10)));
    } finally { await b.close(); }
  }
  fs.writeFileSync(path.join(OUT,'styles.json'),JSON.stringify(report,null,2));
  let fail=false;
  for(const [k,r] of Object.entries(report)){
    if(!r.onState){console.log(`FAIL ${k}: 滤镜未生效,比对无意义`);fail=true;}
    if(r.count===0){console.log(`FAIL ${k}: 无元素可比对`);fail=true;}
    // 🔴 真正的判据:切换滤镜不得引入 control 之外的任何差异。
    if(r.attributable>0){console.log(`FAIL ${k}: ${r.attributable} 处差异可归因于滤镜(INV-1)`);fail=true;}
    if(r.residue.attrs.length||r.residue.classHasCcf||r.residue.styleHasVar
       ||r.residue.injectedNodes||r.residue.computedFilter!=='none'){
      console.log(`FAIL ${k}: 走产品 removeFilter() 之后仍有残留 ${JSON.stringify(r.residue)}`);fail=true;}
  }
  console.log(fail?'STYLES: FAIL':'STYLES: PASS');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
