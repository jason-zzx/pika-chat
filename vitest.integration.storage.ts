import { afterEach, beforeEach, expect, vi } from "vitest";

import { InMemoryFileStorage } from "./src/test-utils/in-memory-file-storage";

// One fake per test file. `getFileStorage()` is replaced process-wide so any
// service that stores attachment bytes (upload, cascade delete, orphan sweep)
// stays inside this Map instead of reaching a real S3/RustFS bucket.
const fake = new InMemoryFileStorage();

vi.mock("@/server/files/storage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/files/storage")>();
  return { ...actual, getFileStorage: () => fake };
});

beforeEach(() => {
  fake.clear();
});

afterEach(() => {
  // Leak invariant: every put must be balanced by a delete within the test
  // that wrote it. An unbalanced put used to mean a fixture object stranded
  // in the real bucket; now it fails the suite instead.
  expect(fake.keys(), `leaked storage objects: ${fake.keys().join(", ")}`).toEqual(
    [],
  );
  fake.clear();
});
