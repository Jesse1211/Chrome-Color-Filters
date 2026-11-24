// REAL_STACK_GATE:INV-1 的另两项 —— 计算样式一致 + 移除后无残留。
// 范围按 T4a gate 逐字规定:position / top,left,right,bottom / width,height /
// display / transform / z-index / overflow,**排除注入目标自身的 filter**。
//
// 三条判据:
//   1. removalEffective —— 「移除」必须真的把 computed filter 变成 none
//      (否则下面第 2 条是拿两个相同状态互比、恒真)。
//   2. attributable     —— 开/关滤镜不得引入任何几何或计算样式差异(INV-1)。
//   3. injectedNodes    —— 移除后不得留下 DOM 节点。
//      ⚠️ 属性与 `--ccf-filter` **不在**残留判据内,它们由 INV-5 存活性
//      正确写回,只作 INFO 上报。详见文件末尾判据处的长注释。
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

      const onState=await page.evaluate(()=>document.documentElement.hasAttribute('data-ccf-on'));

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
      // 🔴 **怎样才算「同步移除滤镜」**（ADR-062/063 + ADR-075 后的形态）
      //
      // 旧实现只做 `removeAttribute('data-ccf-on')` + 清 `--ccf-filter`。
      // 在 ADR-063 的预生成 CSS 下**那根本没有移除滤镜**：那些文件用的是
      // **裸 `html`** 选择器（`html { filter: grayscale(1) !important }`），
      // 不以任何属性为条件 —— 摘自家属性对它毫无影响。
      // 真实 Chrome 实测（wikipedia，本分支产物）：
      //     withFilter          : grayscale(1)
      //     afterAttrStripOnly  : grayscale(1)   ← 旧实现停在这里
      //     afterSuppress       : none
      // 即旧实现是在拿 `grayscale(1)` 跟 `grayscale(1)` 比，**判据恒真**：
      // 哪怕滤镜真的破坏了布局几何，这条 INV-1 断言也照样全绿。
      //
      // 故本实现改为设上 `data-ccf-off` —— 这正是产品自己的关闭路径
      // (`removeFilter()` in apply-filter.ts)，由 `filter.css` 的
      // `html[data-ccf-off]` 规则把滤镜压回 `none`。
      // 并且**当场断言 computed filter 真的从有值变成了 none**，
      // 否则这个探针再次退化成恒真（见下方 removalEffective 判据）。
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
        const filterBefore=getComputedStyle(de).filter;
        const withF=[]; for(let i=0;i<all.length;i++) withF.push(snap(all[i]));
        // 2) 同步移除滤镜 —— 走产品真正的关闭路径（见上方长注释）。
        de.removeAttribute('data-ccf-on');
        de.style.removeProperty('--ccf-filter');
        de.setAttribute('data-ccf-off','');
        void de.offsetHeight;
        const filterAfter=getComputedStyle(de).filter;
        // 3) 立即再拍 —— 与 (1) 同处一个任务，动画不可能前进。
        const without=[]; for(let i=0;i<all.length;i++) without.push(snap(all[i]));
        const diffs=[];
        for(let i=0;i<all.length;i++){
          for(const p of props) if(withF[i][p]!==without[i][p]) diffs.push(all[i].tagName+'#'+i+'|'+p);
          for(let k=0;k<4;k++) if(withF[i]._r[k]!==without[i]._r[k]) diffs.push(all[i].tagName+'#'+i+'|rect'+k);
        }
        return { count: all.length, diffs, filterBefore, filterAfter };
      })()`);
      const attributable=probe.diffs;
      // 探针有效性：滤镜态必须真的有滤镜，移除态必须真的没有。
      const removalEffective = probe.filterBefore !== 'none' && probe.filterBefore !== ''
        && probe.filterAfter === 'none';

      // 残留判据只看 **DOM 节点**，属性/变量按 INFO 上报 —— 理由见文件末尾
      // 判据处的长注释（INV-5 存活性会把属性写回，那是正确行为）。
      // 等一拍，让 INV-5 的 MutationObserver 回调跑完，使上报的是**稳定态**
      // 而不是「刚摘掉、observer 还没跑」的瞬时态。
      await new Promise(r=>setTimeout(r,300));
      const residue=await page.evaluate(()=>{
        const de=document.documentElement;
        return {
          attrs:[...de.attributes].map(a=>a.name).filter(n=>n.includes('ccf')),
          styleHasVar: !!(de.getAttribute('style')||'').includes('--ccf-filter'),
          injectedNodes: document.querySelectorAll('[id*="ccf"],[class*="ccf"],style[data-ccf],svg[id*="ccf"]').length,
        };
      });

      report[key]={onState,count:probe.count,
        filterBefore:probe.filterBefore, filterAfter:probe.filterAfter, removalEffective,
        attributable:attributable.length, attributableSample:attributable.slice(0,20), residue};
      console.log(key,JSON.stringify({onState,count:probe.count,
        filterBefore:probe.filterBefore,filterAfter:probe.filterAfter,
        attributable:attributable.length,residue}));
      console.log(`  INFO ${key}: 移除后 attrs=${JSON.stringify(residue.attrs)} styleHasVar=${residue.styleHasVar}`
        +` —— 由 INV-5 存活性写回,属于正确行为;残留判据只看 injectedNodes=${residue.injectedNodes}`);
      if(attributable.length) console.log('  归因于滤镜的差异:',JSON.stringify(attributable.slice(0,10)));
    } finally { await b.close(); }
  }
  fs.writeFileSync(path.join(OUT,'styles.json'),JSON.stringify(report,null,2));
  let fail=false;
  for(const [k,r] of Object.entries(report)){
    if(!r.onState){console.log(`FAIL ${k}: 滤镜未生效,比对无意义`);fail=true;}
    if(r.count===0){console.log(`FAIL ${k}: 无元素可比对`);fail=true;}
    // 🔴 探针有效性判据(新增):若「移除」没把 computed filter 变成 none,
    //    下面那条 INV-1 断言就是拿两个**相同**状态互比、恒真。必须先钉死这个。
    if(!r.removalEffective){
      console.log(`FAIL ${k}: 移除探针无效 —— filter ${r.filterBefore} → ${r.filterAfter}`
        +`(应为「有值 → none」;否则 INV-1 比对恒真、测不出任何东西)`);fail=true;}
    // 🔴 真正的判据:切换滤镜不得引入 control 之外的任何差异。
    if(r.attributable>0){console.log(`FAIL ${k}: ${r.attributable} 处差异可归因于滤镜(INV-1)`);fail=true;}
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔴 残留判据**只看 DOM 节点**,不看属性/变量。不要「再收紧」回去。
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //
    // 本门禁用「在页面内把属性摘掉」来模拟移除滤镜。而 **INV-5(存活性)**
    // 的全部职责就是「站点脚本移除注入样式后,滤镜必须自动恢复」——
    // 页面内摘属性与站点脚本摘属性对扩展而言**不可区分**,于是
    // `liveness.ts` 的 MutationObserver 会**正确地**把属性与变量写回。
    // 把这个写回计为「残留」,等于断言 INV-5 必须失效。
    //
    // 实测(本分支产物,三站点一致):
    //     同一任务内摘掉后 : attrs=[]            styleHasVar=false
    //     下一个任务       : attrs=[data-ccf-on] styleHasVar=true   ← observer 已恢复
    // 判别器 —— 连续 120 次抢夺把 `maxRestoresPerWindow`(60/1s)预算耗尽、
    // observer 自行 `disconnect` 之后,再摘一次就**不再**写回(attrs=[])。
    // 这证明写回者确实是 INV-5 那个带预算的 observer,不是别的东西。
    //
    // 📌 **这不是本分支引入的回归。** main 上已提交的
    // `evidence/styles.json` 显示零残留,但它生成于 `0fc7de6`(T4a),
    // 而存活性是 `b042e98`(T4b)才落地的 —— 那份证据**早于**该行为存在,
    // 两者从未在同一个版本上同时成立过。
    //
    // 真正该守的是「不留 DOM 节点」(ADR-075 后扩展连 SVG 节点都不插了,
    // 注入物只有 documentElement 上的属性与变量),即下面这条 injectedNodes。
    if(r.residue.injectedNodes){
      console.log(`FAIL ${k}: 移除后有残留 DOM 节点 ${JSON.stringify(r.residue)}`);fail=true;}
  }
  console.log(fail?'STYLES: FAIL':'STYLES: PASS');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
