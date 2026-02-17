import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DEFAULT_OPENAPI_URL =
  "https://developer.sportalliance.com/_spec/apis/magicline/openapi/openapi.json?download=";
const DEFAULT_CONNECT_OPENAPI_URL =
  "https://developer.sportalliance.com/_spec/apis/magicline/connectapi/connectapi.json?download=";
const DEFAULT_DEVICE_OPENAPI_URL =
  "https://developer.sportalliance.com/_spec/apis/magicline/deviceapi/deviceapi.json?download=";
const DEFAULT_WEBHOOKS_OPENAPI_URL =
  "https://developer.sportalliance.com/_spec/apis/magicline/webhooks/webhooks.json?download=";

const openApiUrl = process.env.MAGICLINE_OPENAPI_URL ?? DEFAULT_OPENAPI_URL;
const connectApiUrl =
  process.env.MAGICLINE_CONNECT_OPENAPI_URL ?? DEFAULT_CONNECT_OPENAPI_URL;
const deviceApiUrl =
  process.env.MAGICLINE_DEVICE_OPENAPI_URL ?? DEFAULT_DEVICE_OPENAPI_URL;
const webhooksApiUrl =
  process.env.MAGICLINE_WEBHOOKS_OPENAPI_URL ?? DEFAULT_WEBHOOKS_OPENAPI_URL;

const scriptDir = dirname(fileURLToPath(import.meta.url));

async function downloadSpec(url, outputPath, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download ${label} spec (${response.status} ${response.statusText}) from ${url}`,
    );
  }

  const spec = await response.json();
  await writeFile(outputPath, JSON.stringify(spec, null, 2) + "\n", "utf8");
  console.log(`${label} spec saved to ${outputPath}`);
}

await downloadSpec(
  openApiUrl,
  resolve(scriptDir, "..", "src", "openapi.json"),
  "OpenAPI",
);
await downloadSpec(
  connectApiUrl,
  resolve(scriptDir, "..", "src", "connectapi.json"),
  "Connect API",
);
await downloadSpec(
  deviceApiUrl,
  resolve(scriptDir, "..", "src", "deviceapi.json"),
  "Device API",
);
await downloadSpec(
  webhooksApiUrl,
  resolve(scriptDir, "..", "src", "webhooks.json"),
  "Webhooks API",
);
