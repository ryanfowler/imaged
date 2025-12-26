use std::{fmt::Write, time::SystemTime};

use anyhow::{Result, anyhow};
use reqwest::Client;
use tokio::sync::Semaphore;

use crate::{
    image::{ImageMetadata, ImageOutput, ImageProccessor, MetadataOptions, ProcessOptions},
    signature::Verifier,
};

pub struct Handler {
    pub client: Client,
    pub processor: ImageProccessor,
    pub semaphore: Semaphore,
    pub verifier: Option<Verifier>,
}

#[derive(Clone)]
pub struct ImageResponse {
    pub output: ImageOutput,
    pub timing: ServerTiming,
}

pub struct MetadataResponse {
    pub metadata: ImageMetadata,
    pub timing: ServerTiming,
}

impl Handler {
    pub fn new(
        client: Client,
        processor: ImageProccessor,
        concurrency: usize,
        verifier: Option<Verifier>,
    ) -> Self {
        assert!(concurrency > 0);
        Self {
            client,
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
    pub async fn get_image(&self, url: &str, options: ProcessOptions) -> Result<ImageResponse> {
        let _permit = self.semaphore.acquire().await?;

        let mut timing = ServerTiming::new();

        let start = SystemTime::now();
        let body = self.get_orig_image(url).await?;
        timing.push("download", start);

        let start = SystemTime::now();
        let output = self.processor.process_image(body, options).await?;
        timing.push("process", start);

        Ok(ImageResponse { output, timing })
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
