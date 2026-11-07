import {test,expect} from "bun:test";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createAgentSession,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager} from "@earendil-works/pi-coding-agent";
import {InMemoryCredentialStore} from "@earendil-works/pi-ai";
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from "@earendil-works/pi-ai/providers/faux";
import {BackgroundTasks} from "../src/index";
import {backgroundTasksExtension} from "../src/coding-agent";

test("native Pi sees background IDs, performs independent work, and observes batch completion",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"coding-agent-background-"));
 const tasks=new BackgroundTasks(join(directory,"tasks"));
 const faux=fauxProvider();let started="";
 const modelRuntime=await ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,modelsStorePath:join(directory,"models.json"),refreshOnCreate:false});
 modelRuntime.registerNativeProvider(faux.provider);
 const settingsManager=SettingsManager.inMemory({retry:{enabled:false},compaction:{enabled:false}},{projectTrusted:true});
 const resourceLoader=new DefaultResourceLoader({cwd:directory,agentDir:directory,settingsManager,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,
  extensionFactories:[backgroundTasksExtension(tasks,directory,{onStart:task=>{started=task.id;}})]});
 await resourceLoader.reload();
 const {session}=await createAgentSession({cwd:directory,agentDir:directory,sessionManager:SessionManager.inMemory(directory),modelRuntime,model:faux.getModel(),settingsManager,resourceLoader});
 const errors:string[]=[];
 await session.bindExtensions({mode:"rpc",onError:error=>{errors.push(error.error);}});
 faux.setResponses([
  fauxAssistantMessage(fauxToolCall("background_start",{command:"while [ ! -f release-command ]; do sleep 0.02; done; printf native-output"}),{stopReason:"toolUse"}),
  async request=>{
   expect(started).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(request.messages)).toContain(started);
   expect(tasks.active).toBe(true);expect(["starting","running"]).toContain(tasks.get(started).status);
   await writeFile(join(directory,"release-command"),"");
   return fauxAssistantMessage(fauxToolCall("background_wait_all",{ids:[started],timeout_ms:5000}),{stopReason:"toolUse"});
  },
  async request=>{
   expect(JSON.stringify(request.messages)).toContain('completed');
   return fauxAssistantMessage(fauxToolCall("background_output",{id:started}),{stopReason:"toolUse"});
  },
  async request=>{
   expect(JSON.stringify(request.messages)).toContain('native-output');
   return fauxAssistantMessage("observed");
  },
 ]);
 try{
  await session.prompt("Start a command and do independent work before waiting.");
  expect(errors).toEqual([]);expect(session.state.messages.filter(message=>message.role==="assistant").map(message=>message.errorMessage).filter(Boolean)).toEqual([]);expect(faux.state.callCount).toBe(4);
  expect(tasks.list()).toHaveLength(1);expect(tasks.get(started)).toMatchObject({status:"completed",exitCode:0});
  const results=session.state.messages.filter(message=>message.role==="toolResult");
  expect(results).toHaveLength(3);expect(results.every(message=>!message.isError)).toBe(true);
 }finally{session.dispose();await tasks.close();await rm(directory,{recursive:true,force:true});}
},15000);
