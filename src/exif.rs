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
