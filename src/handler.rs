use std::{fmt::Write, sync::Arc, time::SystemTime};

use anyhow::{anyhow, Result};
use reqwest::Client;
use tokio::sync::Semaphore;

use crate::{
    cache::Cache,
    image::{ImageMetadata, ImageOutput, ImageProccessor, MetadataOptions, ProcessOptions},
    singleflight::Group,
};

pub struct Handler {
    pub cache: Option<Cache>,
    pub client: Client,
    pub group: Group<Key, Arc<Result<ImageResponse>>>,
    pub processor: ImageProccessor,
    pub semaphore: Semaphore,
}

#[derive(Clone)]
pub struct ImageResponse {
    pub cache_result: CacheResult,
    pub output: ImageOutput,
    pub timing: ServerTiming,
}

pub struct MetadataResponse {
    pub metadata: ImageMetadata,
    pub timing: ServerTiming,
}

impl Handler {
    pub fn new(
        cache: Option<Cache>,
        client: Client,
        processor: ImageProccessor,
        concurrency: usize,
    ) -> Self {
        Self {
            cache,
            client,
            group: Group::new(),
            processor,
            semaphore: Semaphore::new(concurrency),
        }
    }

    /// This method has to return an Arc<Result<_>> because of the use of
    /// singleflight, which requires the output implement the Clone trait.
    pub async fn get_image(
        &self,
        url: &str,
        options: ProcessOptions,
        timing: bool,
        should_cache: bool,
    ) -> Arc<Result<ImageResponse>> {
        let key = Key {
            input: url.to_owned(),
            options,
        };
        self.group
            .run(&key, || {
                self.get_image_singleflight(url, options, timing, should_cache)
            })
            .await
    }

    async fn get_image_singleflight(
        &self,
        url: &str,
        options: ProcessOptions,
        timing: bool,
        should_cache: bool,
    ) -> Arc<Result<ImageResponse>> {
        Arc::new(
            self.get_image_inner(url, options, timing, should_cache)
                .await,
        )
    }

    async fn get_image_inner(
        &self,
        url: &str,
        options: ProcessOptions,
        timing: bool,
        should_cache: bool,
    ) -> Result<ImageResponse> {
        let _permit = self.semaphore.acquire().await?;

        let mut timing = ServerTiming::new(timing);

        if let Some(cache) = &self.cache {
            let start = SystemTime::now();
            let output = cache.get(url.to_owned(), options);
            timing.push("cache_get", start);
            if let Some(output) = output {
                return Ok(ImageResponse {
                    cache_result: CacheResult::Hit,
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

        if let (Some(cache), true) = (&self.cache, should_cache) {
            let start = SystemTime::now();
            cache.set(url.to_owned(), options, output.clone());
            timing.push("cache_put", start);
        }

        Ok(ImageResponse {
            cache_result: CacheResult::Miss,
            output,
            timing,
        })
    }

    pub async fn get_metadata(
        &self,
        url: &str,
        thumbhash: bool,
        timing: bool,
    ) -> Result<MetadataResponse> {
        let _permit = self.semaphore.acquire().await?;

        let mut timing = ServerTiming::new(timing);

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

        res.bytes().await.map_err(|err| err.into())
    }
}

#[derive(Clone, Copy)]
pub enum CacheResult {
    Hit,
    Miss,
}

impl CacheResult {
    pub fn as_str(&self) -> &'static str {
        match self {
            CacheResult::Hit => "HIT",
            CacheResult::Miss => "MISS",
        }
    }
}

#[derive(Clone)]
pub struct ServerTiming {
    hdr: Option<String>,
}

impl ServerTiming {
    fn new(show_timing: bool) -> Self {
        Self {
            hdr: if show_timing {
                Some(String::new())
            } else {
                None
            },
        }
    }

    fn push(&mut self, name: &str, start: SystemTime) {
        if let Some(ref mut hdr) = self.hdr {
            if !hdr.is_empty() {
                hdr.push(',')
            }
            let dur = Self::ms_since(start);
            _ = write!(hdr, "{};dur={:.1}", name, dur);
        }
    }

    pub fn should_show(&self) -> bool {
        self.hdr.is_some()
    }

    pub fn header(&self) -> String {
        if let Some(v) = &self.hdr {
            v.to_owned()
        } else {
            String::new()
        }
    }

    fn ms_since(start: SystemTime) -> f32 {
        SystemTime::now()
            .duration_since(start)
            .unwrap()
            .as_secs_f32()
            * 1000.0
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Key {
    input: String,
    options: ProcessOptions,
}
