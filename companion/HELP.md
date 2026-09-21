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

The API key is stored as a secret, separately from the rest of the configuration.

If Syncthing runs on a different machine than Companion, its GUI must listen on more than
localhost. Set the GUI listen address to `0.0.0.0:8384` in the Syncthing settings.

### Actions

| Action              | Effect                                                         |
| ------------------- | -------------------------------------------------------------- |
| Rescan all folders  | Looks for local changes in every folder                        |
| Restart Syncthing   | Restarts the Syncthing process                                 |
| Shut down Syncthing | Stops the process, which then has to be started on the machine |
| Clear error list    | Empties the error list shown in the Syncthing GUI              |
| Refresh status now  | Polls immediately instead of waiting for the next interval     |

### Feedbacks

| Feedback                 | Active while                          |
| ------------------------ | ------------------------------------- |
| Connected to Syncthing   | The module can reach the REST API     |
| Syncthing reports errors | The Syncthing error list is not empty |

### Variables

Connection and version: `connected`, `version`, `version_long`, `os`, `arch`

Identity: `my_id`, `my_id_short`, `device_name`

Runtime: `uptime`, `uptime_seconds`, `bytes_in_total`, `bytes_out_total`

Counts: `devices_total`, `devices_connected`, `devices_paused`, `folders_total`, `folders_paused`

Errors: `error_count`, `last_error`

### Not yet implemented

Per-folder and per-device actions, feedbacks and variables, plus the event stream for immediate
updates, are planned for later versions. At the moment everything is driven by polling.
