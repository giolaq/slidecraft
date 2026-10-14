import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
export interface Assets {
  put(id: string, bytes: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array>;
  delete(id: string): Promise<void>;
}
function valid(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid asset.");
  return id;
}
export class S3Assets implements Assets {
  private client: S3Client;
  constructor(
    private bucket: string,
    endpoint?: string,
    region = "us-east-1",
  ) {
    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle: !!endpoint,
    });
  }
  async put(id: string, bytes: Uint8Array) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: "narration/" + valid(id) + ".mp3",
        Body: bytes,
        ContentType: "audio/mpeg",
      }),
    );
  }
  async get(id: string) {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: "narration/" + valid(id) + ".mp3",
      }),
    );
    if (!result.Body) throw new Error("Audio not found.");
    return result.Body.transformToByteArray();
  }
  async delete(id: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: "narration/" + valid(id) + ".mp3",
      }),
    );
  }
}
export class FileAssets implements Assets {
  constructor(private path: string) {}
  async put(id: string, bytes: Uint8Array) {
    await mkdir(this.path, { recursive: true, mode: 0o700 });
    await writeFile(join(this.path, valid(id) + ".mp3"), bytes, {
      mode: 0o600,
    });
  }
  async get(id: string) {
    return readFile(join(this.path, valid(id) + ".mp3"));
  }
  async delete(id: string) {
    await unlink(join(this.path, valid(id) + ".mp3")).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
