# companion-module-syncthing

A [Bitfocus Companion](https://bitfocus.io/companion) module for [Syncthing](https://syncthing.net/).

It talks to the Syncthing REST API to show whether an instance is reachable, how many devices are
connected and whether any errors are pending, and it can trigger a rescan, a restart or a shutdown.

See [HELP.md](./companion/HELP.md) for user documentation and [LICENSE](./LICENSE) for the license.

## Getting started

Running `yarn` performs all the steps needed to develop the module.

Build once with `yarn build`. That is enough for Companion to load the module.

While developing, `yarn dev` runs the compiler in watch mode and recompiles on change.

Check types and style with `yarn build` and `yarn lint`. Run `yarn test` after a build to
exercise the REST client and the state helpers against a simulated Syncthing server. Build a distributable package with
`yarn package`.

## Project layout

| File               | Contents                                                            |
| ------------------ | ------------------------------------------------------------------- |
| `src/main.ts`      | The instance class, polling loop and state publishing               |
| `src/api.ts`       | REST client for the Syncthing API, including error classification   |
| `src/types.ts`     | Types for the REST responses this module reads                      |
| `src/state.ts`     | Folder and device state, variable naming and completion maths       |
| `src/config.ts`    | Connection settings shown in the Companion web UI                   |
| `src/discover.ts`  | Reads the API key from an instance whose web interface has no login |
| `src/events.ts`    | Long-polling event stream, with reconnect and restart detection     |
| `src/actions.ts`   | Actions                                                             |
| `src/feedbacks.ts` | Feedbacks                                                           |
| `src/variables.ts` | Variable definitions and the uptime formatter                       |
| `src/presets.ts`   | Ready-made buttons                                                  |
| `tests/`           | Dependency-free checks, run with `yarn test` after `yarn build`     |

## Roadmap

1. ~~Scaffold, connection, status and instance-wide variables~~ done
2. ~~Per-folder and per-device variables, feedbacks and presets, driven by the live configuration~~ done
3. ~~Per-folder and per-device actions: pause, resume, override, revert~~ done
4. ~~Event stream via `/rest/events` long polling, replacing most of the polling~~ done
5. Polish, real-world testing against several instances, then submission to the Bitfocus module list

Deliberately out of scope: actions that add a folder or add a remote device. Those are setup steps
that belong in the Syncthing web interface, where the device ID can be checked before confirming.
They may be reconsidered if users ask for them.

## References

- [Syncthing REST API](https://docs.syncthing.net/dev/rest.html)
- [Syncthing event API](https://docs.syncthing.net/dev/events.html)
- [Companion module API](https://github.com/bitfocus/companion-module-base)
