import { TlsConfig } from "./types";

const envPort = process.env.PORT;
let port: number;
try {
  port = envPort ? parseInt(envPort) : 8000;
} catch (e) {
  throw new Error(`env: invalid value for PORT "${envPort}"`);
}

const bufferFromTlsVar = (envName: string): Buffer => {
  const value = process.env[envName];
  if (!value) {
    throw new Error(`env: ${envName} is required unless TLS_MODE is "off"`);
  }
  try {
    return Buffer.from(value, "base64");
  } catch (e) {
    throw new Error(`env: invalid value for ${envName}`);
  }
};

let tlsConfig: TlsConfig | undefined;
const envTlsMode = process.env.TLS_MODE;
if (!envTlsMode || envTlsMode === "on") {
  tlsConfig = {
    key: bufferFromTlsVar("TLS_KEY"),
    cert: bufferFromTlsVar("TLS_CERT"),
  };
} else if (envTlsMode !== "off") {
  throw new Error(`env: invalid value for TLS_MODE "${envTlsMode}"`);
}

export default {
  port,
  tlsConfig,
};
