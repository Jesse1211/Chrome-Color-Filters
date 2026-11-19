// Deterministic discriminator: local fixture, no network, no dynamic chrome.
const puppeteer=require('puppeteer-core');
const path=require('path'),fs=require('fs');
const CHROME=path.join(__dirname,'..','chrome/mac_arm-158.0.8127.36/chrome-mac-arm64','Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL='file://'+path.join(__dirname,'page.html');
const CASES={
 off:'',
 a1_html_filter:'html{filter:grayscale(1)!important}',
 a2_html_filter_plus_js:'html{filter:grayscale(1)!important}', // JS compensation applied separately
 a4_body_filter:'body{filter:grayscale(1)!important}',
 a5_html_filter_toplayer:'html{filter:grayscale(1)!important}:modal,[popover]:popover-open,:fullscreen,::backdrop{filter:grayscale(1)!important}',
};
(async()=>{
 const b=await puppeteer.launch({executablePath:CHROME,headless:false,args:['--no-first-run'],defaultViewport:{width:1000,height:700}});
 const out={};
 for(const [name,css] of Object.entries(CASES)){
  const p=await b.newPage();
  await p.goto(URL,{waitUntil:'load'});
  if(css) await p.addStyleTag({content:css});
  if(name==='a2_html_filter_plus_js'){
    await p.evaluate(()=>{
      const comp=()=>{document.querySelectorAll('#hdr,#side').forEach(el=>{
        el.style.setProperty('transform',`translate(${scrollX}px,${scrollY}px)`,'important');});};
      addEventListener('scroll',comp,{passive:true}); comp();
    });
  }
  await new Promise(r=>setTimeout(r,250));
  await p.evaluate(()=>window.scrollTo(0,1000));
  await new Promise(r=>setTimeout(r,400));
  out[name]=await p.evaluate(()=>{
    const g=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:Math.round(r.x*10)/10,y:Math.round(r.y*10)/10};};
    return {scrollY:scrollY,hdr:g('hdr'),side:g('side'),stick:g('stick')};
  });
  await p.screenshot({path:path.join(__dirname,'..','out',`fixture-${name}.png`)});
  await p.close();
 }
 fs.writeFileSync(path.join(__dirname,'final.json'),JSON.stringify(out,null,2));
 const base=out.off;
 console.log('case'.padEnd(26),'hdr(dx,dy)','side(dx,dy)','stick(dx,dy)','VERDICT');
 for(const [k,v] of Object.entries(out)){
   const d=(a,b)=>`(${+(a.x-b.x).toFixed(1)},${+(a.y-b.y).toFixed(1)})`;
   const ok=['hdr','side','stick'].every(id=>v[id].x===base[id].x&&v[id].y===base[id].y);
   console.log(k.padEnd(26),d(v.hdr,base.hdr).padEnd(11),d(v.side,base.side).padEnd(12),d(v.stick,base.stick).padEnd(13),ok?'INV-1 OK':'INV-1 BROKEN');
 }
 await b.close();
})();
