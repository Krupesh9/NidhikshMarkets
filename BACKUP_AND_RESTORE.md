# Backup and restore

Run `make backup` or choose an explicitly separate destination:

```sh
BACKUP_PATH=/your-approved-backup-destination/market-unique-date.sqlite make backup
BACKUP_PATH=/your-approved-backup-destination/market-unique-date.sqlite make restore-test
```

The backend CLI uses SQLite's online backup API. It refuses to overwrite an existing destination and checks `PRAGMA integrity_check`. `restore-test` restores into an isolated temporary directory, verifies the expected schema, integrity and foreign keys, and does not replace the active database.

The local verification backup is `backups/tonight-wrap-20261116.sqlite`. This is a separate directory on the same Mac: **it does not establish off-device backup protection**. Select a separate physical/device destination before NAS acceptance. RAID is not a backup.

To restore for real, stop the backend, preserve the current DB and WAL/SHM files as a rollback set, restore a verified backup into a new runtime directory, point `DATABASE_URL` there, run migrations, and verify login/data before switching. Do not overwrite a live SQLite file. Backups contain private research and password hashes; use restrictive permissions and encrypted off-device storage.

Before container updates, back up the DB and record the current image tag. Image rollback is safe only while schema compatibility is maintained. After a destructive schema change, restore the matching backup into a separate path; do not attempt an unsafe blind downgrade.

The local completion snapshot `backups/final-local-20261117.sqlite` was restored into an isolated directory and verified with29tables before the intraday migration. The subsequent `backups/partner-demo-20261117.sqlite` snapshot was restored and verified with30tables after the intraday migration. Both contain private account data and remain excluded from Git.
