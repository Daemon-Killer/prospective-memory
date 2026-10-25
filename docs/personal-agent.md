# Remy Personal Assistant service

The existing Remy API mounts its companion at `/agent`. Configure a separate
`AGENT_TOKEN` of at least 32 printable ASCII characters. Every mounted endpoint,
including `/agent/health`, requires `X-AGENT-TOKEN`. Do not embed this token in
the APK, repository, logs or a publicly shared download.

Phone onboarding now supports a private setup link instead of copying this
master token. An authenticated client creates one using `POST /v1/pairing/links`.
The one-year bearer key is carried in the fragment of `/agent/connect#key=...`;
the landing page has no external assets, disables caching/referrers, and launches
an explicit Android intent for `com.remy.reminders`. Remy asks for confirmation,
then exchanges the key and installation ID at public `POST /v1/pairing/exchange`.
The resulting per-installation credential goes directly to Android's encrypted
storage. The server persists only hashes. Exact retries return the same device
credential, revoked credentials cannot be restored by replay, and rotating the
master token invalidates existing links and device credentials.

Authenticated clients can list setup-link metadata and devices, revoke links to
block new installations, or revoke a device to immediately stop its access. A
setup link does not choose notification permissions. Keep recovery links private;
do not embed them in a public APK. Android updates preserve the connection;
reinstalls can use a saved link without access to the original PC.

Hosted memory uses the existing PostgreSQL connection configuration and an
isolated `remy_agent` schema. It never falls back to an ephemeral hosted SQLite
file. Local development without PostgreSQL uses `agent.sqlite3` in Remy's data
directory. Database initialization is lazy; failures return a sanitized 503
without disabling the existing reminder API. Companion writes are transactional
and serialized across workers by an advisory transaction lock.

The Android Personal Assistant connection screen accepts the HTTPS base URL,
token, explicit notification package list and separate learning-sharing toggle.
Android Keystore encrypts the token. Newly posted selected previews enter a
bounded native SQLite outbox and WorkManager retries delivery independently of
React. Capture starts only after configuration and Android notification access.
An empty package list captures nothing. OTP/credential messages, own app notices,
scams and group summaries are excluded. These filters are conservative, not a
guarantee that all sensitive personal information is removed.

The outbox retains at most 500 previews for seven days. The service keeps captured
previews for 30 days by default; pruning runs on ingestion/read requests. It stores
the latest preview per source/event ID, not full messages or historical edits.
Pause sharing purges pending notifications; existing server memory is retained.

`GET /v1/context` and `/v1/brief` combine confirmed personal facts, per-device
learning summaries and the existing Remy reminder state. Notification text does
not become a trusted fact or execute actions automatically. Fact edits use revision
checks and deletion tombstones. Learning snapshots use monotonically increasing
per-device sequences and exact retry detection. They provide shared context and
do not overwrite local study history or upload editor drafts.

Endpoints beneath `/agent`:

- `POST /v1/events`: up to 40 notifications; every result acknowledges its source ID.
- `GET /v1/memories?q=...`: literal, case-insensitive preview search.
- `GET /v1/facts`, `PUT /v1/facts/{id}`, `DELETE /v1/facts/{id}?revision=N`.
- `POST /v1/learning/sync`: latest complete learning context per device.
- `GET /v1/context`, `GET /v1/brief`, `GET /v1/suggestions`.
- Existing companion reminder/action endpoints use Remy's database functions.

Facts and learning remain until explicitly changed or administratively removed;
the event retention window does not apply to them. The API caps facts at 500
records (including deletion tombstones), learning at 20 devices, and each device
snapshot at 5,000 records / one MiB. Access tokens grant access to this single-user
assistant; rotate `AGENT_TOKEN` and reconnect clients if it is exposed.

Verification: `python -m pytest tests` exercises existing Remy behavior, the
companion API and the mounted integration. Real-device notification permission,
battery policies and delivery require a device check after installing the APK.
