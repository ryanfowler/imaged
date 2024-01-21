use std::{
    fs::File,
    io::{Cursor, Write},
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Result};
use bytes::Bytes;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;

use crate::image::{ImageOutput, ProcessOptions};

pub struct DiskCache {
    dir: PathBuf,
    sema: Semaphore,
}

impl DiskCache {
    pub fn new(path: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&path)?;
        Ok(Self {
            dir: path,
            sema: Semaphore::new(128),
        })
    }

    pub async fn get(&self, input: &str, ops: ProcessOptions) -> Result<Option<ImageOutput>> {
        let path = self.get_file_path(input, ops);
        let _permit = self.sema.acquire().await?;
        tokio::task::spawn_blocking(move || Self::get_inner(path)).await?
    }

    pub async fn set(&self, input: &str, ops: ProcessOptions, output: ImageOutput) -> Result<()> {
        let path = self.get_file_path(input, ops);
        let _permit = self.sema.acquire().await?;
        tokio::task::spawn_blocking(move || Self::set_inner(path, output)).await?
    }

    fn get_inner(path: PathBuf) -> Result<Option<ImageOutput>> {
        let data = std::fs::read(path)?;
        if data.len() < 4 {
            return Err(anyhow!("invalid cached file: too short"));
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

    fn set_inner(path: PathBuf, output: ImageOutput) -> Result<()> {
        let raw: Vec<u8> = Vec::with_capacity(128);
        let mut cursor = Cursor::new(raw);
        _ = cursor.write(&[0, 0, 0, 0]);
        serde_json::to_writer(&mut cursor, &output).unwrap();
        let length = (cursor.position() - 4) as u32;
        cursor.set_position(0);
        _ = cursor.write(&length.to_be_bytes());
        let contents = cursor.into_inner();

        let mut file = Self::create_file(&path)?;
        file.write_all(&contents)?;
        file.write_all(&output.buf)?;
        file.flush()?;
        Ok(())
    }

    fn get_file_path(&self, input: &str, ops: ProcessOptions) -> PathBuf {
        let hash = Self::get_hash(input, ops);
        let mut path = self.dir.to_owned();
        path.push(&hash.as_str()[hash.len() - 1..]);
        path.push(&hash.as_str()[hash.len() - 3..hash.len() - 1]);
        path.push(&hash);
        path
    }

    fn get_hash(input: &str, ops: ProcessOptions) -> String {
        let key = serde_json::to_vec(&Key { input, ops }).unwrap();
        let mut hasher = Sha256::new();
        hasher.update(&key);
        let hash = hasher.finalize();
        hex::encode(hash)
    }

    fn create_file(path: &Path) -> Result<File> {
        File::create(path)
            .or_else(|err| {
                if let Some(parent) = path.parent() {
                    if std::fs::create_dir_all(parent).is_ok() {
                        return File::create(path);
                    }
                }
                Err(err)
            })
            .map_err(|err| err.into())
    }
}

#[derive(Serialize)]
struct Key<'a> {
    input: &'a str,
    ops: ProcessOptions,
}
