use std::fmt::Display;

use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use fast_image_resize::{ResizeOptions, Resizer};
use image::{
    DynamicImage, GenericImageView, ImageError, ImageFormat, ImageResult,
    codecs::{avif::AvifEncoder, png::PngEncoder, tiff::TiffEncoder},
    error::{ImageFormatHint, UnsupportedError, UnsupportedErrorKind},
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
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
    pub fn as_str(self) -> &'static str {
        match self {
            ImageType::Avif => "avif",
            ImageType::Jpeg => "jpeg",
            ImageType::Png => "png",
            ImageType::Tiff => "tiff",
            ImageType::Webp => "webp",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "avif" => Some(Self::Avif),
            "jpeg" => Some(Self::Jpeg),
            "png" => Some(Self::Png),
            "tiff" => Some(Self::Tiff),
            "webp" => Some(Self::Webp),
            _ => None,
        }
    }

    pub fn mimetype(self) -> &'static str {
        match self {
            ImageType::Avif => "image/avif",
            ImageType::Jpeg => "image/jpeg",
            ImageType::Png => "image/png",
            ImageType::Tiff => "image/tiff",
            ImageType::Webp => "image/webp",
        }
    }

    fn default_quality(self) -> u32 {
        match self {
            ImageType::Avif => 50,
            ImageType::Jpeg | ImageType::Png | ImageType::Tiff | ImageType::Webp => 75,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize)]
pub struct ProcessOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_type: Option<ImageType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quality: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blur: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ImageOutput {
    #[serde(skip)]
    pub buf: bytes::Bytes,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<exif::Data>,
}

pub struct ImageProccessor {
    semaphore: Semaphore,
}

