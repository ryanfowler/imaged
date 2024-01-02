use std::fmt::Display;

use anyhow::anyhow;
use image::{
    error::{ImageFormatHint, UnsupportedError, UnsupportedErrorKind},
    DynamicImage, GenericImageView, ImageError, ImageFormat, ImageResult,
};

#[derive(Clone, Copy, Debug)]
enum ImageType {
    Jpeg,
    Webp,
}

impl Display for ImageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ImageType::Jpeg => "jpeg",
            ImageType::Webp => "webp",
        })
    }
}

impl ImageType {
    fn from_image_format(fmt: ImageFormat) -> ImageResult<Self> {
        match fmt {
            ImageFormat::Jpeg => Ok(ImageType::Jpeg),
            ImageFormat::WebP => Ok(ImageType::Webp),
            _ => {
                let hint = ImageFormatHint::Exact(fmt);
                Err(ImageError::Unsupported(
                    UnsupportedError::from_format_and_kind(
                        hint.clone(),
                        UnsupportedErrorKind::Format(hint),
                    ),
                ))
            }
        }
    }

    fn from_raw(b: &[u8]) -> ImageResult<Self> {
        Self::from_image_format(image::guess_format(b)?)
    }

    fn to_image_format(&self) -> ImageFormat {
        match self {
            ImageType::Jpeg => ImageFormat::Jpeg,
            ImageType::Webp => ImageFormat::WebP,
        }
    }

    fn mimetype(&self) -> &'static str {
        match self {
            ImageType::Jpeg => "image/jpeg",
            ImageType::Webp => "image/webp",
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct ProcessOptions {
    width: Option<u32>,
    height: Option<u32>,
    out_type: ImageType,
    quality: u8,
}

#[derive(Clone, Debug)]
struct ImageOutput {
    buf: Vec<u8>,
    img_type: ImageType,
    width: u32,
    height: u32,
    orig_type: ImageType,
    orig_width: u32,
    orig_height: u32,
}

pub async fn process_image(b: bytes::Bytes, ops: ProcessOptions) -> Result<(), anyhow::Error> {
    tokio::task::spawn_blocking(move || process_image_inner(b, ops))
        .await
        .unwrap()
}

fn process_image_inner<T: AsRef<[u8]>>(b: T, ops: ProcessOptions) -> Result<(), anyhow::Error> {
    let body = b.as_ref();
    let img_type = ImageType::from_raw(body)?;

    let img = decode_image(img_type, body)?;
    let (orig_width, orig_height) = img.dimensions();

    let out_img = resize(&img, &ops);

    Ok(())
}

fn decode_image(img_type: ImageType, raw: &[u8]) -> Result<DynamicImage, anyhow::Error> {
    match img_type {
        ImageType::Jpeg => decode_jpeg(raw),
        ImageType::Webp => decode_webp(raw),
    }
}

fn decode_jpeg(raw: &[u8]) -> Result<DynamicImage, anyhow::Error> {
    let img: image::RgbImage = turbojpeg::decompress_image(raw)?;
    Ok(image::DynamicImage::from(img))
}

fn decode_webp(raw: &[u8]) -> Result<DynamicImage, anyhow::Error> {
    webp::Decoder::new(raw)
        .decode()
        .ok_or_else(|| anyhow!("unable to decode image as webp"))
        .map(|v| v.to_image())
}

fn resize(img: &DynamicImage, ops: &ProcessOptions) -> DynamicImage {
    let (width, height) = get_img_dims(img, ops);
    img.thumbnail(width, height)
}

fn get_img_dims(img: &DynamicImage, ops: &ProcessOptions) -> (u32, u32) {
    if let (Some(width), Some(height)) = (ops.width, ops.height) {
        return (width, height);
    }

    let (orig_width, orig_height) = img.dimensions();

    if let Some(width) = ops.width {
        if width >= orig_width {
            return (orig_width, orig_height);
        }
        return (width, orig_height);
    }

    if let Some(height) = ops.height {
        if height >= orig_height {
            return (orig_width, orig_height);
        }
        return (orig_width, height);
    }

    (orig_width, orig_height)
}

fn encode_image(
    img: DynamicImage,
    img_type: ImageType,
    quality: u8,
) -> Result<Vec<u8>, anyhow::Error> {
    match img_type {
        ImageType::Jpeg => encode_jpeg(img, quality),
        ImageType::Webp => encode_webp(img, quality),
    }
}

fn encode_jpeg(img: DynamicImage, quality: u8) -> Result<Vec<u8>, anyhow::Error> {
    let quality = quality as i32;
    let out = match img {
        DynamicImage::ImageRgb8(img) => {
            turbojpeg::compress_image(&img, quality, turbojpeg::Subsamp::Sub2x2)
        }
        DynamicImage::ImageRgba8(img) => {
            turbojpeg::compress_image(&img, quality, turbojpeg::Subsamp::Sub2x2)
        }
        _ => return Err(anyhow!("unable to encode image as jpeg")),
    }?
    .to_owned();
    Ok(out)
}

fn encode_webp(img: DynamicImage, quality: u8) -> Result<Vec<u8>, anyhow::Error> {
    Ok(webp::Encoder::from_image(&img)
        .map_err(|_| anyhow!("unable to encode image as webp"))?
        .encode(quality as f32)
        .to_owned())
}
