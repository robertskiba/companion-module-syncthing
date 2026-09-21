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

## [0.1.5] - 2026-09-21

### Added

- Two variables, discovered_hosts and discovered_count, showing what the network search has found.
  They are set before a host has been chosen, so they can be put on a button while setting up.

### Changed

- The configuration now says plainly that the list of found instances is built when the page is
  opened, and that leaving the page and coming back picks up anything found since. Companion asks
  the module for its fields at that moment and the module cannot extend a list that is already on
  screen, so an instance heard ten seconds after the page opened appeared to be missing.
- The option for reading the API key now says "try to", because that is what it does. An instance
  whose web interface is properly protected refuses, which is correct behaviour on its part, and
  the key then has to be entered by hand. The tooltip says so too.

## [0.1.4] - 2026-09-21

### Removed

- The switches for following the event stream and for searching the network. Neither had a case
  where turning it off helps: the stream is strictly better than waiting for the next poll and
  polling stays underneath it either way, and the search only listens, so a network without
  Syncthing simply produces nothing. An option nobody knowingly changes is one more thing to
  explain, document and test.
- The host field keeps its free text entry. Discovery only reaches the same broadcast domain, so
  an instance on another subnet, behind a router or across a VPN can only be reached by typing its
  address, and restricting the field to what was found would make those setups impossible.

### Fixed

- Changing the web interface port now applies to the search straight away. The port was read once
  when the search started, so a corrected port was ignored until the connection was recreated.
  Saving the connection with a different port also throws away what was found, because every entry
  had been confirmed against the old port.
- An instance that did not answer when it was first heard is checked again after a few minutes,
  instead of staying invisible until the connection was saved. Binding a Syncthing to a network
  address after Companion had already heard it is the ordinary case for this.
- Every announcement heard is now written to the log at debug level, along with the reason an
  address was skipped, so it is possible to tell "heard nothing" apart from "heard it but it did
  not answer".

## [0.1.3] - 2026-09-21

### Fixed

- Network discovery found nothing on a machine that also runs Syncthing. Syncthing holds the
  discovery port for its own use, and the shared socket Companion hands out cannot bind alongside
  it. The port is now opened again in a mode that allows sharing when the first attempt is
  refused, so both can listen. Where the system refuses even that, the log says so plainly.

### Added

- The name of a found machine is now also asked for directly, the way Windows machines find each
  other, when reverse DNS has nothing to say. On a small network that is the normal case, and this
  is what turns a bare address into a recognisable computer name.

### Changed

- Entries without a device ID no longer show an empty "device" label.

## [0.1.2] - 2026-09-21

### Changed

- A newly added connection starts with no host chosen and contacts nothing until one is picked,
  where it previously defaulted to 127.0.0.1 and began polling the local machine straight away.
  On a network with several machines the local instance is rarely the one wanted, and a connection
  attempt nobody asked for is worse than an empty field.
- 127.0.0.1 is still offered in the host list, labelled as this machine, but it is never
  preselected and sits after whatever was found on the network.
- The connection status now reads "No host chosen yet", and the configuration text says plainly
  that nothing is being contacted, instead of showing an address derived from a host that was
  never chosen.
- The instance on the machine Companion runs on is now searched for like any other, by checking
  127.0.0.1 directly and repeating that check every minute. It was previously offered outright,
  which is wrong: binding Syncthing to a single network address makes its interface unreachable
  over 127.0.0.1, and the list would have suggested an address that does not work.
- The device ID for that local entry is taken from its own broadcast when one arrives, so it reads
  like every other entry.

### Added

- A diagnostic script, `node scripts/discover-check.mjs [address]`, which binds the same port the
  module binds, prints every announcement it hears, and says for each whether the module would
  list it. Meant for working out why an instance is not being found.

## [0.1.1] - 2026-09-21

### Added

- Finds Syncthing instances on the network by listening for the announcements they broadcast on
  UDP port 21027, on every IPv4 interface of the Companion machine. Nothing is sent out.
- Because an announcement says which device is there but not where its web interface is, each
  newly heard instance is checked on the configured port, and only instances that answer are
  offered. Syncthing binds its web interface to localhost until that is changed, so an unreachable
  instance would otherwise be offered and then fail.
- The host field became a list of what was found, showing the address, the resolved name where the
  network provides one, and the short device ID. Any other address can still be typed in, and
  127.0.0.1 is always offered for the common case of Syncthing running on the Companion machine.
- Found instances are written to the connection log as they appear.

### Known limits

- Only IPv4 broadcasts are listened for. Syncthing also announces itself by IPv6 multicast, which
  Companion's shared socket cannot join; a dual-stack instance is found through IPv4 anyway.
- Only the first block of the device ID is shown. The full ID adds check characters whose exact
  derivation is not documented, and a wrong ID that looks right would be worse than a short one.

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
