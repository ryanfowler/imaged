use std::{
    fmt::Write,
    time::{Duration, SystemTime},
};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use image::{ImageProccessor, ImageType, ProcessOptions};
use reqwest::Client;

mod image;

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
        .with_state((client, processor));

    const ADDR: &str = "0.0.0.0:8000";
    let listener = tokio::net::TcpListener::bind(ADDR).await.unwrap();
    println!("Starting server on {}", ADDR);
    axum::serve(listener, app).await.unwrap();
}

async fn get_image(
    Query(query): Query<ImageQuery>,
    State((client, processor)): State<(Client, ImageProccessor)>,
) -> Response {
    let mut timings = Vec::new();

    let start = SystemTime::now();
    let body = match client.get(&query.url).send().await {
        Err(_) => return (StatusCode::BAD_REQUEST).into_response(),
        Ok(res) => match res.bytes().await {
            Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR).into_response(),
            Ok(body) => body,
        },
    };
    timings.push(ServerTimingValue {
        name: "download",
        dur: ms_since(start),
    });
    let orig_size = body.len();

    let start = SystemTime::now();
    let output = match processor
        .process_image(
            body,
            ProcessOptions {
                width: query.width,
                height: query.height,
                out_type: query.format,
                quality: query.quality,
            },
        )
        .await
    {
        Err(err) => return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
        Ok(output) => output,
    };
    timings.push(ServerTimingValue {
        name: "process",
        dur: ms_since(start),
    });

    let mut thdr = String::new();
    for (i, timing) in timings.iter().enumerate() {
        if i > 0 {
            thdr.push_str(", ");
        }
        _ = write!(&mut thdr, "{};dur={:.1}", timing.name, timing.dur);
    }

    let mut res = axum::response::Response::builder();
    res = res.header("content-type", output.img_type.mimetype());
    res = res.header("server-timing", &thdr);
    res = res.header("x-image-width", output.width);
    res = res.header("x-image-height", output.height);

    if query.is_debug() {
        let raw = serde_json::to_string(&ImageDebug {
            original_size: orig_size as u64,
            original_width: output.orig_width,
            original_height: output.orig_height,
            original_format: output.orig_type,
        })
        .unwrap();
        res = res.header("x-image-debug", &raw);
    }

    res.body(axum::body::Body::from(output.buf)).unwrap()
}

struct ServerTimingValue {
    name: &'static str,
    dur: f32,
}

fn ms_since(start: std::time::SystemTime) -> f32 {
    std::time::SystemTime::now()
        .duration_since(start)
        .unwrap()
        .as_secs_f32()
        * 1000.0
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
    height: Option<u32>,
    #[serde(default)]
    width: Option<u32>,
}

impl ImageQuery {
    fn is_debug(&self) -> bool {
        if let Some(v) = &self.debug {
            return v != "false";
        }
        false
    }
}

#[derive(serde::Serialize)]
struct ImageDebug {
    original_height: u32,
    original_width: u32,
    original_size: u64,
    original_format: ImageType,
}
