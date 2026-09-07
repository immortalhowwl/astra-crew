# Security policy

GPTHEIST has two deliberately separate modes:

- **Replay** reads local JSON fixtures and writes immutable local audit records.
- **Desk** performs read-only JSON-RPC calls to public Robinhood Chain endpoints and displays verified Pons v2 factory events.

Neither mode contains wallet connection, private-key handling, signing, brokerage integration, or order execution. The Desk binds to `127.0.0.1` by default, sets defensive HTTP headers, limits RPC windows and cached responses, and treats missing market evidence as a veto.

Do not place private keys, seed phrases, API credentials, or personal data in fixtures, environment variables, URLs, issues, or screenshots. `RPC_URL` is intended for one or more comma-separated HTTP(S) read-only RPC endpoints; credentials embedded in a URL may be exposed to the local process or shell history.

If you discover a security problem, do not open a public issue. Contact the repository owner privately through the contact method on their GitHub profile.
