import {defineTool,type ExtensionFactory} from "@earendil-works/pi-coding-agent";
import {Type} from "typebox";
import {BackgroundTasks,type BackgroundTask,waitForBackgroundTasks} from "./index.js";

export interface BackgroundTasksExtensionOptions {
 /** Called after start, including a deduplicated start. Host owns delivery policy. */
 onStart?:(task:BackgroundTask)=>void|Promise<void>;
}

// Coding Agent consumes content; Durable consumes output. Separate entry points
// prevent a native Pi installation from loading the Durable runtime.
const result=(value:unknown)=>({content:[{type:"text" as const,text:JSON.stringify(value)}],details:{}});
export function backgroundTasksExtension(service:BackgroundTasks,cwd:string,options:BackgroundTasksExtensionOptions={}):ExtensionFactory{
 return pi=>{
  pi.registerTool(defineTool({name:"background_start",label:"Start background command",description:"Start a supervised command and continue independent work. Commands do not survive host loss. Approval belongs to the host tool policy.",parameters:Type.Object({command:Type.String(),name:Type.Optional(Type.String())}),execute:async(id,args)=>{
   const task=service.start({...args,cwd,requestId:id});await options.onStart?.(task);return result(task);
  }}));
  pi.registerTool(defineTool({name:"background_status",label:"Background status",description:"List session-owned background commands.",parameters:Type.Object({}),execute:async()=>result(service.list())}));
  pi.registerTool(defineTool({name:"background_output",label:"Background output",description:"Read bounded background output using byte offsets.",parameters:Type.Object({id:Type.String(),offset:Type.Optional(Type.Integer({minimum:0})),limit:Type.Optional(Type.Integer({minimum:1,maximum:65536}))}),execute:async(_id,args)=>result(await service.output(args.id,args.offset,args.limit))}));
  pi.registerTool(defineTool({name:"background_wait",label:"Wait for command",description:"Observe a command only when no independent work remains. Timeout ends observation, not execution.",parameters:Type.Object({id:Type.String(),timeout_ms:Type.Integer({minimum:1,maximum:600000})}),execute:async(_id,args,signal)=>result(await service.wait(args.id,args.timeout_ms,signal))}));
  pi.registerTool(defineTool({name:"background_wait_all",label:"Wait for commands",description:"Observe selected commands concurrently after independent work is finished. Timeout does not stop commands.",parameters:Type.Object({ids:Type.Array(Type.String(),{minItems:1,maxItems:100,uniqueItems:true}),timeout_ms:Type.Integer({minimum:1,maximum:600000})}),execute:async(_id,args,signal)=>result(await waitForBackgroundTasks(service,args.ids,args.timeout_ms,signal))}));
  pi.registerTool(defineTool({name:"background_stop",label:"Stop command",description:"Stop a session-owned command and reap its descendants.",parameters:Type.Object({id:Type.String()}),execute:async(_id,args)=>result(await service.stop(args.id))}));
 };
}
