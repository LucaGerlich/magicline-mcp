import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * Config
 * - Base URL example from Magicline Open API docs is the demo tenant:
 *   https://open-api-demo.open-api.magicline.com/
 */

const OPENAPI_CONFIG = {
  baseUrl: (process.env.MAGICLINE_BASE_URL ?? "").replace(/\/$/, ""),
  apiKey: process.env.MAGICLINE_API_KEY ?? "",
  apiKeyHeader: process.env.MAGICLINE_API_KEY_HEADER ?? "X-API-KEY",
} as const;

const CONNECT_CONFIG = {
  baseUrl: (process.env.MAGICLINE_CONNECT_BASE_URL ?? "").replace(/\/$/, ""),
  apiKey: process.env.MAGICLINE_CONNECT_API_KEY ?? "",
  apiKeyHeader: process.env.MAGICLINE_CONNECT_API_KEY_HEADER ?? "X-API-KEY",
} as const;

const DEVICE_CONFIG = {
  baseUrl: (process.env.MAGICLINE_DEVICE_BASE_URL ?? "").replace(/\/$/, ""),
  apiToken: process.env.MAGICLINE_DEVICE_API_TOKEN ?? "",
  authHeader: process.env.MAGICLINE_DEVICE_AUTH_HEADER ?? "Authorization",
  authPrefix: process.env.MAGICLINE_DEVICE_AUTH_PREFIX ?? "Bearer ",
} as const;

const WEBHOOKS_CONFIG = {
  baseUrl: (process.env.MAGICLINE_WEBHOOKS_BASE_URL ?? "").replace(/\/$/, ""),
  apiKey: process.env.MAGICLINE_WEBHOOKS_API_KEY ?? "",
  apiKeyHeader: process.env.MAGICLINE_WEBHOOKS_API_KEY_HEADER ?? "X-API-KEY",
} as const;

const DEFAULT_OPENAPI_URL =
  "https://developer.sportalliance.com/_spec/apis/magicline/openapi/openapi.json?download=";
const DEFAULT_CONNECT_OPENAPI_URL =
  "https://developer.sportalliance.com/_spec/apis/magicline/connectapi/connectapi.json?download=";
const DEFAULT_DEVICE_OPENAPI_URL =
  "https://developer.sportalliance.com/_spec/apis/magicline/deviceapi/deviceapi.json?download=";
const DEFAULT_WEBHOOKS_OPENAPI_URL =
  "https://developer.sportalliance.com/_spec/apis/magicline/webhooks/webhooks.json?download=";
const OPENAPI_SPEC_PATH = new URL("./openapi.json", import.meta.url);
const CONNECT_SPEC_PATH = new URL("./connectapi.json", import.meta.url);
const DEVICE_SPEC_PATH = new URL("./deviceapi.json", import.meta.url);
const WEBHOOKS_SPEC_PATH = new URL("./webhooks.json", import.meta.url);

if (!OPENAPI_CONFIG.apiKey) {
  throw new Error("Missing MAGICLINE_API_KEY. Set it in your MCP config env.");
}
if (!OPENAPI_CONFIG.baseUrl) {
  throw new Error("Missing MAGICLINE_BASE_URL. Set it in your MCP config env.");
}

// Create MCP server instance
const server = new McpServer({
  name: "magicline-mcp",
  version: "0.1.0",
});

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
type QueryValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | null;

type MultipartPart =
  | { kind: "json"; name: string; data: unknown }
  | { kind: "text"; name: string; data: string; contentType?: string }
  | {
      kind: "binary";
      name: string;
      dataBase64: string;
      filename: string;
      contentType?: string;
    };

type RequestOptions = {
  method?: HttpMethod;
  query?: Record<string, QueryValue | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  rawBodyBase64?: string;
  multipart?: MultipartPart[];
  baseUrl?: string;
  baseUrlName?: string;
  apiKey?: string;
  apiKeyName?: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  requireApiKey?: boolean;
};

