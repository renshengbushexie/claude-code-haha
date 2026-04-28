# go-runtime

Go-side runtime kernel for open-claude-code.

**Status**: P1 skeleton (no business logic yet; only health/createTask/listTasks).

## Responsibilities (per `.opencode/memory.md`)

- Task state machine (`internal/task`)
- Event log (`internal/event`)
- SQLite as the **sole writer** (`internal/store`)
- Local RPC over Unix socket (POSIX) / Named Pipe (Windows) (`internal/rpc`, `internal/ipc`)

## Non-Responsibilities

- No UI, no plugin system, no MCP/Skill orchestration, no compact semantics.
- TS still owns those layers and only talks to this runtime via RPC.

## Layout

```
go-runtime/
├── cmd/runtime/main.go          # entrypoint
├── internal/
│   ├── log/      slog wiring
│   ├── store/    SQLite open + migrations + DAO
│   ├── event/    event writer (single goroutine)
│   ├── task/     task state machine
│   ├── ipc/      named pipe / unix socket listener
│   └── rpc/      JSON over HTTP handlers
└── go.mod
```

## Build & Run

```bash
# from repo root
cd go-runtime
go build -o ../bin/oc-runtime ./cmd/runtime
../bin/oc-runtime --data-dir ~/.claude-haha
```

## RPC Surface (P1)

| Method | Path | Body | Response |
|---|---|---|---|
| GET  | `/health`        | –                          | `{ ok: true, version, pid, dataDir }` |
| POST | `/v1/tasks`      | `{ prompt, cwd?, model? }` | `{ task_id, status: "pending" }` |
| GET  | `/v1/tasks`      | –                          | `{ tasks: Task[] }` |
| GET  | `/v1/tasks/:id`  | –                          | `Task` |

P2+ will add: cancel, resume, recover, events stream, etc.

## Transport

- **POSIX**: `unix:///run/user/<uid>/oc-runtime.sock` (or `$XDG_RUNTIME_DIR`)
- **Windows**: `\\.\pipe\oc-runtime-<user>`

TS client picks the right transport per platform.
