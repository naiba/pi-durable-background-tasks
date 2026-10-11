import {test, expect} from "bun:test";
import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
const supervisor = fileURLToPath(new URL("../src/process-supervisor.py", import.meta.url));
async function until(check:()=>Promise<boolean>, timeout=5000) {
 const end=Date.now()+timeout;
 while(Date.now()<end){if(await check())return;await Bun.sleep(30);}
 throw new Error("Condition deadline exceeded");
}
function exited(child:ChildProcessWithoutNullStreams){return new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});}
function exists(pid:number){try{process.kill(pid,0);return true;}catch{return false;}}
for(const mode of ["stop", "host-pipe-close", "normal-exit"] as const){
 test(`reaps escaped TERM-resistant descendants on ${mode}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),"background-supervisor-"));
  const owner=spawn("python3",[supervisor]);const done=exited(owner);let output="";let errors="";
  owner.stdout.on("data",value=>output+=value);owner.stderr.on("data",value=>errors+=value);
  try{
   // setsid deliberately escapes the shell group; the subreaper must still own it.
   const command=`python3 -c 'import os,signal,time; os.setsid(); signal.signal(signal.SIGTERM,signal.SIG_IGN); open("descendant.pid","w").write(str(os.getpid())); time.sleep(60)' & ${mode==="normal-exit" ? 'sleep 0.3' : 'wait'}`;
   owner.stdin.write(JSON.stringify({command,cwd:directory,log:join(directory,"output.log"),graceSeconds:0.1})+"\n");
   await until(async()=>{try{return !!(await readFile(join(directory,"descendant.pid"),"utf8"));}catch{return false;}});
   const pid=Number(await readFile(join(directory,"descendant.pid"),"utf8"));expect(exists(pid)).toBe(true);
   if(mode==="stop")owner.stdin.write("stop\n");else if(mode==="host-pipe-close")owner.stdin.end();
   expect(await done).toBe(0);expect(errors).toBe("");expect(exists(pid)).toBe(false);
   const events=output.trim().split("\n").map(line=>JSON.parse(line));
   expect(events.map(e=>e.event)).toEqual(["started","settled"]);
   expect(events[1].status).toBe(mode==="normal-exit"?"completed":"stopped");
  }finally{owner.stdin.end();await done;await rm(directory,{recursive:true,force:true});}
 },10000);
}
