//! launchd socket activation: the one `unsafe` module in tether.
#![allow(unsafe_code)]

use std::ffi::CString;
use std::io;
use std::os::fd::{FromRawFd as _, OwnedFd};

unsafe extern "C" {
    // SAFETY: launch(3) declares this libSystem function; successful calls transfer
    // ownership of a malloc'd fd array to the caller.
    fn launch_activate_socket(
        name: *const libc::c_char,
        fds: *mut *mut libc::c_int,
        count: *mut libc::size_t,
    ) -> libc::c_int;
}

struct FdArray(*mut libc::c_int);

impl Drop for FdArray {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: `launch_activate_socket` returned this malloc'd array and this
            // guard is its sole owner.
            unsafe { libc::free(self.0.cast()) };
        }
    }
}

/// Takes the fds launchd holds for the plist's `Sockets` entry `name`.
pub fn activate_socket(name: &str) -> io::Result<Vec<OwnedFd>> {
    let name =
        CString::new(name).map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    let (mut fds, mut count) = (std::ptr::null_mut(), 0);
    // SAFETY: `name` is a valid nul-terminated string, and both out-pointers refer
    // to initialized writable storage for the duration of the call.
    let error = unsafe { launch_activate_socket(name.as_ptr(), &mut fds, &mut count) };
    if error != 0 {
        return Err(io::Error::from_raw_os_error(error));
    }
    if fds.is_null() {
        return Ok(Vec::new());
    }
    let array = FdArray(fds);
    // SAFETY: launchd guarantees that a non-null successful result points to `count`
    // valid descriptors in its malloc'd array.
    let descriptors = unsafe { std::slice::from_raw_parts(array.0, count) };
    let mut owned = Vec::with_capacity(count);
    for descriptor in descriptors {
        // SAFETY: launchd transfers each descriptor exactly once, and this loop
        // wraps every transferred fd in its unique RAII owner.
        owned.push(unsafe { OwnedFd::from_raw_fd(*descriptor) });
    }
    drop(array);
    Ok(owned)
}
