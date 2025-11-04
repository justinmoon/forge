# Demo Stream

This repository is seeded automatically by `just dev` so you can try Forge without any manual setup.

- `flake.nix` exposes a `pre-merge` app that emits a 20 second tick log to exercise realtime streaming.
- A `feature/log-stream` branch is pushed with a second commit so the UI shows an open merge request by default.

Feel free to push extra commits to `feature/log-stream` while `just dev` is running to see the CI log stream update in real time.