type OpenApiReference = { $ref: string };

type OpenApiSchema = {
  type?: string;
  enum?: unknown[];
  items?: OpenApiSchema | OpenApiReference;
  properties?: Record<string, OpenApiSchema | OpenApiReference>;
  required?: string[];
  oneOf?: Array<OpenApiSchema | OpenApiReference>;
  anyOf?: Array<OpenApiSchema | OpenApiReference>;
  allOf?: Array<OpenApiSchema | OpenApiReference>;
};

type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: OpenApiSchema | OpenApiReference;
  description?: string;
};

type OpenApiRequestBody = {
  description?: string;
  required?: boolean;
  content?: Record<string, { schema?: OpenApiSchema | OpenApiReference }>;
};

type OpenApiOperation = {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<OpenApiParameter | OpenApiReference>;
  requestBody?: OpenApiRequestBody | OpenApiReference;
};

type OpenApiPathItem = {
  parameters?: Array<OpenApiParameter | OpenApiReference>;
  get?: OpenApiOperation | OpenApiReference;
  post?: OpenApiOperation | OpenApiReference;
  put?: OpenApiOperation | OpenApiReference;
  delete?: OpenApiOperation | OpenApiReference;
};

type OpenApiSpec = {
  paths?: Record<string, OpenApiPathItem | OpenApiReference>;
  components?: {
    parameters?: Record<string, OpenApiParameter>;
    requestBodies?: Record<string, OpenApiRequestBody>;
    schemas?: Record<string, OpenApiSchema>;
  };
};

function formatResponse(data: unknown): string {
  if (data === undefined) {
    return "";
  }
  if (typeof data === "string") {
    return data;
  }
  return JSON.stringify(data, null, 2);
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]/g, " ");
}

function escapeHeaderQuotedValue(value: string): string {
  return sanitizeHeaderValue(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function ensureHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
) {
  const existingKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  if (!existingKey) {
    headers[name] = value;
  }
}

function setHeader(
  headers: Record<string, string>,
  name: string,
  value: string,
) {
  const existingKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  headers[existingKey ?? name] = value;
}

function buildUrl(
  path: string,
  query: Record<string, QueryValue | undefined> | undefined,
  baseUrl: string,
) {
  if (/^https?:\/\//i.test(path)) {
    throw new Error("Path must be relative (e.g. /v1/customers).");
  }
  if (!baseUrl) {
    throw new Error("Missing base URL. Set it in your MCP config env.");
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, baseUrl);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }

  return url.toString();
}

function buildMultipartBody(parts: MultipartPart[]) {
  const boundary = `----magicline-mcp-${Date.now().toString(16)}-${Math.random()
    .toString(16)
    .slice(2)}`;
  const chunks: Buffer[] = [];

  const push = (value: string | Buffer) => {
    chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
  };

  for (const part of parts) {
    push(`--${boundary}\r\n`);

    if (part.kind === "json") {
      push(
        `Content-Disposition: form-data; name="${escapeHeaderQuotedValue(
          part.name,
        )}"\r\n`,
      );
      push("Content-Type: application/json\r\n\r\n");
      push(JSON.stringify(part.data ?? null));
      push("\r\n");
      continue;
    }

    if (part.kind === "text") {
      const contentType = sanitizeHeaderValue(
        part.contentType ?? "text/plain",
      );
      push(
        `Content-Disposition: form-data; name="${escapeHeaderQuotedValue(
          part.name,
        )}"\r\n`,
      );
      push(`Content-Type: ${contentType}\r\n\r\n`);
      push(part.data);
      push("\r\n");
      continue;
    }

    const contentType = sanitizeHeaderValue(
      part.contentType ?? "application/octet-stream",
    );
    push(
      `Content-Disposition: form-data; name="${escapeHeaderQuotedValue(
        part.name,
      )}"; filename="${escapeHeaderQuotedValue(part.filename)}"\r\n`,
    );
    push(`Content-Type: ${contentType}\r\n\r\n`);
    push(Buffer.from(part.dataBase64, "base64"));
    push("\r\n");
  }

  push(`--${boundary}--\r\n`);

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

const MULTIPART_SCHEMA = z
  .array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("json"),
        name: z.string(),
        data: z.any(),
      }),
      z.object({
        kind: z.literal("text"),
        name: z.string(),
        data: z.string(),
        contentType: z.string().optional(),
      }),
      z.object({
        kind: z.literal("binary"),
        name: z.string(),
        dataBase64: z.string(),
        filename: z.string(),
        contentType: z.string().optional(),
      }),
    ]),
  )
  .min(1);

