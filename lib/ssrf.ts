import { HttpError } from "./types.ts";

import dns from "node:dns";

/**
 * Parses an IPv4 address string into a 32-bit unsigned integer.
 * Returns null if the string is not a valid IPv4 address.
 */
export function parseIPv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let result = 0;
  for (const part of parts) {
    // Must be non-empty and only digits
    if (part.length === 0 || !/^\d+$/.test(part)) {
      return null;
    }
    // Leading zeros are not allowed (except for "0" itself)
    if (part.length > 1 && part[0] === "0") {
      return null;
    }
    const octet = parseInt(part, 10);
    if (octet < 0 || octet > 255) {
      return null;
    }
    result = (result << 8) | octet;
  }

  // Convert to unsigned 32-bit integer
  return result >>> 0;
}

/**
 * Parses an IPv6 address string into high and low 64-bit bigints.
 * Handles compressed notation (::) and IPv4-mapped addresses (::ffff:x.x.x.x).
 * Returns null if the string is not a valid IPv6 address.
 */
export function parseIPv6(ip: string): { high: bigint; low: bigint } | null {
  // Check for IPv4-mapped IPv6 address (::ffff:x.x.x.x)
  const ipv4MappedMatch = ip.match(/^(.*):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4MappedMatch) {
    const prefix = ipv4MappedMatch[1]!;
    const ipv4Part = ipv4MappedMatch[2]!;

    const ipv4 = parseIPv4(ipv4Part);
    if (ipv4 === null) {
      return null;
    }

    // Parse the prefix part (without the IPv4)
    // Replace the IPv4 with two zero groups to parse the IPv6 prefix
    const prefixResult = parseIPv6Prefix(prefix + ":0:0");
    if (prefixResult === null) {
      return null;
    }

    // Replace the last 32 bits with the IPv4 address
    const low = (prefixResult.low & ~0xffffffffn) | BigInt(ipv4);
    return { high: prefixResult.high, low };
  }

  return parseIPv6Prefix(ip);
}

function parseIPv6Prefix(ip: string): { high: bigint; low: bigint } | null {
  // Handle :: expansion
  const parts = ip.split("::");
  if (parts.length > 2) {
    return null; // Only one :: allowed
  }

  let groups: string[];
  if (parts.length === 2) {
    const left = parts[0] === "" ? [] : parts[0]!.split(":");
    const right = parts[1] === "" ? [] : parts[1]!.split(":");
    const missing = 8 - left.length - right.length;
    if (missing < 0) {
      return null;
    }
    groups = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    groups = ip.split(":");
  }

  if (groups.length !== 8) {
    return null;
  }

  let high = 0n;
  let low = 0n;

  for (let i = 0; i < 8; i++) {
    const group = groups[i]!;
    if (group.length === 0 || group.length > 4 || !/^[0-9a-fA-F]+$/.test(group)) {
      return null;
    }
    const value = BigInt(parseInt(group, 16));
    if (i < 4) {
      high = (high << 16n) | value;
    } else {
      low = (low << 16n) | value;
    }
  }

  return { high, low };
}

interface PrivateIPResult {
  isPrivate: boolean;
  reason?: string;
}

/**
 * Checks if an IPv4 address is in a private or reserved range.
 */
export function isPrivateIPv4(ip: string): PrivateIPResult {
  const parsed = parseIPv4(ip);
  if (parsed === null) {
    return { isPrivate: false };
  }

  // 0.0.0.0/8 - Current network
  if (parsed >>> 24 === 0) {
    return { isPrivate: true, reason: "Current network" };
  }

  // 10.0.0.0/8 - Private network
  if (parsed >>> 24 === 10) {
    return { isPrivate: true, reason: "Private network" };
  }

  // 127.0.0.0/8 - Loopback
  if (parsed >>> 24 === 127) {
    return { isPrivate: true, reason: "Loopback" };
  }

  // 169.254.0.0/16 - Link-local
  if (parsed >>> 16 === 0xa9fe) {
    return { isPrivate: true, reason: "Link-local" };
  }

  // 172.16.0.0/12 - Private network (172.16.0.0 - 172.31.255.255)
  const firstTwoOctets = parsed >>> 16;
  if (firstTwoOctets >= 0xac10 && firstTwoOctets <= 0xac1f) {
    return { isPrivate: true, reason: "Private network" };
  }

  // 192.168.0.0/16 - Private network
  if (parsed >>> 16 === 0xc0a8) {
    return { isPrivate: true, reason: "Private network" };
  }

  // 224.0.0.0/4 - Multicast
  if (parsed >>> 28 === 0xe) {
    return { isPrivate: true, reason: "Multicast" };
  }

  // 240.0.0.0/4 - Reserved
  if (parsed >>> 28 === 0xf) {
    return { isPrivate: true, reason: "Reserved" };
  }

  return { isPrivate: false };
}

