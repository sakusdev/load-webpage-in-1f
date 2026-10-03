import {readFile} from "node:fs/promises";
import {brotliCompressSync,constants} from "node:zlib";

const MAX_BR=12*1024;
const MAX_INLINE_JS=1024;
const html=await readFile("dist/index.html","utf8");
const raw=Buffer.byteLength(html);
const br=brotliCompressSync(Buffer.from(html),{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).byteLength;

const styles=[...html.matchAll(/<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi)].length;
const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=/gi)].length;
const media=[...html.matchAll(/<(?:img|iframe|video|audio|source)\b[^>]*(?:src|poster)=["'](?!data:)/gi)].length;
const preloads=[...html.matchAll(/<link\b[^>]*rel=["'][^"']*(?:preload|modulepreload)[^"']*["'][^>]*>/gi)].length;
const inlineJs=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].reduce((n,m)=>n+Buffer.byteLength(m[1]),0);
const thirdParty=[...html.matchAll(/<(?:script|link|img|source|iframe|video|audio)\b[^>]*(?:src|href|poster)=["']https?:\/\/[^"']+["']/gi)].length;
const initialRequests=1+styles+scripts+media+preloads;

const rows=[
  ["Brotli document",br,MAX_BR,"B"],
  ["Inline JS",inlineJs,MAX_INLINE_JS,"B"],
  ["Initial requests",initialRequests,1,""],
  ["External stylesheets",styles,0,""],
  ["External scripts",scripts,0,""],
  ["Initial media",media,0,""],
  ["Preloads",preloads,0,""],
  ["Third-party URLs",thirdParty,0,""]
];

let failed=false;
console.log("\nFIRST-FRAME PERFORMANCE CONTRACT\n");
for(const [name,value,max,unit] of rows){
  const ok=value<=max;
  failed ||= !ok;
  console.log(`${ok?"✓":"✗"} ${name.padEnd(22)} ${String(value).padStart(6)}${unit} / ${max}${unit}`);
}
const us1g=(br*8/1_000_000_000)*1_000_000;
console.log(`\nRaw document            ${raw} B`);
console.log(`Estimated transfer @1Gbps ${us1g.toFixed(2)} µs (payload only)\n`);

if(failed){
  console.error("FAIL — first-frame budget exceeded");
  process.exit(1);
}
console.log("PASS — first-flight byte/request contract satisfied");
