use std::{
    fs::{File, Metadata, OpenOptions},
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, SystemTime},
};

use anyhow::{anyhow, Result};
use blake3::{Hash, Hasher};
use bytes::Bytes;
use rand::{seq::IteratorRandom, Rng};
use serde::Serialize;
use tokio::{sync::Semaphore, task, time};
use walkdir::{DirEntry, WalkDir};

use crate::image::{ImageOutput, ProcessOptions};

#[derive(Clone)]
pub struct DiskCache {
    inner: Arc<Inner>,
}

struct Inner {
    dir: PathBuf,
    sema: Semaphore,
    max_size: u64,
    cur_size: AtomicU64,
}

impl DiskCache {
    pub async fn new(path: PathBuf, max_size: u64) -> Result<Self> {
        assert!(
            max_size > 0,
            "maximum bytes for disk cache must be greater than 0"
        );
        let disk_cache = Self {
            inner: Arc::new(Inner {
                dir: path.clone(),
                sema: Semaphore::new(128),
                max_size,
                cur_size: AtomicU64::new(0),
            }),
        };
        task::spawn_blocking(move || std::fs::create_dir_all(path)).await??;
        disk_cache.start_cleaner();
        Ok(disk_cache)
    }

    pub async fn get(&self, input: &str, ops: ProcessOptions) -> Result<Option<ImageOutput>> {
        let path = self.get_file_path(input, ops);
        let _permit = self.inner.sema.acquire().await?;
        task::spawn_blocking(move || Self::get_inner(path)).await?
    }

    pub async fn set(&self, input: &str, ops: ProcessOptions, output: ImageOutput) -> Result<()> {
        let path = self.get_file_path(input, ops);
        let _permit = self.inner.sema.acquire().await?;
        let added = task::spawn_blocking(move || Self::set_inner(&path, &output)).await??;
        self.inner.cur_size.fetch_add(added, Ordering::AcqRel);
        Ok(())
    }

    fn start_cleaner(&self) {
        let this = self.clone();
        task::spawn(async move {
            let size = this.get_initial_size().await.unwrap();
            this.inner.cur_size.fetch_add(size, Ordering::AcqRel);

            loop {
                this.clean().await;
                time::sleep(Duration::from_secs(10)).await;
            }
        });
    }

    async fn get_initial_size(&self) -> Result<u64> {
        let this = self.clone();
        task::spawn_blocking(move || {
            WalkDir::new(&this.inner.dir)
                .min_depth(3)
                .max_depth(3)
                .into_iter()
                .filter_map(Result::ok)
                .filter_map(|entry| entry.metadata().ok())
                .filter(Metadata::is_file)
                .map(|meta| meta.len())
                .sum()
        })
        .await
        .map_err(Into::into)
    }

    async fn clean(&self) {
        let mut cur_size = self.inner.cur_size.load(Ordering::Acquire);
        if cur_size <= self.inner.max_size {
            return;
        }

        let this = self.clone();
        task::spawn_blocking(move || loop {
            let to_remove = cur_size
                .checked_sub(this.inner.max_size)
                .expect("overflow calculating bytes to remove");
            let mut removed = 0;
            while removed < to_remove {
                removed += this.remove_files(to_remove - removed);
            }
            let old = this.inner.cur_size.fetch_sub(removed, Ordering::AcqRel);
            cur_size = old
                .checked_sub(removed)
                .expect("overflow calculating current size");
            if cur_size <= this.inner.max_size {
                return;
            }
        })
        .await
        .unwrap();
    }

    fn remove_files(&self, to_remove: u64) -> u64 {
        let entries = Self::get_random_entries(&self.inner.dir);

        let mut candidates = entries
            .into_iter()
            .filter_map(|entry| entry.metadata().ok().map(|meta| (entry, meta)))
            .collect::<Vec<_>>();
        candidates.sort_by_cached_key(metadata_sort_key);

        let mut removed = 0;
        for (entry, meta) in candidates.into_iter().take(10) {
            let size = meta.len();
            if std::fs::remove_file(entry.path()).is_ok() {
                removed += size;
                if removed >= to_remove {
                    break;
                }
            }
        }

        removed
    }

