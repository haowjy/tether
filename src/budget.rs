//! The startup memory budget and its three user-visible caps (daemon-core.md §6).
//! Linux cgroup files are advisory: odd or unavailable files fall back to config.

use std::error::Error;
use std::fmt;

use tracing::{info, warn};

const MIB: u64 = 1 << 20;
pub const MINIMUM_MIB: u64 = 42;
/// Fixed HTTP accept backstop, included in the ceiling and used by `http::server`.
pub const ACCEPTED_CONNECTIONS: usize = 64;

/// The only memory-dependent daemon caps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caps {
    pub control_clients: usize,
    pub sockets: usize,
    pub completion: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tier {
    pub minimum_mib: u64,
    pub label: &'static str,
    pub caps: Caps,
}

/// Kept in round MiB bands from the approved resource-limits design.
pub const TIERS: [Tier; 5] = [
    Tier {
        minimum_mib: 72,
        label: "72+",
        caps: Caps {
            control_clients: 3,
            sockets: 3,
            completion: true,
        },
    },
    Tier {
        minimum_mib: 64,
        label: "64–71",
        caps: Caps {
            control_clients: 2,
            sockets: 3,
            completion: true,
        },
    },
    Tier {
        minimum_mib: 58,
        label: "58–63",
        caps: Caps {
            control_clients: 1,
            sockets: 3,
            completion: true,
        },
    },
    Tier {
        minimum_mib: 53,
        label: "53–57",
        caps: Caps {
            control_clients: 1,
            sockets: 2,
            completion: true,
        },
    },
    Tier {
        minimum_mib: 42,
        label: "42–52",
        caps: Caps {
            control_clients: 1,
            sockets: 2,
            completion: false,
        },
    },
];

pub const DEFAULT_CAPS: Caps = TIERS[0].caps;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BelowMinimum {
    pub effective_mib: u64,
    pub configured_mib: u64,
    pub unit_limit_mib: Option<u64>,
}

impl fmt::Display for BelowMinimum {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let unit = self
            .unit_limit_mib
            .map_or_else(|| "none".to_owned(), |mib| format!("{mib} MiB"));
        write!(
            f,
            "memory budget {} MiB (config {} MiB, unit {unit}) is below the minimum of {MINIMUM_MIB} MiB",
            self.effective_mib, self.configured_mib
        )
    }
}

impl Error for BelowMinimum {}

/// Reads cgroup v2, selects the lower budget and logs the chosen caps.
pub fn resolve(configured_mib: u64) -> Result<&'static Tier, BelowMinimum> {
    let cgroup = read_cgroup();
    let unit_limit_mib = cgroup
        .as_ref()
        .and_then(|limits| limits.memory_max_bytes)
        .map(|bytes| bytes / MIB);
    let effective_mib = unit_limit_mib.map_or(configured_mib, |limit| limit.min(configured_mib));
    if effective_mib < MINIMUM_MIB {
        return Err(BelowMinimum {
            effective_mib,
            configured_mib,
            unit_limit_mib,
        });
    }
    let tier = TIERS
        .iter()
        .find(|tier| effective_mib >= tier.minimum_mib)
        .expect("the minimum budget has a tier");
    match unit_limit_mib {
        Some(limit) if limit < configured_mib => {
            warn!(
                config_mib = configured_mib,
                unit_mib = limit,
                effective_mib,
                "the cgroup memory limit is below the configured budget; it governs"
            );
        }
        Some(limit) if limit > configured_mib => {
            info!(
                config_mib = configured_mib,
                unit_mib = limit,
                "the configured memory budget is below the cgroup memory limit; it governs"
            );
        }
        None if std::env::var_os("INVOCATION_ID").is_some() => {
            warn!("no cgroup memory limit is in force; the budget alone sizes the caps");
        }
        _ => {}
    }

    if let Some(high) = cgroup.and_then(|limits| limits.memory_high_bytes) {
        let warning_line = effective_mib.saturating_sub(4).saturating_mul(MIB);
        if high < warning_line {
            warn!(
                memory_high_mib = high / MIB,
                effective_mib, "MemoryHigh is below what tether may hold at its caps; remove it"
            );
        }
    }
    info!(
        configured_mib,
        unit_limit_mib = ?unit_limit_mib,
        effective_mib,
        tier = tier.label,
        control_clients = tier.caps.control_clients,
        sockets = tier.caps.sockets,
        completion = tier.caps.completion,
        "memory budget and caps"
    );
    Ok(tier)
}

#[derive(Debug, Default)]
struct CgroupLimits {
    memory_max_bytes: Option<u64>,
    memory_high_bytes: Option<u64>,
}

