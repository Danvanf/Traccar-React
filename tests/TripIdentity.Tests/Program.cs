var start = DateTimeOffset.Parse("2026-01-15T12:00:00Z");
var end = start.AddMinutes(30);
var saved = new SavedTripIdentity(Guid.NewGuid(), Guid.NewGuid(), 5, start, end, 101, 202, "Keep my note");
var count = 0;
void Check(string name, IEnumerable<SavedTripIdentity> rows, TripIdentityStatus expected,
    int device = 5, DateTimeOffset? from = null, DateTimeOffset? to = null, long? first = 101, long? last = 202)
{
    var result = TripIdentity.Resolve(rows, device, from ?? start, to ?? end, first, last);
    if (result.Status != expected) throw new Exception($"{name}: expected {expected}, got {result.Status}");
    if (expected == TripIdentityStatus.Found && (result.Trip?.Id != saved.Id || result.Trip.Notes != saved.Notes))
        throw new Exception($"{name}: stable ID or notes changed");
    if (expected != TripIdentityStatus.Found && result.Trip is not null) throw new Exception($"{name}: unsafe identity returned");
    Console.WriteLine($"PASS {name}"); count++;
}
Check("exact match preserves saved identity and note", [saved], TripIdentityStatus.Found);
Check("stable source positions resolve changed derived boundaries", [saved], TripIdentityStatus.Found,
    from: start.AddSeconds(1), to: end.AddSeconds(2));
Check("nearby trip is not a match", [saved with { StartedAt = start.AddSeconds(1) }], TripIdentityStatus.Missing, first: null, last: null);
Check("different device at same time is not a match", [saved], TripIdentityStatus.Missing, device: 6);
Check("partial range is not a match", [saved], TripIdentityStatus.Missing, to: end.AddMinutes(-1), first: null, last: null);
Check("duplicate exact trips disable editing", [saved, saved with { Id = Guid.NewGuid() }], TripIdentityStatus.Ambiguous);
Check("duplicates across vehicles disable editing", [saved, saved with { VehicleId = Guid.NewGuid() }], TripIdentityStatus.Ambiguous);
Check("legacy null position IDs remain readable", [saved with { StartTraccarPositionId = null, EndTraccarPositionId = null }], TripIdentityStatus.Found);
Check("known start position mismatch is rejected", [saved], TripIdentityStatus.Missing, first: 999);
Check("known end position mismatch is rejected", [saved], TripIdentityStatus.Missing, last: 999);
Check("equivalent UTC offsets resolve", [saved], TripIdentityStatus.Found, from: start.ToOffset(TimeSpan.FromHours(-5)));
Check("missing trip stays missing", [], TripIdentityStatus.Missing);
Check("legacy client can resolve exact timestamps", [saved], TripIdentityStatus.Found, first: null, last: null);
Console.WriteLine($"Trip identity: {count} checks passed; no database writes.");
