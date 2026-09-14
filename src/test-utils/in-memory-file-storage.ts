import type { FileStorage } from "@/server/files/storage";

/**
 * In-memory {@link FileStorage} for integration tests. Integration tests
 * isolate `TEST_DATABASE_URL` but historically let `getFileStorage()` reach
 * the real object storage, leaving hundreds of fixture objects in the
 * operator's bucket. This fake keeps every byte in a Map: byte round-trips
 * still exercise the service orchestration, while the shared integration
 * setup asserts after each test that nothing survived — a put without its
 * matching delete is a test failure, not bucket pollution.
 */
export class InMemoryFileStorage implements FileStorage {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, data: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(data));
  }

  async get(key: string): Promise<Buffer> {
    const data = this.objects.get(key);
    if (data === undefined) {
      // The NoSuchKey name matches S3's missing-object error so
      // `isObjectMissing()` in the service keeps its semantics.
      const error = new Error(`missing object: ${key}`);
      error.name = "NoSuchKey";
      throw error;
    }
    return data;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /** Live object keys — the leak invariant reads this after every test. */
  keys(): string[] {
    return [...this.objects.keys()];
  }

  /** Drops every object. Used between tests, alongside the DB reset. */
  clear(): void {
    this.objects.clear();
  }
}
