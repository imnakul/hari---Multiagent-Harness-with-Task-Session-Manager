//! Tiny UTC date helpers. ActivityWatch speaks ISO-8601 and the notes prompt
//! wants wall-clock times; neither is worth pulling `chrono` in for.

const MS_PER_DAY: i64 = 86_400_000;

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's
/// `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Inverse of [`days_from_civil`]: `(year, month, day)`.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Format epoch milliseconds as `YYYY-MM-DDTHH:MM:SS.mmmZ`.
pub fn format_iso_utc(ms: i64) -> String {
    let days = ms.div_euclid(MS_PER_DAY);
    let rem = ms.rem_euclid(MS_PER_DAY);
    let (year, month, day) = civil_from_days(days);
    let hour = rem / 3_600_000;
    let minute = (rem / 60_000) % 60;
    let second = (rem / 1000) % 60;
    let millis = rem % 1000;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Parse an ISO-8601 timestamp as ActivityWatch emits it
/// (`2026-11-09T12:34:56.789000+00:00`, `...Z`, or no fraction) into epoch ms.
pub fn parse_iso_ms(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    if raw.len() < 19 {
        return None;
    }
    let bytes = raw.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' || !matches!(bytes[10], b'T' | b' ') {
        return None;
    }
    if bytes[13] != b':' || bytes[16] != b':' {
        return None;
    }
    let num = |range: std::ops::Range<usize>| raw.get(range)?.parse::<i64>().ok();
    let year = num(0..4)?;
    let month = num(5..7)?;
    let day = num(8..10)?;
    let hour = num(11..13)?;
    let minute = num(14..16)?;
    let second = num(17..19)?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
        return None;
    }

    let mut rest = &raw[19..];
    let mut millis = 0_i64;
    if let Some(fraction) = rest.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            return None;
        }
        // Keep millisecond precision; pad short fractions ("5" means 500 ms).
        let mut ms_text: String = fraction[..digits].chars().take(3).collect();
        while ms_text.len() < 3 {
            ms_text.push('0');
        }
        millis = ms_text.parse().ok()?;
        rest = &fraction[digits..];
    }

    let offset_minutes = match rest {
        "" | "Z" | "z" => 0,
        _ => {
            let sign = match rest.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let body = rest[1..].replace(':', "");
            if body.len() != 4 {
                return None;
            }
            let hours: i64 = body[..2].parse().ok()?;
            let mins: i64 = body[2..].parse().ok()?;
            sign * (hours * 60 + mins)
        }
    };

    let days = days_from_civil(year, month, day);
    let seconds = days * 86_400 + hour * 3600 + minute * 60 + second - offset_minutes * 60;
    Some(seconds * 1000 + millis)
}

/// `HH:MM` wall-clock time for epoch ms, shifted by the viewer's UTC offset.
///
/// `offset_minutes` follows the ISO sign convention (IST is `+330`), which is
/// the negation of JavaScript's `Date#getTimezoneOffset`.
pub fn format_clock(ms: i64, offset_minutes: i64) -> String {
    let local = ms + offset_minutes * 60_000;
    let rem = local.rem_euclid(MS_PER_DAY);
    format!("{:02}:{:02}", rem / 3_600_000, (rem / 60_000) % 60)
}

/// Compact duration such as `45s`, `12m`, or `1h 05m`.
pub fn format_duration(ms: i64) -> String {
    let total_seconds = ms.max(0) / 1000;
    if total_seconds < 60 {
        return format!("{total_seconds}s");
    }
    let minutes = total_seconds / 60;
    if minutes < 60 {
        return format!("{minutes}m");
    }
    format!("{}h {:02}m", minutes / 60, minutes % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_utc_timestamps() {
        let ms = 1_794_312_896_789; // 2026-11-10T12:14:56.789Z
        let iso = format_iso_utc(ms);
        assert_eq!(iso, "2026-11-10T12:14:56.789Z");
        assert_eq!(parse_iso_ms(&iso), Some(ms));
    }

    #[test]
    fn parses_activitywatch_offsets_and_fractions() {
        assert_eq!(
            parse_iso_ms("2026-11-10T12:14:56.789000+00:00"),
            Some(1_794_312_896_789)
        );
        assert_eq!(
            parse_iso_ms("2026-11-10T17:44:56+05:30"),
            Some(1_794_312_896_000)
        );
        assert_eq!(
            parse_iso_ms("2026-11-10T12:14:56.5Z"),
            Some(1_794_312_896_500)
        );
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
    }

    #[test]
    fn rejects_malformed_timestamps() {
        assert_eq!(parse_iso_ms(""), None);
        assert_eq!(parse_iso_ms("2026-13-10T12:14:56Z"), None);
        assert_eq!(parse_iso_ms("2026-11-10 12:14"), None);
        assert_eq!(parse_iso_ms("2026-11-10T12:14:56+0"), None);
        assert_eq!(parse_iso_ms("2026-11-10T12:14:56.Z"), None);
    }

    #[test]
    fn formats_clock_in_local_offset() {
        let ms = parse_iso_ms("2026-11-10T23:50:00Z").unwrap();
        assert_eq!(format_clock(ms, 0), "23:50");
        assert_eq!(format_clock(ms, 330), "05:20");
        assert_eq!(format_clock(ms, -480), "15:50");
    }

    #[test]
    fn formats_durations_compactly() {
        assert_eq!(format_duration(-5), "0s");
        assert_eq!(format_duration(45_000), "45s");
        assert_eq!(format_duration(12 * 60_000), "12m");
        assert_eq!(format_duration(65 * 60_000), "1h 05m");
    }
}
