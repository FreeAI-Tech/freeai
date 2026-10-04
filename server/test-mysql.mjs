// Deployment acceptance: deliberately separate from the SQLite unit suite.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from './db.mjs';
import {createApp} from './index.mjs';

const required=['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME'];
if(process.env.FREEAI_MYSQL_ACCEPTANCE!=='dedicated-test-database'||required.some(k=>!process.env[k])){
 console.log('SKIP: explicit MySQL settings and dedicated-test-database opt-in required; no connection attempted.');
 process.exit(2);
}
if(!/^freeai_test_[a-z0-9_]{1,48}$/.test(process.env.DB_NAME)||!/^\d+$/.test(process.env.DB_PORT)||Number(process.env.DB_PORT)<1||Number(process.env.DB_PORT)>65535){
 console.log('REFUSED: dedicated freeai_test_* database and valid explicit port required.');process.exit(2);
}
const marker=`acceptance_${randomUUID().replaceAll('-','')}`;
const emails=[`${marker}_a@example.invalid`,`${marker}_b@example.invalid`,`${marker}_rollback@example.invalid`];
const origin='https://freeai-acceptance.invalid';
const env={DB_DRIVER:'mysql',DB_HOST:process.env.DB_HOST,DB_PORT:process.env.DB_PORT,DB_USER:process.env.DB_USER,DB_PASSWORD:process.env.DB_PASSWORD,DB_NAME:process.env.DB_NAME,NODE_ENV:'production',PUBLIC_ORIGIN:origin,SIGNUP_INVITE_SECRET:randomUUID()};
const password=` ${randomUUID()} `;
let q,app,base,failed=false,cleanupFailed=false;
const originalError=console.error;
// The application currently logs database errors: do not leak driver details in acceptance output.
console.error=()=>{};
async function start(){app=await createApp(env);await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${app.server.address().port}`;}
async function stop(){if(app){const current=app;app=null;await current.close();}}
async function request(path,{method='GET',body,cookie,key,requestOrigin=origin}={}){
 const response=await fetch(base+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:requestOrigin}),...(cookie?{Cookie:cookie}:{}),...(key?{Authorization:`Bearer ${key}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],setCookie:response.headers.get('set-cookie')};
}
try{
 q=await database(env);
 const tables=await q('SELECT TABLE_NAME AS name,ENGINE AS engine,TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[env.DB_NAME]);
 for(const name of ['users','sessions','agents','posts','comments','reports']){const table=tables.find(t=>t.name===name);assert.ok(table);assert.equal(table.engine,'InnoDB');assert.match(table.collation,/^utf8mb4_/);}
 const columns=await q('SELECT TABLE_NAME AS table_name,COLUMN_NAME AS column_name,CHARACTER_SET_NAME AS charset FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?,?,?,?,?) AND CHARACTER_SET_NAME IS NOT NULL',[env.DB_NAME,'users','sessions','agents','posts','comments','reports']);
 assert.ok(columns.length);assert.ok(columns.every(c=>c.charset===(c.table_name==='users'&&c.column_name==='email'?'ascii':'utf8mb4')));
 const rollback=new Error('intentional fixture rollback');
 await assert.rejects(q.transaction(async tx=>{await tx('INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)',[marker,emails[2],'fixture-only','member']);throw rollback;}),e=>e===rollback);
 assert.equal((await q('SELECT id FROM users WHERE email=?',[emails[2]])).length,0);
 await start();
 assert.deepEqual((await request('/api/health')).body,{ok:true,service:'FreeAI',database:'mysql'});
 assert.equal((await request('/api/posts',{method:'POST',body:{title:'未授权访问',body:'未授权访问不能发布任何内容。'}})).status,401);
 const cookies=[];
 for(let i=0;i<2;i++){
  assert.equal((await request('/api/register',{method:'POST',body:{name:`测试成员${i} 🌏`,email:emails[i],password,invite_code:env.SIGNUP_INVITE_SECRET}})).status,201);
  assert.equal((await request('/api/login',{method:'POST',body:{email:emails[i],password:randomUUID()}})).status,401);
  const login=await request('/api/login',{method:'POST',body:{email:emails[i],password}});assert.equal(login.status,200);assert.match(login.setCookie,/HttpOnly/);assert.match(login.setCookie,/Secure/);cookies.push(login.cookie);
 }
 assert.equal((await request('/api/register',{method:'POST',body:{name:'重复注册',email:emails[0],password,invite_code:env.SIGNUP_INVITE_SECRET}})).status,409);
 const title=`中文与 emoji 🌏🤝 '${marker}`;const body='人类与智能体共同学习，持久保存中文与 emoji 🧠🌱。';
 const human=await request('/api/posts',{method:'POST',cookie:cookies[0],body:{title,body}});assert.equal(human.status,201);
 const agent=await request('/api/agents',{method:'POST',cookie:cookies[0],body:{name:'协作智能体 🤖',description:`专属测试记录 ${marker}，验证真实身份与权限。`,model:'acceptance-test'}});assert.equal(agent.status,201);assert.ok(agent.body.api_key);
 assert.equal((await request(`/api/agents/${agent.body.id}/revoke`,{method:'POST',cookie:cookies[1],body:{}})).status,403);
 assert.equal((await request('/api/me/agents',{cookie:cookies[1]})).body.agents.length,0);
 assert.equal((await request('/api/agents',{method:'POST',key:agent.body.api_key,body:{}})).status,403);
 const agentPost=await request('/api/posts',{method:'POST',key:agent.body.api_key,body:{title:`智能体发言 ${marker}`,body}});assert.equal(agentPost.status,201);
 assert.equal((await request(`/api/posts/${human.body.id}`,{method:'DELETE',key:agent.body.api_key,body:{}})).status,403);
 assert.equal((await request(`/api/posts/${agentPost.body.id}`,{method:'DELETE',cookie:cookies[0],body:{}})).status,403);
 assert.equal((await request(`/api/posts/${human.body.id}`,{method:'DELETE',cookie:cookies[1],body:{}})).status,403);
 assert.equal((await request('/api/admin/moderation',{cookie:cookies[0]})).status,403);
 assert.equal((await request('/api/posts',{method:'POST',cookie:cookies[0],requestOrigin:'https://attacker.invalid',body:{title,body}})).status,403);
 const comment=await request(`/api/posts/${human.body.id}/comments`,{method:'POST',key:agent.body.api_key,body:{body:'中文回复与 emoji 🤝'}});assert.equal(comment.status,201);
 const directory=(await request('/api/agents')).body.agents.find(a=>a.id===agent.body.id);assert.ok(directory);for(const field of ['api_key','api_hash','email','password'])assert.equal(directory[field],undefined);
 await stop();await start();
 assert.equal((await request('/api/me',{cookie:cookies[0]})).body.user.name,'测试成员0 🌏');
 const persisted=(await request('/api/posts',{cookie:cookies[0]})).body.posts.find(p=>p.id===human.body.id);assert.equal(persisted.title,title);assert.equal(persisted.body,body);assert.equal(persisted.is_owner,true);
 assert.equal((await request(`/api/posts/${human.body.id}/comments`)).body.comments.find(c=>c.id===comment.body.id).body,'中文回复与 emoji 🤝');
 assert.equal((await request('/api/me',{key:agent.body.api_key})).body.user.author_type,'agent');
 assert.equal((await request(`/api/agents/${agent.body.id}/revoke`,{method:'POST',cookie:cookies[0],body:{}})).status,200);
 assert.equal((await request('/api/posts',{method:'POST',key:agent.body.api_key,body:{title,body}})).status,401);
 console.log('CHECKS PASSED: MySQL schema, Unicode, rollback, authentication, ownership, API isolation, revocation and restart persistence.');
}catch{failed=true;console.log('FAIL: MySQL acceptance check failed. Driver and assertion details suppressed to protect secrets.');}
finally{
 try{await stop();}catch{cleanupFailed=true;}
 if(q){try{
  await q.transaction(async tx=>{
   const users=await tx('SELECT id FROM users WHERE email IN (?,?,?)',emails);
   for(const user of users){
    const agents=await tx('SELECT id FROM agents WHERE owner_id=?',[user.id]);
    for(const agent of agents){await tx('DELETE FROM comments WHERE author_type=? AND author_id=?',['agent',agent.id]);const posts=await tx('SELECT id FROM posts WHERE author_type=? AND author_id=?',['agent',agent.id]);for(const post of posts)await tx('DELETE FROM comments WHERE post_id=?',[post.id]);await tx('DELETE FROM posts WHERE author_type=? AND author_id=?',['agent',agent.id]);}
    const posts=await tx('SELECT id FROM posts WHERE author_type=? AND author_id=?',['human',user.id]);for(const post of posts)await tx('DELETE FROM comments WHERE post_id=?',[post.id]);
    await tx('DELETE FROM comments WHERE author_type=? AND author_id=?',['human',user.id]);await tx('DELETE FROM posts WHERE author_type=? AND author_id=?',['human',user.id]);await tx('DELETE FROM reports WHERE user_id=?',[user.id]);await tx('DELETE FROM agents WHERE owner_id=?',[user.id]);await tx('DELETE FROM sessions WHERE user_id=?',[user.id]);await tx('DELETE FROM users WHERE id=?',[user.id]);
   }
  });
  assert.equal((await q('SELECT id FROM users WHERE email IN (?,?,?)',emails)).length,0);
 }catch{cleanupFailed=true;}finally{try{await q.close();}catch{cleanupFailed=true;}}}
 console.error=originalError;
 if(cleanupFailed)console.log('FAIL: fixture cleanup or connection shutdown not verified; inspect dedicated test database privately.');
 process.exitCode=failed||cleanupFailed?1:0;
 if(!process.exitCode)console.log('PASS: acceptance gate complete; unique fixtures removed.');
}
