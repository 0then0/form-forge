// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: null,
  createClient: vi.fn(),
  migrate: vi.fn(),
  drizzle: vi.fn(),
}));
vi.mock("pg", () => ({ default: { Client: mocks.createClient } }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzle }));
vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: mocks.migrate,
}));
import { runMigrations } from "./migrate.mjs";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client = Object.assign(new EventEmitter(), {
    connect: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  });
  mocks.createClient.mockImplementation(function Client() {
    return mocks.client;
  });
  mocks.drizzle.mockReturnValue("database");
  mocks.migrate.mockResolvedValue(undefined);
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://operator:private-password@localhost/test?sslmode=verify-full",
  );
  vi.stubEnv("MIGRATION_STATEMENT_TIMEOUT_MS", undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("uses the existing Drizzle journal and closes the connection before success", async () => {
  expect(await runMigrations()).toBe(0);
  expect(mocks.drizzle).toHaveBeenCalledWith(mocks.client);
  expect(mocks.migrate).toHaveBeenCalledWith("database", {
    migrationsFolder: expect.stringMatching(/\/apps\/web\/drizzle$/),
  });
  expect(mocks.client.end).toHaveBeenCalledOnce();
  expect(mocks.createClient).toHaveBeenCalledWith(
    expect.objectContaining({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 15_000,
      statement_timeout: 300_000,
      query_timeout: 310_000,
      lock_timeout: 15_000,
    }),
  );
  expect(mocks.createClient.mock.calls[0][0]).not.toHaveProperty("ssl");
});

test("fails without DATABASE_URL instead of reading env files or connecting to a default database", async () => {
  vi.stubEnv("DATABASE_URL", undefined);
  expect(await runMigrations()).toBe(1);
  expect(mocks.createClient).not.toHaveBeenCalled();
});

test.each(["0", "NaN", "-1", "1.5", "2147473648"])(
  "rejects invalid statement timeout %s before connecting",
  async (timeout) => {
    vi.stubEnv("MIGRATION_STATEMENT_TIMEOUT_MS", timeout);
    expect(await runMigrations()).toBe(1);
    expect(mocks.createClient).not.toHaveBeenCalled();
  },
);

test("allows a deliberate longer statement timeout without removing its network deadline", async () => {
  vi.stubEnv("MIGRATION_STATEMENT_TIMEOUT_MS", "600000");
  expect(await runMigrations()).toBe(0);
  expect(mocks.createClient).toHaveBeenCalledWith(
    expect.objectContaining({
      statement_timeout: 600_000,
      query_timeout: 610_000,
    }),
  );
});

test("connection timeout closes the client without retry or invoking migrations", async () => {
  mocks.client.connect.mockRejectedValue(
    Object.assign(new Error("secret details"), { code: "ETIMEDOUT" }),
  );
  expect(await runMigrations()).toBe(1);
  expect(mocks.client.end).toHaveBeenCalledOnce();
  expect(mocks.createClient).toHaveBeenCalledOnce();
  expect(mocks.migrate).not.toHaveBeenCalled();
  expect(JSON.stringify(console.error.mock.calls)).toContain("ETIMEDOUT");
  expect(JSON.stringify(console.error.mock.calls)).not.toContain(
    "secret details",
  );
});

test("idle transport failure does not become an unhandled error or false success", async () => {
  mocks.migrate.mockImplementationOnce(async () => {
    mocks.client.emit(
      "error",
      Object.assign(new Error("connection lost"), { code: "ETIMEDOUT" }),
    );
  });
  expect(await runMigrations()).toBe(1);
  expect(mocks.migrate).toHaveBeenCalledOnce();
  expect(mocks.client.end).toHaveBeenCalledOnce();
  expect(JSON.stringify(console.log.mock.calls)).not.toContain("completed");
});

test("migration SQL failure reports its cause without printing SQL, values or credentials", async () => {
  mocks.migrate.mockRejectedValueOnce(
    new Error(`SQL containing ${process.env.DATABASE_URL}`, {
      cause: Object.assign(new Error("private answer value"), {
        code: "23505",
      }),
    }),
  );
  expect(await runMigrations()).toBe(1);
  expect(mocks.client.end).toHaveBeenCalledOnce();
  const output = JSON.stringify(console.error.mock.calls);
  expect(output).toContain("23505");
  expect(output).not.toMatch(/private|postgresql|SQL containing/);
  expect(output).toContain("COMMIT");
});

test("closing failure prevents a successful exit", async () => {
  mocks.client.end.mockRejectedValueOnce(new Error("close failed"));
  expect(await runMigrations()).toBe(1);
  expect(JSON.stringify(console.log.mock.calls)).not.toContain("completed");
});