#[cfg(target_os = "linux")]
fn read_cgroup() -> Option<CgroupLimits> {
    use std::fs;
    use std::path::Path;

    const MOUNTINFO: &str = "/proc/self/mountinfo";
    const CGROUP: &str = "/proc/self/cgroup";

    let mountinfo = match fs::read_to_string(MOUNTINFO) {
        Ok(text) => text,
        Err(error) => {
            warn!(file = MOUNTINFO, %error, "can't inspect the cgroup mount; using the configured memory budget");
            return None;
        }
    };
    let Some((mount_root, mount_point)) = cgroup2_mount(&mountinfo) else {
        warn!(
            file = MOUNTINFO,
            "no cgroup2 mount found; using the configured memory budget"
        );
        return None;
    };
    let membership = match fs::read_to_string(CGROUP) {
        Ok(text) => text,
        Err(error) => {
            warn!(file = CGROUP, %error, "can't inspect cgroup membership; using the configured memory budget");
            return None;
        }
    };
    let Some(path) = membership.lines().find_map(|line| line.strip_prefix("0::")) else {
        warn!(
            file = CGROUP,
            "no unified cgroup membership found; using the configured memory budget"
        );
        return None;
    };
    let path = Path::new(path);
    let relative = match path.strip_prefix(&mount_root) {
        Ok(path) => path,
        Err(_) => {
            warn!(
                file = CGROUP,
                "cgroup membership is outside the cgroup2 mount; using the configured memory budget"
            );
            return None;
        }
    };
    let directory = mount_point.join(relative);
    let mut limits = CgroupLimits::default();
    let mut current = directory;
    loop {
        for (name, slot) in [
            ("memory.max", &mut limits.memory_max_bytes),
            ("memory.high", &mut limits.memory_high_bytes),
        ] {
            let file = current.join(name);
            match fs::read_to_string(&file) {
                Ok(text) => match parse_cgroup_limit(&text) {
                    Some(Some(limit)) => {
                        *slot = Some(slot.map_or(limit, |old| old.min(limit)));
                    }
                    Some(None) => {}
                    None => {
                        warn!(file = %file.display(), "unparsable cgroup limit; using the configured memory budget");
                        return None;
                    }
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    warn!(file = %file.display(), %error, "can't read cgroup limit; treating this level as unlimited")
                }
            }
        }
        if current == mount_point {
            break;
        }
        let Some(parent) = current.parent() else {
            warn!(
                file = CGROUP,
                "cgroup path escaped its mount; using the configured memory budget"
            );
            return None;
        };
        if !parent.starts_with(&mount_point) {
            warn!(
                file = CGROUP,
                "cgroup path escaped its mount; using the configured memory budget"
            );
            return None;
        }
        current = parent.to_owned();
    }
    Some(limits)
}

#[cfg(target_os = "linux")]
fn cgroup2_mount(text: &str) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    for line in text.lines() {
        let Some((mount, filesystem)) = line.split_once(" - ") else {
            continue;
        };
        if filesystem.split_whitespace().next() != Some("cgroup2") {
            continue;
        }
        let fields: Vec<_> = mount.split_whitespace().collect();
        let root = fields.get(3).and_then(|field| unescape_mountinfo(field))?;
        let point = fields.get(4).and_then(|field| unescape_mountinfo(field))?;
        return Some((root, point));
    }
    None
}

#[cfg(target_os = "linux")]
fn unescape_mountinfo(field: &str) -> Option<std::path::PathBuf> {
    use std::os::unix::ffi::OsStringExt as _;

    let bytes = field.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] == b'\\' {
            let octal = bytes.get(cursor + 1..cursor + 4)?;
            if !octal.iter().all(|digit| (b'0'..=b'7').contains(digit)) {
                return None;
            }
            let value = u16::from(octal[0] - b'0') * 64
                + u16::from(octal[1] - b'0') * 8
                + u16::from(octal[2] - b'0');
            decoded.push(u8::try_from(value).ok()?);
            cursor += 4;
        } else {
            decoded.push(bytes[cursor]);
            cursor += 1;
        }
    }
    Some(std::path::PathBuf::from(std::ffi::OsString::from_vec(
        decoded,
    )))
}

#[cfg(not(target_os = "linux"))]
fn read_cgroup() -> Option<CgroupLimits> {
    None
}

/// `max` is unlimited; a number is a byte count. `None` means malformed.
#[cfg(target_os = "linux")]
fn parse_cgroup_limit(text: &str) -> Option<Option<u64>> {
    match text.trim() {
        "max" => Some(None),
        value => value.parse::<u64>().ok().map(Some),
    }
}

