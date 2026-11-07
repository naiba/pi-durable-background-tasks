import type {BackgroundTasks} from "./index.js";

/** Validate the entire selection before observing; one timeout applies concurrently. */
export async function waitForBackgroundTasks(service:Pick<BackgroundTasks,"get"|"wait">,ids:string[],timeout:number,signal?:AbortSignal){
 if(!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw new Error("Select 1..100 distinct background task IDs");
 if(!Number.isInteger(timeout)||timeout<1||timeout>600000)throw new Error("timeout_ms must be 1..600000");
 for(const id of ids)service.get(id);
 return Promise.all(ids.map(id=>service.wait(id,timeout,signal)));
}
