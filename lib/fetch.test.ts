import { describe, test, expect } from "bun:test";
import { Client } from "./fetch.ts";

describe("Client with SSRF protection", () => {
  test("blocks request to localhost", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      ssrfProtection: true,
    });

    await expect(client.fetch("http://localhost:8080/image.png")).rejects.toThrow(
      /private IP/,
    );
  });

  test("blocks request to 127.0.0.1", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      ssrfProtection: true,
    });

    await expect(client.fetch("http://127.0.0.1/image.png")).rejects.toThrow(
      /private IP/,
    );
  });

  test("blocks request to private IP 192.168.x.x", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      ssrfProtection: true,
    });

    await expect(client.fetch("http://192.168.1.1/image.png")).rejects.toThrow(
      /private IP/,
    );
  });

  test("blocks request to 10.x.x.x network", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      ssrfProtection: true,
    });

    await expect(client.fetch("http://10.0.0.1/image.png")).rejects.toThrow(
      /private IP/,
    );
  });

  test("blocks request to 172.16.x.x network", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      ssrfProtection: true,
    });

    await expect(client.fetch("http://172.16.0.1/image.png")).rejects.toThrow(
      /private IP/,
    );
  });

  test("blocks request to IPv6 loopback", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      ssrfProtection: true,
    });

    await expect(client.fetch("http://[::1]/image.png")).rejects.toThrow(/private IP/);
  });

  test("allows private IP when protection disabled", async () => {
    const client = new Client({
      timeoutMs: 1000, // Short timeout since we expect connection failure
      bodyLimit: 1024 * 1024,
      ssrfProtection: false,
    });

    // This will fail with connection error (not SSRF error)
    // since the IP likely doesn't exist or times out
    const result = client.fetch("http://192.168.1.1/image.png");
    // Should NOT throw "private IP" error - any other error is acceptable
    await expect(result).rejects.not.toThrow(/private IP/);
  });

  test("SSRF protection is enabled by default", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      // ssrfProtection not specified - should default to true
    });

    await expect(client.fetch("http://127.0.0.1/image.png")).rejects.toThrow(
      /private IP/,
    );
  });
});

describe("Client URL validation", () => {
  test("rejects invalid URL", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
    });

    await expect(client.fetch("not-a-valid-url")).rejects.toThrow(/invalid URL/);
  });

  test("rejects non-http(s) schemes", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      ssrfProtection: false,
    });

    await expect(client.fetch("ftp://example.com/file")).rejects.toThrow(
      /only http and https/,
    );
    await expect(client.fetch("file:///etc/passwd")).rejects.toThrow(
      /only http and https/,
    );
  });
});

describe("Client allowedHosts", () => {
  test("validates allowedHosts on initial request", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      allowedHosts: /^example\.com$/,
      ssrfProtection: false, // Disable to isolate allowedHosts test
    });

    await expect(client.fetch("http://evil.com/image.png")).rejects.toThrow(
      /host is not allowed/,
    );
  });

  test("allows matching host", async () => {
    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      allowedHosts: /^example\.com$/,
      ssrfProtection: false,
    });

    // Will fail with some error, but NOT "host is not allowed"
    // example.com may return 404 or other response
    const result = client.fetch("http://example.com/image.png");
    await expect(result).rejects.not.toThrow(/host is not allowed/);
  });
});
