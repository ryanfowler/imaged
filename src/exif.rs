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
            .map(|(num, denom)| format!("{}/{}", num, denom))
    }

    fn get_field_string(&self, tag: Tag) -> Option<String> {
        if let Some(field) = self.exif.get_field(tag, In::PRIMARY) {
            if let Value::Ascii(v) = &field.value {
                if !v.is_empty() {
                    return std::str::from_utf8(&v[0]).ok().map(|v| v.to_string());
                }
            }
        }
        None
    }

    fn get_field_rational(&self, tag: Tag) -> Option<(u32, u32)> {
        self.exif.get_field(tag, In::PRIMARY).and_then(|field| {
            if let Value::Rational(v) = &field.value {
                if !v.is_empty() {
                    return Some((v[0].num, v[0].denom));
                }
            }
            None
        })
    }

    fn get_field_u32(&self, tag: Tag) -> Option<u32> {
        self.exif
            .get_field(tag, In::PRIMARY)
            .and_then(|field| field.value.get_uint(0))
    }
}

// #[derive(Clone, Debug, Default)]
// struct Coordinates {
//     lat: f64,
//     lon: f64,
// }

// #[derive(Debug, Clone, Default)]
// struct Location {
//     coords: Option<Coordinates>,
//     altitude: Option<f64>,
// }

// fn parse_location(e: &exif::Exif) -> Location {
//     let mut location = Location::default();

//     location.altitude = get_float(e, exif::Tag::GPSAltitude, exif::In::PRIMARY);

//     let latitude = parse_coordinate(e, exif::Tag::GPSLatitude, exif::In::PRIMARY).and_then(|v| {
//         if let Some(field) = e.get_field(exif::Tag::GPSLatitudeRef, exif::In::PRIMARY) {
//             if let exif::Value::Ascii(n) = &field.value {
//                 if let Some(s) = n.get(0) {
//                     if s.starts_with(&[b'S']) {
//                         return Some(v * -1.0);
//                     }
//                 }
//             }
//         }
//         Some(v)
//     });

//     let longitude = parse_coordinate(e, exif::Tag::GPSLongitude, exif::In::PRIMARY).and_then(|v| {
//         if let Some(field) = e.get_field(exif::Tag::GPSLongitudeRef, exif::In::PRIMARY) {
//             if let exif::Value::Ascii(n) = &field.value {
//                 if let Some(s) = n.get(0) {
//                     if s.starts_with(&[b'W']) {
//                         return Some(v * -1.0);
//                     }
//                 }
//             }
//         }
//         Some(v)
//     });

//     if let (Some(lat), Some(lon)) = (latitude, longitude) {
//         location.coords = Some(Coordinates { lat, lon });
//     }

//     location
// }

// fn parse_coordinate(e: &exif::Exif, tag: exif::Tag, ifd_num: exif::In) -> Option<f64> {
//     if let Some(field) = e.get_field(tag, ifd_num) {
//         if let exif::Value::Rational(n) = &field.value {
//             if n.len() >= 3 {
//                 let hours = n[0].to_f64();
//                 let minutes = n[1].to_f64();
//                 let seconds = n[2].to_f64();
//                 return Some(hours + (minutes / 60.0) + (seconds / 3600.0));
//             }
//         }
//     }
//     None
// }

// fn get_float(e: &exif::Exif, tag: exif::Tag, ifd_num: exif::In) -> Option<f64> {
//     if let Some(field) = e.get_field(tag, ifd_num) {
//         if let exif::Value::Rational(n) = &field.value {
//             return n.get(0).and_then(|v| Some(v.to_f64()));
//         }
//     }
//     None
// }
