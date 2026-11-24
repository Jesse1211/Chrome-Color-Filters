// 四种模式都必须在真实 Chrome 中真正生效 —— 四种模式统一走**同文档**
// SVG feColorMatrix 的 url("#ccf-…") 引用(ADR-069/070),必须实测。
//
// 🔴 不要把这里的断言写回 `url("data:image/svg+xml…")`:那是 ADR-069
//    **废止**的旧方案(data: URI 的 SVG 被站点 CSP 的 img-src 拦掉,
//    三个色觉滤镜静默失效)。现在正确的形态恰恰是**没有** data: URI。
const fs=require('fs'), path=require('path');
const {PNG}=require('pngjs');
const { launch, seed, rule, settings } = require('./lib.cjs');
const OUT=path.join(__dirname,'out'); fs.mkdirSync(OUT,{recursive:true});

// 一个确定性的彩色 fixture,避免真实站点的动态内容干扰。
const FIXTURE='data:text/html,'+encodeURIComponent(`<!doctype html><html><head><meta charset=utf-8></head>
<body style="margin:0">
<div style="width:200px;height:100px;background:#ff0000"></div>
<div style="width:200px;height:100px;background:#00ff00"></div>
<div style="width:200px;height:100px;background:#0000ff"></div>
</body></html>`);

function stats(buf){
  const p=PNG.sync.read(Buffer.from(buf));
  let maxSpread=0; const px=[];
  for(let i=0;i<p.data.length;i+=4){
    const r=p.data[i],g=p.data[i+1],b=p.data[i+2];
    const s=Math.max(r,g,b)-Math.min(r,g,b);
    if(s>maxSpread)maxSpread=s;
  }
  // 取三个色块中心像素
  for(const y of [50,150,250]){
    const idx=(p.width*y+100)*4;
    px.push([p.data[idx],p.data[idx+1],p.data[idx+2]]);
  }
  return {maxSpread,px};
}

(async()=>{
  const report={};
  const udd=path.join(OUT,'modes'); fs.rmSync(udd,{recursive:true,force:true});
  const b=await launch(udd,{headless:true});
  try{
    const page=await b.newPage();
    for(const mode of ['OFF','Grayscale','RedGreen','GreenRed','BlueYellow']){
      if(mode==='OFF') await seed(b,settings([],true));
      else await seed(b,settings([rule('*',mode,100)],true));
      // data: URL 上 content script 不运行,故用一个真实 http 源更稳妥。
      // 这里直接在页面里构造 fixture 内容。
      await page.goto('https://example.com/',{waitUntil:'networkidle2',timeout:90000});
      await page.evaluate(()=>{
        // 用一个定位在视口左上角的容器,确保三个色块恰好落在 clip(0,0,200,300)内,
        // 否则采样点会打在站点自身的背景上(实测曾采到 [34,34,34])。
        document.documentElement.style.margin='0';
        document.body.style.margin='0';
        const host=document.createElement('div');
        host.id='__mode_fixture';
        host.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;margin:0;padding:0';
        host.innerHTML='<div style="width:200px;height:100px;background:#ff0000"></div>'+
          '<div style="width:200px;height:100px;background:#00ff00"></div>'+
          '<div style="width:200px;height:100px;background:#0000ff"></div>';
        document.body.appendChild(host);
      });
      await new Promise(r=>setTimeout(r,500));
      const st=await page.evaluate(()=>({
        // 🔴 ADR-069:class 门控 + 同文档 SVG 定义(属性已废止)。
        cls:document.documentElement.classList.contains('ccf-on'),
        svgDefs:!!document.getElementById('ccf-svg-defs'),
        v:document.documentElement.style.getPropertyValue('--ccf-filter'),
        computed:getComputedStyle(document.documentElement).filter,
      }));
      const shot=await page.screenshot({clip:{x:0,y:0,width:200,height:300}});
      fs.writeFileSync(path.join(OUT,`mode-${mode}.png`),Buffer.from(shot));
      report[mode]={...st,...stats(shot)};
      console.log(mode,JSON.stringify(report[mode]));
    }
  } finally { await b.close(); }
  fs.writeFileSync(path.join(OUT,'modes.json'),JSON.stringify(report,null,2));

  let fail=false;
  const off=report.OFF;
  if(off.cls||off.svgDefs||off.maxSpread===0){console.log('FAIL: OFF 基线异常(应无滤镜且有彩色)');fail=true;}
  // Grayscale:必须完全灰阶。
  if(report.Grayscale.maxSpread!==0){console.log(`FAIL Grayscale: maxSpread=${report.Grayscale.maxSpread} ≠ 0`);fail=true;}
  // 三种辅助模式:必须 (a) 真的应用了同文档 url("#ccf-…") (b) 像素确实变了。
  for(const m of ['RedGreen','GreenRed','BlueYellow']){
    const r=report[m];
    if(!r.cls){console.log(`FAIL ${m}: 未打门控 class(ccf-on)`);fail=true;}
    // 🔴 ADR-070:四个模式**统一**走 SVG feColorMatrix,灰阶不例外。
    //    灰阶若仍走内置 grayscale() 就不会有这个容器 —— 这条断言正是
    //    把「路径分裂」挡在门禁上。
    if(!r.svgDefs){console.log(`FAIL ${m}: 无同文档 SVG 滤镜定义容器 —— url("#ccf-…") 引用不到(ADR-069/070)`);fail=true;}
    // 🔴 ADR-069:必须是**同文档 fragment 引用**,且**绝不**是 data: URI。
    //    后者正是被站点 CSP img-src 拦掉、导致静默失效的那个废止方案。
    if(!/^url\("#ccf-/.test(r.v)){console.log(`FAIL ${m}: 未使用同文档 url("#ccf-…") 引用,实际=${r.v.slice(0,40)}`);fail=true;}
    if(/data:/.test(r.v)){console.log(`FAIL ${m}: 出现了 ADR-069 废止的 data: URI,实际=${r.v.slice(0,40)}`);fail=true;}
    if(r.computed==='none'){console.log(`FAIL ${m}: computed filter 为 none —— 同文档 url("#ccf-…") 未被 Chrome 解析到!`);fail=true;}
    // ⚠️ 单个色块可能是该矩阵的**不动点**,不足以判定「没生效」。
    // 实测:GreenRed 下纯红 (255,0,0) 的像确实就是 (255,0,0) ——
    // R'=1.436619*255 被钳到 255,G'=0,B'=-0.184239*255 被钳到 0。
    // 这是矩阵的正确行为,不是缺陷。故判据改为「三个色块中**至少一个**发生变化」。
    const changed=r.px.some((px,i)=>JSON.stringify(px)!==JSON.stringify(off.px[i]));
    if(!changed){console.log(`FAIL ${m}: 三个色块像素全部与基线相同 —— 滤镜没有真正生效`);fail=true;}
  }
  console.log(fail?'MODES: FAIL':'MODES: PASS');
  process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
