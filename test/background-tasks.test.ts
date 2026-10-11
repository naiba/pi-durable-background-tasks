import {test,expect} from "bun:test";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {BackgroundTasks} from "../src/index";
test("command output, exit status and deduplication survive reopening",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"background-records-"));const service=new BackgroundTasks(directory);
 try{
  const input={requestId:"build",command:"printf hello; exit 7",cwd:directory};
  const task=service.start(input);expect(service.start(input).id).toBe(task.id);
  expect(()=>service.start({...input,command:"echo unexpected"})).toThrow("conflicts");
  const done=await service.wait(task.id,5000);expect(done.status).toBe("failed");expect(done.exitCode).toBe(7);
  expect(await service.output(task.id,0,2)).toEqual({text:"he",nextOffset:2});
  expect(await service.output(task.id,2)).toEqual({text:"llo",nextOffset:5});
  expect(service.active).toBe(false);await service.close();
  const restored=new BackgroundTasks(directory);expect(restored.start(input).status).toBe("failed");expect(restored.active).toBe(false);await restored.close();
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
test("observation timeout and cancellation do not stop execution; close reaps it",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"background-wait-"));const service=new BackgroundTasks(directory);
 try{
  const task=service.start({requestId:"watch",command:"sleep 60",cwd:directory});
  expect(["starting","running"]).toContain((await service.wait(task.id,1)).status);
  const abort=new AbortController();const waiting=service.wait(task.id,5000,abort.signal);abort.abort(new Error("observer stopped"));
  await expect(waiting).rejects.toThrow("observer stopped");expect(service.active).toBe(true);
  await expect(service.wait(task.id,600001)).rejects.toThrow("timeoutMs");
  await service.close();expect(service.active).toBe(false);expect(service.get(task.id).status).toBe("stopped");
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
test("uncertain restart records cannot replay or kill by stale identity",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"background-uncertain-"));const id="a".repeat(64);
 await writeFile(join(directory,id+".json"),JSON.stringify({id,command:"sleep 60",cwd:directory,name:"watch",status:"running",createdAt:"",updatedAt:""}));
 const service=new BackgroundTasks(directory);
 try{expect(service.get(id).status).toBe("unknown");await expect(service.stop(id)).rejects.toThrow("ownership");expect(service.active).toBe(false);}
 finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
