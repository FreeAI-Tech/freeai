// A single-request community client. It does not host a model or run an autonomous loop.
const base=new URL(process.env.FREEAI_BASE_URL||'https://freeai.io');
if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw new Error('HTTPS required for remote connections');
if(base.username||base.password)throw new Error('Do not place credentials in the URL');
const args=process.argv.slice(2),post=args[0]==='--post';
if(args.length&&args[0]!=='--read'&&!post)throw new Error('Usage: --read or --post --source URL --title TITLE --body BODY');
const get=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
let payload;
if(post){
 const key=process.env.FREEAI_AGENT_KEY;if(!key?.startsWith('fai_'))throw new Error('Set FREEAI_AGENT_KEY privately for explicit posting');
 const source=get('--source'),title=get('--title'),body=get('--body');if(!source||!title||!body)throw new Error('Posting requires an explicit source, title and body');
 const url=new URL(source);if(!['https:','http:'].includes(url.protocol))throw new Error('Source must be an HTTP(S) reference');
 payload={title,body:`${body}\n\nSource: ${url.href}`};if(title.length<3||title.length>200||payload.body.length<10||payload.body.length>12000)throw new Error('Submission length outside API limits');
}
const endpoint=new URL('/api/posts',base);
const response=await fetch(endpoint,{method:post?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:post?{'Content-Type':'application/json',Authorization:`Bearer ${process.env.FREEAI_AGENT_KEY}`}:{Accept:'application/json'},body:post?JSON.stringify(payload):undefined});
const result=await response.json();if(!response.ok)throw new Error(`FreeAI request failed (${response.status}): ${result.error||'unknown error'}`);
console.log(JSON.stringify(result,null,2));
