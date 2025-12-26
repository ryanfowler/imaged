use std::io::Cursor;

use exif::{Exif, In, Reader, Tag, Value};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct Data {
    #[serde(skip_serializing_if = "Option::is_none")]
    make: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    software: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    orientation: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    f_number: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    iso: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exposure_time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    latitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    longitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    altitude: Option<f64>,
}

pub struct ExifData {
    exif: Exif,
}

impl ExifData {
    pub fn new(buf: &[u8]) -> Option<Self> {
        let mut cursor = Cursor::new(buf);
        Reader::new()
            .read_from_container(&mut cursor)
            .ok()
            .map(|exif| Self { exif })
    }

    pub fn get_data(&self) -> Data {
        Data {
            make: self.get_make(),
            model: self.get_model(),
            software: self.get_software(),
            orientation: self.get_orientation(),
            f_number: self.get_f_number(),
            iso: self.get_iso(),
            exposure_time: self.get_exposure_time(),
            latitude: self.get_latitude(),
            longitude: self.get_longitude(),
            altitude: self.get_altitude(),
        }
    }

    pub fn get_orientation(&self) -> Option<u32> {
        self.get_field_u32(Tag::Orientation)
    }

    fn get_make(&self) -> Option<String> {
        self.get_field_string(Tag::Make)
    }

    fn get_model(&self) -> Option<String> {
        self.get_field_string(Tag::Model)
    }

    fn get_software(&self) -> Option<String> {
        self.get_field_string(Tag::Software)
    }

    fn get_f_number(&self) -> Option<f32> {
        self.get_field_rational(Tag::FNumber)
            .map(|(num, denom)| num as f32 / denom as f32)
    }

    fn _get_aperture(&self) -> Option<f32> {
        self.get_field_rational(Tag::ApertureValue)
            .map(|(num, denom)| num as f32 / denom as f32)
            .map(|v| (2_f32.powf(v).sqrt() * 10.0).round() / 10.0)
    }

    fn get_iso(&self) -> Option<u32> {
        self.get_field_u32(Tag::PhotographicSensitivity)
    }

    fn get_exposure_time(&self) -> Option<String> {
        self.get_field_rational(Tag::ExposureTime)
            .map(|(num, denom)| format!("{num}/{denom}"))
    }

    fn get_latitude(&self) -> Option<f64> {
        self.get_coordinate(Tag::GPSLatitude)
            .map(|v| {
                if let Some(field) = self.exif.get_field(Tag::GPSLatitudeRef, In::PRIMARY)
                    && let exif::Value::Ascii(n) = &field.value
                    && let Some(s) = n.first()
                    && s.starts_with(b"S")
                {
                    return -v;
                }
                v
            })
            .map(|v| (100_000.0 * v).round() / 100_000.0)
    }

    fn get_longitude(&self) -> Option<f64> {
        self.get_coordinate(Tag::GPSLongitude)
            .map(|v| {
                if let Some(field) = self.exif.get_field(Tag::GPSLongitudeRef, In::PRIMARY)
                    && let exif::Value::Ascii(n) = &field.value
                    && let Some(s) = n.first()
                    && s.starts_with(b"W")
                {
                    return -v;
                }
                v
            })
            .map(|v| (100_000.0 * v).round() / 100_000.0)
    }

    fn get_altitude(&self) -> Option<f64> {
        self.get_float64(Tag::GPSAltitude)
            .map(|v| {
                if let Some(1) = self.get_field_u32(Tag::GPSAltitudeRef) {
                    -v
                } else {
                    v
                }
            })
            .map(|v| (10.0 * v).round() / 10.0)
    }

    fn get_coordinate(&self, tag: Tag) -> Option<f64> {
        if let Some(field) = self.exif.get_field(tag, In::PRIMARY)
            && let Value::Rational(n) = &field.value
            && n.len() >= 3
        {
            let hours = n[0].to_f64();
            let minutes = n[1].to_f64();
            let seconds = n[2].to_f64();
            return Some(hours + (minutes / 60.0) + (seconds / 3600.0));
        }
        None
    }

    fn get_field_string(&self, tag: Tag) -> Option<String> {
        if let Some(field) = self.exif.get_field(tag, In::PRIMARY)
            && let Value::Ascii(v) = &field.value
            && !v.is_empty()
        {
            return std::str::from_utf8(&v[0]).ok().map(ToString::to_string);
        }
        None
    }

    fn get_field_rational(&self, tag: Tag) -> Option<(u32, u32)> {
        self.exif.get_field(tag, In::PRIMARY).and_then(|field| {
            if let Value::Rational(v) = &field.value
                && !v.is_empty()
            {
                return Some((v[0].num, v[0].denom));
            }
            None
        })
    }

    fn get_field_u32(&self, tag: Tag) -> Option<u32> {
        self.exif
            .get_field(tag, In::PRIMARY)
            .and_then(|field| field.value.get_uint(0))
    }

    fn get_float64(&self, tag: Tag) -> Option<f64> {
        self.exif.get_field(tag, In::PRIMARY).and_then(|field| {
            if let exif::Value::Rational(v) = &field.value {
                return v.first().map(exif::Rational::to_f64);
            }
            None
        })
    }
}
