# Isolated session expiration checks

Run from the repository root:

```powershell
dotnet run --project tests/SessionExpiration.Tests/SessionExpiration.Tests.csproj
node --test tests/session-state.test.js
```

The .NET executable starts a temporary loopback-only Kestrel server on an automatically allocated port. It links the production `TraccarScopeCookieAuthentication.Configure` implementation and uses the real ASP.NET cookie/authentication middleware, ephemeral encryption keys, and a controllable clock. Its only identity is an invented regular user; protected endpoints return invented data. It does not start the application backend, use its development bypass, load a database, or touch browser sessions. The server stops in a finally block.

Time advances beyond the configured cookie lifetime without sleeping or changing that lifetime. Checks cover anonymous 401, valid access, regular-user admin 403, sliding renewal, original-ticket expiry, renewed-ticket expiry after inactivity, no login/access-denied redirect, and recovery with a fresh test identity. Production cookie settings are shared with the test through a behavior-preserving extraction from Program.cs; real expiration settings have not changed.

The JavaScript tests exercise the actual Traccar API client's 401 error/session-state callback, subsequent successful recovery, and distinct 403 error handling. These tests do not establish end-to-end behavior of a real database-backed login, every API client, or browser UI after natural expiration. Live session stability and full deployed UI expiration remain separate acceptance observations.