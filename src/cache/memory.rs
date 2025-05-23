use std::{hash::Hash, sync::Mutex};

use lru::LruCache;

use crate::image::{ImageOutput, ProcessOptions};

pub struct MemoryCache {
    mu: Mutex<Inner>,
}

impl MemoryCache {
    pub fn new(max_bytes: usize) -> Self {
        assert!(
            max_bytes > 0,
            "maximum bytes for memory cache must be greater than 0"
        );
        MemoryCache {
            mu: Mutex::new(Inner {
                lru: LruCache::unbounded(),
                max: max_bytes,
                size: 0,
            }),
        }
    }

    pub fn get(&self, input: &str, options: ProcessOptions) -> Option<ImageOutput> {
        let input = input.to_owned();
        self.mu
            .lock()
            .unwrap()
            .lru
            .get(&Key { input, options })
            .map(ToOwned::to_owned)
    }

    pub fn set(&self, input: &str, options: ProcessOptions, output: ImageOutput) {
        let input = input.to_owned();
        let mut guard = self.mu.lock().unwrap();
        guard.size += output.buf.len();
        if let Some(val) = guard.lru.put(Key { input, options }, output) {
            guard.size = guard
                .size
                .checked_sub(val.buf.len())
                .expect("overflow replacing item in memory lru");
        }
        while guard.size > guard.max {
            match guard.lru.pop_lru() {
                Some((_, val)) => {
                    guard.size = guard
                        .size
                        .checked_sub(val.buf.len())
                        .expect("overflow removing from memory lru");
                }
                _ => {
                    return;
                }
            }
        }
    }
}

struct Inner {
    lru: LruCache<Key, ImageOutput>,
    max: usize,
    size: usize,
}

#[derive(Eq, Hash, PartialEq)]
struct Key {
    input: String,
    options: ProcessOptions,
}
