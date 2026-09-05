use std::ffi::c_void;
use std::io;
use std::mem::size_of;
use std::os::windows::io::RawHandle;

type Bool = i32;
type Dword = u32;
type Handle = RawHandle;

const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: Dword = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: Dword = 0x0000_2000;

#[repr(C)]
struct JobObjectBasicLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: Dword,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: Dword,
    affinity: usize,
    priority_class: Dword,
    scheduling_class: Dword,
}

#[repr(C)]
struct IoCounters {
    counters: [u64; 6],
}

#[repr(C)]
struct JobObjectExtendedLimitInformation {
    basic_limit_information: JobObjectBasicLimitInformation,
    io_info: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[link(name = "kernel32")]
extern "system" {
    fn AssignProcessToJobObject(job: Handle, process: Handle) -> Bool;
    fn CloseHandle(handle: Handle) -> Bool;
    fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> Handle;
    fn SetInformationJobObject(
        job: Handle,
        info_class: Dword,
        info: *mut c_void,
        info_len: Dword,
    ) -> Bool;
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

        let job = Self(job);
        if let Err(error) = job.set_kill_on_close(true) {
            drop(job);
            return Err(error);
        }

        let assigned = unsafe { AssignProcessToJobObject(job.0, process as Handle) != 0 };
        if !assigned {
            let error = io::Error::last_os_error();
            drop(job);
            return Err(error);
        }

        Ok(job)
    }

    pub(crate) fn terminate(&self) -> bool {
        unsafe { TerminateJobObject(self.0, 1) != 0 }
    }

    /// Job Object is only used as a failure cleanup boundary. Successful script
    /// completion intentionally releases kill-on-close to preserve existing detached
    /// process behavior.
    pub(crate) fn preserve_processes(&self) -> io::Result<()> {
        self.set_kill_on_close(false)
    }

    fn set_kill_on_close(&self, enabled: bool) -> io::Result<()> {
        let mut limits = JobObjectExtendedLimitInformation {
            basic_limit_information: JobObjectBasicLimitInformation {
                per_process_user_time_limit: 0,
                per_job_user_time_limit: 0,
                limit_flags: if enabled {
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                } else {
                    0
                },
                minimum_working_set_size: 0,
                maximum_working_set_size: 0,
                active_process_limit: 0,
                affinity: 0,
                priority_class: 0,
                scheduling_class: 0,
            },
            io_info: IoCounters { counters: [0; 6] },
            process_memory_limit: 0,
            job_memory_limit: 0,
            peak_process_memory_used: 0,
            peak_job_memory_used: 0,
        };
        let updated = unsafe {
            SetInformationJobObject(
                self.0,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                &mut limits as *mut JobObjectExtendedLimitInformation as *mut c_void,
                size_of::<JobObjectExtendedLimitInformation>() as Dword,
            ) != 0
        };
        if updated {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
}

impl Drop for JobObject {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
