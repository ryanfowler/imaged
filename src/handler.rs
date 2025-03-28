use std::{fmt::Write, sync::Arc, time::SystemTime};

use anyhow::{Result, anyhow};
use reqwest::Client;
use tokio::sync::Semaphore;

use crate::{
    cache::{disk::DiskCache, memory::MemoryCache},
    image::{ImageMetadata, ImageOutput, ImageProccessor, MetadataOptions, ProcessOptions},
    signature::Verifier,
    singleflight::Group,
};

pub struct Handler {
    pub mem_cache: Option<MemoryCache>,
    pub disk_cache: Option<DiskCache>,
    pub client: Client,
    pub group: Group<Key, Arc<Result<ImageResponse>>>,
    pub processor: ImageProccessor,
    pub semaphore: Semaphore,
    pub verifier: Option<Verifier>,
}

#[derive(Clone)]
pub struct ImageResponse {
    pub cache_result: Option<CacheResult>,
    pub output: ImageOutput,
    pub timing: ServerTiming,
}

pub struct MetadataResponse {
    pub metadata: ImageMetadata,
    pub timing: ServerTiming,
}

impl Handler {
    pub fn new(
        mem_cache: Option<MemoryCache>,
        disk_cache: Option<DiskCache>,
        client: Client,
        processor: ImageProccessor,
        concurrency: usize,
        verifier: Option<Verifier>,
    ) -> Self {
        assert!(concurrency > 0);
        Self {
            mem_cache,
            disk_cache,
            client,
            group: Group::new(),
            processor,
            semaphore: Semaphore::new(concurrency),
            verifier,
        }
    }

    pub fn verify(&self, path: &str, query: Option<&str>, sig: Option<&str>) -> Result<()> {
        let Some(verifier) = &self.verifier else {
            return Ok(());
        };

        let Some(sig) = sig else {
            return Err(anyhow!("signature must be provided"));
        };

        verifier.verify(path, query, sig.as_bytes())
    }

    /// This method has to return an Arc<Result<_>> because of the use of
    /// singleflight, which requires the output implement the Clone trait.
    pub async fn get_image(
        &self,
        url: &str,
        options: ProcessOptions,
        should_cache: bool,
    ) -> Arc<Result<ImageResponse>> {
        let key = Key {
            input: url.to_owned(),
            options,
        };
        self.group
            .run(&key, || async {
                Arc::new(self.get_image_inner(url, options, should_cache).await)
            })
            .await
    }

    async fn get_image_inner(
        &self,
        url: &str,
        options: ProcessOptions,
        should_cache: bool,
    ) -> Result<ImageResponse> {
        let _permit = self.semaphore.acquire().await?;

        let mut timing = ServerTiming::new();

        if let Some(cache) = &self.mem_cache {
            let start = SystemTime::now();
            let output = cache.get(url, options);
            timing.push("mem_cache_get", start);
            if let Some(output) = output {
                return Ok(ImageResponse {
                    cache_result: Some(CacheResult::Hit),
                    output,
                    timing,
                });
            }
        }

        if let Some(cache) = &self.disk_cache {
            let start = SystemTime::now();
            let output = cache.get(url, options).await;
            timing.push("disk_cache_get", start);
            if let Ok(Some(output)) = output {
                if let (Some(mem_cache), true) = (&self.mem_cache, should_cache) {
                    let start = SystemTime::now();
                    mem_cache.set(url, options, output.clone());
                    timing.push("mem_cache_put", start);
                }
                return Ok(ImageResponse {
                    cache_result: Some(CacheResult::Hit),
                    output,
                    timing,
                });
            }
        }

        let start = SystemTime::now();
        let body = self.get_orig_image(url).await?;
        timing.push("download", start);

        let start = SystemTime::now();
        let output = self.processor.process_image(body, options).await?;
        timing.push("process", start);

        if let (Some(cache), true) = (&self.mem_cache, should_cache) {
            let start = SystemTime::now();
            cache.set(url, options, output.clone());
            timing.push("mem_cache_put", start);
        }

        if let (Some(cache), true) = (&self.disk_cache, should_cache) {
            let start = SystemTime::now();
            _ = cache.set(url, options, output.clone()).await;
            timing.push("disk_cache_put", start);
        }

        let cache_result =
            (self.mem_cache.is_some() || self.disk_cache.is_some()).then_some(CacheResult::Miss);

        Ok(ImageResponse {
            cache_result,
            output,
            timing,
        })
    }

    pub async fn get_metadata(&self, url: &str, thumbhash: bool) -> Result<MetadataResponse> {
        let _permit = self.semaphore.acquire().await?;

        let mut timing = ServerTiming::new();

        let start = SystemTime::now();
        let body = self.get_orig_image(url).await?;
        timing.push("download", start);

        let start = SystemTime::now();
        let ops = MetadataOptions::new(thumbhash);
        let metadata = self.processor.metadata(body, ops).await?;
        timing.push("process", start);

        Ok(MetadataResponse { metadata, timing })
    }

    async fn get_orig_image(&self, url: &str) -> Result<bytes::Bytes> {
        let res = self.client.get(url).send().await?;
        if res.status() != reqwest::StatusCode::OK {
            return Err(anyhow!("received status code: {}", res.status()));
        }

        res.bytes().await.map_err(Into::into)
    }
}

#[derive(Clone, Copy)]
pub enum CacheResult {
    Hit,
    Miss,
}

impl CacheResult {
    pub fn as_str(self) -> &'static str {
        match self {
            CacheResult::Hit => "HIT",
            CacheResult::Miss => "MISS",
        }
    }
}

#[derive(Clone)]
pub struct ServerTiming {
    vals: Vec<TimingValue>,
}

#[derive(Clone)]
struct TimingValue {
    name: &'static str,
    dur: f32,
}

impl ServerTiming {
    fn new() -> Self {
        Self {
            vals: Vec::with_capacity(6),
        }
    }

    fn push(&mut self, name: &'static str, start: SystemTime) {
        let dur = Self::ms_since(start);
        self.vals.push(TimingValue { name, dur });
    }

    pub fn header(&self) -> String {
        let mut out = String::with_capacity(128);
        for val in &self.vals {
            if !out.is_empty() {
                out.push(',');
            }
            _ = write!(&mut out, "{};dur={:.1}", val.name, val.dur);
        }
        out
    }

    fn ms_since(start: SystemTime) -> f32 {
        SystemTime::now()
            .duration_since(start)
            .unwrap_or_default()
            .as_secs_f32()
            * 1000.0
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Key {
    input: String,
    options: ProcessOptions,
}
