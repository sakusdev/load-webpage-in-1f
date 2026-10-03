import http from "node:http";
import {readFile,stat} from "node:fs/promises";
import {extname,join,normalize} from "node:path";

const root=join(process.cwd(),"dist");
const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8"};
const port=Number(process.env.PORT||8788);

export const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,"http://x").pathname);
    let file=join(root,normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
    if(pathname==="/") file=join(root,"index.html");
    if((await stat(file)).isDirectory()) file=join(file,"index.html");
    const body=await readFile(file);
    res.writeHead(200,{"content-type":types[extname(file)]||"application/octet-stream","cache-control":"no-store"});
    res.end(body);
  }catch{
    res.writeHead(404,{"content-type":"text/plain; charset=utf-8"});res.end("404");
  }
});

if(import.meta.url===`file://${process.argv[1]}`) server.listen(port,()=>console.log(`http://localhost:${port}`));
