# Metadata API

Extract image dimensions, EXIF data, statistics, and generate thumbhash placeholders.

## Endpoints

```
PUT /metadata
GET /metadata  (requires --enable-fetch)
```

- **PUT**: Upload image in request body
- **GET**: Fetch image from URL (requires `--enable-fetch` flag)

## Query Parameters

| Parameter   | Type    | Description                                                          |
| ----------- | ------- | -------------------------------------------------------------------- |
| `url`       | string  | Source image URL (GET only)                                          |
| `exif`      | boolean | Include EXIF metadata                                                |
| `stats`     | boolean | Include image statistics                                             |
| `thumbhash` | boolean | Generate [thumbhash](https://evanw.github.io/thumbhash/) placeholder |
| `strict`    | boolean | Enable strict validation (returns 400 on invalid)                    |

## Response Schema

### Basic Response

Always included in the response:

```json
{
  "width": 1920,
  "height": 1080,
  "format": "jpeg",
  "size": 245678,
  "space": "srgb",
  "channels": 3,
  "depth": "uchar",
  "hasProfile": true,
  "hasAlpha": false
}
```

| Field        | Type    | Description                                  |
| ------------ | ------- | -------------------------------------------- |
| `width`      | number  | Image width in pixels                        |
| `height`     | number  | Image height in pixels                       |
| `format`     | string  | Detected format (avif, gif, jpeg, png, etc.) |
| `size`       | number  | File size in bytes                           |
| `space`      | string  | Color space (srgb, p3, cmyk, etc.)           |
| `channels`   | number  | Number of channels (3 for RGB, 4 for RGBA)   |
| `depth`      | string  | Bit depth (uchar, ushort, float, etc.)       |
| `hasProfile` | boolean | Whether ICC profile is embedded              |
| `hasAlpha`   | boolean | Whether image has alpha channel              |

### Optional Fields

These fields appear when present in the image:

| Field               | Type    | Description                          |
| ------------------- | ------- | ------------------------------------ |
| `density`           | number  | Pixels per inch (PPI/DPI)            |
| `resolutionUnit`    | string  | Resolution unit (inch, cm)           |
| `chromaSubsampling` | string  | Chroma subsampling (4:4:4, 4:2:0)    |
| `isProgressive`     | boolean | Progressive/interlaced encoding      |
| `isPalette`         | boolean | Palette-based image                  |
| `bitsPerSample`     | number  | Bits per sample                      |
| `pages`             | number  | Number of pages (multi-page formats) |
| `pageHeight`        | number  | Height of each page                  |
| `loop`              | number  | Animation loop count                 |
| `delay`             | array   | Frame delays in ms (animated images) |
| `background`        | object  | Background color ({r,g,b} or {gray}) |
| `orientation`       | number  | EXIF orientation (1-8)               |

## EXIF Data

Request with `exif=true` to include EXIF metadata:

```json
{
  "width": 4032,
  "height": 3024,
  "format": "jpeg",
  "exif": {
    "make": "Apple",
    "model": "iPhone 14 Pro",
    "datetime": "2024-01-15T10:30:00-05:00",
    "exposure_time": 0.008,
    "f_number": 1.78,
    "focal_length": 6.86,
    "focal_length_35mm": 24,
    "iso": 50,
    "flash": "Did not fire",
    "exposure_program": "Normal program",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "altitude": 12.5
  }
}
```

### EXIF Fields

Only fields present in the image are returned.

**Camera Information:**

| Field         | Type   | Description               |
| ------------- | ------ | ------------------------- |
| `make`        | string | Camera manufacturer       |
| `model`       | string | Camera model              |
| `software`    | string | Software used             |
| `lens_make`   | string | Lens manufacturer         |
| `lens_model`  | string | Lens model                |
| `lens_serial` | string | Lens serial number        |
| `body_serial` | string | Camera body serial number |
| `unique_id`   | string | Unique image identifier   |

**Capture Settings:**

| Field                   | Type   | Description                  |
| ----------------------- | ------ | ---------------------------- |
| `datetime`              | string | Capture date/time (ISO 8601) |
| `orientation`           | string | Image orientation            |
| `exposure_time`         | number | Exposure time in seconds     |
| `f_number`              | number | Aperture f-number            |
| `focal_length`          | number | Actual focal length in mm    |
| `focal_length_35mm`     | number | 35mm equivalent focal length |
| `iso`                   | number | ISO sensitivity              |
| `flash`                 | string | Flash status                 |
| `exposure_program`      | string | Exposure program mode        |
| `exposure_compensation` | number | Exposure compensation in EV  |
| `metering_mode`         | string | Metering mode                |
| `white_balance`         | string | White balance setting        |
| `color_space`           | string | Color space                  |
| `brightness`            | number | Brightness value             |
| `max_aperture`          | number | Maximum aperture             |
| `subject_distance`      | number | Subject distance in meters   |
| `light_source`          | string | Light source type            |
| `scene_capture_type`    | string | Scene capture type           |
| `contrast`              | string | Contrast setting             |
| `saturation`            | string | Saturation setting           |
| `sharpness`             | string | Sharpness setting            |
| `digital_zoom`          | number | Digital zoom ratio           |

**GPS Data:**

| Field           | Type   | Description                     |
| --------------- | ------ | ------------------------------- |
| `latitude`      | number | GPS latitude (decimal degrees)  |
| `longitude`     | number | GPS longitude (decimal degrees) |
| `altitude`      | number | GPS altitude in meters          |
| `speed`         | number | GPS speed                       |
| `direction`     | number | GPS direction in degrees        |
| `gps_timestamp` | string | GPS timestamp                   |

**Metadata:**

| Field          | Type   | Description         |
| -------------- | ------ | ------------------- |
| `description`  | string | Image description   |
| `artist`       | string | Artist/creator name |
| `copyright`    | string | Copyright notice    |
| `user_comment` | string | User comment        |
| `rating`       | number | Rating (0-5)        |

## Stats

Request with `stats=true` to include image statistics:

```json
{
  "width": 1920,
  "height": 1080,
  "format": "jpeg",
  "stats": {
    "isOpaque": true,
    "entropy": 7.234,
    "sharpness": 0.456,
    "dominant": { "r": 128, "g": 64, "b": 32 },
    "channels": [
      { "min": 0, "max": 255, "mean": 127.5, "stdev": 64.2 },
      { "min": 0, "max": 255, "mean": 115.3, "stdev": 58.1 },
      { "min": 0, "max": 255, "mean": 98.7, "stdev": 52.4 }
    ]
  }
}
```

| Field       | Type    | Description                                    |
| ----------- | ------- | ---------------------------------------------- |
| `isOpaque`  | boolean | True if no transparent pixels                  |
| `entropy`   | number  | Image entropy (higher = more detail)           |
| `sharpness` | number  | Sharpness measure                              |
| `dominant`  | object  | Dominant color as RGB                          |
| `channels`  | array   | Per-channel statistics (min, max, mean, stdev) |

## Thumbhash

Request with `thumbhash=true` to generate a [thumbhash](https://evanw.github.io/thumbhash/) placeholder:

```json
{
  "width": 1920,
  "height": 1080,
  "format": "jpeg",
  "thumbhash": "3OcRJYB4d3h/iIeHeEh3eIhw+j3A"
}
```

Thumbhash is a compact image placeholder that encodes a tiny version of the image (~20-30 bytes) that can be decoded client-side to show a blurred preview while the full image loads.

## Parameter Validation

### Lenient Mode (Default)

Invalid boolean values are ignored without error:

```bash
curl -X PUT "http://localhost:8000/metadata?exif=maybe" \
  --data-binary @input.jpg
# exif is ignored, returns basic metadata
```

### Strict Mode

Enable with `strict=true` to return 400 Bad Request for invalid parameters:

```bash
curl -X PUT "http://localhost:8000/metadata?exif=maybe&strict=true" \
  --data-binary @input.jpg

# Returns 400:
{
  "error": "Invalid parameters",
  "details": [
    { "param": "exif", "value": "maybe", "reason": "must be true, false, 1, or 0" }
  ]
}
```

## Examples

**Get basic metadata:**

```bash
curl -X PUT "http://localhost:8000/metadata" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg
```

**Get metadata with EXIF:**

```bash
curl -X PUT "http://localhost:8000/metadata?exif=true" \
  -H "Content-Type: image/jpeg" \
  --data-binary @photo.jpg
```

**Get all optional data:**

```bash
curl -X PUT "http://localhost:8000/metadata?exif=true&stats=true&thumbhash=true" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg
```

**Fetch metadata from URL** (requires `--enable-fetch`):

```bash
curl "http://localhost:8000/metadata?url=https://example.com/image.jpg&exif=true"
```

**Generate thumbhash only:**

```bash
curl -X PUT "http://localhost:8000/metadata?thumbhash=true" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg
```
