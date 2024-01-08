use std::{fmt::Display, sync::Arc};

use anyhow::anyhow;
use image::{
    codecs::{png::PngEncoder, tiff::TiffEncoder},
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
    fn from_image_format(fmt: ImageFormat) -> ImageResult<Self> {
        match fmt {
            ImageFormat::Avif => Ok(InputImageType::Avif),
            ImageFormat::Jpeg => Ok(InputImageType::Jpeg),
            ImageFormat::Png => Ok(InputImageType::Png),
            ImageFormat::Tiff => Ok(InputImageType::Tiff),
            ImageFormat::WebP => Ok(InputImageType::Webp),
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

    fn to_image_format(&self) -> ImageFormat {
        match self {
            ImageType::Avif => ImageFormat::Avif,
            ImageType::Jpeg => ImageFormat::Jpeg,
            ImageType::Png => ImageFormat::Png,
            ImageType::Tiff => ImageFormat::Tiff,
            ImageType::Webp => ImageFormat::WebP,
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
}

#[derive(Clone, Debug)]
pub struct ImageOutput {
    pub buf: Vec<u8>,
    pub img_type: ImageType,
    pub width: u32,
    pub height: u32,
    pub orig_type: InputImageType,
    pub orig_width: u32,
    pub orig_height: u32,
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

    pub async fn process_image(
        &self,
        b: bytes::Bytes,
        ops: ProcessOptions,
    ) -> Result<ImageOutput, anyhow::Error> {
        let _permit = self.semaphore.acquire().await?;
        tokio::task::spawn_blocking(move || process_image_inner(b, ops)).await?
    }
}

fn process_image_inner<T: AsRef<[u8]>>(
    b: T,
    ops: ProcessOptions,
) -> Result<ImageOutput, anyhow::Error> {
    let body = b.as_ref();
    let img_type = from_raw(body)?;

    let img = decode_image(img_type, body)?;
    let img = auto_orient(img, body);
    let (orig_width, orig_height) = img.dimensions();

    let out_img = resize(img, &ops);
    let (width, height) = out_img.dimensions();

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
        orig_type: img_type,
        orig_width,
        orig_height,
    })
}

fn from_raw(b: &[u8]) -> ImageResult<InputImageType> {
    image::guess_format(b).and_then(|res| InputImageType::from_image_format(res))
}

fn decode_image(img_type: InputImageType, raw: &[u8]) -> Result<DynamicImage, anyhow::Error> {
    match img_type {
        InputImageType::Avif => decode_avif(raw),
        InputImageType::Jpeg => decode_jpeg(raw),
        InputImageType::Png => decode_png(raw),
        InputImageType::Tiff => decode_tiff(raw),
        InputImageType::Webp => decode_webp(raw),
    }
}

fn decode_avif(raw: &[u8]) -> Result<DynamicImage, anyhow::Error> {
    Ok(libavif_image::read(raw)?)
}

fn decode_jpeg(raw: &[u8]) -> Result<DynamicImage, anyhow::Error> {
    let img: image::RgbImage = turbojpeg::decompress_image(raw)?;
    Ok(image::DynamicImage::from(img))
}

fn decode_png(raw: &[u8]) -> Result<DynamicImage, anyhow::Error> {
    Ok(image::load_from_memory_with_format(
        raw,
        ImageType::Png.to_image_format(),
    )?)
}

fn decode_tiff(raw: &[u8]) -> Result<DynamicImage, anyhow::Error> {
    Ok(image::load_from_memory_with_format(
        raw,
        ImageType::Tiff.to_image_format(),
    )?)
}

fn decode_webp(raw: &[u8]) -> Result<DynamicImage, anyhow::Error> {
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

fn resize(img: DynamicImage, ops: &ProcessOptions) -> DynamicImage {
    let (width, height, should_crop) = get_img_dims(&img, ops);
    if should_crop {
        let (orig_width, orig_height) = img.dimensions();
        let mut x = 0;
        let mut y = 0;
        let mut crop_width = orig_width;
        let mut crop_height = orig_height;

        let aspect_ratio = orig_width as f32 / orig_height as f32;
        let crop_aspect_ratio = width as f32 / height as f32;
        if aspect_ratio > crop_aspect_ratio {
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

fn get_img_dims(img: &DynamicImage, ops: &ProcessOptions) -> (u32, u32, bool) {
    if let (Some(width), Some(height)) = (ops.width, ops.height) {
        return (width, height, true);
    }

    let (orig_width, orig_height) = img.dimensions();

    if let Some(width) = ops.width {
        if width >= orig_width {
            return (orig_width, orig_height, false);
        }
        return (width, orig_height, false);
    }

    if let Some(height) = ops.height {
        if height >= orig_height {
            return (orig_width, orig_height, false);
        }
        return (orig_width, height, false);
    }

    (orig_width, orig_height, false)
}

fn encode_image(
    img: DynamicImage,
    img_type: ImageType,
    quality: u8,
) -> Result<Vec<u8>, anyhow::Error> {
    match img_type {
        ImageType::Avif => encode_avif(img, quality),
        ImageType::Jpeg => encode_jpeg(img, quality),
        ImageType::Png => encode_png(img, quality),
        ImageType::Tiff => encode_tiff(img, quality),
        ImageType::Webp => encode_webp(img, quality),
    }
}

fn encode_avif(img: DynamicImage, quality: u8) -> Result<Vec<u8>, anyhow::Error> {
    Ok(match img {
        DynamicImage::ImageRgb8(img) => {
            let rgb = img.as_flat_samples();
            encode_avif_rgb8(img.width(), img.height(), rgb.as_slice(), quality)?
        }
        DynamicImage::ImageRgba8(img) => {
            let rgb = img.as_flat_samples();
            encode_avif_rgb8(img.width(), img.height(), rgb.as_slice(), quality)?
        }
        DynamicImage::ImageLuma8(img) => {
            let rgb = img.as_flat_samples();
            encode_avif_rgb8(img.width(), img.height(), rgb.as_slice(), quality)?
        }
        _ => return Err(libavif::Error::UnsupportedImageType)?,
    })
}

fn encode_avif_rgb8(
    width: u32,
    height: u32,
    rgb: &[u8],
    quality: u8,
) -> Result<Vec<u8>, anyhow::Error> {
    let image = if (width * height) as usize == rgb.len() {
        libavif::AvifImage::from_luma8(width, height, rgb)?
    } else {
        let rgb = libavif::RgbPixels::new(width, height, rgb)?;
        rgb.to_image(libavif::YuvFormat::Yuv444)
    };
    Ok(libavif::Encoder::new()
        .set_quality(quality)
        .set_alpha_quality(quality)
        .set_speed(8)
        .encode(&image)?
        .to_vec())
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

fn encode_png(img: DynamicImage, _quality: u8) -> Result<Vec<u8>, anyhow::Error> {
    let mut out = Vec::with_capacity(1 << 15);
    img.write_with_encoder(PngEncoder::new(&mut out))?;
    Ok(out)
}

fn encode_tiff(img: DynamicImage, _quality: u8) -> Result<Vec<u8>, anyhow::Error> {
    let mut out = std::io::Cursor::new(Vec::with_capacity(1 << 15));
    img.write_with_encoder(TiffEncoder::new(&mut out))?;
    Ok(out.into_inner())
}

fn encode_webp(img: DynamicImage, quality: u8) -> Result<Vec<u8>, anyhow::Error> {
    Ok(webp::Encoder::from_image(&img)
        .map_err(|_| anyhow!("unable to encode image as webp"))?
        .encode(quality as f32)
        .to_owned())
}