impl ImageProccessor {
    pub fn new(num_workers: usize) -> Self {
        let num_workers = num_workers.max(1);
        ImageProccessor {
            semaphore: Semaphore::new(num_workers),
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
    let data = exif::ExifData::new(body);

    let img = decode_image(img_type, body)?;
    let img = auto_orient(&data, img);
    let (orig_width, orig_height) = img.dimensions();

    let mut out_img = resize(img, ops.width, ops.height)?;
    let (width, height) = out_img.dimensions();

    if let Some(blur) = ops.blur {
        let sigma = blur.min(100) as f32;
        out_img = out_img.blur(sigma);
    }

    out_img.set_color_space(image::metadata::Cicp::SRGB)?;

    let out_type = ops.out_type.unwrap_or_else(|| img_type.into());
    let quality = ops
        .quality
        .map_or_else(|| out_type.default_quality(), |v| v.clamp(1, 100));
    let buf = encode_image(&out_img, out_type, quality)?;

    Ok(ImageOutput {
        buf: bytes::Bytes::from(buf),
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
    image::load_from_memory_with_format(raw, ImageFormat::Avif).map_err(Into::into)
}

fn decode_jpeg(raw: &[u8]) -> Result<DynamicImage> {
    let img: image::RgbImage = decompress_jpeg_internal(raw)?;
    Ok(image::DynamicImage::from(img))
}

fn decode_png(raw: &[u8]) -> Result<DynamicImage> {
    image::load_from_memory_with_format(raw, ImageFormat::Png).map_err(Into::into)
}

fn decode_tiff(raw: &[u8]) -> Result<DynamicImage> {
    image::load_from_memory_with_format(raw, ImageFormat::Tiff).map_err(Into::into)
}

fn decode_webp(raw: &[u8]) -> Result<DynamicImage> {
    webp::Decoder::new(raw)
        .decode()
        .ok_or_else(|| anyhow!("unable to decode image as webp"))
        .map(|v| v.to_image())
}

fn auto_orient(data: &Option<exif::ExifData>, img: DynamicImage) -> DynamicImage {
    if let Some(data) = data
        && let Some(orientation) = data.get_orientation()
    {
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
    img
}

fn resize(img: DynamicImage, width: Option<u32>, height: Option<u32>) -> Result<DynamicImage> {
    // Calculate new width and height.
    let (orig_width, orig_height) = img.dimensions();
    let (width, height, should_crop) = match (width, height) {
        (Some(width), Some(height)) => {
            if width == orig_width && height == orig_height {
                return Ok(img);
            }
            (width, height, true)
        }
        (Some(width), None) => (width, mul_div_round(width, orig_height, orig_width)?, false),
        (None, Some(height)) => (
            mul_div_round(height, orig_width, orig_height)?,
            height,
            false,
        ),
        (None, None) => {
            return Ok(img);
        }
    };

    let mut out = DynamicImage::new(width, height, img.color());
    let mut resizer = Resizer::new();
    let mut ops = ResizeOptions::new();
    if should_crop {
        ops = ops.fit_into_destination(Some((0.5, 0.5)));
    }
    resizer.resize(&img, &mut out, &ops)?;

    Ok(out)
}

/// Computes round(a * b / c) using u64 to avoid overflow.
/// Returns Err on division by zero or if result doesn't fit u32.
#[inline]
fn mul_div_round(a: u32, b: u32, c: u32) -> Result<u32> {
    if c == 0 {
        return Err(anyhow!("division by zero"));
    }
    let a = a as u64;
    let b = b as u64;
    let c = c as u64;

    // round-to-nearest: (a*b + c/2) / c
    let num = a.saturating_mul(b).saturating_add(c / 2);
    let out = num / c;

    u32::try_from(out).context("dimension overflow")
}

fn encode_image(img: &DynamicImage, img_type: ImageType, quality: u32) -> Result<Vec<u8>> {
    match img_type {
        ImageType::Avif => encode_avif(img, quality),
        ImageType::Jpeg => encode_jpeg(img, quality),
        ImageType::Png => encode_png(img, quality),
        ImageType::Tiff => encode_tiff(img, quality),
        ImageType::Webp => encode_webp(img, quality),
    }
}

fn encode_avif(img: &DynamicImage, quality: u32) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(1 << 15);
    let enc = AvifEncoder::new_with_speed_quality(&mut out, 9, quality as u8);
    img.write_with_encoder(enc)?;
    Ok(out)
}

fn encode_jpeg(img: &DynamicImage, quality: u32) -> Result<Vec<u8>> {
    let quality = quality as i32;
    let out = match img {
        DynamicImage::ImageRgb8(img) => {
            compress_jpeg_internal(img, quality, turbojpeg::Subsamp::Sub2x2)
        }
        DynamicImage::ImageRgba8(img) => {
            compress_jpeg_internal(img, quality, turbojpeg::Subsamp::Sub2x2)
        }
        _ => return Err(anyhow!("unable to encode image as jpeg")),
    }?
    .to_owned();
    Ok(out)
}

fn encode_png(img: &DynamicImage, _quality: u32) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(1 << 15);
    img.write_with_encoder(PngEncoder::new(&mut out))?;
    Ok(out)
}

fn encode_tiff(img: &DynamicImage, _quality: u32) -> Result<Vec<u8>> {
    let mut out = std::io::Cursor::new(Vec::with_capacity(1 << 15));
    img.write_with_encoder(TiffEncoder::new(&mut out))?;
    Ok(out.into_inner())
}

fn encode_webp(img: &DynamicImage, quality: u32) -> Result<Vec<u8>> {
    Ok(webp::Encoder::from_image(img)
        .map_err(|_| anyhow!("unable to encode image as webp"))?
        .encode_simple(false, quality as f32)
        .map_err(|err| anyhow!(format!("webp: {err:?}")))?
        .to_owned())
}

fn metadata_inner(buf: bytes::Bytes, ops: MetadataOptions) -> Result<ImageMetadata> {
    let format = type_from_raw(&buf)?;
    let edata = exif::ExifData::new(&buf);
    let img = decode_image(format, &buf)?;
    let img = auto_orient(&edata, img);
    let (width, height) = img.dimensions();
    let thumbhash = ops.thumbhash.then(|| get_thumbhash(img));

    Ok(ImageMetadata {
        format,
        width,
        height,
        size: buf.len() as u64,
        thumbhash,
        data: edata.map(|edata| edata.get_data()),
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

// Copied from turbojpeg source in order to use our own version of the image crate.

pub fn decompress_jpeg_internal<P>(jpeg_data: &[u8]) -> Result<image::ImageBuffer<P, Vec<u8>>>
where
    P: JpegPixel + 'static,
{
    let mut decompressor = turbojpeg::Decompressor::new()?;
    let header = decompressor.read_header(jpeg_data)?;

    let pitch = header.width * P::PIXEL_FORMAT.size();
    let mut image_data = vec![0; pitch * header.height];
    let image = turbojpeg::Image {
        pixels: &mut image_data[..],
        width: header.width,
        pitch,
        height: header.height,
        format: P::PIXEL_FORMAT,
    };
    decompressor.decompress(jpeg_data, image)?;

    let image_buf =
        image::ImageBuffer::from_raw(header.width as u32, header.height as u32, image_data)
            .unwrap();
    Ok(image_buf)
}

pub fn compress_jpeg_internal<P>(
    image_buf: &image::ImageBuffer<P, Vec<u8>>,
    quality: i32,
    subsamp: turbojpeg::Subsamp,
) -> Result<turbojpeg::OwnedBuf>
where
    P: JpegPixel + 'static,
{
    let (width, height) = image_buf.dimensions();
    let format = P::PIXEL_FORMAT;
    let image = turbojpeg::Image {
        pixels: &image_buf.as_raw()[..],
        width: width as usize,
        pitch: format.size() * width as usize,
        height: height as usize,
        format,
    };

    let mut compressor = turbojpeg::Compressor::new()?;
    compressor.set_quality(quality)?;
    compressor.set_subsamp(subsamp)?;
    Ok(compressor.compress_to_owned(image)?)
}

/// Trait implemented for [`image::Pixel`s][image::Pixel] that correspond to a [`PixelFormat`] supported
/// by TurboJPEG.
#[cfg_attr(docsrs, doc(cfg(feature = "image")))]
pub trait JpegPixel: image::Pixel<Subpixel = u8> {
    /// The TurboJPEG pixel format that corresponds to this pixel type.
    const PIXEL_FORMAT: turbojpeg::PixelFormat;
}

impl JpegPixel for image::Rgb<u8> {
    const PIXEL_FORMAT: turbojpeg::PixelFormat = turbojpeg::PixelFormat::RGB;
}
impl JpegPixel for image::Rgba<u8> {
    const PIXEL_FORMAT: turbojpeg::PixelFormat = turbojpeg::PixelFormat::RGBA;
}
impl JpegPixel for image::Luma<u8> {
    const PIXEL_FORMAT: turbojpeg::PixelFormat = turbojpeg::PixelFormat::GRAY;
}