#[cfg(test)]
mod tests {
    use super::{ACCEPTED_CONNECTIONS, MIB, TIERS, Tier};

    const KIB: u64 = 1 << 10;
    const HEADROOM_KIB: u64 = 4 * KIB;
    // Table rows are rounded separately to tenths of a MiB; cost entries round up to KiB.
    const PUBLISHED_ROUNDING_KIB: u64 = 150;
    const FIXED_KIB: [(&str, u64); 10] = [
        ("daemon", 5 * KIB),
        ("one-shot tmux", 5_018),
        ("tmux chunks", 2 * KIB),
        ("file API", 3_584),
        ("kernel socket buffers", 3 * 256),
        ("capture replies", 2 * MIB / KIB),
        ("paste files", MIB / KIB),
        ("raw responses", MIB / KIB),
        ("shell slots: kernel buffers", MIB / KIB),
        ("LocalAPI answers and parse", 308), // 0.3 MiB, rounded up to KiB.
    ];
    const PER_CAP_KIB: [(&str, u64); 4] = [
        ("unupgraded HTTP connection", 36),
        ("control client", 5_428),
        ("socket", 4_414),
        ("completion", 11_572),
    ];
    const SPEC_CEILINGS_TENTHS_MIB: [u64; 5] = [636, 583, 530, 488, 375];

    fn ceiling_kib(tier: &Tier) -> u64 {
        let fixed = FIXED_KIB.iter().map(|(_, kib)| kib).sum::<u64>();
        let [
            (_, http_connection),
            (_, control_client),
            (_, socket),
            (_, completion),
        ] = PER_CAP_KIB;
        let unupgraded = (ACCEPTED_CONNECTIONS - tier.caps.sockets) as u64 * http_connection;
        fixed
            + unupgraded
            + tier.caps.control_clients as u64 * control_client
            + tier.caps.sockets as u64 * socket
            + u64::from(tier.caps.completion) * completion
    }

    fn published_ceilings_tenths_mib() -> [u64; 5] {
        let paragraph = include_str!("../docs/design/daemon-core.md")
            .split("By tier, the unreclaimable ceiling is ")
            .nth(1)
            .and_then(|rest| rest.split(". Each plus").next())
            .expect("daemon-core.md publishes per-tier ceilings");
        let mut outside_ranges = String::new();
        let mut in_range = false;
        for character in paragraph.chars() {
            match character {
                '(' => in_range = true,
                ')' => in_range = false,
                _ if !in_range => outside_ranges.push(character),
                _ => {}
            }
        }
        let values = outside_ranges
            .split(|character: char| !(character.is_ascii_digit() || character == '.'))
            .filter(|part| !part.is_empty())
            .map(|part| {
                let (whole, tenths) = part.split_once('.').expect("ceiling uses one decimal");
                whole.parse::<u64>().expect("whole MiB") * 10
                    + tenths.parse::<u64>().expect("tenths of MiB")
            })
            .collect::<Vec<_>>();
        values
            .try_into()
            .expect("daemon-core.md publishes five tier ceilings")
    }

    #[test]
    fn published_tier_ceilings_match_the_spec() {
        let published = published_ceilings_tenths_mib();
        assert_eq!(published, SPEC_CEILINGS_TENTHS_MIB);
        for (tier, published_tenths_mib) in TIERS.iter().zip(published) {
            let computed_tenths_kib = ceiling_kib(tier) * 10;
            let published_tenths_kib = published_tenths_mib * KIB;
            assert!(
                computed_tenths_kib.abs_diff(published_tenths_kib) <= PUBLISHED_ROUNDING_KIB * 10,
                "{} ceiling differs from its published value by more than {} KiB",
                tier.label,
                PUBLISHED_ROUNDING_KIB
            );
        }
    }

    #[test]
    fn each_tier_ceiling_plus_headroom_fits_only_its_range() {
        for (index, tier) in TIERS.iter().enumerate() {
            let budget_kib = tier.minimum_mib * KIB;
            let ceiling = ceiling_kib(tier);
            assert!(
                ceiling + HEADROOM_KIB <= budget_kib,
                "{} ceiling {ceiling} KiB plus headroom exceeds {} MiB",
                tier.label,
                tier.minimum_mib
            );

            if let Some(higher) = index.checked_sub(1).map(|higher| &TIERS[higher]) {
                let higher_ceiling = ceiling_kib(higher);
                assert!(
                    higher_ceiling + HEADROOM_KIB > budget_kib,
                    "{} caps unexpectedly fit in the {} MiB tier",
                    higher.label,
                    tier.minimum_mib
                );
            }
        }
    }
}
