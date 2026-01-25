# Security

This document covers security features for protecting imaged when fetching remote images.

## Why `--enable-fetch` is Opt-In

The `--enable-fetch` flag (or `ENABLE_FETCH=1` environment variable) enables GET endpoints that fetch images from remote URLs. This is disabled by default because:

1. **Attack Surface**: Allows external URLs to be processed, requiring SSRF protection
2. **Resource Usage**: Remote fetches consume bandwidth and can be slow
3. **Trust Model**: Many deployments only need to process uploaded images

When enabled, imaged applies SSRF protection and optionally a host allowlist to restrict which URLs can be fetched.

## SSRF Protection

When using `--enable-fetch`, Server-Side Request Forgery (SSRF) protection is **enabled by default**. This prevents attackers from using imaged to make requests to internal services, cloud metadata endpoints, or other private resources.

### How It Works

1. **DNS Resolution**: Before fetching, hostnames are resolved to IP addresses
2. **IP Validation**: All resolved IPs are checked against private/reserved ranges
3. **Redirect Validation**: Each redirect hop is validated (prevents DNS rebinding attacks)

### Protected IPv4 Ranges

| Range       | CIDR           | Description     |
| ----------- | -------------- | --------------- |
| 0.0.0.0     | 0.0.0.0/8      | Current network |
| 10.x.x.x    | 10.0.0.0/8     | Private network |
| 127.x.x.x   | 127.0.0.0/8    | Loopback        |
| 169.254.x.x | 169.254.0.0/16 | Link-local      |
| 172.16.x.x  | 172.16.0.0/12  | Private network |
| 192.168.x.x | 192.168.0.0/16 | Private network |
| 224.x.x.x   | 224.0.0.0/4    | Multicast       |
| 240.x.x.x   | 240.0.0.0/4    | Reserved        |

### Protected IPv6 Ranges

| Address/Range    | Description                              |
| ---------------- | ---------------------------------------- |
| `::1`            | Loopback                                 |
| `::`             | Unspecified                              |
| `fe80::/10`      | Link-local                               |
| `fc00::/7`       | Unique local (private)                   |
| `ff00::/8`       | Multicast                                |
| `::ffff:x.x.x.x` | IPv4-mapped (checked against IPv4 rules) |

### Redirect Validation

SSRF protection validates each redirect hop, preventing attacks where:

- An allowed host redirects to an internal IP
- A public DNS entry changes between initial request and redirect (DNS rebinding)
- Redirect chains eventually reach private resources

### Disabling SSRF Protection

**Not recommended for production.** Only disable if you have network-level protections:

```bash
bun run index.ts --enable-fetch --disable-ssrf-protection
```

## Host Allowlist

Use `--allowed-hosts` with a regex pattern to restrict which hosts can be fetched. The allowlist is validated on both initial requests and redirects.

### Examples

**Allow a single domain:**

```bash
bun run index.ts --enable-fetch --allowed-hosts '^example\.com$'
```

**Allow subdomains of a domain:**

```bash
bun run index.ts --enable-fetch --allowed-hosts '^([a-z0-9-]+\.)?example\.com$'
```

**Allow multiple specific domains:**

```bash
bun run index.ts --enable-fetch --allowed-hosts '^(images\.example\.com|cdn\.example\.com)$'
```

**Allow any subdomain of multiple domains:**

```bash
bun run index.ts --enable-fetch --allowed-hosts '^([a-z0-9-]+\.)?(example\.com|example\.org)$'
```

### Regex Tips

- Use `^` and `$` anchors to match the full hostname
- Escape dots with `\.` (dots match any character in regex)
- Use `[a-z0-9-]+` for subdomain segments
- Use `?` to make groups optional (e.g., optional subdomain)
- Test your regex carefully before deploying

### Combining with SSRF Protection

Both the host allowlist and SSRF protection can be active simultaneously. A request must pass both checks:

1. Hostname must match the `--allowed-hosts` pattern
2. Resolved IP must not be in a private/reserved range

```bash
bun run index.ts --enable-fetch --allowed-hosts '^cdn\.example\.com$'
# SSRF protection is still active by default
```
