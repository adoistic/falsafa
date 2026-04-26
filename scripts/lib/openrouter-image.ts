/**
 * OpenRouter image-generation client.
 *
 * Routes through /chat/completions with `modalities: ["image", "text"]`.
 * The model returns image data in `choices[0].message.images[0].image_url.url`.
 *
 * Reference: https://openrouter.ai/docs/features/multimodal/image-generation
 */

export interface ImageGenerationResult {
  /** Base64-encoded image bytes (when the API returns a data URL). */
  imageBase64?: string;
  /** Hosted image URL (when the API returns a URL instead of inline data). */
  imageUrl?: string;
  /** Raw response for debugging. */
  raw: unknown;
  /** Mime type sniffed from data URL when available. */
  mimeType?: string;
}

export interface GenerateOptions {
  apiKey: string;
  model: string;
  prompt: string;
  negative: string;
  /** Aspect ratio: "1:1" | "3:2" | "2:3" | "16:9" | "9:16" | "4:3" | "3:4" | "4:5" | "5:4" | "21:9" etc. */
  aspect_ratio: string;
  /** Image size: "0.5K" | "1K" | "2K" | "4K" */
  image_size?: string;
  /** Optional seed for reproducibility (when the model supports it). */
  seed?: number;
  /** Optional referer + title for OpenRouter analytics. */
  referer?: string;
  appTitle?: string;
}

const DEFAULT_REFERER = "https://github.com/adoistic/falsafa";
const DEFAULT_TITLE = "Falsafa";

export async function generateImage(opts: GenerateOptions): Promise<ImageGenerationResult> {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const userMessage = [opts.prompt, `Avoid: ${opts.negative}.`].join("\n\n");

  // image_config is the OpenRouter-canonical way to set aspect ratio + size.
  // Reference: https://openrouter.ai/docs/guides/overview/multimodal/image-generation
  const imageConfig: Record<string, string> = {
    aspect_ratio: opts.aspect_ratio,
  };
  if (opts.image_size) imageConfig["image_size"] = opts.image_size;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [{ role: "user", content: userMessage }],
    modalities: ["image", "text"],
    image_config: imageConfig,
  };
  if (opts.seed !== undefined) body["seed"] = opts.seed;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": opts.referer ?? DEFAULT_REFERER,
      "X-Title": opts.appTitle ?? DEFAULT_TITLE,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenRouter ${resp.status}: ${errText.slice(0, 600)}`);
  }

  const data = (await resp.json()) as {
    choices?: {
      message?: {
        content?: string;
        images?: { type?: string; image_url?: { url?: string } }[];
      };
    }[];
  };

  const msg = data.choices?.[0]?.message;
  const firstImage = msg?.images?.[0]?.image_url?.url;
  if (!firstImage) {
    throw new Error(
      `OpenRouter returned no image data. content=${msg?.content?.slice(0, 200) ?? "(none)"} | raw=${JSON.stringify(data).slice(0, 400)}`,
    );
  }

  if (firstImage.startsWith("data:")) {
    const commaIdx = firstImage.indexOf(",");
    const header = firstImage.slice(0, commaIdx);
    const b64 = firstImage.slice(commaIdx + 1);
    const mimeMatch = header.match(/data:([^;,]+)/);
    return { imageBase64: b64, mimeType: mimeMatch?.[1] ?? undefined, raw: data };
  }
  return { imageUrl: firstImage, raw: data };
}

// ─────────────────────────────────────────────────────────────────────────
// Retry helper
// ─────────────────────────────────────────────────────────────────────────

const RETRY_BASE_MS = 1500;

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 4,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /429|500|502|503|504|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
      if (!retryable || attempt === maxRetries) break;
      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      console.error(`  [${label}] retry ${attempt + 1}/${maxRetries} in ${delay}ms (${msg.slice(0, 120)})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────────────────────────────────
// Concurrency limiter (no external deps)
// ─────────────────────────────────────────────────────────────────────────

export class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= this.max) {
      await new Promise<void>((res) => this.queue.push(res));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Save image
// ─────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname } from "node:path";
import sharp from "sharp";

/**
 * Save an image, converting to the file's expected format if necessary.
 *
 * gpt-5.4-image-2 typically returns PNG bytes regardless of any output-format
 * hint we send. We convert to the extension's actual format via sharp so the
 * MIME type matches the filename and we don't pay 4x storage for misnamed PNG.
 */
export async function saveImage(result: ImageGenerationResult, outputPath: string): Promise<number> {
  let raw: Buffer;
  if (result.imageBase64) {
    raw = Buffer.from(result.imageBase64, "base64");
  } else if (result.imageUrl) {
    const r = await fetch(result.imageUrl);
    if (!r.ok) throw new Error(`Failed to download image from ${result.imageUrl}: ${r.status}`);
    const ab = await r.arrayBuffer();
    raw = Buffer.from(ab);
  } else {
    throw new Error("No image data in result");
  }

  mkdirSync(dirname(outputPath), { recursive: true });

  // Convert to the requested format based on file extension
  const ext = extname(outputPath).toLowerCase();
  let bytes: Buffer;
  switch (ext) {
    case ".webp":
      bytes = await sharp(raw).webp({ quality: 90 }).toBuffer();
      break;
    case ".png":
      bytes = await sharp(raw).png().toBuffer();
      break;
    case ".jpg":
    case ".jpeg":
      bytes = await sharp(raw).jpeg({ quality: 92 }).toBuffer();
      break;
    default:
      // Unknown extension — write raw
      bytes = raw;
  }

  writeFileSync(outputPath, bytes);
  return bytes.length;
}
