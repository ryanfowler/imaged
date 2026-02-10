import type { Client } from "./fetch.ts";
import type { ImageEngine } from "./image.ts";
import { createS3Client, getS3Url, uploadToS3 } from "./s3.ts";
import {
  HttpError,
  type ImageOptions,
  type MetadataResult,
  type PipelineConfig,
  type PipelineResponse,
  type PipelineTask,
  type S3Config,
  type TaskResult,
} from "./types.ts";
import {
  getMimetype,
  validateContentType,
  validateBlurStrict,
  validateBooleanStrict,
  validateDimensionStrict,
  validateEffortStrict,
  validateFitStrict,
  validateFormatStrict,
  validateKernelStrict,
  validatePositionStrict,
  validatePresetStrict,
  validateQualityStrict,
} from "./validation.ts";

import type { S3Client } from "bun";
import { performance } from "node:perf_hooks";

export interface PipelineOptions {
  maxTasks: number;
  enableFetch: boolean;
  dimensionLimit: number;
}

export class PipelineExecutor {
  private engine: ImageEngine;
  private client: Client;
  private s3Client: S3Client;
  private s3Region: string;
  private s3Endpoint?: string;
  private maxTasks: number;
  private enableFetch: boolean;
  private dimensionLimit: number;

  constructor(
    engine: ImageEngine,
    client: Client,
    s3Config: S3Config,
    options: PipelineOptions,
  ) {
    this.engine = engine;
    this.client = client;
    this.s3Client = createS3Client(s3Config);
    this.s3Region = s3Config.region;
    this.s3Endpoint = s3Config.endpoint;
    this.maxTasks = options.maxTasks;
    this.enableFetch = options.enableFetch;
    this.dimensionLimit = options.dimensionLimit;
  }

  async execute(
    config: PipelineConfig,
    imageData?: Uint8Array,
  ): Promise<PipelineResponse> {
    const start = performance.now();

    // 1. Validate config structure
    this.validateConfigStructure(config);

    // 2. Parse and validate transform options for each task
    const parsedTasks = config.tasks.map((task, i) =>
      this.parseTask(task, i, this.dimensionLimit),
    );

    // 3. Get image data
    let data: Uint8Array;
    if (imageData) {
      data = imageData;
    } else if (config.url) {
      if (!this.enableFetch) {
        throw new HttpError(400, "URL fetching is disabled");
      }
      data = await this.client.fetch(config.url);
    } else {
      throw new HttpError(400, "No image provided");
    }

    // 4. Get metadata if requested
    let metadata: MetadataResult | undefined;
    if (config.metadata) {
      metadata = await this.engine.metadata({
        data,
        exif: config.metadata.exif ?? false,
        stats: config.metadata.stats ?? false,
        thumbhash: config.metadata.thumbhash ?? false,
      });
    }

    // 5. Execute tasks concurrently
    const taskResults = await Promise.all(
      parsedTasks.map((task) => this.executeTask(task, data)),
    );

    return {
      totalDurationMs: Math.round(performance.now() - start),
      metadata,
      tasks: taskResults,
    };
  }

  private validateConfigStructure(config: PipelineConfig): void {
    if (!config.tasks || !Array.isArray(config.tasks)) {
      throw new HttpError(400, "tasks must be an array");
    }

    if (config.tasks.length === 0) {
      throw new HttpError(400, "at least one task is required");
    }

    if (config.tasks.length > this.maxTasks) {
      throw new HttpError(
        400,
        `too many tasks: ${config.tasks.length} (max: ${this.maxTasks})`,
      );
    }

    const seenIds = new Set<string>();
    for (let i = 0; i < config.tasks.length; i++) {
      const task = config.tasks[i]!;

      if (!task.id || typeof task.id !== "string") {
        throw new HttpError(400, `task[${i}]: id is required`);
      }

      if (seenIds.has(task.id)) {
        throw new HttpError(400, `task[${i}]: duplicate id '${task.id}'`);
      }
      seenIds.add(task.id);

      if (!task.transform || typeof task.transform !== "object") {
        throw new HttpError(400, `task[${i}]: transform is required`);
      }

      if (!task.transform.format || typeof task.transform.format !== "string") {
        throw new HttpError(400, `task[${i}]: transform.format is required`);
      }

      if (!task.output || typeof task.output !== "object") {
        throw new HttpError(400, `task[${i}]: output is required`);
      }

      if (!task.output.bucket || typeof task.output.bucket !== "string") {
        throw new HttpError(400, `task[${i}]: output.bucket is required`);
      }

      if (!task.output.key || typeof task.output.key !== "string") {
        throw new HttpError(400, `task[${i}]: output.key is required`);
      }

      if (
        task.metadata !== undefined &&
        (typeof task.metadata !== "object" ||
          task.metadata === null ||
          Array.isArray(task.metadata))
      ) {
        throw new HttpError(400, `task[${i}]: metadata must be an object`);
      }
    }
  }

