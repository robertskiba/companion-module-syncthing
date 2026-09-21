## Syncthing

Monitors and controls a [Syncthing](https://syncthing.net/) instance through its REST API.

One Companion connection talks to exactly one Syncthing instance. If you want to watch several
machines, add one connection per machine.

### Configuration

| Field                          | Meaning                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| Host                           | IP address or hostname of the machine running Syncthing           |
| GUI port                       | Port of the Syncthing web interface, `8384` by default            |
| Poll interval                  | How often the module refreshes status and variables, in seconds   |
| API key                        | Taken from the Syncthing GUI under Actions > Settings > General   |
| Read the API key automatically | Fills the field above from an unprotected web interface           |
| Use HTTPS                      | Enable if the Syncthing GUI is served over HTTPS                  |
| Accept self-signed certificate | Needed for HTTPS, because Syncthing generates its own certificate |
| Follow the event stream        | Reacts to changes immediately instead of at the next poll         |
| Poll folder and device details | Turns the per-folder and per-device data on or off                |
| Detail interval                | How often that per-folder and per-device data is refreshed        |

The API key is stored as a secret, separately from the rest of the configuration.

### Getting the API key without copying it

Leave the API key empty and the module will try to read it from the instance itself, then store it
as if you had typed it in. This only works while the Syncthing web interface has no username and
password, which is its state after a fresh install on a trusted network. The module does exactly
what the web interface does in your browser: it asks for the page once to receive a CSRF token,
then reads the configuration with that token.

If the interface asks for a login, or refuses the request, nothing is stored and the connection
log says why. Enter the key by hand in that case, from Actions, Settings, General in the Syncthing
web interface.

Two caveats. This uses behaviour that is not part of the documented REST API, so a future
Syncthing release could change it. And Syncthing rejects requests that arrive under an unexpected
host name as a protection against DNS rebinding, so use an IP address if the lookup fails with a
host check error. Untick the option if you would rather the module never tried.

If Syncthing runs on a different machine than Companion, its GUI must listen on more than
localhost. Set the GUI listen address to `0.0.0.0:8384` in the Syncthing settings.

Details cost one request per folder and one per device, and Syncthing describes the folder status
call as expensive on large folders. That is why they run on their own, slower interval, and can be
switched off entirely if you only need the overall status.

### How the module stays up to date

Two mechanisms run side by side.

**The event stream** keeps one request open to Syncthing, which answers the moment something
happens. Folder state, transfer progress, pause and resume, and devices coming and going therefore
show up on buttons within milliseconds. Only the event types this module needs are subscribed to,
so the per-file chatter never reaches Companion.

**Polling** is the floor underneath it. A short poll refreshes uptime, byte totals and the error
list. The expensive per-folder call is where the event stream earns its keep: while events are
flowing, folder numbers arrive in the events themselves, and the poll drops back to a safety net
that runs at most once every two minutes.

If the stream breaks, the module says so in the log once, retries every few seconds, and keeps
polling meanwhile, so buttons stay correct at the polling rate. If Syncthing restarts, its event
numbering starts over, which the module notices and answers by reading the whole state again.

Turn the stream off to fall back to polling only.

### Are we in sync?

This is the question the module is built around, and it is answered at two levels.

**This machine is up to date** means the local machine holds everything the others have. It says
nothing about whether the others have caught up with your changes.

**In sync with all other devices** means everyone holds the same data, in both directions. This is
the one to put on a button before going live. Paused devices are always ignored. Devices that are
currently offline count as out of sync unless you tick the option to ignore them, because an
offline machine that never received your last change is exactly the case you want to catch.

### Folders and devices follow the configuration

The folder and device lists are read from the running instance on every poll. Add, rename or
remove a folder in Syncthing and the dropdowns, variables and presets follow within one interval,
without reloading the connection.

### Two ways to name the same variable

Every folder and device variable exists twice, so you can pick between a stable name and a
readable one.

**By identifier.** Folders use their folder id, devices the first block of their device ID. These
never change, even when you rename things, which is what you want for an installation that has to
keep working untouched. The drawback is that a Syncthing folder id is often generated and cryptic,
so you get something like `$(syncthing:folder_kj3h4_a9s8d_completion)`.

**By name.** Folders use their label, devices their device name, lower-cased. That reads far
better, for example `$(syncthing:folder_show_content_completion)` or
`$(syncthing:device_backup_pc_completion)`. The catch is that renaming a folder or device renames
its variables, and buttons referring to the old name stop resolving. Use this variant while
building, and the identifier variant where a rename must not break anything.

Characters that a variable name cannot contain become underscores. A folder with no label, or one
whose label matches its id, only gets the identifier variant. If two labels collapse to the same
name, the second one gets a numeric suffix.

### Actions

| Action                          | Effect                                                         |
| ------------------------------- | -------------------------------------------------------------- |
| Rescan all folders              | Looks for local changes in every folder                        |
| Rescan one folder               | Looks for local changes in a single folder                     |
| Folder: pause, resume or toggle | A paused folder is neither scanned nor synchronised            |
| Folder: override remote changes | Makes the local version win, on send-only folders              |
| Folder: revert local changes    | Throws local changes away, on receive-only folders             |
| Device: pause, resume or toggle | A paused device is not connected to                            |
| All devices: pause or resume    | Applies to every remote device at once                         |
| Restart Syncthing               | Restarts the Syncthing process                                 |
| Shut down Syncthing             | Stops the process, which then has to be started on the machine |
| Clear error list                | Empties the error list shown in the Syncthing GUI              |
| Refresh status now              | Polls immediately instead of waiting for the next interval     |

Pause, resume and toggle share one action with a mode dropdown, so a single button can toggle a
folder or device. Toggling needs the current state, so it is skipped with a log entry if the
module has not seen that folder or device yet.

Override and revert are destructive in opposite directions. Override discards what other devices
changed, revert discards what you changed locally. Syncthing silently ignores both on folder types
they do not apply to, so the module checks the type first and writes a log entry instead.

Folder pause goes through the configuration, so Companion needs the folder to exist in Syncthing.
Device pause uses the dedicated pause and resume endpoints.

### Feedbacks

| Feedback                       | Active while                                         |
| ------------------------------ | ---------------------------------------------------- |
| Connected to Syncthing         | The module can reach the REST API                    |
| Restart required               | A config change is waiting for a Syncthing restart   |
| Syncthing reports errors       | The Syncthing error list is not empty                |
| This machine is up to date     | The local machine holds everything the cluster has   |
| In sync with all other devices | Every device holds the same data, in both directions |
| Any folder is syncing          | At least one folder is transferring data             |
| Folder is in a given state     | The chosen folder reports the chosen state           |
| Folder is fully in sync        | The chosen folder needs nothing                      |
| Folder is paused               | The chosen folder is paused                          |
| Folder has failed files        | Files in the chosen folder failed to sync            |
| Device is connected            | The chosen device has a live connection              |
| Device is paused               | The chosen device is paused                          |
| Device is fully in sync        | The chosen device holds everything shared with it    |

### Variables

Connection and version: `connected`, `version`, `version_long`, `os`, `arch`

Identity: `my_id`, `my_id_short`, `device_name`, `gui_url`

`gui_url` holds the address of the Syncthing web interface, for example to open it in a new tab
from a button.

Runtime: `uptime`, `uptime_seconds`, `bytes_in_total`, `bytes_out_total`

Sync state: `completion`, `in_sync`, `all_in_sync`, `folders_syncing`, `folders_out_of_sync`,
`devices_out_of_sync`

Counts: `devices_total`, `devices_connected`, `devices_paused`, `folders_total`, `folders_paused`

Errors: `error_count`, `last_error`, `restart_required`

Per folder, as `folder_<folder>_<name>`, where `<folder>` is either the folder id or the
lower-cased label: `id`, `label`, `type`, `state`, `paused`, `completion`, `in_sync`, `need_bytes`,
`need_items`, `global_bytes`, `local_bytes`, `errors`, `pull_errors`, `local_changes`.

Per device, as `device_<device>_<name>`, where `<device>` is either the first block of the device
ID or the lower-cased device name: `id`, `id_short`, `name`, `connected`, `paused`, `completion`,
`in_sync`, `need_bytes`, `need_items`, `address`, `client_version`.

### Deliberately not included

Adding folders and adding remote devices are not offered as actions. Those are setup steps that
belong in the Syncthing web interface, where you can see what you are doing and confirm the device
ID. They may be reconsidered if enough users ask for them.

### Known limits

Syncthing buffers a limited number of events. If the module is disconnected for a long time while
a great deal happens, some events are dropped. The periodic poll covers that case, so the state
converges again rather than staying wrong.
