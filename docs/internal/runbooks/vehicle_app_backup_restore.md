# vehicle_app backup and restore

These commands run on the Linux host. They use the existing `traccar-db` PostgreSQL container and never place the database password in the repository.

## Create a compressed backup

Choose a protected backup directory with sufficient space, then run:

```bash
mkdir -p ~/backups/vehicle_app
stamp=$(date -u +%Y%m%dT%H%M%SZ)
sudo docker exec traccar-db pg_dump -U traccar -d vehicle_app -Fc \
  > ~/backups/vehicle_app/vehicle_app_${stamp}.dump
```

Verify that the file is non-empty and record its checksum:

```bash
ls -lh ~/backups/vehicle_app/vehicle_app_${stamp}.dump
sha256sum ~/backups/vehicle_app/vehicle_app_${stamp}.dump
```

## Restore into a disposable database

Run this against a disposable database name, never the live database:

```bash
sudo docker exec -i traccar-db createdb -U traccar vehicle_app_restore_test
cat ~/backups/vehicle_app/vehicle_app_YYYYMMDDTHHMMSSZ.dump \
  | sudo docker exec -i traccar-db pg_restore -U traccar -d vehicle_app_restore_test \
      --exit-on-error --no-owner --no-privileges
sudo docker exec -it traccar-db psql -U traccar -d vehicle_app_restore_test \
  -c "select count(*) as trips from trips;"
```

Remove the disposable database only after verification:

```bash
sudo docker exec -it traccar-db dropdb -U traccar vehicle_app_restore_test
```

Backups should be kept outside the Git working tree with restricted filesystem permissions. The backup includes schema, trips, tags, bindings, event data, DTC data, and archive tables present at dump time.