  private parseTask(
    task: PipelineTask,
    index: number,
    dimensionLimit: number,
  ): ParsedTask {
    const prefix = `task[${index}].transform`;
    const t = task.transform;

    // Parse format
    const format = validateFormatStrict(t.format, prefix);

    // Parse and validate all transform options
    const options: Omit<ImageOptions, "data"> = {
      format,
      width: validateDimensionStrict(t.width, "width", prefix, dimensionLimit),
      height: validateDimensionStrict(t.height, "height", prefix, dimensionLimit),
      quality: validateQualityStrict(t.quality, prefix),
      blur: validateBlurStrict(t.blur, prefix),
      greyscale: validateBooleanStrict(t.greyscale, "greyscale", prefix),
      lossless: validateBooleanStrict(t.lossless, "lossless", prefix),
      progressive: validateBooleanStrict(t.progressive, "progressive", prefix),
      effort: validateEffortStrict(t.effort, format, prefix),
      fit: validateFitStrict(t.fit, prefix),
      kernel: validateKernelStrict(t.kernel, prefix),
      position: validatePositionStrict(t.position, prefix),
      preset: validatePresetStrict(t.preset, prefix),
    };

    // Parse metadata options if provided (empty object returns basic metadata)
    let metadata: ParsedTask["metadata"];
    if (task.metadata) {
      const metaPrefix = `task[${index}].metadata`;
      metadata = {
        exif: validateBooleanStrict(task.metadata.exif, "exif", metaPrefix) ?? false,
        stats: validateBooleanStrict(task.metadata.stats, "stats", metaPrefix) ?? false,
        thumbhash:
          validateBooleanStrict(task.metadata.thumbhash, "thumbhash", metaPrefix) ??
          false,
      };
    }

    return {
      id: task.id,
      options,
      output: task.output,
      metadata,
    };
  }

  private async executeTask(task: ParsedTask, data: Uint8Array): Promise<TaskResult> {
    const start = performance.now();
    try {
      // Transform image
      const result = await this.engine.perform({
        data,
        ...task.options,
      });

      // Upload to S3
      const contentType = task.output.contentType
        ? validateContentType(task.output.contentType, `task '${task.id}'`)
        : getMimetype(result.format);
      await uploadToS3(
        result.data,
        task.output.bucket,
        task.output.key,
        this.s3Client,
        {
          contentType,
          acl: task.output.acl,
        },
      );

      // Extract metadata from transformed output if requested
      let metadata: MetadataResult | undefined;
      if (task.metadata) {
        metadata = await this.engine.metadata({
          data: result.data,
          exif: task.metadata.exif,
          stats: task.metadata.stats,
          thumbhash: task.metadata.thumbhash,
        });
      }

      return {
        id: task.id,
        status: "success",
        durationMs: Math.round(performance.now() - start),
        output: {
          format: result.format,
          width: result.width,
          height: result.height,
          size: result.data.length,
          url: getS3Url(
            task.output.bucket,
            task.output.key,
            this.s3Region,
            this.s3Endpoint,
          ),
        },
        metadata,
      };
    } catch (err) {
      return {
        id: task.id,
        status: "failed",
        durationMs: Math.round(performance.now() - start),
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }
}

interface ParsedTask {
  id: string;
  options: Omit<ImageOptions, "data">;
  output: PipelineTask["output"];
  metadata?: {
    exif: boolean;
    stats: boolean;
    thumbhash: boolean;
  };
}
