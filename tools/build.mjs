import {readFile,writeFile,mkdir,cp} from "node:fs/promises";
import {join} from "node:path";

const root=process.cwd();
const src=join(root,"src");
const out=join(root,"dist");

await mkdir(out,{recursive:true});

let [html,css,js]=await Promise.all([
  readFile(join(src,"index.html"),"utf8"),
  readFile(join(src,"critical.css"),"utf8"),
  readFile(join(src,"gate.js"),"utf8")
]);

css=css.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\s+/g," ").replace(/\s*([{}:;,>])\s*/g,"$1").trim();
js=js.trim();

html=html
  .replace("/*__CRITICAL_CSS__*/",css)
  .replace("/*__GATE_JS__*/",js)
  .replace(/<!--[^]*?-->/g,"")
  .replace(/>\s+</g,"><")
  .trim();

await writeFile(join(out,"index.html"),html+"\n");
await cp(join(src,"fragments"),join(out,"fragments"),{recursive:true,force:true});
await cp(join(src,"boot.js"),join(out,"boot.js"),{force:true});
await cp(join(src,"baseline.html"),join(out,"baseline.html"),{force:true});
await cp(join(src,"instant.html"),join(out,"instant.html"),{force:true});

console.log(`built dist/index.html (${Buffer.byteLength(html)} bytes raw)`);
