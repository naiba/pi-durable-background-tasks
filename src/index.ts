import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync} from "node:fs";
import {open} from "node:fs/promises";
import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

export type BackgroundTask = {
 id:string; command:string; cwd:string; name:string;
 status:"starting"|"running"|"stopping"|"completed"|"failed"|"stopped"|"unknown";
 createdAt:string; updatedAt:string; exitCode?:number|null; error?:string;
};
type Owned = {child:ChildProcessWithoutNullStreams; done:Promise<void>};
export class BackgroundTasks {
 private records = new Map<string,BackgroundTask>();
 private owned = new Map<string,Owned>();
 private listeners = new Set<()=>void>();
 private closed=false;
 readonly directory:string;
 constructor(directory:string, private python="python3") {
  if(process.platform!=="linux")throw new Error("Background task supervision currently requires Linux");
  this.directory=resolve(directory);mkdirSync(this.directory,{recursive:true,mode:0o700});
  for(const file of readdirSync(this.directory).filter(value=>/^[a-f0-9]{64}\.json$/.test(value))){
   const task=JSON.parse(readFileSync(join(this.directory,file),"utf8")) as BackgroundTask;
   if(task.id+".json"!==file)throw new Error("Invalid background task identity");
   this.records.set(task.id,task);
   // Persisted PIDs are never used for control after restart: ownership is unknown.
   if(["starting","running","stopping"].includes(task.status))this.update(task,{status:"unknown",error:"Host restarted; command is not replayed and process ownership cannot be confirmed"});
  }
 }
 subscribe(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
 list(){return [...this.records.values()].map(task=>({...task}));}
 get(id:string){const task=this.records.get(id);if(!task)throw new Error("Background task not found");return {...task};}
 get active(){return this.owned.size>0;}
 private update(task:BackgroundTask, changes:Partial<BackgroundTask>={}){
  Object.assign(task,changes,{updatedAt:new Date().toISOString()});
  const path=join(this.directory,task.id+".json");
  writeFileSync(path+".pending",JSON.stringify(task),{mode:0o600});renameSync(path+".pending",path);
  for(const listener of this.listeners){try{listener();}catch{/* Observers cannot break process cleanup. */}}
 }
 start(input:{requestId:string;command:string;cwd:string;name?:string}){
  if(this.closed)throw new Error("Background task service is closed");
  if(!input.requestId || !input.command.trim())throw new Error("requestId and command are required");
  const id=createHash("sha256").update(input.requestId).digest("hex");
  const cwd=resolve(input.cwd),name=input.name||input.command.slice(0,100);
  const existing=this.records.get(id);
  if(existing){if(existing.command!==input.command||existing.cwd!==cwd||existing.name!==name)throw new Error("Request identity conflicts with earlier command");return {...existing};}
  const task:BackgroundTask={id,command:input.command,cwd,name,status:"starting",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  this.records.set(id,task);this.update(task);
  const child=spawn(this.python,[fileURLToPath(new URL("./process-supervisor.py",import.meta.url))],{stdio:"pipe"});
  let finish!:()=>void;const done=new Promise<void>(resolve=>{finish=resolve;});
  this.owned.set(id,{child,done});
  let buffer="",diagnostic="",settled=false;
  child.stdout.on("data",chunk=>{
   buffer+=chunk.toString();
   for(let position;(position=buffer.indexOf("\n"))>=0;){
    const line=buffer.slice(0,position);buffer=buffer.slice(position+1);
    try{const event=JSON.parse(line);
     if(event.event==="started"&&task.status==="starting")this.update(task,{status:"running"});
     if(event.event==="settled"){settled=true;this.update(task,{status:event.status,exitCode:event.exitCode});}
    }catch{diagnostic="Invalid supervisor response";child.stdin.end();}
   }
  });
  child.stderr.on("data",chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4000);});
  child.stdin.on("error",()=>{/* close/error below owns final state */});
  child.on("error",error=>{diagnostic=error.message;});
  child.on("close",()=>{
   try{if(!settled)this.update(task,{status:"unknown",error:diagnostic||"Supervisor exited without confirming cleanup"});}
   finally{this.owned.delete(id);finish();for(const listener of this.listeners){try{listener();}catch{}}}
  });
  child.stdin.write(JSON.stringify({command:task.command,cwd,log:join(this.directory,id+".log")})+"\n");
  return {...task};
 }
 async output(id:string,offset=0,limit=32768){
  this.get(id);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>65536)throw new Error("Invalid output bounds");
  let file;try{file=await open(join(this.directory,id+".log"),"r");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {text:"",nextOffset:offset};throw error;}
  try{const buffer=Buffer.alloc(limit);const {bytesRead}=await file.read(buffer,0,limit,offset);return {text:buffer.subarray(0,bytesRead).toString("utf8"),nextOffset:offset+bytesRead};}finally{await file.close();}
 }
 async wait(id:string,timeoutMs:number,signal?:AbortSignal){
  this.get(id);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw new Error("timeoutMs must be 1..600000");
  signal?.throwIfAborted();
  const owner=this.owned.get(id);if(!owner)return this.get(id);
  await new Promise<void>((resolve,reject)=>{
   const finish=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);resolve();};
   const abort=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);reject(signal?.reason);};
   const timer=setTimeout(finish,timeoutMs);signal?.addEventListener("abort",abort,{once:true});void owner.done.then(finish);
  });
  return this.get(id);
 }
 async stop(id:string){
  const task=this.records.get(id);if(!task)throw new Error("Background task not found");
  const owner=this.owned.get(id);
  if(!owner){if(task.status==="unknown")throw new Error("Cannot stop a process without verified ownership");return {...task};}
  this.update(task,{status:"stopping"});owner.child.stdin.end();await owner.done;return this.get(id);
 }
 async close(){this.closed=true;await Promise.all([...this.owned.keys()].map(id=>this.stop(id)));}
}
