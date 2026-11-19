const puppeteer=require('puppeteer-core');
const {PNG}=require('pngjs');
const path=require('path'),fs=require('fs');
const CHROME=path.join(__dirname,'..','chrome/mac_arm-158.0.8127.36/chrome-mac-arm64','Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const OUT=path.join(__dirname,'..','out');
function spread(f){const p=PNG.sync.read(fs.readFileSync(f));let m=0,c=0;
 for(let i=0;i<p.data.length;i+=4){const d=Math.max(p.data[i],p.data[i+1],p.data[i+2])-Math.min(p.data[i],p.data[i+1],p.data[i+2]);if(d>m)m=d;if(d>12)c++;}
 return{maxd:m,colored:c};}
const BASE='html{filter:grayscale(1)!important}';
const EXTRAS={
 none:'',
 topLayerDialog:':modal,[popover]:popover-open,:fullscreen,::backdrop{filter:grayscale(1)!important}',
};
const HTML={
 dialog:`<body style="margin:0"><dialog id="d" style="background:#e00;width:300px;height:200px">MODAL</dialog><script>document.getElementById('d').showModal()<\/script></body>`,
 popover:`<body style="margin:0"><div popover id="p" style="background:#e00;width:300px;height:200px">POPOVER</div><script>document.getElementById('p').showPopover()<\/script></body>`,
};
(async()=>{
 const b=await puppeteer.launch({executablePath:CHROME,headless:false,args:['--no-first-run'],defaultViewport:{width:500,height:400}});
 for(const [hn,html] of Object.entries(HTML))
  for(const [en,extra] of Object.entries(EXTRAS)){
   const p=await b.newPage();
   await p.setContent('<!doctype html><html>'+html+'</html>',{waitUntil:'load'});
   await p.addStyleTag({content:BASE+extra});
   await new Promise(r=>setTimeout(r,400));
   const f=path.join(OUT,`toplayer-${hn}-${en}.png`);
   await p.screenshot({path:f});
   console.log(hn.padEnd(9),en.padEnd(16),JSON.stringify(spread(f)));
   await p.close();
  }
 await b.close();
})();
