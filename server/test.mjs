import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './index.mjs';
test('community identity, isolation, moderation and security',async()=>{
 const app=await createApp({SQLITE_PATH:':memory:',PUBLIC_ORIGIN:'http://localhost',ADMIN_EMAIL:'admin@example.org',ADMIN_BOOTSTRAP_SECRET:'test-only-bootstrap'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 let cookie='';const request=async(path,body,extra={})=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:'http://localhost','Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};};
 try{
  assert.equal((await request('/api/health')).body.ok,true);
  assert.deepEqual((await request('/api/posts')).body,{posts:[]});
  assert.equal((await request('/api/posts',{title:'Hello',body:'Unauthenticated body'})).status,401);
  assert.equal((await request('/api/register',{name:'Alan',email:'admin@example.org',password:'long-password-123',admin_secret:'test-only-bootstrap'})).status,201);
  assert.equal((await request('/api/login',{email:'admin@example.org',password:'wrong'})).status,401);
  const login=await request('/api/login',{email:'admin@example.org',password:'long-password-123'});assert.equal(login.status,200);assert.match(login.cookie,/HttpOnly/);cookie=login.cookie.split(';')[0];assert.equal((await request('/api/me')).body.user.role,'admin');
  assert.equal((await request('/api/posts',{title:'Hello world',body:'A real human contribution.'},{Origin:'https://attacker.test'})).status,403);
  const post=await request('/api/posts',{title:"A title ' with SQL",body:'A real human contribution.'});assert.equal(post.status,201);
  assert.equal((await request(`/api/posts/${post.body.id}/comments`,{body:'Helpful comment'})).status,201);
  assert.equal((await request(`/api/posts/999/comments`,{body:'Missing post'})).status,404);
  const agent=await request('/api/agents',{name:'Research agent',description:'An operator managed research assistant.',model:'Test model'});assert.equal(agent.status,201);assert.ok(agent.body.api_key);
  const directory=(await request('/api/agents')).body.agents;assert.equal(directory[0].api_hash,undefined);
  assert.equal(directory[0].operator_name,'Alan');assert.equal(directory[0].email,undefined);
  assert.equal((await request('/api/me/agents')).body.agents[0].id,agent.body.id);
  cookie='';assert.equal((await request('/api/posts',{title:'Agent contribution',body:'Transparent agent generated content.'},{Authorization:`Bearer ${agent.body.api_key}`})).status,201);
  const agentPost=(await request('/api/posts')).body.posts[0];
  const remove=async(id,headers)=>fetch(base+`/api/posts/${id}`,{method:'DELETE',headers:{Origin:'http://localhost','Content-Type':'application/json',...headers},body:'{}'});
  assert.equal((await remove(post.body.id,{Authorization:`Bearer ${agent.body.api_key}`})).status,403);
  assert.equal((await remove(agentPost.id,{Cookie:login.cookie.split(';')[0]})).status,403);
  const disposable=await request('/api/posts',{title:'Remove private detail',body:'A detail to erase permanently.'},{Authorization:`Bearer ${agent.body.api_key}`});
  assert.equal((await remove(disposable.body.id,{Authorization:`Bearer ${agent.body.api_key}`})).status,200);
  assert.equal((await request('/api/admin/moderation')).status,401);
  assert.equal((await request('/api/posts')).body.posts[0].author_type,'agent');
  cookie=login.cookie.split(';')[0];const patch=await fetch(base+`/api/admin/posts/${post.body.id}`,{method:'PATCH',headers:{Origin:'http://localhost','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({status:'hidden'})});assert.equal(patch.status,200);assert.equal((await request('/api/posts')).body.posts.length,1);
  assert.equal((await request('/api/reports',{target_type:'agents',target_id:agent.body.id,reason:'Please review this operator account.'})).status,201);
  assert.equal((await request('/api/admin/reports')).body.reports.length,1);
  assert.equal((await request(`/api/agents/${agent.body.id}/revoke`,{})).status,200);
  const republish=await fetch(base+`/api/admin/agents/${agent.body.id}`,{method:'PATCH',headers:{Origin:'http://localhost','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({status:'published'})});assert.equal(republish.status,200);
  assert.equal((await request('/api/posts',{title:'Revoked agent',body:'Cannot publish after revoke.'},{Authorization:`Bearer ${agent.body.api_key}`})).status,401);
  const deletion=await fetch(base+'/api/me',{method:'DELETE',headers:{Origin:'http://localhost','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({password:'long-password-123'})});assert.equal(deletion.status,200);
  assert.equal((await request('/api/posts')).body.posts[0].author_name,'Deleted agent');
  await request('/api/logout',{});assert.equal((await request('/api/me')).body.user,null);
 }finally{await app.close();}
});
test('production refuses implicit local storage',async()=>{
 await assert.rejects(createApp({NODE_ENV:'production'}),/HTTPS/);
 await assert.rejects(createApp({NODE_ENV:'production',PUBLIC_ORIGIN:'https://freeai.io'}),/MySQL/);
});
test('RSS includes only latest published posts with safe XML and no private records',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {database}=await import('./db.mjs');
 const dir=await mkdtemp(join(tmpdir(),'freeai-feed-')),env={SQLITE_PATH:join(dir,'db.sqlite'),PUBLIC_ORIGIN:'http://localhost'};let app;
 try{
  const q=await database(env);
  try{
   await q('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)',['Private operator','private-email@example.invalid','private-password-hash','member']);
   await q('INSERT INTO agents (owner_id,name,description,model,api_hash,status,created_at) VALUES (?,?,?,?,?,?,?)',[1,'Private agent','Private agent details','Private model','private-api-hash','published','2026-10-04T00:00:00.000Z']);
   await q('INSERT INTO sessions (token,user_id,expires) VALUES (?,?,?)',['private-session-token',1,Date.now()+60000]);
   for(let i=1;i<=53;i++)await q('INSERT INTO posts (author_id,author_type,author_name,title,body,status,created_at) VALUES (?,?,?,?,?,?,?)',[1,i===51?'agent':'human','Public contributor',i===51?'中文 & <title> "test"':'Discussion '+i,i===51?'<script>alert("x")</script> & &#60;img src=x onerror=alert(1)&#62; 😀\u0001\ufffe':'Body '+i,i===52?'pending':i===53?'hidden':'published','2026-10-04T00:00:00.000Z']);
  }finally{await q.close();}
  app=await createApp(env);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
  const response=await fetch(base+'/api/feed.xml'),xml=await response.text();assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/rss+xml; charset=utf-8');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);
  assert.match(xml,/^<\?xml version="1.0" encoding="UTF-8"\?>/);assert.match(xml,/<rss version="2.0"><channel>/);assert.match(xml,/FreeAI 社区/);
  const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>m[1]);assert.equal(items.length,50);
  assert.match(items[0],/<title>中文 &amp; &lt;title&gt; &quot;test&quot;<\/title>/);assert.match(items[0],/<link>https:\/\/freeai.io\/#discussion-51<\/link>/);assert.match(items[0],/<guid isPermaLink="true">https:\/\/freeai.io\/#discussion-51<\/guid>/);assert.match(items[0],/<pubDate>Sun, 04 Oct 2026 00:00:00 GMT<\/pubDate>/);
  assert.match(items[0],/&amp;lt;script&amp;gt;alert\(&amp;quot;x&amp;quot;\)/);assert.match(items[0],/&amp;amp;#60;img/);assert.match(items[0],/Public contributor \(agent\)/);assert.match(items[0],/😀/);
  assert.doesNotMatch(xml,/[\u0000\u0001\ufffe]|<script>|<img|private-email|private-password|private-api|private-session|Private operator|Private agent|Private model|author_id|owner_id|api_hash|password|<author>/);
  assert.doesNotMatch(xml,/#discussion-(?:1|52|53)<|Discussion (?:1|52|53)<|Body (?:1|52|53)</);assert.match(items.at(-1),/#discussion-2</);
  const authenticated=await fetch(base+'/api/feed.xml',{headers:{Cookie:'freeai_session=invalid',Authorization:'Bearer invalid'}});assert.equal(await authenticated.text(),xml);
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});
test('post detail reaches older posts without disclosing unpublished content',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {database}=await import('./db.mjs');
 const dir=await mkdtemp(join(tmpdir(),'freeai-detail-')),env={SQLITE_PATH:join(dir,'db.sqlite'),PUBLIC_ORIGIN:'http://localhost'};let app;
 try{
  const q=await database(env);
  try{for(let i=1;i<=103;i++)await q('INSERT INTO posts (author_id,author_type,author_name,title,body,status,created_at) VALUES (?,?,?,?,?,?,?)',[999,'human','Original author',`Discussion ${i}`,'Public research discussion.',i===102?'pending':i===103?'hidden':'published','2026-10-04T00:00:00.000Z']);}finally{await q.close();}
  app=await createApp(env);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
  const get=async(path,cookie)=>{const response=await fetch(base+path,{headers:cookie?{Cookie:cookie}:{}});return {status:response.status,body:await response.json()};};
  const listing=await get('/api/posts');assert.equal(listing.body.posts.length,100);assert.equal(listing.body.posts.some(p=>p.id===1),false);
  const detail=await get('/api/posts/1');assert.equal(detail.status,200);assert.equal(detail.body.post.title,'Discussion 1');assert.equal(detail.body.post.is_owner,false);
  assert.deepEqual(Object.keys(detail.body.post).sort(),['id','title','body','author_id','author_name','author_type','created_at','status','is_owner'].sort());
  const write=(path,body)=>fetch(base+path,{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await write('/api/register',{name:'Another author',email:'detail@example.org',password:'detail-password-123'})).status,201);
  const login=await write('/api/login',{email:'detail@example.org',password:'detail-password-123'}),cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/api/posts/1',cookie)).body.post.is_owner,false);
  for(const id of ['102','103','0','9999','not-an-id','9007199254740992']){const response=await get(`/api/posts/${id}`,cookie);assert.equal(response.status,404);assert.deepEqual(response.body,{error:id==='not-an-id'?'Not found':'Post not found'});}
 }finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});
test('registration rejects Unicode emails but accepts punycoded domains',async()=>{
 const {randomUUID}=await import('node:crypto');const password=randomUUID();
 const app=await createApp({SQLITE_PATH:':memory:',PUBLIC_ORIGIN:'http://localhost'});
 try{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 const register=email=>fetch(base+'/api/register',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({name:'中文用户',email,password})});
 assert.equal((await register('用户@example.org')).status,400);
 assert.equal((await register('user@例子.org')).status,400);
 assert.equal((await register('user@xn--fsqu00a.org')).status,201);
 }finally{await app.close();}
});
test('SQLite survives service restart and password spaces',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'freeai-test-'));const env={SQLITE_PATH:join(dir,'db.sqlite'),PUBLIC_ORIGIN:'http://localhost'};
 let app;
 try{app=await createApp(env);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${app.server.address().port}`;const response=await fetch(base+'/api/register',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({name:'Persistent member',email:'persist@example.org',password:' space-preserved-password '})});assert.equal(response.status,201);await app.close();app=await createApp(env);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({email:'persist@example.org',password:' space-preserved-password '})});assert.equal(login.status,200);}finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});

