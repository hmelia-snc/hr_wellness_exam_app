import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { getEnv, type Env } from "../config/env.js";

export interface BlobStorage {
  uploadForm(buffer: Buffer, blobPath: string, contentType: string): Promise<string>;
  downloadForm(blobPath: string): Promise<Buffer>;
}

/**
 * Same client code talks to Azurite locally and real Azure Blob Storage in
 * prod — only AZURE_STORAGE_CONNECTION_STRING changes between environments.
 */
export class AzureBlobStorage implements BlobStorage {
  private containerClient: ContainerClient;
  private containerReady: Promise<void> | undefined;

  constructor(env: Pick<Env, "AZURE_STORAGE_CONNECTION_STRING" | "UPLOADS_CONTAINER_NAME">) {
    const serviceClient = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING);
    this.containerClient = serviceClient.getContainerClient(env.UPLOADS_CONTAINER_NAME);
  }

  async uploadForm(buffer: Buffer, blobPath: string, contentType: string): Promise<string> {
    // Deferred to first use (not the constructor) so a connectivity/config
    // problem surfaces as a normal rejected request, not an unhandled
    // rejection that crashes the whole process at startup.
    if (!this.containerReady) {
      this.containerReady = this.containerClient.createIfNotExists().then(() => undefined);
    }
    await this.containerReady;
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);
    await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: contentType } });
    return blockBlobClient.url;
  }

  async downloadForm(blobPath: string): Promise<Buffer> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobPath);
    return blockBlobClient.downloadToBuffer();
  }
}

let cachedBlobStorage: BlobStorage | undefined;

export function getBlobStorage(): BlobStorage {
  if (!cachedBlobStorage) {
    cachedBlobStorage = new AzureBlobStorage(getEnv());
  }
  return cachedBlobStorage;
}
