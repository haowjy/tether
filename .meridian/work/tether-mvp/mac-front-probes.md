# Mac front: probe results for option B (p171, 2026-10-24)

Run as Jimmy (uid 501, admin) on macOS 27.0.1, Tailscale 1.104.2 macsys. Scripts in
`/tmp/tether-meridian-501/macdesign-b/`. Serve config was `{}` before and after.

| Question | Result |
|---|---|
| macsys LocalAPI reachable without sudo | `readlink /Library/Tailscale/ipnport` = 55844; `sameuserproof-55844` is `root:admin 0640`, 20-char token. `GET /localapi/v0/status?peers=false` and `/serve-config` with Basic `:<token>`, `Host: local-tailscaled.sock` → 200 in <1 ms |
| Can the proof token write serve-config | **Yes.** `GET /serve-config` returns `Etag`. `POST /serve-config` with `If-Match: <etag>` → 200 and `tailscale serve status` shows the entry; `If-Match: deadbeef` → `412 etag mismatch`. No `Sec-Tailscale` header needed |
| When is the target URL logged | At the **write**, not at first request: `serve: creating a new proxy handler for http://127.0.0.1:18999/probe-p171-secret` (Default level, persisted, process `io.tailscale.ipn.macsys.network-extension`). Removing it logs `serve: closing idle connections to http://127.0.0.1:18999/probe-p171-secret`. The extension also stores the config in the keychain (`tailscale-serve/<profile>`) |
| Who can read the unified log | `/usr/bin/log` refuses non-admins ("Must be admin to run '%s' command"); `/private/var/db/diagnostics` is `root:admin 0750` |
| Admin group on this Mac | `root jimmyyao _mbsetupuser` |
| Port sharing while tether listens on 127.0.0.1:P (SO_REUSEADDR, as tokio) | Same uid: a second bind of `127.0.0.1:P` fails with every REUSEADDR/REUSEPORT combination. A wildcard `0.0.0.0:P` bind with REUSEADDR or REUSEPORT **succeeds**, but connections to 127.0.0.1:P still go to the specific listener. So a squatter can pre-position on `0.0.0.0:P` and receive Serve's connections the moment tether stops. Cross-uid not tested (no second account) |
| Upstream discovery (safesocket_darwin.go, v1.104.2) | macsys: `ipnport` symlink + `sameuserproof-<port>`. App Store: `lsof -n -a -u<uid> -c IPNExtension -F`, parse `.tailscale.ipn.macos/sameuserproof-<port>-<token>` from the open-file names. The CLI tries App Store first, then macsys |
| launchd socket activation (gui-domain LaunchAgent, `Sockets.Listener` on `127.0.0.1:18777`, Python `launch_activate_socket` via ctypes) | `rc 0`, 1 fd, bound `127.0.0.1:18777`; `TMPDIR` set to the per-user temp dir. After `kill -9` of the job, binding `127.0.0.1:18777` and `0.0.0.0:18777` with `SO_REUSEADDR`+`SO_REUSEPORT` both fail (`EADDRINUSE`); the next connection waited ~10 s (launchd throttle) and was answered by a relaunched process. After `launchctl bootout`, the port stayed unbindable for several seconds, then freed. `lsof` as Jimmy shows no listener (launchd's socket is root's). The LaunchDaemon-with-`UserName` variant was not tried (needs sudo) |

## Follow-up probes for Jimmy's answers (2026-10-24)

| Question | Result |
|---|---|
| Can tether see `TS_NO_LOGS_NO_SUPPORT`? | **No reliable way.** Source at v1.104.2: the flag reaches LocalAPI only in `serveBugReport` (`ipn/localapi/localapi.go:409`, a marker `BUG-NO-LOGS-NO-SUPPORT-…`, from a POST that logs and flushes a bug report) and in `Hostinfo.NoLogsNoSupport` (`hostinfo/hostinfo.go:66`). Status has no `Hostinfo`; whois of the Mac's own address returns a self `Hostinfo` with only `Hostname` and `Services` (probed); the netmap bus option is obsolete. `/private/var/root` is `root:wheel 0750`, so Jimmy can't read the env file |
| Cost of the opt-out | No log-based support; a tailnet whose netmap has the data-plane audit-log capability sets `WantRunning=false` with "tailnet requires logging to be enabled" (`ipn/ipnlocal/local.go:2048`) |
| Port held by another process when the agent loads (p177) | A process listening on `127.0.0.1:47999`, then `launchctl bootstrap` of an agent whose `Sockets.Listener` names that port: bootstrap returns 0, the job runs, `launch_activate_socket` returns rc 0 with 1 fd whose `getsockname` is `('0.0.0.0', 0)`, unbound and not listening; `curl 127.0.0.1:47999` reaches the other process |
| Local launchd module (p175) | Under a gui-domain LaunchAgent: 1 fd at `127.0.0.1:47851`, CLOEXEC and blocking; second call `EALREADY` (37); outside launchd `ESRCH` (3); a name missing from the plist also `ESRCH`. Builds on 1.85, edition 2024. raunch 1.0.1 returns `Vec<RawFd>`; converting needs `unsafe` in the caller (rejected under `forbid`) |

The module p175 ran (add a `// SAFETY:` comment to the `free` block when porting):

```rust
//! launchd socket activation: the one `unsafe` in tether.
#![allow(unsafe_code)]

use std::ffi::CString;
use std::io;
use std::os::fd::{FromRawFd as _, OwnedFd};

unsafe extern "C" {
    // libSystem; see launch(3). On success `*fds` is a malloc'd array of `*cnt` fds the caller owns.
    fn launch_activate_socket(name: *const libc::c_char, fds: *mut *mut libc::c_int, cnt: *mut libc::size_t) -> libc::c_int;
}

/// Takes the fds launchd holds for the plist's `Sockets` entry `name`. Callable once per process
/// lifetime per name (`EALREADY` after); `ESRCH`/`ENOENT` when not launchd-managed or no such entry.
pub fn activate_socket(name: &str) -> io::Result<Vec<OwnedFd>> {
    let name = CString::new(name).map_err(|_| io::ErrorKind::InvalidInput)?;
    let (mut fds, mut cnt) = (std::ptr::null_mut(), 0);
    // SAFETY: valid C string and out-pointers; launchd writes them only on success.
    let err = unsafe { launch_activate_socket(name.as_ptr(), &mut fds, &mut cnt) };
    if err != 0 {
        return Err(io::Error::from_raw_os_error(err));
    }
    if fds.is_null() {
        return Ok(Vec::new());
    }
    // SAFETY: launchd hands over `cnt` open fds that nothing else in this process owns, in an
    // array we must free(3).
    let owned = unsafe { std::slice::from_raw_parts(fds, cnt) }.iter().map(|&fd| unsafe { OwnedFd::from_raw_fd(fd) }).collect();
    unsafe { libc::free(fds.cast()) };
    Ok(owned)
}
```
