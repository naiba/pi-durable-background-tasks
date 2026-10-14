import {test,expect} from "bun:test";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {Harness,MemoryStorage,createRegistry} from "@earendil-works/pi-durable";
import {BACKGROUND_CONTEXT as context} from "@earendil-works/chord/context";
import {createModels} from "@earendil-works/pi-ai/models";
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from "@earendil-works/pi-ai/providers/faux";
import {BackgroundTasks} from "../src/index";
import {backgroundTasksExtension} from "../src/pi";

test("Pi sees background results and continues independent work before the command finishes",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"pi-background-concurrency-"));
 const service=new BackgroundTasks(directory),registry=createRegistry(),models=createModels(),faux=fauxProvider();
 models.setProvider(faux.provider);registry.install(backgroundTasksExtension(service,directory));
 let continued=false;
 faux.setResponses([
  fauxAssistantMessage(fauxToolCall("background_start",{command:"while [ ! -f independent-work-complete ]; do sleep 0.05; done; printf background-complete",name:"parallel-check"}),{stopReason:"toolUse"}),
  async request=>{
   const messages=JSON.stringify(request.messages);
   expect(messages).toContain('parallel-check');expect(messages).toContain(service.list()[0].id);
   expect(service.active).toBe(true);
   expect(["starting","running"]).toContain(service.list()[0].status);
   // Release the command only after the model has performed independent foreground work.
   await writeFile(join(directory,"independent-work-complete"),"verified");continued=true;
   return fauxAssistantMessage("independent work complete");
  },
 ]);
 const harness=await Harness.open(new MemoryStorage(),{models,registry,settings:{retry:{enabled:false}}},context);
 try{
  const root=await harness.root(context,{agent:{model:{provider:faux.provider.id,modelId:faux.getModel().id}}});
  expect((await(await root.submit({type:"input",content:"Start background work, then continue independently."},context)).wait(context)).status).toBe("done");
  expect(continued).toBe(true);expect(faux.state.callCount).toBe(2);expect(service.list()).toHaveLength(1);
  const task=await service.wait(service.list()[0].id,5000);expect(task.status).toBe("completed");
  expect((await service.output(task.id)).text).toBe("background-complete");
 }finally{await harness.close(context);await service.close();await rm(directory,{recursive:true,force:true});}
},15000);
