use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use thiserror::Error;

const WORKER_BITS: u64 = 10;
const SEQUENCE_BITS: u64 = 12;
const MAX_WORKER_ID: i64 = (1 << WORKER_BITS) - 1;
const MAX_SEQUENCE: i64 = (1 << SEQUENCE_BITS) - 1;
const TIMESTAMP_SHIFT: u64 = WORKER_BITS + SEQUENCE_BITS;
const WORKER_SHIFT: u64 = SEQUENCE_BITS;
const EPOCH_MILLISECOND: i64 = 1_704_067_200_000; // 2024-01-01 UTC

#[derive(Debug, Error)]
pub enum IdGenError {
    #[error("idgen: worker id out of range")]
    WorkerIdOutOfRange,
    #[error("idgen: clock moved backwards")]
    ClockBackwards,
}

/// Snowflake 签发全局唯一 ID（与 Go ftp-service / ssh-service idgen 位布局一致）。
pub struct Snowflake {
    worker_id: i64,
    last_milli: AtomicI64,
    sequence: Mutex<i64>,
}

impl Snowflake {
    pub fn new(worker_id: i64) -> Result<Self, IdGenError> {
        if !(0..=MAX_WORKER_ID).contains(&worker_id) {
            return Err(IdGenError::WorkerIdOutOfRange);
        }
        Ok(Self {
            worker_id,
            last_milli: AtomicI64::new(0),
            sequence: Mutex::new(0),
        })
    }

    pub fn next_id(&self) -> Result<i64, IdGenError> {
        let now = now_millis();
        let mut last = self.last_milli.load(Ordering::Acquire);
        if now < last {
            return Err(IdGenError::ClockBackwards);
        }

        let mut seq_guard = self.sequence.lock().unwrap();
        let mut sequence = *seq_guard;
        if now == last {
            sequence = (sequence + 1) & MAX_SEQUENCE;
            if sequence == 0 {
                let mut spin = now;
                while spin <= last {
                    spin = now_millis();
                }
                last = spin;
                self.last_milli.store(last, Ordering::Release);
            }
        } else {
            sequence = 0;
            last = now;
            self.last_milli.store(last, Ordering::Release);
        }
        *seq_guard = sequence;

        let id = ((last - EPOCH_MILLISECOND) << TIMESTAMP_SHIFT)
            | (self.worker_id << WORKER_SHIFT)
            | sequence;
        Ok(id)
    }

    pub fn next_string(&self) -> Result<String, IdGenError> {
        Ok(self.next_id()?.to_string())
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis() as i64
}
