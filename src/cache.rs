use std::{hash::Hash, sync::Mutex};

use lru::LruCache;

use crate::image::{ImageOutput, ProcessOptions};

pub struct Cache {
    mu: Mutex<Inner>,
}

impl Cache {
    pub fn new(max_bytes: usize) -> Self {
        Cache {
            mu: Mutex::new(Inner {
                lru: LruCache::unbounded(),
                max: max_bytes,
                size: 0,
            }),
        }
    }

    pub fn get(&self, input: String, options: ProcessOptions) -> Option<ImageOutput> {
        self.mu
            .lock()
            .unwrap()
            .lru
            .get(&Key { input, options })
            .map(|v| v.to_owned())
    }

    pub fn set(&self, input: String, options: ProcessOptions, output: ImageOutput) {
        let mut guard = self.mu.lock().unwrap();
        guard.size += output.buf.len();
        if let Some((_, val)) = guard.lru.push(Key { input, options }, output) {
            guard.size -= val.buf.len();
        }
        while guard.size > guard.max {
            if let Some((_, val)) = guard.lru.pop_lru() {
                guard.size -= val.buf.len();
            } else {
                return;
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
