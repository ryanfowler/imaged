import { describe, test, expect, spyOn } from "bun:test";
import { Client } from "./fetch.ts";
import * as ssrf from "./ssrf.ts";

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

describe("DNS rebinding protection", () => {
  test("resolves DNS once and connects to validated IP", async () => {
    // Track how many times resolveHostname is called
    const resolveHostnameSpy = spyOn(ssrf, "resolveHostname");

    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      ssrfProtection: true,
    });

    // This will fail because localhost resolves to a private IP
    await expect(client.fetch("http://localhost/")).rejects.toThrow(/private IP/);

    // resolveHostname should only be called once
    expect(resolveHostnameSpy).toHaveBeenCalledTimes(1);
    expect(resolveHostnameSpy).toHaveBeenCalledWith("localhost");

    resolveHostnameSpy.mockRestore();
  });

  test("blocks hostname that resolves to private IP after DNS lookup", async () => {
    // Mock resolveHostname to return a private IP for a "safe looking" hostname
    const resolveHostnameMock = spyOn(ssrf, "resolveHostname").mockResolvedValue([
      "127.0.0.1",
    ]);

    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      ssrfProtection: true,
    });

    // Even though the hostname looks safe, it resolves to a private IP
    await expect(client.fetch("http://safe-looking-host.com/")).rejects.toThrow(
      /private IP/,
    );

    resolveHostnameMock.mockRestore();
  });

  test("uses first public IP when multiple IPs resolved", async () => {
    // Mock to return mixed IPs - private first, then public
    const resolveHostnameMock = spyOn(ssrf, "resolveHostname").mockResolvedValue([
      "127.0.0.1", // private - should be skipped
      "10.0.0.1", // private - should be skipped
      "8.8.8.8", // public - should be used
    ]);

    const client = new Client({
      timeoutMs: 1000, // Short timeout - we just want to verify no SSRF error
      bodyLimit: 1024 * 1024,
      ssrfProtection: true,
    });

    // Should succeed past SSRF check and fail with connection error
    // (because 8.8.8.8 doesn't serve HTTP on port 80)
    // The important thing is it doesn't throw "private IP" error
    const result = client.fetch("http://example.com/");
    await expect(result).rejects.not.toThrow(/private IP/);

    resolveHostnameMock.mockRestore();
  });

  test("blocks when all resolved IPs are private", async () => {
    // Mock to return only private IPs
    const resolveHostnameMock = spyOn(ssrf, "resolveHostname").mockResolvedValue([
      "127.0.0.1",
      "10.0.0.1",
      "192.168.1.1",
    ]);

    const client = new Client({
      timeoutMs: 5000,
      bodyLimit: 1024 * 1024,
      ssrfProtection: true,
    });

    await expect(client.fetch("http://example.com/")).rejects.toThrow(/private IP/);

    resolveHostnameMock.mockRestore();
  });

  test("validates redirect destinations for DNS rebinding", async () => {
    // Start a simple server that redirects
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/redirect") {
          // Redirect to localhost (should be blocked)
          return new Response(null, {
            status: 302,
            headers: { Location: "http://127.0.0.1/target" },
          });
        }
        return new Response("OK");
      },
    });

    try {
      const client = new Client({
        timeoutMs: 5000,
        bodyLimit: 1024 * 1024,
        ssrfProtection: true,
      });

      // Request to the server's redirect endpoint
      // The redirect target (127.0.0.1) should be blocked
      await expect(
        client.fetch(`http://127.0.0.1:${server.port}/redirect`),
      ).rejects.toThrow(/private IP/);
    } finally {
      server.stop();
    }
  });
});
