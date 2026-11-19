// REAL_STACK_GATE:INV-1 的另两项 —— 计算样式一致 + 移除后无残留。
// 范围按 T4a gate 逐字规定:position / top,left,right,bottom / width,height /
// display / transform / z-index / overflow,**排除注入目标自身的 filter**。
const fs=require('fs'), path=require('path');
const { launch, seed, rule, settings } = require('./lib.cjs');
const OUT=path.join(__dirname,'out'); fs.mkdirSync(OUT,{recursive:true});

const PROPS=['position','top','left','right','bottom','width','height','display','transform','zIndex','overflow'];

const SNAP=`(() => {
  const props=${JSON.stringify(PROPS)};
  const out=[];
  const all=document.querySelectorAll('*');
  for(let i=0;i<all.length;i++){
    const cs=getComputedStyle(all[i]);
    const rec={};
    for(const p of props) rec[p]=cs[p];
    const r=all[i].getBoundingClientRect();
    rec._r=[Math.round(r.x*100)/100,Math.round(r.y*100)/100,Math.round(r.width*100)/100,Math.round(r.height*100)/100];
    rec._t=all[i].tagName;
    out.push(rec);
  }
  return out;
})()`;

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

      // ── 方法论:配对对照(paired control)────────────────────────────────
      // 直接比「滤镜态 vs 移除后」会把**页面自身的动画/动态内容**算进差异。
      // 判别器证据:github 首页有常驻横向滚动动画 —— 完全不动滤镜、同样间隔
      // 再拍一次即产生上千处差异(dbg13.cjs 的 CONTROL),签名与带滤镜比对完全相同。
      // 故本 gate 测的是「**切换滤镜**是否比**什么都不做**多出差异」:
      //   control = snapA → 等待 → snapB            (滤镜全程不变)
      //   treat   = snapC → 等待+移除滤镜 → snapD   (唯一变量是滤镜)
      // 判据:treat 的差异集合不得包含 control 之外的**新**元素/属性。
      const GAP=300;
      const diffOf=(x,y)=>{
        const n=Math.min(x.length,y.length); const set=new Set();
        for(let i=0;i<n;i++){
          for(const p of PROPS) if(x[i][p]!==y[i][p]) set.add(i+'|'+p);
          for(let k=0;k<4;k++) if(x[i]._r[k]!==y[i]._r[k]) set.add(i+'|rect'+k);
        }
        return set;
      };

      // control:滤镜保持开启,隔 GAP 拍两次。
      const a=await page.evaluate(SNAP);
      await new Promise(r=>setTimeout(r,GAP));
      const bSnap=await page.evaluate(SNAP);
      const control=diffOf(a,bSnap);

      // treat:再拍一次,移除滤镜,隔同样的 GAP 拍一次。
      const withFilter=await page.evaluate(SNAP);
      await page.evaluate(()=>{
        document.documentElement.removeAttribute('data-ccf-on');
        document.documentElement.style.removeProperty('--ccf-filter');
      });
      await new Promise(r=>setTimeout(r,GAP));
      const without=await page.evaluate(SNAP);
      const treat=diffOf(withFilter,without);

      // 只保留 control 里没有出现过的差异 —— 那才可能归因于滤镜。
      const attributable=[...treat].filter(k=>!control.has(k));

      const residue=await page.evaluate(()=>{
        const de=document.documentElement;
        return {
          attrs:[...de.attributes].map(a=>a.name).filter(n=>n.includes('ccf')),
          styleHasVar: !!(de.getAttribute('style')||'').includes('--ccf-filter'),
          injectedNodes: document.querySelectorAll('[id*="ccf"],[class*="ccf"],style[data-ccf],svg[id*="ccf"]').length,
        };
      });

      report[key]={onState,count:Math.min(withFilter.length,without.length),
        controlDiffs:control.size, treatDiffs:treat.size,
        attributable:attributable.length, attributableSample:attributable.slice(0,20), residue};
      console.log(key,JSON.stringify({onState,count:report[key].count,
        control:control.size,treat:treat.size,attributable:attributable.length,residue}));
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
    if(r.residue.attrs.length||r.residue.styleHasVar||r.residue.injectedNodes){
      console.log(`FAIL ${k}: 移除后有残留 ${JSON.stringify(r.residue)}`);fail=true;}
  }
  console.log(fail?'STYLES: FAIL':'STYLES: PASS');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
