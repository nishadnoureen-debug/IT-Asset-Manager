import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

export interface StorageDriver {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,500}$/;

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..')) throw new Error(`Invalid storage key: ${key}`);
}

class LocalStorageDriver implements StorageDriver {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    assertKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root) + sep)) throw new Error('Storage path escapes root');
    return full;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    env: Env,
  ) {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/** Files inside PostgreSQL: for hosts without a persistent disk (e.g. free plans), no extra service needed. */
class DatabaseStorageDriver implements StorageDriver {
  constructor(private readonly prisma: PrismaService) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertKey(key);
    const data = new Uint8Array(body);
    await this.prisma.storedFile.upsert({
      where: { key },
      create: { key, contentType, sizeBytes: data.length, data },
      update: { contentType, sizeBytes: data.length, data },
    });
  }

  async get(key: string): Promise<Buffer> {
    assertKey(key);
    const file = await this.prisma.storedFile.findUnique({
      where: { key },
      select: { data: true },
    });
    if (!file) throw Object.assign(new Error(`Stored file not found: ${key}`), { code: 'ENOENT' });
    return Buffer.from(file.data);
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.prisma.storedFile.deleteMany({ where: { key } });
  }
}

/** S3-compatible object storage, PostgreSQL, or the local filesystem (development / single host). */
@Injectable()
export class StorageService implements StorageDriver {
  private readonly driver: StorageDriver;

  constructor(config: ConfigService<Env, true>, prisma: PrismaService) {
    const env = {
      S3_REGION: config.get('S3_REGION', { infer: true }),
      S3_ENDPOINT: config.get('S3_ENDPOINT', { infer: true }),
      S3_FORCE_PATH_STYLE: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      S3_ACCESS_KEY_ID: config.get('S3_ACCESS_KEY_ID', { infer: true }),
      S3_SECRET_ACCESS_KEY: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
    } as Env;
    const driver = config.get('STORAGE_DRIVER', { infer: true });
    if (driver === 's3') {
      this.driver = new S3StorageDriver(config.get('S3_BUCKET', { infer: true })!, env);
    } else if (driver === 'database') {
      this.driver = new DatabaseStorageDriver(prisma);
    } else {
      const dir = config.get('STORAGE_LOCAL_DIR', { infer: true });
      this.driver = new LocalStorageDriver(isAbsolute(dir) ? dir : join(process.cwd(), dir));
    }
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.driver.put(key, body, contentType);
  }

  get(key: string): Promise<Buffer> {
    return this.driver.get(key);
  }

  delete(key: string): Promise<void> {
    return this.driver.delete(key);
  }
}
