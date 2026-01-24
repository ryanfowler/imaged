import { describe, test, expect } from "bun:test";
import {
  parseIPv4,
  parseIPv6,
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateIP,
  resolveHostname,
  validateUrlForSSRF,
} from "./ssrf.ts";

describe("parseIPv4", () => {
  test("parses valid IPv4 addresses", () => {
    expect(parseIPv4("0.0.0.0")).toBe(0);
    expect(parseIPv4("127.0.0.1")).toBe(0x7f000001);
    expect(parseIPv4("192.168.1.1")).toBe(0xc0a80101);
    expect(parseIPv4("255.255.255.255")).toBe(0xffffffff);
    expect(parseIPv4("10.0.0.1")).toBe(0x0a000001);
    expect(parseIPv4("172.16.0.1")).toBe(0xac100001);
  });

  test("returns null for invalid IPv4", () => {
    expect(parseIPv4("256.0.0.0")).toBeNull();
    expect(parseIPv4("1.2.3")).toBeNull();
    expect(parseIPv4("1.2.3.4.5")).toBeNull();
    expect(parseIPv4("not-an-ip")).toBeNull();
    expect(parseIPv4("::1")).toBeNull();
    expect(parseIPv4("")).toBeNull();
    expect(parseIPv4("1.2.3.")).toBeNull();
    expect(parseIPv4(".1.2.3")).toBeNull();
    expect(parseIPv4("1.2.3.256")).toBeNull();
    expect(parseIPv4("01.02.03.04")).toBeNull(); // Leading zeros not allowed
  });
});

describe("parseIPv6", () => {
  test("parses loopback", () => {
    const result = parseIPv6("::1");
    expect(result).toEqual({ high: 0n, low: 1n });
  });

  test("parses unspecified", () => {
    const result = parseIPv6("::");
    expect(result).toEqual({ high: 0n, low: 0n });
  });

  test("parses full IPv6 address", () => {
    const result = parseIPv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
    expect(result).not.toBeNull();
    expect(result!.high).toBe(0x20010db885a30000n);
    expect(result!.low).toBe(0x00008a2e03707334n);
  });

  test("parses compressed IPv6 address", () => {
    const result = parseIPv6("fe80::1");
    expect(result).not.toBeNull();
    expect(result!.high).toBe(0xfe800000_00000000n);
    expect(result!.low).toBe(1n);
  });

  test("parses IPv4-mapped IPv6", () => {
    const result = parseIPv6("::ffff:192.168.1.1");
    expect(result).not.toBeNull();
    expect(result!.high).toBe(0n);
    // low should be 0xffff followed by 192.168.1.1 (0xc0a80101)
    expect(result!.low).toBe(0xffffc0a80101n);
  });

  test("returns null for invalid IPv6", () => {
    expect(parseIPv6("not-an-ip")).toBeNull();
    expect(parseIPv6("192.168.1.1")).toBeNull();
    expect(parseIPv6("::1::2")).toBeNull(); // Multiple ::
    expect(parseIPv6("1:2:3:4:5:6:7:8:9")).toBeNull(); // Too many groups
  });
});

describe("isPrivateIPv4", () => {
  test.each([
    ["127.0.0.1", "Loopback"],
    ["127.255.255.255", "Loopback"],
    ["10.0.0.1", "Private network"],
    ["10.255.255.255", "Private network"],
    ["172.16.0.1", "Private network"],
    ["172.31.255.255", "Private network"],
    ["192.168.0.1", "Private network"],
    ["192.168.255.255", "Private network"],
    ["169.254.1.1", "Link-local"],
    ["169.254.255.255", "Link-local"],
    ["0.0.0.0", "Current network"],
    ["0.255.255.255", "Current network"],
    ["224.0.0.1", "Multicast"],
    ["239.255.255.255", "Multicast"],
    ["240.0.0.1", "Reserved"],
    ["255.255.255.255", "Reserved"],
  ])("detects %s as private (%s)", (ip: string, reason: string) => {
    const result = isPrivateIPv4(ip);
    expect(result.isPrivate).toBe(true);
    expect(result.reason).toBe(reason);
  });

  test.each([
    "8.8.8.8",
    "1.1.1.1",
    "142.250.80.46",
    "172.32.0.1", // Just outside 172.16.0.0/12
    "172.15.255.255", // Just outside 172.16.0.0/12
    "192.167.1.1", // Just outside 192.168.0.0/16
    "192.169.1.1", // Just outside 192.168.0.0/16
    "11.0.0.1", // Just outside 10.0.0.0/8
    "126.0.0.1", // Just outside 127.0.0.0/8
    "169.253.1.1", // Just outside 169.254.0.0/16
  ])("detects %s as public", (ip: string) => {
    const result = isPrivateIPv4(ip);
    expect(result.isPrivate).toBe(false);
  });
});

