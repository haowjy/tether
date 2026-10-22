//! Pure, apart from drawing random bytes: device tokens, enrolment codes, host ids,
//! their hashes, and the constant-time scan (auth.md "Constants", "The device token").

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};
use subtle::{ConditionallySelectable, ConstantTimeEq};

use super::store::Device;

/// Makes a leaked token recognisable in logs, pastes and secret scanners.
pub const TOKEN_PREFIX: &str = "tether_";

pub type Hash = [u8; 32];

const CROCKFORD: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BASE32_LOWER: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";

/// `tether_` and base64url, unpadded, of 32 random bytes.
pub fn generate() -> Result<String, getrandom::Error> {
    let bytes: [u8; 32] = random()?;
    Ok(format!("{TOKEN_PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes)))
}

/// A new enrolment code, shown as `XXXX-XXXX`: 8 Crockford base32 characters.
pub fn new_code() -> Result<String, getrandom::Error> {
    let bytes: [u8; 5] = random()?;
    let code = base32(&bytes, CROCKFORD);
    Ok(format!("{}-{}", &code[..4], &code[4..]))
}

/// What was typed, as the code was printed: uppercase, without `-` or spaces, with
/// the letters people mistake for digits read as those digits.
pub fn normalize_code(code: &str) -> String {
    code.chars()
        .filter(|c| *c != '-' && !c.is_whitespace())
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        })
        .collect()
}

/// 10 random bytes, lowercase base32: 16 characters.
pub fn host_id() -> Result<String, getrandom::Error> {
    let bytes: [u8; 10] = random()?;
    Ok(base32(&bytes, BASE32_LOWER))
}

pub fn is_host_id(text: &str) -> bool {
    text.len() == 16 && text.bytes().all(|b| BASE32_LOWER.contains(&b))
}

pub fn hash(text: &str) -> Hash {
    Sha256::digest(text.as_bytes()).into()
}

pub fn hex(hash: &Hash) -> String {
    hash.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn unhex(text: &str) -> Option<Hash> {
    let mut hash = [0; 32];
    if text.len() != 64 {
        return None;
    }
    for (at, byte) in hash.iter_mut().enumerate() {
        *byte = u8::from_str_radix(text.get(at * 2..at * 2 + 2)?, 16).ok()?;
    }
    Some(hash)
}

/// Whether `stored` (hex, from the file) is `hash`, in constant time.
pub fn matches(stored: &str, hash: &Hash) -> bool {
    unhex(stored).is_some_and(|stored| bool::from(stored.ct_eq(hash)))
}

/// The device whose token hashes to `hash`. Compares every device in constant time
/// and never stops early, so the time taken says nothing about which hash matched.
pub fn find<'a>(devices: &'a [Device], hash: &Hash) -> Option<&'a Device> {
    let mut found = 0u64;
    for (at, device) in devices.iter().enumerate() {
        let stored = unhex(&device.token_sha256);
        let valid = subtle::Choice::from(u8::from(stored.is_some()));
        let equal = stored.unwrap_or_default().ct_eq(hash) & valid;
        found.conditional_assign(&(at as u64 + 1), equal);
    }
    let at = usize::try_from(found.checked_sub(1)?).ok()?;
    devices.get(at)
}

fn random<const N: usize>() -> Result<[u8; N], getrandom::Error> {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes)?;
    Ok(bytes)
}

/// `bytes` is a whole number of 5-bit groups (5 or 10 bytes here).
fn base32(bytes: &[u8], alphabet: &[u8; 32]) -> String {
    let mut out = String::with_capacity(bytes.len() * 8 / 5);
    let (mut buffer, mut bits) = (0u16, 0);
    for &byte in bytes {
        buffer = (buffer << 8) | u16::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(char::from(alphabet[usize::from((buffer >> bits) & 31)]));
        }
    }
    out
}
