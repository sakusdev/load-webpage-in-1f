import {chromium} from "@playwright/test";
import {writeFile} from "node:fs/promises";
import {server} from "./serve.mjs";

const PORT=8788;
await new Promise(r=>server.listen(PORT,"127.0.0.1",r));
const browser=await chromium.launch({headless:true});

async function measure(path, enforceRequests=false){
  const runs=[];
  for(let i=0;i<7;i++){
    const context=await browser.newContext();
    const page=await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}${path}`,{waitUntil:"load"});
    await page.waitForTimeout(80);
    const m=await page.evaluate(()=>{
      const nav=performance.getEntriesByType("navigation")[0];
      const fcp=performance.getEntriesByName("first-contentful-paint")[0]?.startTime??null;
      const before=(fcp==null?[]:performance.getEntriesByType("resource").filter(r=>r.startTime<=fcp));
      return {
        ttfb:nav?.responseStart??null,
        responseEnd:nav?.responseEnd??null,
        fcp,
        renderAfterResponse:nav&&fcp!=null?Math.max(0,fcp-nav.responseEnd):null,
        domContentLoaded:nav?.domContentLoadedEventEnd??null,
        requestsBeforeFcp:1+before.length
      };
    });
    runs.push(m);
    await context.close();
  }
  const med=a=>{const v=a.filter(Number.isFinite).sort((x,y)=>x-y);return v[Math.floor(v.length/2)]??null};
  const fcpValues=runs.map(x=>x.fcp);
  const sorted=fcpValues.filter(Number.isFinite).sort((a,b)=>a-b);
  return {
    medianFcpMs:med(fcpValues),
    p95FcpMs:sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]??null,
    medianRenderAfterResponseMs:med(runs.map(x=>x.renderAfterResponse)),
    maxRequestsBeforeFcp:Math.max(...runs.map(x=>x.requestsBeforeFcp)),
    runs,
    enforceRequests
  };
}

async function measurePrerender(){
  const context=await browser.newContext();
  const page=await context.newPage();
  const client=await context.newCDPSession(page);
  const target=`http://127.0.0.1:${PORT}/instant.html`;
  const statuses=[];
  const ruleSets=[];
  let requested=false;
  page.on("request",r=>{if(r.url()===target)requested=true});
  try{await client.send("Page.setPrerenderingAllowed",{isAllowed:true})}catch{}
  try{
    await client.send("Preload.enable");
    client.on("Preload.prerenderStatusUpdated",e=>statuses.push(e));
    client.on("Preload.ruleSetUpdated",e=>ruleSets.push(e.ruleSet));
  }catch{}
  let result={prerendered:false,supported:false,requested:false,activationStartMs:0,fcpMs:null,activationToFcpMs:null,clickToUrlMs:null,statuses:[],ruleSets:[],error:null};
  try{
    await page.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:"load"});
    await page.waitForSelector(".instant-link",{timeout:5000});
    result.supported=await page.evaluate(()=>!!HTMLScriptElement.supports?.("speculationrules"));
    await page.waitForTimeout(1200);
    const t=performance.now();
    await Promise.all([
      page.waitForURL(target,{timeout:5000}),
      page.click(".instant-link")
    ]);
    result.clickToUrlMs=performance.now()-t;
    await page.waitForTimeout(50);
    result={...result,requested,statuses,ruleSets,...await page.evaluate(()=>{
      const nav=performance.getEntriesByType("navigation")[0];
      const fcp=performance.getEntriesByName("first-contentful-paint")[0]?.startTime??null;
      const a=nav?.activationStart??0;
      return {
        prerendered:a>0,
        activationStartMs:a,
        fcpMs:fcp,
        activationToFcpMs:a>0&&fcp!=null?Math.max(0,fcp-a):null
      };
    })};
  }catch(e){result.error=String(e?.stack||e)}
  await context.close();
  return result;
}

let site,baseline,prerender;
try{
  site=await measure("/",true);
  baseline=await measure("/baseline.html");
  prerender=await measurePrerender();
}finally{
  await browser.close();
  await new Promise(r=>server.close(r));
}

const report={
  targetMs120Hz:8.33,
  targetMs60Hz:16.67,
  medianFcpMs:site.medianFcpMs,
  p95FcpMs:site.p95FcpMs,
  medianRenderAfterResponseMs:site.medianRenderAfterResponseMs,
  browserBaselineFcpMs:baseline.medianFcpMs,
  browserBaselineRenderAfterResponseMs:baseline.medianRenderAfterResponseMs,
  siteOverBaselineFcpMs:
    site.medianFcpMs!=null&&baseline.medianFcpMs!=null
      ? site.medianFcpMs-baseline.medianFcpMs
      : null,
  prerender,
  oneFrame120Hz:site.medianFcpMs!==null&&site.medianFcpMs<=8.33,
  maxRequestsBeforeFcp:site.maxRequestsBeforeFcp,
  runs:site.runs,
  baselineRuns:baseline.runs
};
await writeFile("benchmark.json",JSON.stringify(report,null,2)+"\n");

console.log("\nLOCAL BROWSER BENCHMARK\n");
console.log(`site median FCP      ${site.medianFcpMs?.toFixed(2)??"n/a"} ms`);
console.log(`site p95 FCP         ${site.p95FcpMs?.toFixed(2)??"n/a"} ms`);
console.log(`site render only     ${site.medianRenderAfterResponseMs?.toFixed(2)??"n/a"} ms`);
console.log(`browser baseline FCP ${baseline.medianFcpMs?.toFixed(2)??"n/a"} ms`);
console.log(`site overhead        ${report.siteOverBaselineFcpMs?.toFixed(2)??"n/a"} ms`);
console.log(`prerender activated  ${prerender.prerendered?"yes":"no"}`);
console.log(`activation → FCP     ${prerender.activationToFcpMs?.toFixed(2)??"n/a"} ms`);
console.log(`click → URL          ${prerender.clickToUrlMs?.toFixed(2)??"n/a"} ms`);
console.log(`120 Hz 1F            ${report.oneFrame120Hz?"HIT":"MISS"} (8.33 ms target)`);
console.log(`requests ≤ FCP       ${site.maxRequestsBeforeFcp} (must be 1)`);
console.log("\nCI timing is informational except for the one-request-before-FCP contract.");
if(site.maxRequestsBeforeFcp!==1){
  console.error("\nFAIL — deferred traffic started before first contentful paint");
  process.exit(1);
}
