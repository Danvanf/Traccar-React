# Teltonika FMM00A data catalog

The initial FMM00A profile is a device-specific starting point for the decoded Traccar output observed from the Silverado. It is not a complete AVL dictionary and does not treat the FMM003 profile as interchangeable. The app keeps each received position and raw attribute intact; unmapped values remain visible under their Traccar keys.

## Sources and confidence

The primary reference is Teltonika's [FMM00A Teltonika Data Sending Parameters ID](https://wiki.teltonika-gps.com/view/FMM00A_Teltonika_Data_Sending_Parameters_ID). That page documents the AVL vocabulary for FMM firmware 03.29.00 and newer. Check the current device firmware and configuration when validating a mapping.

| Traccar key | Current handling | Evidence and limitation |
| --- | --- | --- |
| `io13201` | Tracker PCB Temperature; raw × 0.1 °C | Teltonika documents AVL 13201 with a 0.1 multiplier and lists FMM00A in its hardware-support list. The display can follow the user's temperature preference. |
| `io247` | “AVL 247 (crash/trace code; FMM00A support unverified)”; no unit or conversion | Teltonika's FMM00A AVL page describes ID 247 as crash detection and lists values 1–6, but its hardware-support list for that row does not include FMM00A. Presence in a Traccar sample is not proof that the device supports or emitted the event with this meaning. |
| `io12` | “AVL 12 (device-configured value)”; no unit or conversion | Its meaning depends on the tracker configuration. Keep raw until the active configuration confirms the field. |
| Other included keys | Labels for observed Traccar/Teltonika fields; only documented units are shown | These labels make the current profile usable without copying FMM003-specific OBD mappings. Confirm each source meaning and scale before adding conversions or treating it as a physical measurement. |

The profile also labels standard decoded values present in the sample, including GNSS and tracker status, accelerometer axes, battery readings, distance, and cellular information. The current sample and profile contain no VIN, coordinates, trip tags, or other personal identifiers in this catalog.

The profile JSON is [`device-profiles/teltonika-fmm00a.json`](../device-profiles/teltonika-fmm00a.json). Its internal ID is `teltonika-fmm003` because the live Silverado assignment already uses that key; retain the ID unless assignments are migrated. Its display name is **Teltonika FMM00A**.

## Extending the profile

1. Capture a time-bounded Traccar API sample for this tracker and retain the raw keys.
2. Check the FMM00A AVL table for the exact ID, multiplier, units, and hardware-support list.
3. For OBD/OEM values, also check the supported-vehicle list for the Silverado's model year and the tracker's actual OBD configuration. Model family alone does not establish that a vehicle reports a value.
4. Add only evidence-backed labels and unit scaling. Keep ambiguous attributes raw or label them explicitly as tentative.
5. Add representative mapping tests before using a new conversion. Do not promote guesses to confirmed mappings solely because values look plausible.

Source: [Teltonika FMM00A AVL table](https://wiki.teltonika-gps.com/view/FMM00A_Teltonika_Data_Sending_Parameters_ID).
