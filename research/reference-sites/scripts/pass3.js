const { chromium } = require('playwright'); const fs=require('fs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const O='research/reference-sites/palantir/'; const res={};
const vis=()=>[...document.querySelectorAll('a,button')].filter(a=>{const r=a.getBoundingClientRect();const cs=getComputedStyle(a);return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&cs.visibility!=='hidden'&&parseFloat(cs.opacity)>0.1&&!a.closest('[aria-hidden="true"]')}).map(a=>(a.innerText||a.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ')).filter(Boolean);
(async()=>{const b=await chromium.launch();
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 await p.goto('https://www.palantir.com/',{waitUntil:'domcontentloaded'}); await sleep(7000);
 res.codec=await p.evaluate(()=>({h264:document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'),webm:document.createElement('video').canPlayType('video/webm; codecs="vp9"')}));
 res.heroVideoState=await p.evaluate(()=>{const v=document.querySelector('video');return v?{readyState:v.readyState,error:v.error&&v.error.code,paused:v.paused,src:v.currentSrc.split('/').pop()}:null});
 res.h1=await p.evaluate(()=>{const h=document.querySelector('h1');const r=h.getBoundingClientRect();const cs=getComputedStyle(h);return {text:h.innerText,w:r.width,h:r.height,clip:cs.clip,clipPath:cs.clipPath,pos:cs.position,opacity:cs.opacity}});
 const btn=await p.evaluate(()=>{const c=[...document.querySelectorAll('button')].filter(e=>{const r=e.getBoundingClientRect();return r.top<100&&r.left>1350&&r.width>0});return c.map(e=>{const r=e.getBoundingClientRect();return {l:e.getAttribute('aria-label'),x:r.x+r.width/2,y:r.y+r.height/2}})});
 res.desktopTopRight=btn; const m=btn.find(x=>/menu|nav/i.test(x.l||''))||btn[btn.length-1];
 const before=await p.evaluate(vis); await p.mouse.click(m.x,m.y); await sleep(1800);
 await p.screenshot({path:O+'desktop-menu-open.png'}); res.desktopMenuAdded=(await p.evaluate(vis)).filter(x=>!before.includes(x));
 res.desktopMenuLinkStyle=await p.evaluate(()=>{const a=[...document.querySelectorAll('a')].find(a=>a.innerText.trim()==='Offerings');const cs=getComputedStyle(a);return {ff:cs.fontFamily.split(',')[0],fs:cs.fontSize,color:cs.color}});
 // hover a menu item
 const off=await p.evaluate(()=>{const a=[...document.querySelectorAll('a')].find(a=>a.innerText.trim()==='Offerings');const r=a.getBoundingClientRect();return {x:r.x+20,y:r.y+r.height/2}});
 await p.mouse.move(off.x,off.y); await sleep(900); await p.screenshot({path:O+'desktop-menu-hover-offerings.png'});
 // search button
 await p.keyboard.press('Escape'); await sleep(600); await p.mouse.click(m.x,m.y).catch(()=>{}); await sleep(800);
 const sb=btn.find(x=>/search/i.test(x.l||'')); if(sb){const bf=await p.evaluate(vis); await p.mouse.click(sb.x,sb.y); await sleep(1500); await p.screenshot({path:O+'desktop-search-open.png'}); res.searchAdded=(await p.evaluate(vis)).filter(x=>!bf.includes(x)).slice(0,20); res.searchInput=await p.evaluate(()=>{const i=document.querySelector('input[type=search],input[type=text],input');return i?{ph:i.placeholder,visible:i.getBoundingClientRect().width>0}:null});}
 const pp=await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})).newPage();
 await pp.goto('https://www.palantir.com/',{waitUntil:'domcontentloaded'}); await sleep(7000);
 const pb=await pp.evaluate(()=>[...document.querySelectorAll('button')].filter(e=>{const r=e.getBoundingClientRect();return r.top>innerHeight-100&&r.left<120&&r.width>0}).map(e=>{const r=e.getBoundingClientRect();return {l:e.getAttribute('aria-label'),x:r.x+r.width/2,y:r.y+r.height/2}}));
 res.phoneBottomLeft=pb; const pm=pb.find(x=>/menu|nav/i.test(x.l||''))||pb[0];
 if(pm){const bf=await pp.evaluate(vis); await pp.tap(`button[aria-label="${pm.l}"]`).catch(async()=>{await pp.mouse.click(pm.x,pm.y)}); await sleep(1800); await pp.screenshot({path:O+'phone-menu.png'}); res.phoneMenuAdded=(await pp.evaluate(vis)).filter(x=>!bf.includes(x));}
 fs.writeFileSync(O+'measurements-pass3.json',JSON.stringify(res,null,2)); console.log(JSON.stringify(res,null,1).slice(0,3500)); await b.close();})();
