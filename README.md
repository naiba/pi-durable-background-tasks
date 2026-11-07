# Pi Durable Background Tasks

Supervised background shell commands for Pi Coding Agent and Pi Durable. Both adapters share one independent process core. No delegated agents, model configuration, or implicit model calls.

**Initial development version. Linux only; requires Python 3.9+ and Linux pidfd support.**

```sh
bun add @naiba/pi-durable-background-tasks
```

Available on [npm](https://www.npmjs.com/package/@naiba/pi-durable-background-tasks), with GitHub Actions Trusted Publishing and provenance. Node.js 22+ is required; Bun loads the TypeScript source exports, while Node loads the compiled JavaScript.

The host installs the appropriate adapter and owns its lifecycle. This is not an auto-discovered CLI plugin. It does not manage Claude Code or Codex background tasks. All host peer dependencies are optional: importing the core loads neither Pi runtime; importing `./coding-agent` does not load Durable.

## Usage

For native Pi, install `@earendil-works/pi-coding-agent` (1.5+) and `typebox` (1.4.4+), then add the factory to your `DefaultResourceLoader`:

```ts
import {BackgroundTasks} from "@naiba/pi-durable-background-tasks";
import {backgroundTasksExtension} from "@naiba/pi-durable-background-tasks/coding-agent";

const tasks = new BackgroundTasks("/persistent/session/background");
const extension = backgroundTasksExtension(tasks, "/workspace", {
  onStart: task => trackOwnedTask(task.id), // optional host delivery bookkeeping
});
// Pass extensionFactories: [extension] to DefaultResourceLoader, reload it,
// createAgentSession with that loader, then await session.bindExtensions(...).
// Keep normal tool_call approval hooks; await tasks.close() at host shutdown.
```

For Durable, install `@earendil-works/pi-durable`, `@earendil-works/pi-ai` (1.2+) and `typebox` (1.4.4+). The existing `./pi` entry point remains unchanged:

```ts
import {BackgroundTasks} from "@naiba/pi-durable-background-tasks";
import {backgroundTasksExtension} from "@naiba/pi-durable-background-tasks/pi";

// `registry` is your host's Pi Durable registry.
const tasks = new BackgroundTasks("/persistent/session/background");
registry.install(backgroundTasksExtension(tasks, "/workspace"));
// Register your normal Pi beforeTool approval policy. This package does not bypass it.
const unsubscribe = tasks.subscribe(() => render(tasks.list()));
// Host shutdown must await cleanup:
await tasks.close();
unsubscribe();
```

| Tool | Input | Purpose |
| --- | --- | --- |
| `background_start` | `command`, optional `name` | Start a session-owned shell command |
| `background_status` | `{}` | List commands and their recorded state |
| `background_output` | `id`, optional `offset`, `limit` | Read up to 64 KiB using byte offsets |
| `background_wait` | `id`, `timeout_ms` | Observe completion for a bounded interval |
| `background_wait_all` | `ids`, `timeout_ms` | Observe 1–100 distinct commands concurrently |
| `background_stop` | `id` | Stop a command and await supervisor cleanup |

Wait requires `timeout_ms` between 1 and 600000. Observation timeout/cancellation does not stop the command. Commands have no implicit execution deadline.

The core API works without creating a model session. `start` requires a stable `requestId`; repeats return the original record and mismatching arguments are rejected. Recovered records never automatically relaunch a command. Use one service instance per directory and one writer process; concurrent writers are not supported.

## Process ownership

Each command has a Linux Python subreaper supervisor. A private stdin pipe ties ownership to the host: explicit stop or host pipe loss (including host SIGKILL) initiates cleanup. The supervisor reaps descendants, including ordinary double-fork/setsid escapes. TERM gets a grace interval before KILL; pidfd signalling avoids signalling a recycled PID. Even normal shell completion cleans up descendants before publishing a settled result.

This is **lifecycle management, not an OS security sandbox**. Privileged or hostile commands can kill the supervisor, leave its PID namespace, or start processes through an external daemon. Killing both the supervisor and host, uninterruptible kernel tasks, machine failure, and external-service side effects are not covered. Use delegated cgroups/container isolation for stronger enforcement. A supervisor without confirmed cleanup yields `unknown`, never fabricated success. The service never kills from a persisted PID after restart.

Records and logs survive reopening; live process continuity across host restart is deliberately not promised. Recovered active records become `unknown`. No automatic model wakeup or replay occurs. Hosts choose how to consume lifecycle events and display unknown execution ownership.

Output reads are bounded to 64 KiB, with byte offsets. Logs are retained without automatic deletion; configure filesystem quotas at the host level. Commands run with inherited environment and host permissions. Do not expose this service directly to untrusted clients; isolate task directories by session and authorize every tool/HTTP action.

## CloudCode integration

[CloudCode](https://github.com/naiba/cloudcode) consumes this npm package for Pi sessions. It provides a collapsed background-activity panel, on-demand logs, explicit stop controls, native Pi approval, and protection against releasing/deleting sessions with active commands. Closing a browser is not host shutdown and does not stop commands.

CloudCode uses the native `./coding-agent` adapter, retaining its host-specific approval, completion delivery and strict log-evidence checks. The package itself has no Web UI and does not automatically resume a model when a command completes. Claude Code and Codex continue to use their own native executors.

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

Update `package.json` to a new stable version, refresh `bun.lock` if needed, commit and push, then push the matching tag (for example, `v0.1.2` for version `0.1.2`). The tag-triggered publish workflow first calls the reusable `test.yml` workflow on the same tag. Its publish job uses `needs: test`, so failed or cancelled tests prevent publication. Branch pushes and pull requests also run `test.yml`; tag pushes avoid a redundant standalone test run. After tests succeed, the publish job rejects mismatching or prerelease versions, rebuilds the package, then publishes publicly with provenance. Published versions are immutable: `0.1.0` and `0.1.1` already exist and must not be republished. Never move a published release tag. There is no manual-dispatch publish path.
