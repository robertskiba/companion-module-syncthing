# Changelog

All notable changes to this module are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning

Everything below 1.0.0 is a pre-release. These versions have been built and checked against
simulated Syncthing servers, but not yet proven against real instances in daily use, so they are
not submitted anywhere. Each round of changes raises the patch number: 0.1.0-alpha, then 0.1.1,
0.1.2 and so on.

Version 1.0.0 will be the first release submitted to the Bitfocus module list, once the module has
been tested against real Syncthing instances.

## [Unreleased]

Nothing yet.

## [0.1.0-alpha] - 2026-09-21

First pre-release. Built on the Bitfocus TypeScript module template with
`@companion-module/base` 2.0.4.

### Connection

- Connects to the REST API of a single Syncthing instance over HTTP or HTTPS, with an option to
  accept the self-signed certificate Syncthing generates for its own web interface.
- The API key is stored as a Companion secret, separately from the rest of the configuration.
- Leaving the API key empty makes the module read it from the instance and save it, which removes
  the copy-and-paste step from setting up a connection. This only works while the Syncthing web
  interface has no username and password; a protected instance fails cleanly with a log entry
  naming the reason. The option can be turned off.
- Connection failures are reported once rather than on every attempt, and an API key the instance
  rejects is reported as an authentication failure rather than an outage.

### Staying up to date

- Follows the Syncthing event stream, so folder state, transfer progress, pause and resume, and
  devices coming and going reach buttons within milliseconds. Only the event types the module
  needs are subscribed to.
- Polling continues underneath as a floor, so a dropped event converges instead of leaving the
  state wrong. While the stream is connected, the per-folder status call that Syncthing documents
  as expensive drops to a safety net running at most every two minutes.
- A broken stream is logged once and retried. A restarted Syncthing is detected from its event
  numbering starting over, and answered by reading the whole state again.
- The folder and device lists are read from the running instance, so dropdowns, variables and
  presets follow configuration changes without reloading the connection.

### Actions

- Rescan all folders, or a single folder.
- Pause, resume or toggle a folder. Pause, resume or toggle a device. Pause or resume every
  device at once.
- Override remote changes on a send-only folder, and revert local changes on a receive-only
  folder. Syncthing ignores both on other folder types, so the module checks the type first and
  explains in the log instead of appearing to do nothing.
- Restart Syncthing, shut it down, clear the error list, refresh the status immediately.

### Feedbacks

- Connected to Syncthing, restart required, Syncthing reports errors.
- This machine is up to date, and in sync with all other devices. The second covers both
  directions and treats an offline device that is behind as out of sync, unless told otherwise.
- Any folder is syncing. Per folder: state, fully in sync, paused, has failed files. Per device:
  connected, paused, fully in sync.

### Variables

- Instance-wide: connection, version, operating system, architecture, own device ID and name, the
  address of the web interface, uptime, byte totals, counts of folders and devices, overall
  completion, sync state, error count and message, and whether a restart is pending.
- Per folder and per device, each published under two names: one derived from the identifier,
  which survives renaming, and one derived from the label or device name in lower case, which
  reads better but changes when you rename things.

### Presets

- An overview section with the in-sync buttons, connection, device count, transfer state and
  errors.
- One button per folder and per device, generated from the live configuration, plus pause buttons
  and, where they apply, override and revert.
- A control section for rescan, clearing errors, refreshing, pausing all devices and restarting.

### Deliberately not included

- Actions that add a folder or add a remote device. Those are setup steps that belong in the
  Syncthing web interface, where the device ID can be checked before confirming. They may be
  reconsidered if users ask for them.
- An action that opens the web interface in a browser. Companion often runs headless, so the
  browser would open on the wrong machine. The address is published as a variable instead.

### Known limits

- The automatic API key lookup and the event stream have been checked against simulated servers
  only, not yet against a real Syncthing instance.
- The API key lookup relies on behaviour that is not part of the documented REST API, so a future
  Syncthing release could change it.
- Syncthing buffers a limited number of events. A long disconnection during heavy activity can
  drop some; the periodic poll covers that case.
- Discovering Syncthing hosts on the local network is not implemented. Syncthing uses its own UDP
  protocol rather than Bonjour, and its web interface listens on localhost by default, so
  discovered hosts would often not be reachable anyway.
