# Realtime log streaming

## Delivered
- Added `src/realtime/log-stream.ts`, a simple SSE broker that caches ANSI-to-HTML log output per job and broadcasts new chunks to every connected client (using `ReadableStream` controllers).
- Piped CI runner stdout/stderr (`src/ci/runner.ts`) through the broker so running jobs immediately publish new lines and close their streams on completion.
- Exposed `GET /jobs/:jobId/log-stream` (plus lightweight dev helpers under `/__test__/jobs/*`) via `src/http/handlers.ts` / `src/server.ts`.
- Updated `src/views/jobs.ts` to render the log container with a tiny `EventSource` script, eliminating the manual refresh button.
- Added `tests/job-log-stream.spec.ts` which seeds a fake job, appends log lines, and verifies the detail page updates live.

## Next steps
- Stream job metadata (status badge, duration, exit code) alongside the log so the page header reflects progress without reloads.
- Surface job events on the `/jobs` dashboard and repo/MR pages to keep lists in sync with CI activity.
- Broaden the broker into a shared `/events` feed (jobs, merge requests, previews) to power additional realtime UX.
- Revisit Datastar once its streaming story stabilises so we can swap the bespoke EventSource client for the official protocol.
