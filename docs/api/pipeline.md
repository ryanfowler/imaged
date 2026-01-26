# Pipeline API

Process a single image into multiple transformed outputs and upload them directly to S3. This endpoint enables batch processing workflows where one source image needs to be converted into multiple sizes, formats, or variants.

## Requirements

- **Runtime**: Bun only (not supported on Node.js)
- **Opt-In**: The `--enable-pipeline` flag or `ENABLE_PIPELINE=1` environment variable must be set
- **Credentials**: AWS credentials must be configured (`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`)

## Endpoint

```
PUT /pipeline  (requires "fetch" to be enabled)
```

## Request Formats

### JSON with URL Fetch

Requires `--enable-fetch` flag or `ENABLE_FETCH=1` environment variable.

```http
PUT /pipeline
Content-Type: application/json

{
  "url": "https://example.com/image.jpg",
  "metadata": { "exif": true, "thumbhash": true },
  "tasks": [
    {
      "id": "thumbnail",
      "transform": { "format": "webp", "width": 150, "height": 150, "fit": "cover" },
      "output": { "bucket": "my-bucket", "key": "images/thumb.webp" },
      "metadata": { "thumbhash": true }
    },
    {
      "id": "full",
      "transform": { "format": "avif", "quality": 80 },
      "output": { "bucket": "my-bucket", "key": "images/full.avif", "acl": "public-read" },
      "metadata": {}
    }
  ]
}
```

### Multipart Form Data

Upload image directly:

```http
PUT /pipeline
Content-Type: multipart/form-data

--boundary
Content-Disposition: form-data; name="config"

{"tasks":[...]}
--boundary
Content-Disposition: form-data; name="file"; filename="image.jpg"
Content-Type: image/jpeg

<binary image data>
--boundary--
```

## Configuration Schema

### Top-Level Config

| Field      | Type   | Required | Description                                  |
| ---------- | ------ | -------- | -------------------------------------------- |
| `url`      | string | No\*     | Source image URL (requires `--enable-fetch`) |
| `metadata` | object | No       | Extract metadata from **source** image       |
| `tasks`    | array  | Yes      | Array of transform tasks                     |

\*Either `url` (JSON) or `file` part (multipart) must be provided.

### Task Schema

| Field       | Type   | Required | Description                                  |
| ----------- | ------ | -------- | -------------------------------------------- |
| `id`        | string | Yes      | Unique identifier for the task               |
| `transform` | object | Yes      | Transform options                            |
| `output`    | object | Yes      | S3 output configuration                      |
| `metadata`  | object | No       | Extract metadata from **transformed output** |

### Transform Options

Same as [Transform API](transform.md) query parameters:

| Field         | Type           | Description              |
| ------------- | -------------- | ------------------------ |
| `format`      | string         | Output format (required) |
| `width`       | number         | Target width in pixels   |
| `height`      | number         | Target height in pixels  |
| `quality`     | number         | Output quality (1-100)   |
| `effort`      | number         | CPU effort for encoding  |
| `blur`        | boolean/number | Apply blur effect        |
| `greyscale`   | boolean        | Convert to greyscale     |
| `lossless`    | boolean        | Use lossless compression |
| `progressive` | boolean        | Use progressive encoding |
| `fit`         | string         | Resize fit mode          |
| `kernel`      | string         | Resize kernel            |
| `position`    | string         | Crop position            |
| `preset`      | string         | Encoding preset          |

### S3 Output Options

| Field         | Type   | Required | Description                      |
| ------------- | ------ | -------- | -------------------------------- |
| `bucket`      | string | Yes      | S3 bucket name                   |
| `key`         | string | Yes      | S3 object key (path)             |
| `acl`         | string | No       | S3 ACL (e.g., `public-read`)     |
| `contentType` | string | No       | Override auto-detected MIME type |

### Metadata Options

Both global and per-task metadata support:

| Field       | Type    | Description                    |
| ----------- | ------- | ------------------------------ |
| `exif`      | boolean | Include EXIF data              |
| `stats`     | boolean | Include image statistics       |
| `thumbhash` | boolean | Generate thumbhash placeholder |

Providing an empty metadata object (`"metadata": {}`) returns basic metadata (dimensions, format, size) without EXIF, stats, or thumbhash.

## Global vs Per-Task Metadata

The pipeline supports two types of metadata extraction:

| Type         | Config Location   | Extracts From      | Use Case                         |
| ------------ | ----------------- | ------------------ | -------------------------------- |
| **Global**   | `config.metadata` | Source image       | Original EXIF, source dimensions |
| **Per-Task** | `task.metadata`   | Transformed output | Output thumbhash, output stats   |

Both can be used together:

```json
{
  "url": "...",
  "metadata": { "exif": true },
  "tasks": [
    {
      "id": "thumb",
      "transform": { "format": "webp", "width": 200 },
      "output": { "bucket": "...", "key": "..." },
      "metadata": { "thumbhash": true }
    }
  ]
}
```

## Response Format

### Success Response

