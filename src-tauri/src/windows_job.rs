use std::ffi::c_void;
use std::io;
use std::os::windows::io::RawHandle;

type Bool = i32;
type Dword = u32;
type Handle = RawHandle;

#[link(name = "kernel32")]
extern "system" {
    fn AssignProcessToJobObject(job: Handle, process: Handle) -> Bool;
    fn CloseHandle(handle: Handle) -> Bool;
    fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> Handle;
    fn TerminateJobObject(job: Handle, exit_code: Dword) -> Bool;
}

pub(crate) struct JobObject(Handle);

// A Job Object handle is an owned kernel handle and may be moved to the Tokio
// task that owns the child process. Windows synchronizes operations on it.
unsafe impl Send for JobObject {}
unsafe impl Sync for JobObject {}

impl JobObject {
    pub(crate) fn attach(child: &tokio::process::Child) -> io::Result<Self> {
        let process = child
            .raw_handle()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "脚本进程已结束。"))?;
        let job = unsafe { CreateJobObjectW(std::ptr::null_mut(), std::ptr::null()) };
        if job.is_null() {
            return Err(io::Error::last_os_error());
        }

        let assigned = unsafe { AssignProcessToJobObject(job, process as Handle) != 0 };
        if !assigned {
            let error = io::Error::last_os_error();
            unsafe {
                CloseHandle(job);
            }
            return Err(error);
        }

        Ok(Self(job))
    }

    pub(crate) fn terminate(&self) -> bool {
        unsafe { TerminateJobObject(self.0, 1) != 0 }
    }
}

impl Drop for JobObject {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
