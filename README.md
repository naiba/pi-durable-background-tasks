# Pi Durable Background Tasks

Supervised background shell commands for Pi Durable. No delegated agents, model configuration, or implicit model calls.

**Initial development version. Linux only; requires Python 3.9+ and Linux pidfd support.**

```sh
bun add @naiba/pi-durable-background-tasks
```

## Usage

```ts
import {BackgroundTasks} from "@naiba/pi-durable-background-tasks";
import {backgroundTasksExtension} from "@naiba/pi-durable-background-tasks/pi";

const tasks = new BackgroundTasks("/persistent/session/background");
registry.install(backgroundTasksExtension(tasks, "/workspace"));
// Register your normal Pi beforeTool approval policy. This package does not bypass it.
const unsubscribe = tasks.subscribe(() => render(tasks.list()));
// Host shutdown must await cleanup:
await tasks.close();
unsubscribe();
```

Tools: `background_start`, `background_status`, `background_output`, `background_wait`, `background_stop`.
Wait requires `timeout_ms` between 1 and 600000. Observation timeout/cancellation does not stop the command. Commands have no implicit execution deadline.

The core API works without creating a model session. `start` requires a stable `requestId`; repeats return the original record and mismatching arguments are rejected. Recovered records never automatically relaunch a command. Use one service instance per directory and one writer process; concurrent writers are not supported.

## Process ownership

Each command has a Linux Python subreaper supervisor. A private stdin pipe ties ownership to the host: explicit stop or host pipe loss (including host SIGKILL) initiates cleanup. The supervisor reaps descendants, including ordinary double-fork/setsid escapes. TERM gets a grace interval before KILL; pidfd signalling avoids signalling a recycled PID. Even normal shell completion cleans up descendants before publishing a settled result.

This is **lifecycle management, not an OS security sandbox**. Privileged or hostile commands can kill the supervisor, leave its PID namespace, or start processes through an external daemon. Killing both the supervisor and host, uninterruptible kernel tasks, machine failure, and external-service side effects are not covered. Use delegated cgroups/container isolation for stronger enforcement. A supervisor without confirmed cleanup yields `unknown`, never fabricated success. The service never kills from a persisted PID after restart.

Records and logs survive reopening; live process continuity across host restart is deliberately not promised. Recovered active records become `unknown`. No automatic model wakeup or replay occurs. Hosts choose how to consume lifecycle events and display unknown execution ownership.

Output reads are bounded to 64 KiB, with byte offsets. Logs are retained without automatic deletion; configure filesystem quotas at the host level. Commands run with inherited environment and host permissions. Do not expose this service directly to untrusted clients; isolate task directories by session and authorize every tool/HTTP action.

## Development

```sh
bun install
bun run build
bun test
```

Tests exercise real Linux processes rather than mocked cancellation. The build includes the Python supervisor beside the JavaScript distribution.

## Publishing

Releases use `.github/workflows/publish.yml` on pushed `v*` tags, with npm Trusted Publishing (OIDC); no npm token secret is required. Configure this package's GitHub Actions trusted publisher on npm:

- Organization or user: `naiba`
- Repository: `pi-durable-background-tasks`
- Workflow filename: `publish.yml`
- Environment: leave empty (the workflow does not declare an environment)

Update `package.json` to a new stable version, refresh `bun.lock` if needed, commit and push, then push the matching tag (for example, `v0.1.1` for version `0.1.1`). The workflow rejects mismatching or prerelease versions, runs type checks, build and process tests, then publishes publicly with provenance. Published versions are immutable: `0.1.0` already exists and must not be republished. Never move a published release tag. There is no manual-dispatch publish path.