describe("isPrivateIPv6", () => {
  test.each([
    ["::1", "Loopback"],
    ["::", "Unspecified"],
    ["fe80::1", "Link-local"],
    ["febf::1", "Link-local"],
    ["fc00::1", "Unique local"],
    ["fd00::1", "Unique local"],
    ["fdff::1", "Unique local"],
    ["ff02::1", "Multicast"],
    ["ff00::1", "Multicast"],
  ])("detects %s as private (%s)", (ip: string, reason: string) => {
    const result = isPrivateIPv6(ip);
    expect(result.isPrivate).toBe(true);
    expect(result.reason).toBe(reason);
  });

  test("detects IPv4-mapped private addresses", () => {
    const result = isPrivateIPv6("::ffff:127.0.0.1");
    expect(result.isPrivate).toBe(true);
    expect(result.reason).toBe("IPv4-mapped Loopback");
  });

  test("detects IPv4-mapped private network", () => {
    const result = isPrivateIPv6("::ffff:192.168.1.1");
    expect(result.isPrivate).toBe(true);
    expect(result.reason).toBe("IPv4-mapped Private network");
  });

  test("allows public IPv6", () => {
    const result = isPrivateIPv6("2001:4860:4860::8888");
    expect(result.isPrivate).toBe(false);
  });

  test("allows IPv4-mapped public addresses", () => {
    const result = isPrivateIPv6("::ffff:8.8.8.8");
    expect(result.isPrivate).toBe(false);
  });
});

describe("isPrivateIP", () => {
  test("detects private IPv4", () => {
    const result = isPrivateIP("192.168.1.1");
    expect(result.isPrivate).toBe(true);
  });

  test("detects private IPv6", () => {
    const result = isPrivateIP("::1");
    expect(result.isPrivate).toBe(true);
  });

  test("allows public IPv4", () => {
    const result = isPrivateIP("8.8.8.8");
    expect(result.isPrivate).toBe(false);
  });

  test("allows public IPv6", () => {
    const result = isPrivateIP("2001:4860:4860::8888");
    expect(result.isPrivate).toBe(false);
  });
});

describe("resolveHostname", () => {
  test("returns IP directly if already an IPv4", async () => {
    const result = await resolveHostname("192.168.1.1");
    expect(result).toEqual(["192.168.1.1"]);
  });

  test("returns IP directly if already an IPv6", async () => {
    const result = await resolveHostname("::1");
    expect(result).toEqual(["::1"]);
  });

  test("handles IPv6 with brackets", async () => {
    const result = await resolveHostname("[::1]");
    expect(result).toEqual(["::1"]);
  });

  test("resolves localhost", async () => {
    const result = await resolveHostname("localhost");
    expect(result.length).toBeGreaterThan(0);
    // localhost typically resolves to 127.0.0.1 or ::1
    expect(result.some((ip) => ip === "127.0.0.1" || ip === "::1")).toBe(true);
  });

  test("throws for non-existent hostname", async () => {
    await expect(
      resolveHostname("this-hostname-does-not-exist.invalid"),
    ).rejects.toThrow(/DNS resolution failed/);
  });
});

describe("validateUrlForSSRF", () => {
  test("throws for localhost", async () => {
    const url = new URL("http://localhost/image.png");
    await expect(validateUrlForSSRF(url)).rejects.toThrow(/private IP/);
  });

  test("throws for private IPv4 in URL", async () => {
    const url = new URL("http://192.168.1.1/image.png");
    await expect(validateUrlForSSRF(url)).rejects.toThrow(/private IP/);
  });

  test("throws for 10.x.x.x network", async () => {
    const url = new URL("http://10.0.0.1/image.png");
    await expect(validateUrlForSSRF(url)).rejects.toThrow(/private IP/);
  });

  test("throws for 172.16.x.x network", async () => {
    const url = new URL("http://172.16.0.1/image.png");
    await expect(validateUrlForSSRF(url)).rejects.toThrow(/private IP/);
  });

  test("throws for IPv6 loopback", async () => {
    const url = new URL("http://[::1]/image.png");
    await expect(validateUrlForSSRF(url)).rejects.toThrow(/private IP/);
  });

  test("allows public IP", async () => {
    // Using a well-known public IP (Google DNS)
    const url = new URL("http://8.8.8.8/image.png");
    await expect(validateUrlForSSRF(url)).resolves.toBeUndefined();
  });
});
