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
| Use HTTPS                      | Enable if the Syncthing GUI is served over HTTPS                  |
| Accept self-signed certificate | Needed for HTTPS, because Syncthing generates its own certificate |
| Poll folder and device details | Turns the per-folder and per-device data on or off                |
| Detail interval                | How often that per-folder and per-device data is refreshed        |

The API key is stored as a secret, separately from the rest of the configuration.

If Syncthing runs on a different machine than Companion, its GUI must listen on more than
localhost. Set the GUI listen address to `0.0.0.0:8384` in the Syncthing settings.

Details cost one request per folder and one per device, and Syncthing describes the folder status
call as expensive on large folders. That is why they run on their own, slower interval, and can be
switched off entirely if you only need the overall status.

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

Folder variables are named after the folder id, device variables after the device name. Characters
that are not allowed in a variable name become underscores, so a device called `Backup PC` gives
`$(syncthing:device_Backup_PC_completion)`. Renaming a device therefore renames its variables.

### Actions

| Action              | Effect                                                         |
| ------------------- | -------------------------------------------------------------- |
| Rescan all folders  | Looks for local changes in every folder                        |
| Rescan one folder   | Looks for local changes in a single folder                     |
| Restart Syncthing   | Restarts the Syncthing process                                 |
| Shut down Syncthing | Stops the process, which then has to be started on the machine |
| Clear error list    | Empties the error list shown in the Syncthing GUI              |
| Refresh status now  | Polls immediately instead of waiting for the next interval     |

### Feedbacks

| Feedback                       | Active while                                         |
| ------------------------------ | ---------------------------------------------------- |
| Connected to Syncthing         | The module can reach the REST API                    |
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

Identity: `my_id`, `my_id_short`, `device_name`

Runtime: `uptime`, `uptime_seconds`, `bytes_in_total`, `bytes_out_total`

Sync state: `completion`, `in_sync`, `all_in_sync`, `folders_syncing`, `folders_out_of_sync`,
`devices_out_of_sync`

Counts: `devices_total`, `devices_connected`, `devices_paused`, `folders_total`, `folders_paused`

Errors: `error_count`, `last_error`

Per folder, where `<folder>` is the folder id: `id`, `label`, `type`, `state`, `paused`,
`completion`, `in_sync`, `need_bytes`, `need_items`, `global_bytes`, `local_bytes`, `errors`,
`pull_errors`, `local_changes`, each as `folder_<folder>_<name>`.

Per device, where `<device>` is the device name: `id`, `id_short`, `name`, `connected`, `paused`,
`completion`, `in_sync`, `need_bytes`, `need_items`, `address`, `client_version`, each as
`device_<device>_<name>`.

### Not yet implemented

Pausing and resuming folders and devices, override and revert for send-only and receive-only
folders, and the event stream for immediate updates instead of polling. All of that is planned for
later versions.
