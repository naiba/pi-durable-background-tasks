import {defineExtension,defineTool} from "@earendil-works/pi-durable";
import {Type} from "@earendil-works/pi-ai";
import {BackgroundTasks} from "./index.js";
// Pi 1.2 consumes output; content silently hides task IDs and status from the model.
const result=(value:unknown)=>({output:[{type:"text" as const,text:JSON.stringify(value)}]});
export function backgroundTasksExtension(service:BackgroundTasks,cwd:string){
 return defineExtension({name:"background-tasks",tools:[
  defineTool({name:"background_start",description:"Start a supervised background shell command. Returns immediately; continue independent work before checking results. Do not immediately wait when other work is available; no model delegation. Commands do not survive host loss. Approval belongs to the host tool policy.",replay:"unsafe",
   parameters:Type.Object({command:Type.String(),name:Type.Optional(Type.String())}),
   execute:async(args,api)=>result(service.start({...args,cwd,requestId:String(api.taskId)}))}),
  defineTool({name:"background_status",description:"List background commands owned by this session.",replay:"safe",parameters:Type.Object({}),execute:async()=>result(service.list())}),
  defineTool({name:"background_output",description:"Read bounded background output using byte offsets.",replay:"safe",
   parameters:Type.Object({id:Type.String(),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:65536}))}),
   execute:async(args)=>result(await service.output(args.id,args.offset,args.limit))}),
  defineTool({name:"background_wait",description:"Blocking observation of a background command. Use only when the next step requires its result and no independent work remains; otherwise continue working and check status later. Explicit timeout ends observation only, not execution.",replay:"safe",
   parameters:Type.Object({id:Type.String(),timeout_ms:Type.Integer({minimum:1,maximum:600000})}),
   execute:async(args,api,ctx)=>result(await service.wait(args.id,args.timeout_ms,ctx.abortSignal))}),
  defineTool({name:"background_stop",description:"Stop a session-owned command and reap its descendants. Returns after supervisor cleanup.",replay:"unsafe",
   parameters:Type.Object({id:Type.String()}),execute:async(args)=>result(await service.stop(args.id))}),
 ]});
}
