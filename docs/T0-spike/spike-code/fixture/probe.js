const puppeteer=require('puppeteer-core');
const path=require('path');
const CHROME = path.join(__dirname,'..','chrome/mac_arm-158.0.8127.36/chrome-mac-arm64','Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const URL='file://'+path.join(__dirname,'page.html');
const CASES = {
  off:        null,
  html_filter:'html{filter:grayscale(1)!important}',
  body_filter:'body{filter:grayscale(1)!important}',
  html_transform:'html{transform:translateZ(0)!important}',
  html_willchange:'html{will-change:filter!important}',
  html_backdrop:'html{backdrop-filter:grayscale(1)!important}',
  html_opacity:'html{opacity:0.999!important}',
};
(async()=>{
  const b=await puppeteer.launch({executablePath:CHROME,headless:false,
    args:['--no-first-run','--no-default-browser-check'],defaultViewport:{width:1000,height:700}});
  const res={};
  for(const [name,css] of Object.entries(CASES)){
    const p=await b.newPage();
    await p.goto(URL,{waitUntil:'load'});
    if(css) await p.addStyleTag({content:css});
    await new Promise(r=>setTimeout(r,300));
    await p.evaluate(()=>window.scrollTo(0,1000));
    await new Promise(r=>setTimeout(r,300));
    res[name]=await p.evaluate(()=>{
      const g=id=>{const r=document.getElementById(id).getBoundingClientRect();
        return {y:Math.round(r.y*10)/10,x:Math.round(r.x*10)/10};};
      return {scrollY:window.scrollY,hdr:g('hdr'),side:g('side'),stick:g('stick'),
        htmlFilter:getComputedStyle(document.documentElement).filter};
    });
    await p.close();
  }
  console.log(JSON.stringify(res,null,1));
  await b.close();
})();
