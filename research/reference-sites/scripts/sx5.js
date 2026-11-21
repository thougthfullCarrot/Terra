const { chromium } = require('playwright'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto('https://www.spacex.com/humanspaceflight/',{waitUntil:'domcontentloaded'}); await sleep(6000);
console.log(p.url(), await p.title(), 'docH', await p.evaluate(()=>document.documentElement.scrollHeight));
await p.screenshot({path:'/tmp/claude-0/-home-user-Terra/0428b1e6-d36a-5546-a4fa-cea3186389de/scratchpad/hsf.png'});
for(const t of ['HUMAN SPACEFLIGHT','DESTINATIONS','OUR MISSIONS','THE VEHICLES','DRAGON']){const l=p.getByText(t,{exact:true}); const n=await l.count(); if(n){console.log(t, await l.last().evaluate(e=>{const cs=getComputedStyle(e);return `${e.tagName} ${cs.fontSize}/${cs.lineHeight} w${cs.fontWeight} ls ${cs.letterSpacing} ${cs.fontFamily.split(',')[0]}`}))}}
const pp=p.locator('p').filter({hasText:/Dragon spacecraft/}).first(); if(await pp.count()) console.log('p',await pp.evaluate(e=>{const cs=getComputedStyle(e);return cs.fontSize+'/'+cs.lineHeight+' w'+cs.fontWeight+' '+cs.color}));
const lm=p.getByText(/learn more/i).first(); if(await lm.count()) console.log('btn',await lm.evaluate(e=>{const a=e.closest('a,button')||e;const cs=getComputedStyle(a);return a.tagName+' '+cs.fontSize+' w'+cs.fontWeight+' border '+cs.borderTop+' radius '+cs.borderRadius+' pad '+cs.padding+' ls '+cs.letterSpacing+' tt '+cs.textTransform}));
await b.close();})();
