// Windows fallback when workerd cannot open SQLite in an AppContainer.
// This uses the unchanged Worker handlers and real SQLite SQL, not mocked queries.
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/worker.js';
export function nodeRuntime(options) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  function prepare(sql,values=[]) {
    return {
      bind(...args){return prepare(sql,args);},
      async first(){return sqlite.prepare(sql).get(...values)??null;},
      async all(){return {results:sqlite.prepare(sql).all(...values)};},
      async run(){const result=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)}};}
    };
  }
  const db={prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const env={...options.bindings,DB:db};const originalFetch=globalThis.fetch;
  globalThis.fetch=(url,init)=>options.outboundService(new Request(url,init));
  return {getD1Database:async()=>db,dispatchFetch:(url,init)=>worker.fetch(new Request(url,init),env),dispose:async()=>{globalThis.fetch=originalFetch;sqlite.close();}};
}
