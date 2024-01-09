use std::{
    fmt::Write,
    sync::Arc,
    time::{Duration, SystemTime},
};

use anyhow::{anyhow, Result};
use axum::{
    body::Body,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use image::{ImageOutput, ImageProccessor, ImageType, InputImageType, ProcessOptions};
use reqwest::Client;
use tokio::{net::TcpListener, signal};

mod exif;
mod image;

static NAME_VERSION: &str = concat!("imaged/", env!("CARGO_PKG_VERSION"));

#[global_allocator]
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let client = reqwest::Client::builder()
        .user_agent("imaged")
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap();

    let workers = std::thread::available_parallelism().unwrap().get();
    let processor = ImageProccessor::new(workers);

    let app = axum::Router::new()
        .route("/", axum::routing::get(get_image))
        .with_state((client, Arc::new(processor)));

    const ADDR: &str = "0.0.0.0:8000";
    let listener = TcpListener::bind(ADDR).await.unwrap();
    println!("Starting server on {}", ADDR);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

async fn shutdown_signal() {
    signal::ctrl_c().await.unwrap()
}

async fn get_image(
    Query(query): Query<ImageQuery>,
    State((client, processor)): State<(Client, Arc<ImageProccessor>)>,
) -> Response {
    let mut timing = ServerTiming::new(query.is_timing());

    let start = SystemTime::now();
    let body = match get_orig_image(client, &query.url).await {
        Ok(body) => body,
        Err(err) => return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
    };
    timing.push("download", start);

    let start = SystemTime::now();
    let ops = options_from_query(&query);
    let output = match processor.process_image(body, ops).await {
        Err(err) => return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
        Ok(output) => output,
    };
    timing.push("process", start);

    let mut res = axum::response::Response::builder();
    res = res.header("content-type", output.img_type.mimetype());
    res = res.header("server", NAME_VERSION);

    if timing.should_show() {
        res = res.header("server-timing", &timing.header());
    }

    if query.is_debug() {
        let raw = serde_json::to_string(&ImageDebug::new(&output)).unwrap();
        res = res.header("x-image-debug", &raw);
    }

    res = res.header("x-image-height", output.height);
    res = res.header("x-image-width", output.width);

    res.body(Body::from(output.buf)).unwrap()
}

async fn get_orig_image(client: Client, url: &str) -> Result<bytes::Bytes> {
    let res = client.get(url).send().await?;
    if res.status() != reqwest::StatusCode::OK {
        return Err(anyhow!("received status code: {}", res.status()));
    }

    res.bytes().await.map_err(|err| err.into())
}

struct ServerTiming {
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

    fn should_show(&self) -> bool {
        self.hdr.is_some()
    }

    fn header(mut self) -> String {
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

#[derive(serde::Deserialize)]
struct ImageQuery {
    url: String,

    #[serde(default)]
    quality: Option<u8>,
    #[serde(default)]
    format: Option<ImageType>,
    #[serde(default)]
    debug: Option<String>,
    #[serde(default)]
    timing: Option<String>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    width: Option<u32>,
}

impl ImageQuery {
    fn is_debug(&self) -> bool {
        Self::is_enabled(&self.debug)
    }

    fn is_timing(&self) -> bool {
        Self::is_enabled(&self.timing)
    }

    fn is_enabled(v: &Option<String>) -> bool {
        if let Some(v) = v {
            v != "false"
        } else {
            false
        }
    }
}

#[derive(serde::Serialize)]
struct ImageDebug {
    original_height: u32,
    original_width: u32,
    original_size: u64,
    original_format: InputImageType,
}

impl ImageDebug {
    fn new(output: &ImageOutput) -> Self {
        ImageDebug {
            original_height: output.orig_height,
            original_width: output.orig_width,
            original_size: output.orig_size,
            original_format: output.orig_type,
        }
    }
}

fn options_from_query(query: &ImageQuery) -> ProcessOptions {
    ProcessOptions {
        width: query.width,
        height: query.height,
        out_type: query.format,
        quality: query.quality,
    }
}
