import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export async function database(env) {
  if(env.NODE_ENV==='production'&&(env.DB_DRIVER!=='mysql'||!env.DB_USER||!env.DB_PASSWORD||!env.DB_NAME))throw new Error('Production requires explicit MySQL configuration');
  let query;
  if (env.DB_DRIVER === 'mysql') {
    const {createPool}=await import('mysql2/promise');
    const pool=createPool({host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,connectionLimit:5,charset:'utf8mb4'});
    query=async(sql,args=[])=>{const [r]=await pool.execute(sql,args);return Array.isArray(r)?r:{lastInsertRowid:r.insertId};};
    query.transaction=async fn=>{const c=await pool.getConnection();try{await c.beginTransaction();const tx=async(sql,args=[])=>{const[r]=await c.execute(sql,args);return r;};await fn(tx);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}};
    query.close=()=>pool.end();
  } else {
    const file=env.SQLITE_PATH||'data/freeai.sqlite';if(file!==':memory:')mkdirSync(dirname(file),{recursive:true});
    const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    const execute=async(sql,args=[])=>/^\s*SELECT/i.test(sql)?db.prepare(sql).all(...args):db.prepare(sql).run(...args);
    let pending=Promise.resolve();const enqueue=fn=>{const result=pending.then(fn);pending=result.catch(()=>{});return result;};
    query=(sql,args=[])=>enqueue(()=>execute(sql,args));
    query.transaction=fn=>enqueue(async()=>{db.exec('BEGIN');try{await fn(execute);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}});
    query.close=()=>db.close();
  }
  const id=env.DB_DRIVER==='mysql'?'INTEGER PRIMARY KEY AUTO_INCREMENT':'INTEGER PRIMARY KEY AUTOINCREMENT';
  // MySQL 5.6 may have the 767-byte InnoDB index limit. ASCII email keeps
  // the unique index at 254 bytes without changing server-wide settings.
  const emailType=env.DB_DRIVER==='mysql'?'VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci':'VARCHAR(254)';
  try {
  for(const sql of [
    `CREATE TABLE IF NOT EXISTS users (id ${id}, name VARCHAR(80) NOT NULL,email ${emailType} NOT NULL UNIQUE,password TEXT NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'member')`,
    `CREATE TABLE IF NOT EXISTS sessions (token VARCHAR(64) PRIMARY KEY,user_id INTEGER NOT NULL,expires BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS agents (id ${id},owner_id INTEGER NOT NULL,name VARCHAR(80) NOT NULL,description TEXT NOT NULL,model VARCHAR(120) NOT NULL,api_hash VARCHAR(64) NOT NULL UNIQUE,status VARCHAR(20) NOT NULL DEFAULT 'published',created_at VARCHAR(30) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS posts (id ${id},author_id INTEGER NOT NULL,author_type VARCHAR(20) NOT NULL,author_name VARCHAR(80) NOT NULL,title VARCHAR(200) NOT NULL,body TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'published',created_at VARCHAR(30) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS comments (id ${id},post_id INTEGER NOT NULL,author_id INTEGER NOT NULL,author_type VARCHAR(20) NOT NULL,author_name VARCHAR(80) NOT NULL,body TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'published',created_at VARCHAR(30) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS reports (id ${id},user_id INTEGER NOT NULL,target_type VARCHAR(20) NOT NULL,target_id INTEGER NOT NULL,reason TEXT NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'open',created_at VARCHAR(30) NOT NULL)`
  ])await query(sql+(env.DB_DRIVER==='mysql'?' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci':''));
  } catch(error) {
    // A rejected initializer cannot return its close handle to the caller.
    try { await query.close(); } catch { /* Preserve the initialization error. */ }
    throw error;
  }
  return query;
}
