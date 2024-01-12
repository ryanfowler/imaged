use std::{fmt::Write, time::SystemTime};

use anyhow::{anyhow, Result};
use reqwest::Client;

use crate::{
    cache::Cache,
    image::{ImageMetadata, ImageOutput, ImageProccessor, MetadataOptions, ProcessOptions},
};

pub struct Handler {
    pub cache: Cache,
    pub client: Client,
    pub processor: ImageProccessor,
}

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
    pub async fn get_image(
        &self,
        url: &str,
        options: ProcessOptions,
        timing: bool,
    ) -> Result<ImageResponse> {
        let mut timing = ServerTiming::new(timing);

        let start = SystemTime::now();
        let output = self.cache.get(url.to_owned(), options);
        timing.push("cache_get", start);
        if let Some(output) = output {
            return Ok(ImageResponse {
                cache_result: CacheResult::Hit,
                output,
                timing,
            });
        }

        let start = SystemTime::now();
        let body = self.get_orig_image(url).await?;
        timing.push("download", start);

        let start = SystemTime::now();
        let output = self.processor.process_image(body, options).await?;
        timing.push("process", start);

        let start = SystemTime::now();
        self.cache.set(url.to_owned(), options, output.clone());
        timing.push("cache_put", start);

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

    pub fn header(mut self) -> String {
        self.hdr.take().unwrap_or_default()
    }

    fn ms_since(start: SystemTime) -> f32 {
        SystemTime::now()
            .duration_since(start)
            .unwrap()
            .as_secs_f32()
            * 1000.0
    }
}