```json
{
  "totalDurationMs": 245,
  "metadata": {
    "format": "jpeg",
    "width": 4000,
    "height": 3000,
    "exif": { "make": "Canon", "model": "EOS R5" },
    "thumbhash": "YJeGBwY3d4eId..."
  },
  "tasks": [
    {
      "id": "thumbnail",
      "status": "success",
      "durationMs": 45,
      "output": {
        "format": "webp",
        "width": 150,
        "height": 150,
        "size": 8234,
        "url": "https://my-bucket.s3.us-east-1.amazonaws.com/images/thumb.webp"
      },
      "metadata": {
        "format": "webp",
        "width": 150,
        "height": 150,
        "size": 8234,
        "thumbhash": "HBkSHYSIeHiP..."
      }
    }
  ]
}
```

### Task Failure

Failed tasks include an `error` field instead of `output`:

```json
{
  "id": "failed-task",
  "status": "failed",
  "durationMs": 5,
  "error": "S3 upload failed: Access Denied"
}
```

Other tasks continue processing when one fails.

## AWS Configuration

### Required Environment Variables

| Variable                | Required | Description           |
| ----------------------- | -------- | --------------------- |
| `AWS_ACCESS_KEY_ID`     | Yes      | AWS access key ID     |
| `AWS_SECRET_ACCESS_KEY` | Yes      | AWS secret access key |

### Optional Environment Variables

| Variable           | Default     | Description            |
| ------------------ | ----------- | ---------------------- |
| `AWS_REGION`       | `us-east-1` | AWS region for S3      |
| `AWS_ENDPOINT_URL` | -           | Custom S3 endpoint URL |

If `--enable-pipeline` is set but credentials are missing, the server will exit with an error.

## S3-Compatible Services

Use `AWS_ENDPOINT_URL` for S3-compatible services:

**DigitalOcean Spaces:**

```bash
AWS_ACCESS_KEY_ID=your-key \
AWS_SECRET_ACCESS_KEY=your-secret \
AWS_ENDPOINT_URL=https://nyc3.digitaloceanspaces.com \
bun run index.ts --enable-pipeline
```

**Cloudflare R2:**

```bash
AWS_ACCESS_KEY_ID=your-key \
AWS_SECRET_ACCESS_KEY=your-secret \
AWS_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com \
bun run index.ts --enable-pipeline
```

## Examples

### JSON Request with URL Fetch

```bash
curl -X PUT http://localhost:8000/pipeline \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/photo.jpg",
    "tasks": [
      {
        "id": "thumb",
        "transform": { "format": "webp", "width": 200 },
        "output": { "bucket": "my-bucket", "key": "thumb.webp" }
      }
    ]
  }'
```

### Multipart Request with File Upload

```bash
curl -X PUT http://localhost:8000/pipeline \
  -F 'config={"tasks":[{"id":"t1","transform":{"format":"webp","width":300},"output":{"bucket":"my-bucket","key":"out.webp"}}]}' \
  -F 'file=@photo.jpg'
```

### Multiple Output Formats

```bash
curl -X PUT http://localhost:8000/pipeline \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/photo.jpg",
    "metadata": { "exif": true },
    "tasks": [
      {
        "id": "avif",
        "transform": { "format": "avif", "width": 800, "quality": 60 },
        "output": { "bucket": "images", "key": "photo.avif", "acl": "public-read" }
      },
      {
        "id": "webp",
        "transform": { "format": "webp", "width": 800, "quality": 80 },
        "output": { "bucket": "images", "key": "photo.webp", "acl": "public-read" }
      },
      {
        "id": "jpeg-fallback",
        "transform": { "format": "jpeg", "width": 800, "quality": 85 },
        "output": { "bucket": "images", "key": "photo.jpg", "acl": "public-read" }
      }
    ]
  }'
```

### Responsive Image Sizes

```bash
curl -X PUT http://localhost:8000/pipeline \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/photo.jpg",
    "tasks": [
      {
        "id": "sm",
        "transform": { "format": "webp", "width": 320 },
        "output": { "bucket": "cdn", "key": "photo-sm.webp" },
        "metadata": {}
      },
      {
        "id": "md",
        "transform": { "format": "webp", "width": 768 },
        "output": { "bucket": "cdn", "key": "photo-md.webp" },
        "metadata": {}
      },
      {
        "id": "lg",
        "transform": { "format": "webp", "width": 1280 },
        "output": { "bucket": "cdn", "key": "photo-lg.webp" },
        "metadata": {}
      },
      {
        "id": "xl",
        "transform": { "format": "webp", "width": 1920 },
        "output": { "bucket": "cdn", "key": "photo-xl.webp" },
        "metadata": {}
      }
    ]
  }'
```

### Start Server with Pipeline Enabled

```bash
AWS_ACCESS_KEY_ID=your-key \
AWS_SECRET_ACCESS_KEY=your-secret \
AWS_REGION=us-west-2 \
bun run index.ts --enable-pipeline --enable-fetch
```
