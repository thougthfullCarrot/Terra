const { chromium } = require('playwright'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch(); const pp=await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})).newPage();
await pp.goto('https://www.palantir.com/',{waitUntil:'domcontentloaded'}); await sleep(7000);
await pp.touchscreen.tap(40,804); await sleep(1800); await pp.screenshot({path:'research/reference-sites/palantir/phone-menu.png'});
for(let i=0;i<2;i++){await pp.mouse.wheel(0,700);await sleep(800);} 
await pp.evaluate(()=>{const s=[...document.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+50&&getComputedStyle(e).overflowY.match(/auto|scroll/)&&e.getBoundingClientRect().height>500); if(s) s.scrollTop=900;}); await sleep(800);
await pp.screenshot({path:'research/reference-sites/palantir/phone-menu-2.png'}); await b.close();})();
