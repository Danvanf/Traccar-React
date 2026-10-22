# Isolated device and trip authorization checks

From Windows PowerShell with .NET 9 and Docker available, run:

```powershell
./tests/VehicleAccess.IntegrationTests/Run-Isolated.ps1
```

The runner obtains the official `postgres:17-alpine` image if needed, builds into a unique temporary directory, and starts a disposable PostgreSQL container with no host data mounts. Only an automatically allocated loopback port is published. Credentials belong to that invented test database. It stops/removes the exact container it created in a finally block and restores any prior process-level test connection variable. The image remains cached for later runs; temporary build outputs remain normal test artifacts.

The executable requires an explicit `VEHICLE_ACCESS_TEST_CONNECTION`; it never falls back to application configuration. Run it manually only against a disposable scratch database. It creates a random `vehicle_access_test_<guid>` schema, sets an exclusive search_path with no application schema fallback, and removes only that validated generated schema in finally. All users, grants, bindings, devices, trips, and coordinates are invented.

Tests invoke production VehicleAccess functions against real PostgreSQL and the actual TripRoutePointEndpoints route over a temporary loopback Kestrel server. Cookie configuration is the production shared configuration with ephemeral encryption keys. A test-only sign-in issues an invented regular-user identity; no application accounts or passwords are used.

Coverage: direct and group device grants; direct and group vehicle grants through current bindings; readable device list exclusion; existing out-of-scope device/trip denial; invalid device IDs; real permitted-route HTTP 200 versus out-of-scope HTTP 403 with no geometry; inactive-user access denial. This does not replace deployed application session-expiry or every endpoint's authorization acceptance.

The initial attempt using repository integration-test defaults was rejected by PostgreSQL before creating a schema. The runner was changed to require its explicit disposable database so it cannot accidentally use those defaults. A normal output build also encountered the running API apphost lock; temporary build output avoids restarting or replacing the live API executable.