/**
 * Checks if an IPv6 address is in a private or reserved range.
 */
export function isPrivateIPv6(ip: string): PrivateIPResult {
  const parsed = parseIPv6(ip);
  if (parsed === null) {
    return { isPrivate: false };
  }

  const { high, low } = parsed;

  // ::1 - Loopback
  if (high === 0n && low === 1n) {
    return { isPrivate: true, reason: "Loopback" };
  }

  // :: - Unspecified
  if (high === 0n && low === 0n) {
    return { isPrivate: true, reason: "Unspecified" };
  }

  // fe80::/10 - Link-local (fe80:: - febf::)
  const first16 = high >> 48n;
  if (first16 >= 0xfe80n && first16 <= 0xfebfn) {
    return { isPrivate: true, reason: "Link-local" };
  }

  // fc00::/7 - Unique local (fc00:: - fdff::)
  if (first16 >= 0xfc00n && first16 <= 0xfdffn) {
    return { isPrivate: true, reason: "Unique local" };
  }

  // ff00::/8 - Multicast
  if (first16 >> 8n === 0xffn) {
    return { isPrivate: true, reason: "Multicast" };
  }

  // ::ffff:x.x.x.x - IPv4-mapped addresses
  // Check if this is an IPv4-mapped address (::ffff:0:0/96)
  if (high === 0n && low >> 32n === 0xffffn) {
    // Extract the IPv4 part and check it
    const ipv4 = Number(low & 0xffffffffn);
    const ipv4String = [
      (ipv4 >>> 24) & 0xff,
      (ipv4 >>> 16) & 0xff,
      (ipv4 >>> 8) & 0xff,
      ipv4 & 0xff,
    ].join(".");
    const ipv4Result = isPrivateIPv4(ipv4String);
    if (ipv4Result.isPrivate) {
      return { isPrivate: true, reason: `IPv4-mapped ${ipv4Result.reason}` };
    }
  }

  return { isPrivate: false };
}

/**
 * Checks if an IP address (IPv4 or IPv6) is in a private or reserved range.
 */
export function isPrivateIP(ip: string): PrivateIPResult {
  // Try IPv4 first
  if (parseIPv4(ip) !== null) {
    return isPrivateIPv4(ip);
  }

  // Try IPv6
  return isPrivateIPv6(ip);
}

/**
 * Resolves a hostname to its IP addresses using DNS lookup.
 * If the input is already an IP address, returns it directly.
 */
export async function resolveHostname(hostname: string): Promise<string[]> {
  // If it's already an IP address, return it directly
  if (parseIPv4(hostname) !== null) {
    return [hostname];
  }

  // Check for IPv6 address (might have brackets from URL)
  const cleanedHostname = hostname.replace(/^\[|\]$/g, "");
  if (parseIPv6(cleanedHostname) !== null) {
    return [cleanedHostname];
  }

  // Perform DNS lookup
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    return addresses.map((addr) => addr.address);
  } catch {
    throw new HttpError(400, `fetch: DNS resolution failed for ${hostname}`);
  }
}

/**
 * Validates a URL for SSRF vulnerabilities by checking if it resolves
 * to any private or reserved IP addresses.
 */
export async function validateUrlForSSRF(url: URL): Promise<void> {
  const hostname = url.hostname;

  // Resolve hostname to IP addresses
  const ips = await resolveHostname(hostname);

  // Check each resolved IP
  for (const ip of ips) {
    const result = isPrivateIP(ip);
    if (result.isPrivate) {
      throw new HttpError(403, `fetch: host resolves to private IP (${result.reason})`);
    }
  }
}
