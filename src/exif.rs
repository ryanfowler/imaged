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

#[cfg(test)]
mod tests {
    use super::*;

    const BYTE: u16 = 1;
    const ASCII: u16 = 2;
    const SHORT: u16 = 3;
    const LONG: u16 = 4;
    const RATIONAL: u16 = 5;

    struct IfdEntry {
        tag: u16,
        field_type: u16,
        count: u32,
        value: Vec<u8>,
    }

    fn ascii(tag: u16, value: &str) -> IfdEntry {
        let mut bytes = value.as_bytes().to_vec();
        bytes.push(0);
        IfdEntry {
            tag,
            field_type: ASCII,
            count: bytes.len() as u32,
            value: bytes,
        }
    }

    fn byte(tag: u16, value: u8) -> IfdEntry {
        IfdEntry {
            tag,
            field_type: BYTE,
            count: 1,
            value: vec![value],
        }
    }

    fn short(tag: u16, value: u16) -> IfdEntry {
        IfdEntry {
            tag,
            field_type: SHORT,
            count: 1,
            value: value.to_le_bytes().to_vec(),
        }
    }

    fn long(tag: u16, value: u32) -> IfdEntry {
        IfdEntry {
            tag,
            field_type: LONG,
            count: 1,
            value: value.to_le_bytes().to_vec(),
        }
    }

    fn rational(tag: u16, values: &[(u32, u32)]) -> IfdEntry {
        let mut value = Vec::with_capacity(values.len() * 8);
        for (num, denom) in values {
            value.extend(num.to_le_bytes());
            value.extend(denom.to_le_bytes());
        }
        IfdEntry {
            tag,
            field_type: RATIONAL,
            count: values.len() as u32,
            value,
        }
    }

    fn ifd_size(entries_len: usize) -> u32 {
        2 + entries_len as u32 * 12 + 4
    }

    fn write_ifd(
        out: &mut Vec<u8>,
        entries: &mut [IfdEntry],
        external: &mut Vec<u8>,
        data_start: u32,
    ) {
        entries.sort_by_key(|entry| entry.tag);
        out.extend((entries.len() as u16).to_le_bytes());

        for entry in entries {
            out.extend(entry.tag.to_le_bytes());
            out.extend(entry.field_type.to_le_bytes());
            out.extend(entry.count.to_le_bytes());

            if entry.value.len() <= 4 {
                out.extend(&entry.value);
                out.resize(out.len() + 4 - entry.value.len(), 0);
            } else {
                let offset = data_start + external.len() as u32;
                out.extend(offset.to_le_bytes());
                external.extend(&entry.value);
            }
        }

        out.extend(0_u32.to_le_bytes());
    }

    fn make_tiff_with_full_exif() -> Vec<u8> {
        let ifd0_len = 6;
        let exif_len = 3;
        let gps_len = 6;
        let ifd0_offset = 8_u32;
        let exif_offset = ifd0_offset + ifd_size(ifd0_len);
        let gps_offset = exif_offset + ifd_size(exif_len);
        let data_start = gps_offset + ifd_size(gps_len);

        let mut ifd0 = vec![
            ascii(0x010f, "Test Camera Make"),
            ascii(0x0110, "Test Camera Model"),
            short(0x0112, 6),
            ascii(0x0131, "Test Software 1.0"),
            long(0x8769, exif_offset),
            long(0x8825, gps_offset),
        ];
        let mut exif = vec![
            rational(0x829a, &[(1, 250)]),
            rational(0x829d, &[(28, 10)]),
            short(0x8827, 400),
        ];
        let mut gps = vec![
            ascii(0x0001, "N"),
            rational(0x0002, &[(40, 1), (26, 1), (46, 1)]),
            ascii(0x0003, "W"),
            rational(0x0004, &[(74, 1), (0, 1), (21, 1)]),
            byte(0x0005, 0),
            rational(0x0006, &[(1005, 10)]),
        ];

        let mut out = Vec::new();
        out.extend(b"II");
        out.extend(42_u16.to_le_bytes());
        out.extend(ifd0_offset.to_le_bytes());

        let mut external = Vec::new();
        write_ifd(&mut out, &mut ifd0, &mut external, data_start);
        write_ifd(&mut out, &mut exif, &mut external, data_start);
        write_ifd(&mut out, &mut gps, &mut external, data_start);
        out.extend(external);
        out
    }

    fn make_tiff_with_make_only() -> Vec<u8> {
        let mut ifd0 = vec![ascii(0x010f, "Test")];
        let data_start = 8 + ifd_size(ifd0.len());

        let mut out = Vec::new();
        out.extend(b"II");
        out.extend(42_u16.to_le_bytes());
        out.extend(8_u32.to_le_bytes());

        let mut external = Vec::new();
        write_ifd(&mut out, &mut ifd0, &mut external, data_start);
        out.extend(external);
        out
    }

    #[test]
    fn parses_camera_info_fields() {
        let buf = make_tiff_with_full_exif();
        let data = ExifData::new(&buf).unwrap().get_data();

        assert_eq!(data.make.as_deref(), Some("Test Camera Make"));
        assert_eq!(data.model.as_deref(), Some("Test Camera Model"));
        assert_eq!(data.software.as_deref(), Some("Test Software 1.0"));
    }

    #[test]
    fn parses_orientation_and_exposure_settings() {
        let buf = make_tiff_with_full_exif();
        let data = ExifData::new(&buf).unwrap().get_data();

        assert_eq!(data.orientation, Some(6));
        assert_eq!(data.exposure_time.as_deref(), Some("1/250"));
        assert_eq!(data.iso, Some(400));
        assert!((data.f_number.unwrap() - 2.8).abs() < f32::EPSILON);
    }

    #[test]
    fn parses_gps_coordinates_and_altitude() {
        let buf = make_tiff_with_full_exif();
        let data = ExifData::new(&buf).unwrap().get_data();

        assert!((data.latitude.unwrap() - 40.44611).abs() < 0.00001);
        assert!((data.longitude.unwrap() + 74.00583).abs() < 0.00001);
        assert_eq!(data.altitude, Some(100.5));
    }

    #[test]
    fn missing_exif_fields_are_none() {
        let buf = make_tiff_with_make_only();
        let data = ExifData::new(&buf).unwrap().get_data();

        assert_eq!(data.make.as_deref(), Some("Test"));
        assert_eq!(data.model, None);
        assert_eq!(data.latitude, None);
        assert_eq!(data.longitude, None);
        assert_eq!(data.altitude, None);
        assert_eq!(data.iso, None);
        assert_eq!(data.f_number, None);
    }
}
