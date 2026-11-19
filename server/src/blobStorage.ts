import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import type { Readable } from 'stream'

export interface BlobStorage {
  init(): Promise<void>
  putFile(localPath: string, objectKey: string, mimeType: string): Promise<void>
  getObject(objectKey: string): Promise<Readable>
  remove(objectKey: string): Promise<void>
}

class LocalBlobStorage implements BlobStorage {
  constructor(private readonly root: string) {}

  async init(): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true })
  }

  async putFile(localPath: string, objectKey: string): Promise<void> {
    const target = path.join(this.root, objectKey)
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.rm(target, { force: true })
    await fsp.rename(localPath, target)
  }

  async getObject(objectKey: string): Promise<Readable> {
    return fs.createReadStream(path.join(this.root, objectKey))
  }

  async remove(objectKey: string): Promise<void> {
    await fsp.rm(path.join(this.root, objectKey), { force: true })
  }
}

class S3BlobStorage implements BlobStorage {
  private readonly client: S3Client

  constructor(
    private readonly bucket: string,
    options: {
      region: string
      endpoint?: string
      forcePathStyle: boolean
    }
  ) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle
    })
  }

  async init(): Promise<void> {
    if (!this.bucket) throw new Error('S3_BUCKET is required for s3 blob storage')
  }

  async putFile(localPath: string, objectKey: string, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: fs.createReadStream(localPath),
        ContentType: mimeType
      })
    )
    await fsp.rm(localPath, { force: true })
  }

  async getObject(objectKey: string): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey
      })
    )
    if (!result.Body) throw new Error('S3 object body is empty')
    return result.Body as Readable
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey
      })
    )
  }
}

export function createBlobStorage(): BlobStorage {
  const kind = (process.env.BLOB_STORAGE ?? 'local').toLowerCase()
  if (kind === 's3') {
    return new S3BlobStorage(String(process.env.S3_BUCKET ?? ''), {
      region: String(process.env.S3_REGION ?? 'auto'),
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false'
    })
  }
  return new LocalBlobStorage(
    path.resolve(process.env.BLOB_DIR ?? 'data/blobs')
  )
}
