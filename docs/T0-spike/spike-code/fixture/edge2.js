const puppeteer=require('puppeteer-core');
const {PNG}=require('pngjs');
const path=require('path'),fs=require('fs');
const CHROME=path.join(__dirname,'..','chrome/mac_arm-158.0.8127.36/chrome-mac-arm64','Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const OUT=path.join(__dirname,'..','out'); fs.mkdirSync(OUT,{recursive:true});
function spread(f){const p=PNG.sync.read(fs.readFileSync(f));let m=0,c=0;
 for(let i=0;i<p.data.length;i+=4){const d=Math.max(p.data[i],p.data[i+1],p.data[i+2])-Math.min(p.data[i],p.data[i+1],p.data[i+2]);if(d>m)m=d;if(d>12)c++;}
 return{maxd:m,colored:c};}
const CASES={
  plain:   `<body style="margin:0"><div style="width:400px;height:300px;background:#e00">PLAIN RED</div></body>`,
  iframe:  `<body style="margin:0"><iframe style="width:400px;height:300px;border:0" src="data:text/html,<body style='margin:0;background:%23e00'>IFRAME</body>"></iframe></body>`,
  dialog:  `<body style="margin:0"><dialog id="d" style="background:#e00;width:300px;height:200px">MODAL</dialog><script>document.getElementById('d').showModal()<\/script></body>`,
  fullscreenish: `<body style="margin:0"><div id="x" style="width:400px;height:300px;background:#e00">POPOVER</div></body>`,
  popover: `<body style="margin:0"><div popover id="p" style="background:#e00;width:300px;height:200px">POPOVER</div><script>document.getElementById('p').showPopover()<\/script></body>`,
  bgfixed: `<body style="margin:0"><div style="height:300px;background-image:linear-gradient(90deg,#e00,#0e0);background-attachment:fixed"></div></body>`,
};
(async()=>{
 const b=await puppeteer.launch({executablePath:CHROME,headless:false,args:['--no-first-run'],defaultViewport:{width:500,height:400}});
 for(const [name,html] of Object.entries(CASES)){
  for(const filt of [false,true]){
   const p=await b.newPage();
   await p.setContent('<!doctype html><html>'+html+'</html>',{waitUntil:'load'});
   if(filt) await p.addStyleTag({content:'html{filter:grayscale(1)!important}'});
   await new Promise(r=>setTimeout(r,400));
   const f=path.join(OUT,`edge-${name}-${filt?'filter':'off'}.png`);
   await p.screenshot({path:f});
   console.log(name.padEnd(14), (filt?'FILTER':'off   '), JSON.stringify(spread(f)));
   await p.close();
  }
 }
 await b.close();
})();
