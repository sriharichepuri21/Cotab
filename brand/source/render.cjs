const { chromium } = require('playwright'); const fs=require('fs'); const path=require('path');
const jobs=JSON.parse(fs.readFileSync('/tmp/claude-0/pack/work/jobs.json','utf8'));
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'});
const ctx=await b.newContext({viewport:{width:64,height:64},deviceScaleFactor:1}); const p=await ctx.newPage();
let n=0;
for(const j of jobs){
  fs.mkdirSync(path.dirname(j.out),{recursive:true});
  await p.setViewportSize({width:j.w,height:j.h});
  let svg=j.svg?fs.readFileSync(j.svg,'utf8').replace(/<svg /,'<svg style="width:100%;height:100%;display:block;color:'+j.color+'" '):'';
  const padPx=Math.round(Math.min(j.w,j.h)*j.pad);
  const html=`<!doctype html><body style="margin:0;background:transparent"><div style="width:${j.w}px;height:${j.h}px;box-sizing:border-box;padding:${padPx}px;display:grid;place-items:center;${j.bg?'background:'+j.bg+';':''}${j.radius?'border-radius:'+(j.radius*100)+'%;':''}overflow:hidden">${svg}</div></body>`;
  await p.setContent(html);
  await p.screenshot({path:j.out,omitBackground:!j.bg||j.radius>0,clip:{x:0,y:0,width:j.w,height:j.h}});
  n++; if(n%25===0) console.log(n,'/',jobs.length);
}
await b.close(); console.log('done',n);})();
