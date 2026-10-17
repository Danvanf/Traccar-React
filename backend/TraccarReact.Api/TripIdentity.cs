public sealed record SavedTripIdentity(
    Guid Id,
    Guid VehicleId,
    int TraccarDeviceId,
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    long? StartTraccarPositionId,
    long? EndTraccarPositionId,
    string? Notes,
    string? DerivationVersion,
    double? MaxSpeedMph);

public enum TripIdentityStatus { Found, Missing, Ambiguous }

public static class TripIdentity
{
    // Legacy imports have no source position IDs. Exact device and timestamps remain
    // mandatory; known source IDs must agree. Never choose between duplicate rows.
    public static (TripIdentityStatus Status, SavedTripIdentity? Trip) Resolve(
        IEnumerable<SavedTripIdentity> candidates, int deviceId,
        DateTimeOffset startedAt, DateTimeOffset endedAt,
        long? startPositionId = null, long? endPositionId = null)
    {
        var sourceMatches = startPositionId.HasValue && endPositionId.HasValue
            ? candidates.Where(trip => trip.TraccarDeviceId == deviceId
                && trip.StartTraccarPositionId == startPositionId
                && trip.EndTraccarPositionId == endPositionId).Take(2).ToArray()
            : [];
        if (sourceMatches.Length == 1)
            return (TripIdentityStatus.Found, sourceMatches[0]);
        if (sourceMatches.Length > 1)
            return (TripIdentityStatus.Ambiguous, null);

        var exact = candidates.Where(trip => trip.TraccarDeviceId == deviceId
            && trip.StartedAt == startedAt && trip.EndedAt == endedAt).Take(2).ToArray();
        if (exact.Length > 1) return (TripIdentityStatus.Ambiguous, null);
        if (exact.Length == 0) return (TripIdentityStatus.Missing, null);
        var trip = exact[0];
        if ((startPositionId.HasValue && trip.StartTraccarPositionId.HasValue
                && startPositionId != trip.StartTraccarPositionId)
            || (endPositionId.HasValue && trip.EndTraccarPositionId.HasValue
                && endPositionId != trip.EndTraccarPositionId))
            return (TripIdentityStatus.Missing, null);
        return (TripIdentityStatus.Found, trip);
    }
}
