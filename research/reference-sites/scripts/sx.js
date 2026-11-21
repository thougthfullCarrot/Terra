const { chromium } = require('playwright'); const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const O='research/reference-sites/spacex/';
(async()=>{const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.goto('https://www.spacex.com/',{waitUntil:'domcontentloaded'}); await sleep(6000);
const items=await p.evaluate(()=>[...document.querySelectorAll('.header span, .header a')].filter(e=>{const r=e.getBoundingClientRect();return r.top<60&&r.height>0&&r.width>0&&e.children.length===0&&e.innerText.trim()&&parseFloat(getComputedStyle(e).opacity)>0.2}).map(e=>{const r=e.getBoundingClientRect();return {t:e.innerText.trim(),x:r.x+r.width/2,y:r.y+r.height/2}}));
console.log(JSON.stringify(items.map(i=>i.t)));
const rest=await p.screenshot({clip:{x:0,y:0,width:1440,height:400}});
for(const it of items.filter(i=>['VEHICLES','HUMAN SPACEFLIGHT','COMPANY'].includes(i.t))){
 await p.mouse.move(700,700); await sleep(700); await p.mouse.move(it.x,it.y); await sleep(1200);
 const s=await p.screenshot({clip:{x:0,y:0,width:1440,height:400}}); const diff=Buffer.compare(rest,s)!==0;
 const st=await p.evaluate(({x,y})=>{const e=document.elementFromPoint(x,y);const li=e.closest('li,div');const sub=li&&li.querySelector('ul,div');return {cls:li&&String(li.className),sub:sub&&{op:getComputedStyle(sub).opacity,h:sub.getBoundingClientRect().height,vis:getComputedStyle(sub).visibility}, color:getComputedStyle(e).color, td:getComputedStyle(e).textDecorationLine}},it);
 console.log(it.t,'changed',diff,JSON.stringify(st));
 if(diff) await p.screenshot({path:O+`desktop-hover-${it.t.toLowerCase().replace(/[^a-z]+/g,'-')}.png`});
}
await b.close();})();
