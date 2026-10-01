public static class BouncieRestEndpoints
{
    public static void MapBouncieRestEndpoints(this WebApplication app)
    {
        app.MapGet("/api/integrations/bouncie/status", (BouncieRestService service) =>
            Results.Ok(service.GetStatus()))
            .WithName("GetBouncieIntegrationStatus");

        app.MapPost("/api/integrations/bouncie/connect", async (
            BouncieConnectRequest request,
            BouncieRestService service,
            CancellationToken cancellationToken) =>
        {
            try
            {
                return Results.Ok(await service.ConnectAsync(request, cancellationToken));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (OperationCanceledException)
            {
                return Results.StatusCode(StatusCodes.Status499ClientClosedRequest);
            }
            catch (Exception ex)
            {
                service.RecordConnectionFailure(ex.Message);
                return Results.Problem(
                    detail: ex.Message,
                    statusCode: StatusCodes.Status502BadGateway,
                    title: "Bouncie connection failed.");
            }
        })
        .WithName("ConnectBouncieIntegration");

        app.MapPost("/api/integrations/bouncie/authorize", (BouncieAuthorizationStartRequest request, BouncieRestService service) =>
        {
            try
            {
                return Results.Ok(service.BeginAuthorization(request));
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
        })
        .WithName("BeginBouncieAuthorization");

        app.MapGet("/signin-bouncie", async (string? code, string? state, string? error, string? error_description, BouncieRestService service, CancellationToken cancellationToken) =>
        {
            static IResult Page(string title, string message, bool close = false)
            {
                var safeTitle = System.Net.WebUtility.HtmlEncode(title);
                var safeMessage = System.Net.WebUtility.HtmlEncode(message);
                var closeScript = close ? "<script>window.opener?.postMessage({type:'bouncie-oauth-complete'}, '*'); window.close();</script>" : "";
                return Results.Content($"<!doctype html><html><head><meta charset='utf-8'><title>{safeTitle}</title></head><body style='font-family:system-ui;padding:2rem'><h1>{safeTitle}</h1><p>{safeMessage}</p>{closeScript}</body></html>", "text/html");
            }
            if (!string.IsNullOrWhiteSpace(error))
            {
                var message = string.IsNullOrWhiteSpace(error_description) ? error : $"{error}: {error_description}";
                service.RecordConnectionFailure($"Bouncie authorization was declined: {message}");
                return Page("Bouncie authorization not completed", message);
            }
            try
            {
                await service.CompleteAuthorizationAsync(state ?? "", code ?? "", cancellationToken);
                return Page("Bouncie connected", "You can close this window and return to Traccar React.", true);
            }
            catch (Exception ex)
            {
                service.RecordConnectionFailure(ex.Message);
                return Page("Bouncie connection failed", ex.Message);
            }
        })
        .WithName("BouncieAuthorizationCallback");

        app.MapPost("/api/integrations/bouncie/import", (
            BouncieImportRangeRequest request,
            BouncieRestService service) =>
        {
            try
            {
                var jobId = service.StartImport(request);
                return Results.Accepted("/api/integrations/bouncie/import-status", new { jobId });
            }
            catch (ArgumentException ex)
            {
                return Results.BadRequest(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return Results.Conflict(new { error = ex.Message });
            }
        })
        .WithName("StartBouncieImport");

        app.MapGet("/api/integrations/bouncie/import-status", (BouncieRestService service) =>
            Results.Ok(service.GetStatus()))
            .WithName("GetBouncieImportStatus");

        app.MapGet("/api/integrations/bouncie/backfill-coverage", async (DateTimeOffset? from, DateTimeOffset? through, BouncieRestService service, CancellationToken cancellationToken) =>
            Results.Ok(await service.GetBackfillCoverageAsync(from, through, cancellationToken)))
            .WithName("GetBouncieBackfillCoverage");

        app.MapPost("/api/integrations/bouncie/restore", async (BouncieRestService service, CancellationToken cancellationToken) =>
            Results.Ok(await service.RestoreAsync(cancellationToken)))
            .WithName("RestoreBouncieConnection");

        app.MapPost("/api/integrations/bouncie/import-cancel", (BouncieRestService service) =>
        {
            service.CancelImport();
            return Results.Ok(service.GetStatus());
        })
        .WithName("CancelBouncieImport");

        app.MapPost("/api/integrations/bouncie/forget", async (BouncieRestService service, CancellationToken cancellationToken) =>
        {
            await service.ForgetAsync(cancellationToken);
            return Results.Ok(service.GetStatus());
        })
        .WithName("ForgetBouncieCredentials");
    }
}
