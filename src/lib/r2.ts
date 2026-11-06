import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

/**
 * Cloudflare R2 (S3-compatible) client for report PDFs.
 * The bucket is PRIVATE: files are only ever reached through short-lived signed URLs
 * that the backend hands out after checking access.
 */

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error("Cloudflare R2 is not configured (R2_* environment variables)");
  }
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

function getBucket(): string {
  if (!env.R2_BUCKET) {
    throw new Error("Cloudflare R2 bucket is not configured (R2_BUCKET)");
  }
  return env.R2_BUCKET;
}

/** Storage path for a report PDF. IDs only, never names (no personal data in paths). */
export function buildReportPdfKey(params: {
  userId: string;
  childProfileId: string | null;
  questSessionId: string;
}): string {
  const child = params.childProfileId || "no-child";
  return `reports/${params.userId}/${child}/${params.questSessionId}.pdf`;
}

export async function uploadPdf(key: string, bytes: Uint8Array): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: bytes,
      ContentType: "application/pdf",
      CacheControl: "private, no-store",
    })
  );
}

/** Downloads a stored PDF. Returns null when the object does not exist. */
export async function getPdf(key: string): Promise<Uint8Array | null> {
  try {
    const result = await getClient().send(
      new GetObjectCommand({ Bucket: getBucket(), Key: key })
    );
    if (!result.Body) return null;
    return await result.Body.transformToByteArray();
  } catch (err: any) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function deletePdfs(keys: string[]): Promise<void> {
  const unique = Array.from(new Set(keys.filter(Boolean)));
  if (unique.length === 0) return;

  // DeleteObjects accepts up to 1000 keys per call
  for (let i = 0; i < unique.length; i += 1000) {
    const batch = unique.slice(i, i + 1000);
    await getClient().send(
      new DeleteObjectsCommand({
        Bucket: getBucket(),
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );
  }
}

/**
 * Short-lived signed URL that opens the PDF in the browser (inline).
 * Default validity: 5 minutes.
 */
export async function getTemporaryViewUrl(
  key: string,
  fileName: string,
  expiresInSeconds = 300
): Promise<string> {
  const safeName = fileName.replace(/[^\w.-]+/g, "_");
  return await getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
      ResponseContentType: "application/pdf",
      ResponseContentDisposition: `inline; filename="${safeName}"`,
      ResponseCacheControl: "private, no-store",
    }),
    { expiresIn: expiresInSeconds }
  );
}