    fn get_random_entries(root: &Path) -> Vec<DirEntry> {
        let mut entries: Vec<DirEntry> = Vec::with_capacity(50);

        let mut rng = rand::rng();
        for first in Self::get_random_dirs(root, &mut rng, 16) {
            for second in Self::get_random_dirs(first.path(), &mut rng, 16 * 16) {
                let num = entries.capacity() - entries.len();
                let mut files = Self::get_random_files(second.path(), &mut rng, num);
                entries.append(&mut files);
                if entries.capacity() == entries.len() {
                    return entries;
                }
            }
        }

        entries
    }

    fn get_random_files<R>(path: &Path, rng: &mut R, num: usize) -> Vec<DirEntry>
    where
        R: Rng + ?Sized,
    {
        WalkDir::new(path)
            .min_depth(1)
            .max_depth(1)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|v| v.file_type().is_file())
            .choose_multiple(rng, num)
    }

    fn get_random_dirs<R>(path: &Path, rng: &mut R, num: usize) -> Vec<DirEntry>
    where
        R: Rng + ?Sized,
    {
        WalkDir::new(path)
            .min_depth(1)
            .max_depth(1)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|v| v.file_type().is_dir())
            .choose_multiple(rng, num)
    }

    fn get_inner(path: PathBuf) -> Result<Option<ImageOutput>> {
        let data = std::fs::read(path).map(Some).or_else(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(err)
            }
        })?;
        let Some(data) = data else {
            return Ok(None);
        };

        if data.len() < 4 {
            return Err(anyhow!("invalid cached file: size is too small"));
        }
        let meta_length = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
        if data.len() < meta_length + 4 {
            return Err(anyhow!("invalid cached file: length is incorrect"));
        }

        let mut output: ImageOutput = serde_json::from_slice(&data[4..4 + meta_length])?;
        let data = Bytes::from(data);
        output.buf = data.slice(4 + meta_length..);
        Ok(Some(output))
    }

    fn set_inner(path: &Path, output: &ImageOutput) -> Result<u64> {
        let raw: Vec<u8> = Vec::with_capacity(128);
        let mut cursor = Cursor::new(raw);
        _ = cursor.write(&[0, 0, 0, 0]);
        serde_json::to_writer(&mut cursor, &output)?;
        let length = u32::try_from(cursor.position() - 4)?;
        cursor.set_position(0);
        _ = cursor.write(&length.to_be_bytes());
        let contents = cursor.into_inner();

        let mut file = Self::create_file(path)?;
        file.write_all(&contents)?;
        file.write_all(&output.buf)?;
        file.flush()?;
        Ok((contents.len() + output.buf.len()) as u64)
    }

    fn get_file_path(&self, input: &str, ops: ProcessOptions) -> PathBuf {
        let hash = Self::get_hash(input, ops).to_hex();
        let mut path = self.inner.dir.clone();
        path.push(&hash.as_str()[hash.len() - 1..]);
        path.push(&hash.as_str()[hash.len() - 3..hash.len() - 1]);
        path.push(hash.as_str());
        path
    }

    fn get_hash(input: &str, ops: ProcessOptions) -> Hash {
        let key = serde_json::to_vec(&Key { input, ops }).unwrap();
        let mut hasher = Hasher::new();
        hasher.update(&key);
        hasher.finalize()
    }

    // create a new file, failing if the file already exists. This function
    // will create all parent directories if necessary.
    fn create_file(path: &Path) -> std::io::Result<File> {
        let res = OpenOptions::new().write(true).create_new(true).open(path);
        let err = match res {
            Ok(file) => return Ok(file),
            Err(err) => {
                if err.kind() != std::io::ErrorKind::NotFound {
                    return Err(err);
                }
                err
            }
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .and_then(|()| OpenOptions::new().write(true).create_new(true).open(path))
        } else {
            Err(err)
        }
    }
}

#[derive(Serialize)]
struct Key<'a> {
    input: &'a str,
    ops: ProcessOptions,
}

fn metadata_sort_key((_, meta): &(DirEntry, Metadata)) -> Option<SystemTime> {
    meta.accessed()
        .ok()
        .or_else(|| meta.modified().ok())
        .or_else(|| meta.created().ok())
}
