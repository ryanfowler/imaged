use std::sync::Arc;

use anyhow::Result;
use axum::{
    body::Body,
    extract::{Query, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, response::Builder},
    response::{IntoResponse, Response},
    routing,
};
use serde::{Deserialize, Serialize};
use tokio::{
    net::TcpListener,
    signal::unix::{SignalKind, signal},
};

use crate::{
    handler::Handler,
    image::{ImageOutput, ImageType, InputImageType, ProcessOptions},
};

pub static NAME_VERSION: &str = concat!("imaged/", env!("CARGO_PKG_VERSION"));

type HandlerState = Arc<Handler>;

pub async fn start_server(handler: Handler, addr: &str) -> Result<()> {
    let state: HandlerState = Arc::new(handler);
    let app = axum::Router::new()
        .route("/", routing::get(get_image))
        .route("/metadata", routing::get(get_image_metadata))
        .with_state(state);

    let listener = TcpListener::bind(&addr).await?;
    println!("Starting server on {}", &addr);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(Into::into)
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
    State(state): State<HandlerState>,
    request: Request,
) -> Response {
    let uri = request.uri();
    if let Err(err) = state.verify(uri.path(), uri.query(), query.s.as_deref()) {
        return (StatusCode::UNAUTHORIZED, err.to_string()).into_response();
    }

    let result = state
        .get_image(&query.url, options_from_query(&query, &headers))
        .await;
    let result = match result {
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

    res.header("x-image-height", result.output.height)
        .header("x-image-width", result.output.width)
        .body(Body::from(result.output.buf.clone()))
        .unwrap()
}

async fn get_image_metadata(
    Query(query): Query<MetadataQuery>,
    State(state): State<HandlerState>,
    request: Request,
) -> Response {
    let uri = request.uri();
    if let Err(err) = state.verify(uri.path(), uri.query(), query.s.as_deref()) {
        return (StatusCode::UNAUTHORIZED, err.to_string()).into_response();
    }

    let thumbhash = query.is_thumbhash();
    let result = match state.get_metadata(&query.url, thumbhash).await {
        Ok(res) => res,
        Err(err) => return (StatusCode::INTERNAL_SERVER_ERROR, err.to_string()).into_response(),
    };

    let mut res = new_response().header("content-type", "application/json");

    if query.is_timing() {
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
    s: Option<String>,
}

impl ImageQuery {
    fn is_debug(&self) -> bool {
        is_query_enabled(&self.debug)
    }

    fn is_timing(&self) -> bool {
        is_query_enabled(&self.timing)
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
    #[serde(default)]
    s: Option<String>,
}

impl MetadataQuery {
    fn is_pretty(&self) -> bool {
        is_query_enabled(&self.pretty)
    }

    fn is_timing(&self) -> bool {
        is_query_enabled(&self.timing)
    }

    fn is_thumbhash(&self) -> bool {
        is_query_enabled(&self.thumbhash)
    }
}

fn is_query_enabled(v: &Option<String>) -> bool {
    matches!(v.as_deref(), Some(raw) if raw != "0" && !raw.eq_ignore_ascii_case("false"))
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
    let width = query
        .width
        .and_then(|width| if width == 0 { None } else { Some(width) });
    let height = query
        .height
        .and_then(|height| if height == 0 { None } else { Some(height) });
    let quality = query.quality.map(|quality| quality.clamp(1, 100));
    let blur = query
        .blur
        .and_then(|blur| if blur == 0 { None } else { Some(blur) });

    let accept = headers.get("accept");
    ProcessOptions {
        width,
        height,
        out_type: query.format.as_ref().and_then(|v| v.format(accept)),
        quality,
        blur,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn image_query() -> ImageQuery {
        ImageQuery {
            url: "http://example.com/image.jpg".to_string(),
            quality: None,
            format: None,
            debug: None,
            timing: None,
            height: None,
            width: None,
            blur: None,
            s: None,
        }
    }

    fn metadata_query() -> MetadataQuery {
        MetadataQuery {
            url: "http://example.com/image.jpg".to_string(),
            pretty: None,
            thumbhash: None,
            timing: None,
            s: None,
        }
    }

    #[test]
    fn parses_single_output_format() {
        assert_eq!(
            ImageFormats::Format(ImageType::Png).format(None),
            Some(ImageType::Png)
        );
    }

    #[test]
    fn negotiates_comma_separated_formats_with_accept_header() {
        let accept = HeaderValue::from_static("image/webp");
        let formats = ImageFormats::CommaSep("avif,webp,jpeg".to_string());

        assert_eq!(formats.format(Some(&accept)), Some(ImageType::Webp));
    }

    #[test]
    fn falls_back_to_last_format_without_accept_match() {
        let accept = HeaderValue::from_static("image/png");
        let formats = ImageFormats::CommaSep("avif,webp,jpeg".to_string());

        assert_eq!(formats.format(Some(&accept)), Some(ImageType::Jpeg));
    }

    #[test]
    fn ignores_unknown_formats_in_comma_separated_list() {
        let accept = HeaderValue::from_static("image/webp");
        let formats = ImageFormats::CommaSep("bmp,webp,jpeg".to_string());

        assert_eq!(formats.format(Some(&accept)), Some(ImageType::Webp));
    }

    #[test]
    fn returns_none_when_no_requested_format_is_supported() {
        let formats = ImageFormats::CommaSep("bmp,gif".to_string());

        assert_eq!(formats.format(None), None);
    }

    #[test]
    fn parses_transform_options_from_image_query() {
        let mut headers = HeaderMap::new();
        headers.insert("accept", HeaderValue::from_static("image/webp"));

        let mut query = image_query();
        query.format = Some(ImageFormats::CommaSep("avif,webp,jpeg".to_string()));
        query.width = Some(120);
        query.height = Some(80);
        query.quality = Some(150);
        query.blur = Some(4);

        let options = options_from_query(&query, &headers);

        assert_eq!(options.width, Some(120));
        assert_eq!(options.height, Some(80));
        assert_eq!(options.out_type, Some(ImageType::Webp));
        assert_eq!(options.quality, Some(100));
        assert_eq!(options.blur, Some(4));
    }

    #[test]
    fn clamps_quality_and_ignores_zero_dimensions_or_blur() {
        let headers = HeaderMap::new();
        let mut query = image_query();
        query.width = Some(0);
        query.height = Some(0);
        query.quality = Some(0);
        query.blur = Some(0);

        let options = options_from_query(&query, &headers);

        assert_eq!(options.width, None);
        assert_eq!(options.height, None);
        assert_eq!(options.quality, Some(1));
        assert_eq!(options.blur, None);
    }

    #[test]
    fn image_debug_and_timing_flags_follow_query_boolean_rules() {
        let mut query = image_query();
        assert!(!query.is_debug());
        assert!(!query.is_timing());

        query.debug = Some("false".to_string());
        query.timing = Some("0".to_string());
        assert!(!query.is_debug());
        assert!(!query.is_timing());

        query.debug = Some(String::new());
        query.timing = Some("1".to_string());
        assert!(query.is_debug());
        assert!(query.is_timing());
    }

    #[test]
    fn metadata_flags_follow_query_boolean_rules() {
        let mut query = metadata_query();
        assert!(!query.is_pretty());
        assert!(!query.is_thumbhash());
        assert!(!query.is_timing());

        query.pretty = Some("FALSE".to_string());
        query.thumbhash = Some("0".to_string());
        query.timing = Some("false".to_string());
        assert!(!query.is_pretty());
        assert!(!query.is_thumbhash());
        assert!(!query.is_timing());

        query.pretty = Some(String::new());
        query.thumbhash = Some("true".to_string());
        query.timing = Some("yes".to_string());
        assert!(query.is_pretty());
        assert!(query.is_thumbhash());
        assert!(query.is_timing());
    }
}
