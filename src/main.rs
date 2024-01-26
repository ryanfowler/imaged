use std::{ops::Deref, sync::Arc, time::Duration};

use axum::{
    body::Body,
    extract::{Query, Request, State},
    http::{response::Builder, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing,
};
use image::{ImageOutput, ImageProccessor, ImageType, InputImageType, ProcessOptions};
use serde::{Deserialize, Serialize};
use tokio::{
    net::TcpListener,
    signal::unix::{signal, SignalKind},
};

use crate::{
    cache::{disk::DiskCache, memory::MemoryCache},
    signature::Verifier,
};

mod cache;
mod exif;
mod handler;
mod image;
mod signature;
mod singleflight;

static NAME_VERSION: &str = concat!("imaged/", env!("CARGO_PKG_VERSION"));

#[global_allocator]
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

type Handler = Arc<handler::Handler>;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let port = std::env::var("PORT").ok();
    let mem_cache_size = std::env::var("MEM_CACHE_SIZE")
        .ok()
        .map(|v| byte_unit::Byte::parse_str(v, true).expect("invalid value for MEM_CACHE_SIZE"));
    let disk_cache_size = std::env::var("DISK_CACHE_SIZE")
        .ok()
        .map(|v| byte_unit::Byte::parse_str(v, true).expect("invalid value for DISK_CACHE_SIZE"));
    let disk_cache_path = std::env::var("DISK_CACHE_PATH").ok();
    let verify_keys = std::env::var("VERIFY_KEYS").ok();

    if let Some(size) = mem_cache_size {
        println!(
            "Using an in-memory cache of size {}",
            size.get_appropriate_unit(byte_unit::UnitType::Both)
        );
    }
    if let (Some(size), Some(path)) = (disk_cache_size, &disk_cache_path) {
        println!(
            "Using a disk cache of size {} at path {}",
            size.get_appropriate_unit(byte_unit::UnitType::Both),
            &path
        );
    }

    let mem_cache = mem_cache_size
        .map(|v| v.as_u64() as usize)
        .map(MemoryCache::new);

    let disk_cache = if let (Some(size), Some(path)) = (disk_cache_size, disk_cache_path) {
        Some(DiskCache::new(path.into(), size.as_u64()).await.unwrap())
    } else {
        None
    };

    let verifier = verify_keys
        .map(|keys| keys.split(',').map(|v| v.to_owned()).collect::<Vec<_>>())
        .map(Verifier::new)
        .map(|res| {
            res.unwrap_or_else(|err| {
                panic!("invalid verification key provided: {}", err);
            })
        });

    let client = reqwest::Client::builder()
        .user_agent(NAME_VERSION)
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap();

    let workers = std::thread::available_parallelism().unwrap().get();
    let processor = ImageProccessor::new(workers);

    let state: Handler = Arc::new(handler::Handler::new(
        mem_cache,
        disk_cache,
        client,
        processor,
        workers * 10,
        verifier,
    ));

    let app = axum::Router::new()
        .route("/", routing::get(get_image))
        .route("/metadata", routing::get(get_image_metadata))
        .with_state(state);

    let port = port.unwrap_or_else(|| "8000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await.unwrap();
    println!("Starting server on {}", &addr);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();
}

async fn shutdown_signal() {
    let mut sigterm = signal(SignalKind::terminate()).unwrap();
    let mut sighup = signal(SignalKind::hangup()).unwrap();
    let mut sigint = signal(SignalKind::interrupt()).unwrap();
    tokio::select! {
        _ = sigterm.recv() => {}
        _ = sighup.recv() => {}
        _ = sigint.recv() => {}
    }
}

async fn get_image(
    headers: HeaderMap,
    Query(query): Query<ImageQuery>,
    State(state): State<Handler>,
    request: Request,
) -> Response {
    let uri = request.uri();
    if let Err(err) = state.verify(uri.path(), uri.query(), query.s.as_deref()) {
        return (StatusCode::BAD_REQUEST, err.to_string()).into_response();
    }

    let result = state
        .get_image(
            &query.url,
            options_from_query(&query, &headers),
            query.is_timing(),
            !query.is_nocache(),
        )
        .await;
    let result = match result.deref() {
        Ok(res) => res,
        Err(err) => return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
    };

    let mut res = new_response().header("content-type", result.output.img_type.mimetype());

    if query.is_timing() {
        res = res.header("server-timing", &result.timing.header());
    }

    if query.is_debug() {
        let raw = serde_json::to_string(&ImageDebug::new(&result.output)).unwrap();
        res = res.header("x-image-debug", &raw);
    }

    if let Some(cache_result) = result.cache_result {
        res = res.header("x-cache-status", cache_result.as_str())
    }

    res.header("x-image-height", result.output.height)
        .header("x-image-width", result.output.width)
        .body(Body::from(result.output.buf.clone()))
        .unwrap()
}

async fn get_image_metadata(
    Query(query): Query<MetadataQuery>,
    State(state): State<Handler>,
) -> Response {
    let timing = query.is_timing();
    let thumbhash = query.is_thumbhash();
    let result = match state.get_metadata(&query.url, thumbhash, timing).await {
        Ok(res) => res,
        Err(err) => return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
    };

    let mut res = new_response().header("content-type", "application/json");

    if result.timing.should_show() {
        res = res.header("server-timing", &result.timing.header());
    }

    let out = if query.is_pretty() {
        serde_json::to_vec_pretty(&result.metadata)
    } else {
        serde_json::to_vec(&result.metadata)
    }
    .unwrap();
    res.body(Body::from(out)).unwrap()
}

fn new_response() -> Builder {
    Response::builder().header("server", NAME_VERSION)
}

#[derive(Clone, Debug, Deserialize)]
struct ImageQuery {
    url: String,

    #[serde(default)]
    quality: Option<u32>,
    #[serde(default)]
    format: Option<ImageFormats>,
    #[serde(default)]
    debug: Option<String>,
    #[serde(default)]
    timing: Option<String>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    blur: Option<u32>,
    #[serde(default)]
    nocache: Option<String>,
    #[serde(default)]
    s: Option<String>,
}

impl ImageQuery {
    fn is_debug(&self) -> bool {
        Self::is_enabled(&self.debug)
    }

    fn is_timing(&self) -> bool {
        Self::is_enabled(&self.timing)
    }

    fn is_nocache(&self) -> bool {
        Self::is_enabled(&self.nocache)
    }

    fn is_enabled(v: &Option<String>) -> bool {
        if let Some(v) = v {
            v != "false"
        } else {
            false
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
enum ImageFormats {
    Format(ImageType),
    CommaSep(String),
}

impl ImageFormats {
    fn format(&self, accept: Option<&HeaderValue>) -> Option<ImageType> {
        match self {
            ImageFormats::Format(fmt) => Some(*fmt),
            ImageFormats::CommaSep(v) => v
                .split(',')
                .filter_map(ImageType::parse)
                .collect::<Vec<ImageType>>()
                .split_last()
                .map(|(last, fmts)| {
                    fmts.iter()
                        .find(|&v| {
                            accept
                                .and_then(|accept| {
                                    memchr::memmem::find(accept.as_bytes(), v.mimetype().as_bytes())
                                })
                                .is_some()
                        })
                        .unwrap_or(last)
                        .to_owned()
                }),
        }
    }
}

#[derive(Deserialize)]
struct MetadataQuery {
    url: String,

    #[serde(default)]
    pretty: Option<String>,
    #[serde(default)]
    thumbhash: Option<String>,
    #[serde(default)]
    timing: Option<String>,
}

impl MetadataQuery {
    fn is_pretty(&self) -> bool {
        Self::is_enabled(&self.pretty)
    }

    fn is_timing(&self) -> bool {
        Self::is_enabled(&self.timing)
    }

    fn is_thumbhash(&self) -> bool {
        Self::is_enabled(&self.thumbhash)
    }

    fn is_enabled(v: &Option<String>) -> bool {
        if let Some(v) = v {
            v != "false"
        } else {
            false
        }
    }
}

#[derive(Serialize)]
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

fn options_from_query(query: &ImageQuery, headers: &HeaderMap) -> ProcessOptions {
    let accept = headers.get("accept");
    ProcessOptions {
        width: query.width,
        height: query.height,
        out_type: query.format.as_ref().and_then(|v| v.format(accept)),
        quality: query.quality,
        blur: query.blur,
    }
}
