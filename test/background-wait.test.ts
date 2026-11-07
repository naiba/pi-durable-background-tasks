import {test,expect} from "bun:test";
import {waitForBackgroundTasks} from "../src/index";

test("batch observation starts every wait concurrently and preserves per-task results",async()=>{
 const calls:string[]=[],resolvers:((value:any)=>void)[]=[];
 const service={get:(id:string)=>({id} as any),wait:async(id:string,timeout:number,signal?:AbortSignal)=>{
 expect(timeout).toBe(100);expect(signal).toBe(controller.signal);calls.push(id);
 return new Promise<any>(resolve=>resolvers.push(resolve));
 }};
 const controller=new AbortController();
 const pending=waitForBackgroundTasks(service,["build","tests"],100,controller.signal);
 expect(calls).toEqual(["build","tests"]);
 resolvers[1]({id:"tests",status:"running"});resolvers[0]({id:"build",status:"failed",exitCode:1});
 expect((await pending).map(({id,status,exitCode})=>({id,status,exitCode}))).toEqual([{id:"build",status:"failed",exitCode:1},{id:"tests",status:"running",exitCode:undefined}]);
});
test("invalid selection never starts partial waits and cancellation is forwarded",async()=>{
 let waits=0;const service={get:(id:string)=>{if(id==="missing")throw Error("unknown");return {id} as any;},wait:async(_id:string,_timeout:number,signal?:AbortSignal)=>{waits++;signal?.throwIfAborted();return {} as any;}};
 for(const ids of [[],["same","same"],["known","missing"],Array.from({length:101},(_,index)=>String(index))])await expect(waitForBackgroundTasks(service,ids,100)).rejects.toThrow();
 await expect(waitForBackgroundTasks(service,["known"],0)).rejects.toThrow();expect(waits).toBe(0);
 const controller=new AbortController();controller.abort(new Error("observation cancelled"));
 await expect(waitForBackgroundTasks(service,["known"],100,controller.signal)).rejects.toThrow("observation cancelled");expect(waits).toBe(1);
});

test("real batch timeout and abort leave supervised commands running and observable",async()=>{
 const {BackgroundTasks}=await import("../src/index");
 const {mkdtemp,rm,writeFile}=await import("node:fs/promises");
 const {tmpdir}=await import("node:os");const {join}=await import("node:path");
 const directory=await mkdtemp(join(tmpdir(),"cloudcode-batch-observation-"));
 const service=new BackgroundTasks(join(directory,"tasks"));
 try{
  const tasks=["build","tests"].map(name=>service.start({requestId:name,name,cwd:directory,command:"while [ ! -f release ]; do sleep 0.02; done; printf verified"}));
  const ids=tasks.map(task=>task.id);
  const timed=await waitForBackgroundTasks(service,ids,20);
  expect(timed.map(task=>task.id)).toEqual(ids);
  expect(timed.every(task=>["starting","running"].includes(task.status))).toBe(true);
  const controller=new AbortController();
  const observation=waitForBackgroundTasks(service,ids,10000,controller.signal);
  controller.abort(new Error("stop observing"));
  await expect(observation).rejects.toThrow("stop observing");
  expect(service.list().every(task=>["starting","running"].includes(task.status))).toBe(true);
  await writeFile(join(directory,"release"),"");
  const completed=await waitForBackgroundTasks(service,ids,10000);
  expect(completed.map(task=>({id:task.id,status:task.status,exitCode:task.exitCode}))).toEqual(ids.map(id=>({id,status:"completed",exitCode:0})));
  for(const id of ids)expect((await service.output(id)).text).toBe("verified");
  expect(service.list()).toHaveLength(2);
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
