import {chromium} from "@playwright/test";
import {writeFile} from "node:fs/promises";
import {server} from "./serve.mjs";

const PORT=8788;
await new Promise(r=>server.listen(PORT,"127.0.0.1",r));
const browser=await chromium.launch({headless:true});
const runs=[];

try{
  for(let i=0;i<7;i++){
    const context=await browser.newContext();
    const page=await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:"load"});
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
}finally{
  await browser.close();
  await new Promise(r=>server.close(r));
}

const values=runs.map(x=>x.fcp).filter(Number.isFinite).sort((a,b)=>a-b);
const median=values[Math.floor(values.length/2)]??null;
const p95=values[Math.min(values.length-1,Math.ceil(values.length*.95)-1)]??null;
const maxRequestsBeforeFcp=Math.max(...runs.map(x=>x.requestsBeforeFcp));
const renderValues=runs.map(x=>x.renderAfterResponse).filter(Number.isFinite).sort((a,b)=>a-b);
const medianRender=renderValues[Math.floor(renderValues.length/2)]??null;
const report={
  targetMs120Hz:8.33,
  targetMs60Hz:16.67,
  medianFcpMs:median,
  p95FcpMs:p95,
  medianRenderAfterResponseMs:medianRender,
  oneFrame120Hz:median!==null&&median<=8.33,
  maxRequestsBeforeFcp,
  runs
};
await writeFile("benchmark.json",JSON.stringify(report,null,2)+"\n");

console.log("\nLOCAL BROWSER BENCHMARK (informational)\n");
console.log(`median FCP  ${median?.toFixed(2)??"n/a"} ms`);
console.log(`p95 FCP     ${p95?.toFixed(2)??"n/a"} ms`);
console.log(`render only ${medianRender?.toFixed(2)??"n/a"} ms (responseEnd → FCP)`);
console.log(`120 Hz 1F   ${report.oneFrame120Hz?"HIT":"MISS"} (8.33 ms target)`);
console.log(`requests ≤ FCP ${maxRequestsBeforeFcp} (must be 1)`);
console.log("\nCI browser timing is intentionally non-blocking; runner scheduling is not a network/rendering SLA.");
if(maxRequestsBeforeFcp!==1){
  console.error("\nFAIL — deferred traffic started before first contentful paint");
  process.exit(1);
}
