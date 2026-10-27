const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'});
const p=await b.newPage(); await p.goto('file:///tmp/claude-0/pack/work/guide.html'); await p.waitForTimeout(1500);
await p.pdf({path:'/tmp/claude-0/pack/Cotab-Logo-B/06-guidelines/Cotab-Logo-Guidelines.pdf',width:'297mm',height:'210mm',printBackground:true});
await p.setViewportSize({width:1123,height:794}); 
const n=await p.evaluate(()=>document.querySelectorAll('.pg').length);
for (const i of [0,1,2,3]) { const el=(await p.$$('.pg'))[i]; await el.screenshot({path:`/tmp/claude-0/pack/work/guide${i}.png`}); }
console.log('pages',n); await b.close();})();