async function magiclineRequest<T>(
  path: string,
  opts?: RequestOptions,
): Promise<T> {
  const method = opts?.method ?? "GET";
  const baseUrl = opts?.baseUrl ?? OPENAPI_CONFIG.baseUrl;
  if (!baseUrl) {
    throw new Error(
      `Missing ${opts?.baseUrlName ?? "base URL"}. Set it in your MCP config env.`,
    );
  }

  const url = buildUrl(path, opts?.query, baseUrl);
  const isBodyAllowed = method !== "GET" && method !== "HEAD";
  const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
  const apiKey = opts?.apiKey ?? OPENAPI_CONFIG.apiKey;
  const requireApiKey = opts?.requireApiKey ?? true;
  const apiKeyHeader = opts?.apiKeyHeader ?? OPENAPI_CONFIG.apiKeyHeader;
  const apiKeyPrefix = opts?.apiKeyPrefix ?? "";

  ensureHeader(headers, "Accept", "application/json");
  if (requireApiKey && !apiKey) {
    throw new Error(
      `Missing ${opts?.apiKeyName ?? "API key"}. Set it in your MCP config env.`,
    );
  }
  if (apiKey) {
    const apiKeyValue =
      apiKeyPrefix && !apiKey.startsWith(apiKeyPrefix)
        ? `${apiKeyPrefix}${apiKey}`
        : apiKey;
    setHeader(headers, apiKeyHeader, apiKeyValue);
  }

  let body: BodyInit | undefined;

  if (opts?.multipart && opts.multipart.length > 0) {
    if (!isBodyAllowed) {
      throw new Error("Multipart bodies cannot be sent with GET or HEAD.");
    }
    const multipart = buildMultipartBody(opts.multipart);
    body = multipart.body;
    setHeader(headers, "Content-Type", multipart.contentType);
  } else if (opts?.rawBodyBase64) {
    if (!isBodyAllowed) {
      throw new Error("Raw bodies cannot be sent with GET or HEAD.");
    }
    body = Buffer.from(opts.rawBodyBase64, "base64");
  } else if (opts?.rawBody) {
    if (!isBodyAllowed) {
      throw new Error("Raw bodies cannot be sent with GET or HEAD.");
    }
    body = opts.rawBody;
  } else if (opts?.body !== undefined) {
    if (!isBodyAllowed) {
      throw new Error("Request bodies cannot be sent with GET or HEAD.");
    }
    body = JSON.stringify(opts.body);
    ensureHeader(headers, "Content-Type", "application/json");
  }

  const res = await fetch(url, { method, headers, body });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Magicline API error ${res.status} ${res.statusText} on ${path}\n${text}`,
    );
  }

  if (method === "HEAD") {
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
    } as T;
  }

  if (res.status === 204) {
    return null as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (contentType.includes("application/json")) {
    return (text ? JSON.parse(text) : null) as T;
  }

  return { contentType, body: text } as T;
}

const SUPPORTED_METHODS = new Set(["get", "post", "put", "delete"]);
type SpecRegistrationOptions = {
  specPath: URL;
  fallbackUrl: string;
  toolPrefix: string;
  baseUrl: string;
  baseUrlName?: string;
  apiKey?: string;
  apiKeyName?: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  requireApiKey?: boolean;
};

function isOpenApiRef(value: unknown): value is OpenApiReference {
  return Boolean(value && typeof value === "object" && "$ref" in value);
}

function resolveRef<T>(spec: OpenApiSpec, ref: string): T {
  if (!ref.startsWith("#/")) {
    throw new Error(`Unsupported OpenAPI ref: ${ref}`);
  }

  const pathSegments = ref
    .slice(2)
    .split("/")
    .map((segment) => decodeURIComponent(segment));
  let current: any = spec;

  for (const segment of pathSegments) {
    current = current?.[segment];
    if (current === undefined) {
      throw new Error(`Unresolved OpenAPI ref: ${ref}`);
    }
  }

  return current as T;
}

function deref<T>(spec: OpenApiSpec, value?: T | OpenApiReference): T | undefined {
  if (!value) {
    return undefined;
  }
  if (isOpenApiRef(value)) {
    return resolveRef<T>(spec, value.$ref);
  }
  return value as T;
}

function schemaToZod(
  spec: OpenApiSpec,
  schema: OpenApiSchema | OpenApiReference | undefined,
  visited = new Set<string>(),
): z.ZodTypeAny {
  if (!schema) {
    return z.any();
  }

  if (isOpenApiRef(schema)) {
    if (visited.has(schema.$ref)) {
      return z.any();
    }
    visited.add(schema.$ref);
    return schemaToZod(spec, resolveRef<OpenApiSchema>(spec, schema.$ref), visited);
  }

  if (schema.oneOf || schema.anyOf || schema.allOf) {
    return z.any();
  }

  if (
    schema.type === "string" &&
    schema.enum &&
    schema.enum.every((value) => typeof value === "string")
  ) {
    const values = schema.enum as string[];
    if (values.length === 1) {
      return z.literal(values[0]);
    }
    if (values.length > 1) {
      return z.enum(values as [string, ...string[]]);
    }
  }

  switch (schema.type) {
    case "string":
      return z.string();
    case "integer":
      return z.number().int();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(schemaToZod(spec, schema.items));
    case "object":
      return z.record(z.string(), z.any());
    default:
      return z.any();
  }
}

function normalizeParameters(
  spec: OpenApiSpec,
  pathItem: OpenApiPathItem,
  operation: OpenApiOperation,
): OpenApiParameter[] {
  const combined = [
    ...(pathItem.parameters ?? []),
    ...(operation.parameters ?? []),
  ];

  return combined
    .map((param) => deref<OpenApiParameter>(spec, param))
    .filter((param): param is OpenApiParameter => Boolean(param))
    .map((param) => ({
      ...param,
      required: param.in === "path" ? true : param.required,
    }));
}

function buildParamSchema(
  spec: OpenApiSpec,
  params: OpenApiParameter[],
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const param of params) {
    let paramSchema = schemaToZod(spec, param.schema);
    if (param.description) {
      paramSchema = paramSchema.describe(param.description);
    }
    if (!param.required) {
      paramSchema = paramSchema.optional();
    }
    shape[param.name] = paramSchema;
  }

  return z.object(shape);
}

function applyPathParams(
  path: string,
  params: Record<string, unknown> | undefined,
): string {
  return path.replace(/{([^}]+)}/g, (match, name) => {
    const value = params?.[name];
    if (value === undefined || value === null) {
      throw new Error(`Missing path parameter: ${name}`);
    }
    return encodeURIComponent(String(value));
  });
}

function sanitizeToolName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(sanitized)) {
    return `op_${sanitized}`;
  }
  return sanitized;
}

function uniqueToolName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let counter = 2;
  while (used.has(`${base}_${counter}`)) {
    counter += 1;
  }
  const name = `${base}_${counter}`;
  used.add(name);
  return name;
}

function buildOperationDescription(
  operation: OpenApiOperation,
  method: string,
  path: string,
  contentTypes: string[],
): string {
  const parts: string[] = [];
  if (operation.summary) {
    parts.push(operation.summary.trim());
  }
  if (operation.description) {
    parts.push(operation.description.trim());
  }
  if (operation.tags && operation.tags.length > 0) {
    parts.push(`Tags: ${operation.tags.join(", ")}`);
  }
  parts.push(`Method: ${method} ${path}`);
  if (contentTypes.length > 0) {
    parts.push(`Content types: ${contentTypes.join(", ")}`);
  }
  return parts.join(" ");
}

async function loadSpec(
  specPath: URL,
  fallbackUrl: string,
): Promise<OpenApiSpec> {
  try {
    const raw = await readFile(specPath, "utf8");
    return JSON.parse(raw) as OpenApiSpec;
  } catch (error) {
    const res = await fetch(fallbackUrl);
    if (!res.ok) {
      throw new Error(
        `Failed to load OpenAPI spec (${res.status} ${res.statusText}) from ${fallbackUrl}`,
      );
    }
    return (await res.json()) as OpenApiSpec;
  }
}

async function registerSpecTools(
  server: McpServer,
  options: SpecRegistrationOptions,
  usedNames: Set<string>,
) {
  const spec = await loadSpec(options.specPath, options.fallbackUrl);

  for (const [path, rawPathItem] of Object.entries(spec.paths ?? {})) {
    const pathItem = deref<OpenApiPathItem>(spec, rawPathItem);
    if (!pathItem) {
      continue;
    }

    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!SUPPORTED_METHODS.has(method)) {
        continue;
      }
      if (Array.isArray(rawOperation)) {
        continue;
      }
      const operation = deref<OpenApiOperation>(spec, rawOperation);
      if (!operation) {
        continue;
      }

      const operationId = operation.operationId || `${method}_${path}`;
      const toolName = uniqueToolName(
        `${options.toolPrefix}${sanitizeToolName(operationId)}`,
        usedNames,
      );

      const parameters = normalizeParameters(spec, pathItem, operation);
      const pathParams = parameters.filter((param) => param.in === "path");
      const queryParams = parameters.filter((param) => param.in === "query");
      const headerParams = parameters.filter((param) => param.in === "header");

      const requestBody = deref<OpenApiRequestBody>(
        spec,
        operation.requestBody,
      );
      const contentTypes = Object.keys(requestBody?.content ?? {});
      const supportsMultipart = contentTypes.includes("multipart/form-data");
      const supportsJson = contentTypes.includes("application/json");
      const bodyRequired = Boolean(requestBody?.required);

      const inputShape: Record<string, z.ZodTypeAny> = {
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Additional headers"),
      };

      if (pathParams.length > 0) {
        inputShape.pathParams = buildParamSchema(spec, pathParams).describe(
          "Path parameters",
        );
      }

      if (queryParams.length > 0) {
        const querySchema = buildParamSchema(spec, queryParams);
        inputShape.query = queryParams.some((param) => param.required)
          ? querySchema.describe("Query parameters")
          : querySchema.describe("Query parameters").optional();
      }

      if (headerParams.length > 0) {
        const headerSchema = buildParamSchema(spec, headerParams);
        inputShape.headerParams = headerParams.some((param) => param.required)
          ? headerSchema.describe("Header parameters")
          : headerSchema.describe("Header parameters").optional();
      }

      if (supportsJson) {
        inputShape.body = z.any().optional().describe("Request body");
        inputShape.rawBody = z
          .string()
          .optional()
          .describe("Raw body string (overrides body)");
        inputShape.rawBodyBase64 = z
          .string()
          .optional()
          .describe("Raw body as base64 (overrides rawBody/body)");
      }

      if (supportsMultipart) {
        inputShape.multipart = MULTIPART_SCHEMA.optional().describe(
          "Multipart form data parts",
        );
      }

      const description = buildOperationDescription(
        operation,
        method.toUpperCase(),
        path,
        contentTypes,
      );

      server.registerTool(
        toolName,
        {
          description,
          inputSchema: z.object(inputShape),
        },
        async (input: Record<string, any>) => {
          try {
            const pathParamsInput = input.pathParams as
              | Record<string, unknown>
              | undefined;
            const queryInput = input.query as
              | Record<string, QueryValue | undefined>
              | undefined;
            const headerParamsInput = input.headerParams as
              | Record<string, unknown>
              | undefined;
            const headersInput = input.headers as Record<string, string> | undefined;

            const resolvedPath = applyPathParams(path, pathParamsInput);
            const headers: Record<string, string> = { ...(headersInput ?? {}) };

            if (headerParamsInput) {
              for (const [key, value] of Object.entries(headerParamsInput)) {
                if (value === undefined || value === null) {
                  continue;
                }
                setHeader(headers, key, String(value));
              }
            }

            const hasBody = input.body !== undefined;
            const hasRaw = input.rawBody !== undefined;
            const hasRawBase64 = input.rawBodyBase64 !== undefined;
            const hasMultipart = input.multipart !== undefined;
            const bodyCount = [hasBody, hasRaw, hasRawBase64, hasMultipart].filter(
              Boolean,
            ).length;

            if (!supportsJson && (hasBody || hasRaw || hasRawBase64)) {
              throw new Error("This endpoint does not accept JSON bodies.");
            }
            if (!supportsMultipart && hasMultipart) {
              throw new Error(
                "This endpoint does not accept multipart/form-data bodies.",
              );
            }
            if (bodyCount > 1) {
              throw new Error(
                "Provide only one of body, rawBody, rawBodyBase64, or multipart.",
              );
            }
            if (bodyRequired && bodyCount === 0) {
              throw new Error("Request body is required for this endpoint.");
            }

            const data = await magiclineRequest<any>(resolvedPath, {
              method: method.toUpperCase() as HttpMethod,
              query: queryInput,
              headers,
              body: hasBody ? input.body : undefined,
              rawBody: hasRaw ? input.rawBody : undefined,
              rawBodyBase64: hasRawBase64 ? input.rawBodyBase64 : undefined,
              multipart: hasMultipart ? input.multipart : undefined,
              baseUrl: options.baseUrl,
              baseUrlName: options.baseUrlName,
              apiKey: options.apiKey,
              apiKeyName: options.apiKeyName,
              apiKeyHeader: options.apiKeyHeader,
              apiKeyPrefix: options.apiKeyPrefix,
              requireApiKey: options.requireApiKey,
            });

            return {
              content: [{ type: "text", text: formatResponse(data) }],
            };
          } catch (err: any) {
            return {
              content: [{ type: "text", text: `Request failed: ${err.message}` }],
            };
          }
        },
      );
    }
  }
}

/**
 * Tool: Generic Magicline request (JSON or raw body)
 */
server.registerTool(
  "magicline_request",
  {
    description:
      "Generic Magicline Open API request. Supports query params, JSON bodies, raw bodies, and HEAD.",
    inputSchema: {
      method: z.enum(["GET", "POST", "PUT", "DELETE", "HEAD"]).default("GET"),
      path: z
        .string()
        .min(1)
        .describe("Relative path like /v1/customers"),
      query: z
        .record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.array(z.union([z.string(), z.number(), z.boolean()])),
            z.null(),
          ]),
        )
        .optional()
        .describe("Query string parameters"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Additional headers (X-API-KEY is set automatically)"),
      body: z.any().optional().describe("JSON body"),
      rawBody: z
        .string()
        .optional()
        .describe("Raw body string (overrides JSON body)"),
      rawBodyBase64: z
        .string()
        .optional()
        .describe("Raw body as base64 (overrides rawBody/body)"),
    },
  },
  async ({ method, path, query, headers, body, rawBody, rawBodyBase64 }) => {
    try {
      const queryRecord = query as
        | Record<string, QueryValue | undefined>
        | undefined;
      const headerRecord = headers as Record<string, string> | undefined;
      const data = await magiclineRequest<any>(path, {
        method,
        query: queryRecord,
        headers: headerRecord,
        body,
        rawBody,
        rawBodyBase64,
      });

      return {
        content: [{ type: "text", text: formatResponse(data) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Request failed: ${err.message}` }],
      };
    }
  },
);

