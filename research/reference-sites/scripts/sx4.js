const { chromium } = require('playwright'); const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1440,height:900},userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'})).newPage();
const bad=[]; p.on('requestfailed',r=>bad.push('FAIL '+r.url().slice(0,110)+' '+(r.failure()||{}).errorText)); p.on('response',r=>{if(r.status()>=400)bad.push(r.status()+' '+r.url().slice(0,110))});
const api=[]; p.on('response',r=>{const t=r.request().resourceType(); if(['xhr','fetch'].includes(t)) api.push(r.status()+' '+r.url().slice(0,110))});
await p.goto('https://www.spacex.com/',{waitUntil:'domcontentloaded'}); try{await p.waitForLoadState('networkidle',{timeout:15000})}catch{}; await sleep(3000);
console.log('docH',await p.evaluate(()=>document.documentElement.scrollHeight));
console.log('bad',JSON.stringify(bad.slice(0,15))); console.log('api',JSON.stringify(api.slice(0,15)));
await b.close();})();
