# Transform API

Resize, convert, or apply effects to images.

## Endpoints

```
PUT /transform
GET /transform  (requires "fetch" to be enabled)
```

- **PUT**: Upload image in request body
- **GET**: Fetch image from URL (requires `--enable-fetch` flag or `ENABLE_FETCH=1` environment variable)

## Query Parameters

| Parameter     | Type           | Description                                                        |
| ------------- | -------------- | ------------------------------------------------------------------ |
| `url`         | string         | Source image URL (GET only)                                        |
| `format`      | string         | Output format (see [Formats](#formats))                            |
| `width`       | number         | Target width in pixels                                             |
| `height`      | number         | Target height in pixels                                            |
| `quality`     | number         | Output quality (1-100)                                             |
| `effort`      | number         | CPU effort for encoding (see [Effort](#effort))                    |
| `blur`        | boolean/number | `true` for fast 3x3 box blur, or sigma value (0.3-1000)            |
| `greyscale`   | boolean        | Convert to greyscale                                               |
| `lossless`    | boolean        | Use lossless compression (where supported)                         |
| `progressive` | boolean        | Use progressive encoding (JPEG/PNG)                                |
| `fit`         | string         | Resize fit mode (see [Fit Modes](#fit-modes))                      |
| `kernel`      | string         | Resize kernel (see [Kernels](#kernels))                            |
| `position`    | string         | Crop position when using `cover` fit (see [Positions](#positions)) |
| `preset`      | string         | Encoding preset: `default`, `quality`, `size`                      |
| `strict`      | boolean        | Enable strict validation (returns 400 on invalid parameters)       |

## Formats

Supported output formats:

| Format  | Value  | Lossy | Lossless |
| ------- | ------ | ----- | -------- |
| AVIF    | `avif` | Yes   | Yes      |
| GIF     | `gif`  | No    | Yes      |
| HEIC    | `heic` | Yes   | Yes      |
| JPEG    | `jpeg` | Yes   | No       |
| JPEG XL | `jxl`  | Yes   | Yes      |
| PNG     | `png`  | No    | Yes      |
| TIFF    | `tiff` | Yes   | Yes      |
| WebP    | `webp` | Yes   | Yes      |

**Content negotiation**: Pass multiple formats comma-separated (e.g., `format=avif,webp,jpeg`) and imaged will select the first format supported by the client based on the `Accept` header.

## Effort

The `effort` parameter controls CPU time vs compression. Higher values produce smaller files but take longer.

| Format    | Range | Default |
| --------- | ----- | ------- |
| AVIF/HEIC | 0-9   | 2       |
| GIF/PNG   | 1-10  | 4       |
| JPEG XL   | 1-9   | 3       |
| WebP      | 0-6   | 2       |

## Fit Modes

Controls how the image is resized when both `width` and `height` are specified:

| Mode      | Description                                                       |
| --------- | ----------------------------------------------------------------- |
| `cover`   | Crop to fill dimensions exactly (default)                         |
| `contain` | Fit within dimensions, preserving aspect ratio (may have padding) |
| `fill`    | Stretch to fill dimensions exactly (may distort)                  |
| `inside`  | Fit within dimensions, never upscale                              |
| `outside` | Cover dimensions, never downscale                                 |

## Kernels

Resize interpolation algorithm:

| Kernel     | Description                               |
| ---------- | ----------------------------------------- |
| `nearest`  | Nearest neighbor (fastest, pixelated)     |
| `linear`   | Bilinear interpolation                    |
| `cubic`    | Bicubic interpolation                     |
| `mitchell` | Mitchell-Netravali (good for downscaling) |
| `lanczos2` | Lanczos with a=2                          |
| `lanczos3` | Lanczos with a=3 (default, high quality)  |
| `mks2013`  | Magic Kernel Sharp 2013                   |
| `mks2021`  | Magic Kernel Sharp 2021                   |

## Positions

Crop position when using `fit=cover`:

| Position       | Aliases                  |
| -------------- | ------------------------ |
| `center`       | `centre`                 |
| `top`          | `north`                  |
| `right top`    | `northeast`              |
| `right`        | `east`                   |
| `right bottom` | `southeast`              |
| `bottom`       | `south`                  |
| `left bottom`  | `southwest`              |
| `left`         | `west`                   |
| `left top`     | `northwest`              |
| `entropy`      | Focus on high entropy    |
| `attention`    | Focus on attention areas |

## Presets

Presets apply format-specific encoding defaults optimized for different use cases:

| Preset    | Description                     |
| --------- | ------------------------------- |
| `default` | Balanced quality and size       |
| `quality` | Higher quality, larger files    |
| `size`    | Smaller files, more compression |

### Preset Values by Format

**AVIF/HEIC:**

| Preset    | Quality | Effort | Chroma Subsampling |
| --------- | ------- | ------ | ------------------ |
| `default` | 45      | 2      | 4:2:0              |
| `quality` | 60      | 6      | 4:4:4              |
| `size`    | 40      | 6      | 4:2:0              |

**JPEG:**

| Preset    | Quality | Progressive | Chroma Subsampling | MozJPEG |
| --------- | ------- | ----------- | ------------------ | ------- |
| `default` | 75      | Yes         | 4:2:0              | No      |
| `quality` | 90      | No          | 4:4:4              | No      |
| `size`    | 70      | Yes         | 4:2:0              | Yes     |

**JPEG XL:**

| Preset    | Quality | Effort | Decoding Tier |
| --------- | ------- | ------ | ------------- |
| `default` | 75      | 3      | 2             |
| `quality` | 90      | 7      | 0             |
| `size`    | 70      | 7      | 0             |

**PNG:**

| Preset    | Compression | Adaptive Filtering | Palette          |
| --------- | ----------- | ------------------ | ---------------- |
| `default` | 4           | Yes                | No               |
| `quality` | 7           | Yes                | No               |
| `size`    | 9           | Yes                | Yes (256 colors) |

**WebP:**

| Preset    | Quality | Effort | Smart Subsample | Smart Deblock |
| --------- | ------- | ------ | --------------- | ------------- |
| `default` | 75      | 2      | Yes             | No            |
| `quality` | 88      | 5      | Yes             | Yes           |
| `size`    | 70      | 5      | Yes             | No            |

**TIFF:**

| Preset    | Compression | Predictor  |
| --------- | ----------- | ---------- |
| `default` | LZW         | Horizontal |
| `quality` | LZW         | Horizontal |
| `size`    | JPEG (q=80) | -          |

## Response Headers

| Header               | Description                                       |
| -------------------- | ------------------------------------------------- |
| `Content-Type`       | MIME type of the output image                     |
| `X-Image-Width`      | Width of the output image in pixels               |
| `X-Image-Height`     | Height of the output image in pixels              |
| `X-Response-Time-Ms` | Processing time in milliseconds                   |
| `X-Imaged-Warnings`  | Parameter validation warnings (lenient mode only) |

## Parameter Validation

### Lenient Mode (Default)

Invalid parameters are handled gracefully:

- **Out-of-range values are clamped**: `quality=200` becomes `100`
- **Invalid values are ignored**: `blur=abc` applies no blur
- **Unknown parameters are ignored**: Extra parameters don't cause errors
- **Warnings returned**: `X-Imaged-Warnings` header contains adjustment details

```bash
curl -v -X PUT "http://localhost:8000/transform?quality=200" \
  --data-binary @input.jpg -o output.jpg
# Response header: X-Imaged-Warnings: quality: must be at most 100
```

### Strict Mode

Enable with `strict=true` to return 400 Bad Request for any invalid parameter:

```bash
curl -X PUT "http://localhost:8000/transform?quality=abc&strict=true" \
  --data-binary @input.jpg

# Returns 400:
# Invalid parameters:
# - quality: must be a positive integer (got "abc")
```

## Examples

**Resize to 300px width:**

```bash
curl -X PUT "http://localhost:8000/transform?width=300" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg \
  -o output.jpg
```

**Convert to WebP with 80% quality:**

```bash
curl -X PUT "http://localhost:8000/transform?format=webp&quality=80" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg \
  -o output.webp
```

**Resize and crop to 200x200 square:**

```bash
curl -X PUT "http://localhost:8000/transform?width=200&height=200&fit=cover" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg \
  -o output.jpg
```

**Apply greyscale and blur:**

```bash
curl -X PUT "http://localhost:8000/transform?greyscale=true&blur=true" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg \
  -o output.jpg
```

**Gaussian blur with custom sigma:**

```bash
curl -X PUT "http://localhost:8000/transform?blur=5.0" \
  -H "Content-Type: image/jpeg" \
  --data-binary @input.jpg \
  -o output.jpg
```

**Fetch and transform a remote image** (requires `--enable-fetch`):

```bash
curl "http://localhost:8000/transform?url=https://example.com/image.jpg&width=500&format=webp" \
  -o output.webp
```

**Content negotiation with format fallback:**

```bash
curl -H "Accept: image/avif, image/webp, image/jpeg" \
  "http://localhost:8000/transform?format=avif,webp,jpeg&width=800" \
  -X PUT --data-binary @input.jpg -o output
```

**High quality preset:**

```bash
curl -X PUT "http://localhost:8000/transform?format=jpeg&preset=quality" \
  --data-binary @input.jpg \
  -o output.jpg
```

**Size-optimized preset:**

```bash
curl -X PUT "http://localhost:8000/transform?format=webp&preset=size&width=400" \
  --data-binary @input.jpg \
  -o output.webp
```
