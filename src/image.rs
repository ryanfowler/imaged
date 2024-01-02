use std::{fmt::Display, sync::Arc};

use anyhow::anyhow;
use image::{
    codecs::{png::PngEncoder, tiff::TiffEncoder},
    error::{ImageFormatHint, UnsupportedError, UnsupportedErrorKind},
    DynamicImage, GenericImageView, ImageError, ImageFormat, ImageResult,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub enum ImageType {
    #[serde(rename = "avif")]
    Avif,
    #[serde(rename = "jpeg")]
    Jpeg,
    #[serde(rename = "png")]
    Png,
    #[serde(rename = "tiff")]
    Tiff,
    #[serde(rename = "webp")]
    Webp,
}

impl Display for ImageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
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

    pub fn as_str(&self) -> &'static str {
        match self {
            ImageType::Avif => "avif",
            ImageType::Jpeg => "jpeg",
            ImageType::Png => "png",
            ImageType::Tiff => "tiff",
            ImageType::Webp => "webp",
        }
    }

    fn from_raw(b: &[u8]) -> ImageResult<Self> {
        Self::from_image_format(image::guess_format(b)?)
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
    pub orig_type: ImageType,
    pub orig_width: u32,
    pub orig_height: u32,
}

#[derive(Clone, Debug)]
pub struct ImageProccessor {
    semaphore: Arc<Semaphore>,
}

impl ImageProccessor {
    pub fn new(num_workers: usize) -> Self {
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
    let img_type = ImageType::from_raw(body)?;

    let img = decode_image(img_type, body)?;
    let (orig_width, orig_height) = img.dimensions();

    let out_img = resize(&img, &ops);
    let (width, height) = out_img.dimensions();

    let out_type = ops.out_type.unwrap_or(img_type);
    let quality = ops.quality.unwrap_or_else(|| out_type.default_quality());
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

fn decode_image(img_type: ImageType, raw: &[u8]) -> Result<DynamicImage, anyhow::Error> {
    match img_type {
        ImageType::Avif => decode_avif(raw),
        ImageType::Jpeg => decode_jpeg(raw),
        ImageType::Png => decode_png(raw),
        ImageType::Tiff => decode_tiff(raw),
        ImageType::Webp => decode_webp(raw),
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

fn resize(img: &DynamicImage, ops: &ProcessOptions) -> DynamicImage {
    let (width, height) = get_img_dims(img, ops);
    img.thumbnail(width, height)
}

fn get_img_dims(img: &DynamicImage, ops: &ProcessOptions) -> (u32, u32) {
    if let (Some(width), Some(height)) = (ops.width, ops.height) {
        // TODO(rfowler): Crop image if necessary.
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