/**
 * Tool: Generic Magicline multipart/form-data request
 */
server.registerTool(
  "magicline_request_multipart",
  {
    description:
      "Generic multipart/form-data request for endpoints that upload files.",
    inputSchema: {
      method: z.enum(["POST", "PUT"]).default("POST"),
      path: z
        .string()
        .min(1)
        .describe("Relative path like /v1/customers/{id}/documents"),
      query: z
        .record(
          z.string(),
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.array(z.union([z.string(), z.number(), z.boolean()])),
            z.null(),
          ]),
        )
        .optional()
        .describe("Query string parameters"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Additional headers (X-API-KEY is set automatically)"),
      parts: MULTIPART_SCHEMA.describe(
        "Multipart parts. Use kind=binary with base64 data for file uploads.",
      ),
    },
  },
  async ({ method, path, query, headers, parts }) => {
    try {
      const queryRecord = query as
        | Record<string, QueryValue | undefined>
        | undefined;
      const headerRecord = headers as Record<string, string> | undefined;
      const data = await magiclineRequest<any>(path, {
        method,
        query: queryRecord,
        headers: headerRecord,
        multipart: parts,
      });

      return {
        content: [{ type: "text", text: formatResponse(data) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Request failed: ${err.message}` }],
      };
    }
  },
);

/**
 * Tool: Search customers (POST /v1/customers/search)
 */
server.registerTool(
  "magicline_search_customers",
  {
    description:
      "Search for customers in Magicline. Returns matching customer records.",
    inputSchema: {
      // Keep flexible because the exact search payload can vary by tenant/version.
      query: z.string().min(2).describe("Search term (name, email, etc.)"),
      limit: z.number().int().min(1).max(50).default(10),
    },
  },
  async ({ query, limit }) => {
    try {
      const data = await magiclineRequest<any>("/v1/customers/search", {
        method: "POST",
        body: {
          query,
          limit,
        },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        content: [
          {
            type: "text",
            text: `Search failed: ${err.message}`,
          },
        ],
      };
    }
  },
);

/**
 * Tool: Get customer (GET /v1/customers/{customerId})
 */
server.registerTool(
  "magicline_get_customer",
  {
    description: "Fetch a single customer by customerId.",
    inputSchema: {
      customerId: z.string().describe("Magicline customerId"),
    },
  },
  async ({ customerId }) => {
    try {
      const data = await magiclineRequest<any>(`/v1/customers/${customerId}`);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Get customer failed: ${err.message}` }],
      };
    }
  },
);

