use std::{fmt::Display, sync::Arc};

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{
    codecs::{avif::AvifEncoder, png::PngEncoder, tiff::TiffEncoder},
    error::{ImageFormatHint, UnsupportedError, UnsupportedErrorKind},
    DynamicImage, GenericImageView, ImageError, ImageFormat, ImageResult,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

use crate::exif;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InputImageType {
    Avif,
    Jpeg,
    Png,
    Tiff,
    Webp,
}

impl InputImageType {
    fn determine_image_type(buf: &[u8]) -> Option<Self> {
        if buf.len() < 12 {
            return None;
        }

        const JPEG: &[u8; 3] = b"\xFF\xD8\xFF";
        if buf.starts_with(JPEG) {
            return Some(Self::Jpeg);
        }

        const PNG: &[u8; 4] = b"\x89\x50\x4E\x47";
        if buf.starts_with(PNG) {
            return Some(Self::Png);
        }

        const TIFFII: &[u8; 4] = b"\x49\x49\x2A\x00";
        const TIFFMM: &[u8; 4] = b"\x4D\x4D\x00\x2A";
        if buf.starts_with(TIFFII) || buf.starts_with(TIFFMM) {
            return Some(Self::Tiff);
        }

        const WEBP: &[u8; 4] = b"\x57\x45\x42\x50";
        if buf[8..].starts_with(WEBP) {
            return Some(Self::Webp);
        }

        const AVIF: &[u8; 8] = b"ftypavif";
        if buf[4..].starts_with(AVIF) {
            return Some(Self::Avif);
        }

        None
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageType {
    Avif,
    Jpeg,
    Png,
    Tiff,
    Webp,
}

impl From<InputImageType> for ImageType {
    fn from(value: InputImageType) -> Self {
        match value {
            InputImageType::Avif => Self::Avif,
            InputImageType::Jpeg => Self::Jpeg,
            InputImageType::Png => Self::Png,
            InputImageType::Tiff => Self::Tiff,
            InputImageType::Webp => Self::Webp,
        }
    }
}

impl Display for ImageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl ImageType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ImageType::Avif => "avif",
            ImageType::Jpeg => "jpeg",
            ImageType::Png => "png",
            ImageType::Tiff => "tiff",
            ImageType::Webp => "webp",
        }
    }

    pub fn mimetype(&self) -> &'static str {
        match self {
            ImageType::Avif => "image/avif",
            ImageType::Jpeg => "image/jpeg",
            ImageType::Png => "image/png",
            ImageType::Tiff => "image/tiff",
            ImageType::Webp => "image/webp",
        }
    }

    fn default_quality(&self) -> u8 {
        match self {
            ImageType::Avif => 50,
            ImageType::Jpeg => 75,
            ImageType::Png => 75,
            ImageType::Tiff => 75,
            ImageType::Webp => 75,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ProcessOptions {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub out_type: Option<ImageType>,
    pub quality: Option<u8>,
    pub blur: Option<u8>,
}

#[derive(Clone, Debug)]
pub struct ImageOutput {
    pub buf: Vec<u8>,
    pub img_type: ImageType,
    pub width: u32,
    pub height: u32,
    pub orig_size: u64,
    pub orig_type: InputImageType,
    pub orig_width: u32,
    pub orig_height: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct MetadataOptions {
    pub thumbhash: bool,
}

impl MetadataOptions {
    pub fn new(thumbhash: bool) -> Self {
        MetadataOptions { thumbhash }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ImageMetadata {
    pub format: InputImageType,
    pub width: u32,
    pub height: u32,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbhash: Option<String>,
}

pub struct ImageProccessor {
    semaphore: Arc<Semaphore>,
}

impl ImageProccessor {
    pub fn new(num_workers: usize) -> Self {
        let num_workers = num_workers.max(1);
        ImageProccessor {
            semaphore: Arc::new(Semaphore::new(num_workers)),
        }
    }

    pub async fn process_image(&self, b: bytes::Bytes, ops: ProcessOptions) -> Result<ImageOutput> {
        let _permit = self.semaphore.acquire().await?;
        tokio::task::spawn_blocking(move || process_image_inner(b, ops)).await?
    }

    pub async fn metadata(&self, b: bytes::Bytes, ops: MetadataOptions) -> Result<ImageMetadata> {
        let _permit = self.semaphore.acquire().await?;
        tokio::task::spawn_blocking(move || metadata_inner(b, ops)).await?
    }
}

fn process_image_inner(b: bytes::Bytes, ops: ProcessOptions) -> Result<ImageOutput> {
    let body = b.as_ref();
    let img_type = type_from_raw(body)?;

    let img = decode_image(img_type, body)?;
    let img = auto_orient(img, body);
    let (orig_width, orig_height) = img.dimensions();

    let mut out_img = resize(img, ops.width, ops.height);
    let (width, height) = out_img.dimensions();

    if let Some(blur) = ops.blur {
        let sigma = blur.min(100) as f32;
        out_img = out_img.blur(sigma);
    }

    let out_type = ops.out_type.unwrap_or_else(|| img_type.into());
    let quality = ops
        .quality
        .map(|v| v.max(1).min(100))
        .unwrap_or_else(|| out_type.default_quality());
    let buf = encode_image(out_img, out_type, quality)?;

    Ok(ImageOutput {
        buf,
        img_type: out_type,
        width,
        height,
        orig_size: body.len() as u64,
        orig_type: img_type,
        orig_width,
        orig_height,
    })
}

fn type_from_raw(b: &[u8]) -> ImageResult<InputImageType> {
    InputImageType::determine_image_type(b).ok_or_else(|| {
        ImageError::Unsupported(UnsupportedError::from_format_and_kind(
            ImageFormatHint::Unknown,
            UnsupportedErrorKind::Format(ImageFormatHint::Unknown),
        ))
    })
}

fn decode_image(img_type: InputImageType, raw: &[u8]) -> Result<DynamicImage> {
    match img_type {
        InputImageType::Avif => decode_avif(raw),
        InputImageType::Jpeg => decode_jpeg(raw),
        InputImageType::Png => decode_png(raw),
        InputImageType::Tiff => decode_tiff(raw),
        InputImageType::Webp => decode_webp(raw),
    }
}

fn decode_avif(raw: &[u8]) -> Result<DynamicImage> {
    libavif_image::read(raw).map_err(|err| err.into())
}

fn decode_jpeg(raw: &[u8]) -> Result<DynamicImage> {
    let img: image::RgbImage = turbojpeg::decompress_image(raw)?;
    Ok(image::DynamicImage::from(img))
}

fn decode_png(raw: &[u8]) -> Result<DynamicImage> {
    image::load_from_memory_with_format(raw, ImageFormat::Png).map_err(|err| err.into())
}

fn decode_tiff(raw: &[u8]) -> Result<DynamicImage> {
    image::load_from_memory_with_format(raw, ImageFormat::Tiff).map_err(|err| err.into())
}

fn decode_webp(raw: &[u8]) -> Result<DynamicImage> {
    webp::Decoder::new(raw)
        .decode()
        .ok_or_else(|| anyhow!("unable to decode image as webp"))
        .map(|v| v.to_image())
}

fn auto_orient(img: DynamicImage, buf: &[u8]) -> DynamicImage {
    if let Some(e) = exif::read_exif(buf) {
        if let Some(orientation) = exif::get_orientation(&e) {
            return match orientation {
                2 => img.fliph(),
                3 => img.rotate180(),
                4 => img.flipv(),
                5 => img.rotate90().fliph(),
                6 => img.rotate90(),
                7 => img.rotate270().fliph(),
                8 => img.rotate270(),
                _ => img,
            };
        }
    }
    img
}

fn resize(img: DynamicImage, width: Option<u32>, height: Option<u32>) -> DynamicImage {
    let (width, height, should_crop) = get_img_dims(&img, width, height);
    if should_crop {
        let (orig_width, orig_height) = img.dimensions();
        let mut x = 0;
        let mut y = 0;
        let mut crop_width = orig_width;
        let mut crop_height = orig_height;

        let orig_aspect_ratio = orig_width as f32 / orig_height as f32;
        let crop_aspect_ratio = width as f32 / height as f32;
        if orig_aspect_ratio > crop_aspect_ratio {
            crop_width = (crop_aspect_ratio * orig_height as f32).round() as u32;
            x = ((orig_width - crop_width) as f32 / 2.0).round() as u32;
        } else {
            crop_height = (orig_width as f32 / crop_aspect_ratio).round() as u32;
            y = ((orig_height - crop_height) as f32 / 2.0).round() as u32;
        }

        img.crop_imm(x, y, crop_width, crop_height)
            .thumbnail_exact(width, height)
    } else {
        img.thumbnail(width, height)
    }
}

fn get_img_dims(img: &DynamicImage, width: Option<u32>, height: Option<u32>) -> (u32, u32, bool) {
    if let (Some(width), Some(height)) = (width, height) {
        return (width, height, true);
    }

    let (orig_width, orig_height) = img.dimensions();

    if let Some(width) = width {
        if width >= orig_width {
            return (orig_width, orig_height, false);
        }
        return (width, orig_height, false);
    }

    if let Some(height) = height {
        if height >= orig_height {
            return (orig_width, orig_height, false);
        }
        return (orig_width, height, false);
    }

    (orig_width, orig_height, false)
}

fn encode_image(img: DynamicImage, img_type: ImageType, quality: u8) -> Result<Vec<u8>> {
    match img_type {
        ImageType::Avif => encode_avif(img, quality),
        ImageType::Jpeg => encode_jpeg(img, quality),
        ImageType::Png => encode_png(img, quality),
        ImageType::Tiff => encode_tiff(img, quality),
        ImageType::Webp => encode_webp(img, quality),
    }
}

fn encode_avif(img: DynamicImage, quality: u8) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(1 << 15);
    let enc = AvifEncoder::new_with_speed_quality(&mut out, 8, quality);
    img.write_with_encoder(enc)?;
    Ok(out)
}

fn encode_jpeg(img: DynamicImage, quality: u8) -> Result<Vec<u8>> {
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

fn encode_png(img: DynamicImage, _quality: u8) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(1 << 15);
    img.write_with_encoder(PngEncoder::new(&mut out))?;
    Ok(out)
}

fn encode_tiff(img: DynamicImage, _quality: u8) -> Result<Vec<u8>> {
    let mut out = std::io::Cursor::new(Vec::with_capacity(1 << 15));
    img.write_with_encoder(TiffEncoder::new(&mut out))?;
    Ok(out.into_inner())
}

fn encode_webp(img: DynamicImage, quality: u8) -> Result<Vec<u8>> {
    Ok(webp::Encoder::from_image(&img)
        .map_err(|_| anyhow!("unable to encode image as webp"))?
        .encode(quality as f32)
        .to_owned())
}

fn metadata_inner(buf: bytes::Bytes, ops: MetadataOptions) -> Result<ImageMetadata> {
    let format = type_from_raw(&buf)?;
    let img = decode_image(format, &buf)?;
    let img = auto_orient(img, &buf);
    let (width, height) = img.dimensions();
    let hash = if ops.thumbhash {
        Some(get_thumbhash(img))
    } else {
        None
    };

    Ok(ImageMetadata {
        format,
        width,
        height,
        size: buf.len() as u64,
        thumbhash: hash,
    })
}

fn get_thumbhash(mut img: DynamicImage) -> String {
    let (width, height) = img.dimensions();
    if width > 100 || height > 100 {
        img = img.thumbnail(100, 100);
    }
    let (width, height) = img.dimensions();
    let rgba = img.to_rgba8().into_raw();
    let hash = thumbhash::rgba_to_thumb_hash(width as usize, height as usize, &rgba);
    STANDARD.encode(hash)
}
