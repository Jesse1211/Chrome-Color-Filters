// INV-3 probe: screencast every painted frame during load; any frame with
// chromatic pixels = a visible unfiltered frame = INV-3 violation.
const puppeteer=require('puppeteer-core');
const {PNG}=require('pngjs');
const fs=require('fs'), path=require('path');
const CHROME=path.join(__dirname,'chrome/mac_arm-158.0.8127.36/chrome-mac-arm64','Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const EXT=path.join(__dirname,'ext');
const OUT=process.env.OUT||path.join(__dirname,'flicker-out');
fs.mkdirSync(OUT,{recursive:true});
const SITES={github:'https://github.com/',wikipedia:'https://en.wikipedia.org/wiki/CSS',hn:'https://news.ycombinator.com/'};

function spread(buf){
  const p=PNG.sync.read(buf); let maxd=0,colored=0;
  for(let i=0;i<p.data.length;i+=4){
    const r=p.data[i],g=p.data[i+1],b=p.data[i+2];
    const d=Math.max(r,g,b)-Math.min(r,g,b);
    if(d>maxd)maxd=d;
    if(d>12)colored++;
  }
  return {maxd,colored,total:p.data.length/4};
}

(async()=>{
  const approach=process.env.APPROACH||'a1';
  fs.writeFileSync(path.join(EXT,'config.js'),`self.__T0_APPROACH = ${JSON.stringify(approach)};\n`);
  const report={};
  for(const [k,url] of Object.entries(SITES)){
    const b=await puppeteer.launch({executablePath:CHROME,headless:false,
      args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`,'--no-first-run','--no-default-browser-check'],
      defaultViewport:{width:1280,height:800}});
    const p=await b.newPage();
    const client=await p.target().createCDPSession();
    const frames=[];
    client.on('Page.screencastFrame',async e=>{
      frames.push(Buffer.from(e.data,'base64'));
      try{ await client.send('Page.screencastFrameAck',{sessionId:e.sessionId}); }catch(_){}
    });
    await client.send('Page.startScreencast',{format:'png',everyNthFrame:1});
    await p.goto(url,{waitUntil:'networkidle2',timeout:60000});
    await new Promise(r=>setTimeout(r,1500));
    await client.send('Page.stopScreencast');
    const bad=[];
    frames.forEach((f,i)=>{
      try{ const s=spread(f);
        if(s.colored> s.total*0.002){ bad.push({i,...s}); }
      }catch(_){}
    });
    // persist the worst offender + the last frame for evidence
    if(bad.length){
      const worst=bad.reduce((a,c)=>c.colored>a.colored?c:a);
      fs.writeFileSync(path.join(OUT,`${k}-${approach}-WORST-frame${worst.i}.png`),frames[worst.i]);
    }
    if(frames.length) fs.writeFileSync(path.join(OUT,`${k}-${approach}-lastframe.png`),frames[frames.length-1]);
    report[k]={approach,totalFrames:frames.length,coloredFrames:bad.length,
      worst:bad.length?bad.reduce((a,c)=>c.colored>a.colored?c:a):null};
    console.log(k,approach,'frames',frames.length,'colored',bad.length);
    await b.close();
  }
  fs.writeFileSync(path.join(OUT,`flicker-${approach}.json`),JSON.stringify(report,null,2));
})();
