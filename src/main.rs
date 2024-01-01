use std::fmt::Write;

use axum::response::IntoResponse;
use image::GenericImageView;

#[global_allocator]
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let app = axum::Router::new().route("/", axum::routing::get(get_image));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// const RAW_IMG: &[u8] = include_bytes!("/Users/ryanfowler/Documents/IMG_1502.jpg");

async fn get_image() -> axum::response::Response {
    tokio::task::spawn_blocking(|| {
        let mut timings = Vec::new();

        let start = std::time::SystemTime::now();
        let raw_img = std::fs::read("/Users/ryanfowler/Documents/IMG_1502.jpg").unwrap();
        // let raw_img = std::fs::read("/Users/ryanfowler/Downloads/GBZL8i_aAAAicUE.jpeg").unwrap();
        // let raw_img = std::fs::read("/Users/ryanfowler/Downloads/dinodog.jpg").unwrap();
        timings.push(ServerTimingValue {
            name: "readfile",
            dur: ms_since(start),
        });

        let format = image::guess_format(&raw_img).unwrap();
        if format != image::ImageFormat::Jpeg {
            return (axum::http::StatusCode::INTERNAL_SERVER_ERROR).into_response();
        }

        let start = std::time::SystemTime::now();
        let mut cursor = std::io::Cursor::new(&raw_img);
        if let Ok(meta) = exif::Reader::new().read_from_container(&mut cursor) {
            timings.push(ServerTimingValue {
                name: "exif",
                dur: ms_since(start),
            });
            // if let Some(field) = meta.get_field(exif::Tag::Orientation, exif::In::PRIMARY) {
            //     if let Some(orientation) = field.value.get_uint(0) {
            //         println!("Orientation: {}", orientation);
            //     }
            // }
            // if let Some(field) = meta.get_field(exif::Tag::Make, exif::In::PRIMARY) {
            //     println!("Make: {}", field.display_value());
            // }
            // if let Some(field) = meta.get_field(exif::Tag::Model, exif::In::PRIMARY) {
            //     println!("Model: {}", field.display_value());
            // }
            // let location = parse_location(&meta);
            // println!("Location: {:?}", location);
            for f in meta.fields() {
                println!("{}: {}", f.tag, f.display_value().with_unit(&meta));
            }
        }

        let start = std::time::SystemTime::now();
        let img: image::RgbImage = turbojpeg::decompress_image(&raw_img).unwrap();
        let mut img = image::DynamicImage::from(img);
        timings.push(ServerTimingValue {
            name: "decompress",
            dur: ms_since(start),
        });

        let start = std::time::SystemTime::now();
        img = img.thumbnail(1008, 756);
        // img = img.resize(1008, 756, image::imageops::FilterType::Lanczos3);
        timings.push(ServerTimingValue {
            name: "thumbnail",
            dur: ms_since(start),
        });

        let (width, height) = img.dimensions();

        let start = std::time::SystemTime::now();
        // let img = match img {
        //     image::DynamicImage::ImageRgb8(img) => img,
        //     _ => panic!("bad image type"),
        // };
        // let out = turbojpeg::compress_image(&img, 75, turbojpeg::Subsamp::Sub2x2)
        //     .unwrap()
        //     .to_owned();
        let out = webp::Encoder::from_image(&img)
            .unwrap()
            .encode(75.0)
            .to_owned();
        timings.push(ServerTimingValue {
            name: "compress",
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
        res = res.header("content-type", "image/webp");
        // res = res.header("content-type", "image/jpeg");
        res = res.header("server-timing", &thdr);
        res = res.header("x-image-width", width);
        res = res.header("x-image-height", height);
        res.body(axum::body::Body::from(out)).unwrap()

        // (
        //     [
        //         (
        //             axum::http::header::CONTENT_TYPE,
        //             //axum::http::HeaderValue::from_static(mime::IMAGE_JPEG.as_ref()),
        //             axum::http::HeaderValue::from_static("image/webp"),
        //         ),
        //         (
        //             axum::http::header::HeaderName::from_static("server-timing"),
        //             axum::http::HeaderValue::from_str(&thdr).unwrap(),
        //         ),
        //     ],
        //     out,
        // )
        //     .into_response()
    })
    .await
    .unwrap()
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

#[derive(Clone, Debug, Default)]
struct Coordinates {
    lat: f64,
    lon: f64,
}

#[derive(Debug, Clone, Default)]
struct Location {
    coords: Option<Coordinates>,
    altitude: Option<f64>,
}

fn parse_location(e: &exif::Exif) -> Location {
    let mut location = Location::default();

    location.altitude = get_float(e, exif::Tag::GPSAltitude, exif::In::PRIMARY);

    let latitude = parse_coordinate(e, exif::Tag::GPSLatitude, exif::In::PRIMARY).and_then(|v| {
        if let Some(field) = e.get_field(exif::Tag::GPSLatitudeRef, exif::In::PRIMARY) {
            if let exif::Value::Ascii(n) = &field.value {
                if let Some(s) = n.get(0) {
                    if s.starts_with(&[b'S']) {
                        return Some(v * -1.0);
                    }
                }
            }
        }
        Some(v)
    });

    let longitude = parse_coordinate(e, exif::Tag::GPSLongitude, exif::In::PRIMARY).and_then(|v| {
        if let Some(field) = e.get_field(exif::Tag::GPSLongitudeRef, exif::In::PRIMARY) {
            if let exif::Value::Ascii(n) = &field.value {
                if let Some(s) = n.get(0) {
                    if s.starts_with(&[b'W']) {
                        return Some(v * -1.0);
                    }
                }
            }
        }
        Some(v)
    });

    if let (Some(lat), Some(lon)) = (latitude, longitude) {
        location.coords = Some(Coordinates { lat, lon });
    }

    location
}

fn parse_coordinate(e: &exif::Exif, tag: exif::Tag, ifd_num: exif::In) -> Option<f64> {
    if let Some(field) = e.get_field(tag, ifd_num) {
        if let exif::Value::Rational(n) = &field.value {
            if n.len() >= 3 {
                let hours = n[0].to_f64();
                let minutes = n[1].to_f64();
                let seconds = n[2].to_f64();
                return Some(hours + (minutes / 60.0) + (seconds / 3600.0));
            }
        }
    }
    None
}

fn get_float(e: &exif::Exif, tag: exif::Tag, ifd_num: exif::In) -> Option<f64> {
    if let Some(field) = e.get_field(tag, ifd_num) {
        if let exif::Value::Rational(n) = &field.value {
            return n.get(0).and_then(|v| Some(v.to_f64()));
        }
    }
    None
}