/**
 * Tool: Get customer checkins (GET /v1/customers/{customerId}/activities/checkins)
 */
server.registerTool(
  "magicline_get_customer_checkins",
  {
    description: "Fetch check-in activities for a customer.",
    inputSchema: {
      customerId: z.string().describe("Magicline customerId"),
    },
  },
  async ({ customerId }) => {
    try {
      const data = await magiclineRequest<any>(
        `/v1/customers/${customerId}/activities/checkins`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Get checkins failed: ${err.message}` }],
      };
    }
  },
);

/**
 * Tool: List membership offers (GET /v1/memberships/membership-offers)
 */
server.registerTool(
  "magicline_list_membership_offers",
  {
    description: "Returns all available membership offers.",
    inputSchema: {},
  },
  async () => {
    try {
      const data = await magiclineRequest<any>(
        "/v1/memberships/membership-offers",
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [
          { type: "text", text: `List membership offers failed: ${err.message}` },
        ],
      };
    }
  },
);

/**
 * Tool: Get studio information (GET /v1/studios/information)
 */
server.registerTool(
  "magicline_get_studio_information",
  {
    description: "Fetch studio information for the tenant.",
    inputSchema: {},
  },
  async () => {
    try {
      const data = await magiclineRequest<any>("/v1/studios/information");
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err: any) {
      return {
        content: [
          { type: "text", text: `Get studio info failed: ${err.message}` },
        ],
      };
    }
  },
);

async function main() {
  const usedNames = new Set<string>([
    "magicline_request",
    "magicline_request_multipart",
    "magicline_search_customers",
    "magicline_get_customer",
    "magicline_get_customer_checkins",
    "magicline_list_membership_offers",
    "magicline_get_studio_information",
  ]);

  await registerSpecTools(
    server,
    {
      specPath: OPENAPI_SPEC_PATH,
      fallbackUrl: process.env.MAGICLINE_OPENAPI_URL ?? DEFAULT_OPENAPI_URL,
      toolPrefix: "magicline_",
      baseUrl: OPENAPI_CONFIG.baseUrl,
      baseUrlName: "MAGICLINE_BASE_URL",
      apiKey: OPENAPI_CONFIG.apiKey,
      apiKeyName: "MAGICLINE_API_KEY",
      apiKeyHeader: OPENAPI_CONFIG.apiKeyHeader,
      requireApiKey: true,
    },
    usedNames,
  );

  await registerSpecTools(
    server,
    {
      specPath: CONNECT_SPEC_PATH,
      fallbackUrl:
        process.env.MAGICLINE_CONNECT_OPENAPI_URL ??
        DEFAULT_CONNECT_OPENAPI_URL,
      toolPrefix: "magicline_connect_",
      baseUrl: CONNECT_CONFIG.baseUrl,
      baseUrlName: "MAGICLINE_CONNECT_BASE_URL",
      apiKey: CONNECT_CONFIG.apiKey,
      apiKeyName: "MAGICLINE_CONNECT_API_KEY",
      apiKeyHeader: CONNECT_CONFIG.apiKeyHeader,
      requireApiKey: false,
    },
    usedNames,
  );

  await registerSpecTools(
    server,
    {
      specPath: DEVICE_SPEC_PATH,
      fallbackUrl:
        process.env.MAGICLINE_DEVICE_OPENAPI_URL ??
        DEFAULT_DEVICE_OPENAPI_URL,
      toolPrefix: "magicline_device_",
      baseUrl: DEVICE_CONFIG.baseUrl,
      baseUrlName: "MAGICLINE_DEVICE_BASE_URL",
      apiKey: DEVICE_CONFIG.apiToken,
      apiKeyName: "MAGICLINE_DEVICE_API_TOKEN",
      apiKeyHeader: DEVICE_CONFIG.authHeader,
      apiKeyPrefix: DEVICE_CONFIG.authPrefix,
      requireApiKey: true,
    },
    usedNames,
  );

  await registerSpecTools(
    server,
    {
      specPath: WEBHOOKS_SPEC_PATH,
      fallbackUrl:
        process.env.MAGICLINE_WEBHOOKS_OPENAPI_URL ??
        DEFAULT_WEBHOOKS_OPENAPI_URL,
      toolPrefix: "magicline_webhooks_",
      baseUrl: WEBHOOKS_CONFIG.baseUrl,
      baseUrlName: "MAGICLINE_WEBHOOKS_BASE_URL",
      apiKey: WEBHOOKS_CONFIG.apiKey,
      apiKeyName: "MAGICLINE_WEBHOOKS_API_KEY",
      apiKeyHeader: WEBHOOKS_CONFIG.apiKeyHeader,
      requireApiKey: true,
    },
    usedNames,
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // IMPORTANT: log to stderr, not stdout (stdio MCP restriction)
  console.error("Magicline MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
