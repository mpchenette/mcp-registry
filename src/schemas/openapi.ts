import fs from "fs";
import path from "path";
import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import YAML from "yaml";

const DEFAULT_SPEC_PATH = path.resolve("docs", "reference", "api", "openapi.yaml");
const specPath = process.env.OPENAPI_SPEC_PATH
  ? path.resolve(process.cwd(), process.env.OPENAPI_SPEC_PATH)
  : DEFAULT_SPEC_PATH;

if (!fs.existsSync(specPath)) {
  throw new Error(`Unable to locate OpenAPI spec at ${specPath}. Set OPENAPI_SPEC_PATH to override.`);
}

const rawSpec = fs.readFileSync(specPath, "utf-8");
const openApiDocument = YAML.parse(rawSpec);

const ajv = new Ajv({
  strict: false,
  strictSchema: false,
  strictTypes: false,
  allowUnionTypes: true,
  allErrors: true,
});
addFormats(ajv);

const componentSchemas = openApiDocument?.components?.schemas as Record<string, unknown> | undefined;

if (!componentSchemas) {
  throw new Error("OpenAPI document missing components.schemas section");
}

// Add the entire OpenAPI document to allow Ajv to resolve all $ref references
ajv.addSchema(openApiDocument, openApiDocument.$id);

// Also add individual schemas with their reference paths
for (const [name, schema] of Object.entries(componentSchemas)) {
  ajv.addSchema(schema as Record<string, unknown>, `#/components/schemas/${name}`);
}

// OpenAPI keywords to strip from JSON Schema (for Fastify compatibility)
const OPENAPI_KEYWORDS = new Set([
  "example",
  "examples",
  "discriminator",
  "xml",
  "externalDocs",
  "deprecated",
  "default", // Fastify's strict mode doesn't like default in some contexts
]);

// Helper function to recursively resolve $ref in schemas
function resolveRefs(schema: any, components: Record<string, any>): any {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map((item) => resolveRefs(item, components));
  }

  if (schema.$ref) {
    const refPath = schema.$ref.replace("#/components/schemas/", "");
    const resolvedSchema = components[refPath];
    if (!resolvedSchema) {
      throw new Error(`Cannot resolve reference: ${schema.$ref}`);
    }
    // Recursively resolve the referenced schema
    return resolveRefs(resolvedSchema, components);
  }

  const resolved: any = {};
  for (const [key, value] of Object.entries(schema)) {
    // Skip OpenAPI-specific keywords
    if (OPENAPI_KEYWORDS.has(key)) {
      continue;
    }
    resolved[key] = resolveRefs(value, components);
  }
  return resolved;
}

// Create dereferenced schemas for Fastify (which uses fast-json-stringify)
export const dereferencedSchemas = {
  ServerDetail: resolveRefs(componentSchemas.ServerDetail, componentSchemas),
  ServerResponse: resolveRefs(componentSchemas.ServerResponse, componentSchemas),
  ServerList: resolveRefs(componentSchemas.ServerList, componentSchemas),
};

export const getSchemaValidator = (ref: string): ValidateFunction<unknown> => {
  const validator = ajv.getSchema(ref);
  if (!validator) {
    throw new Error(`Schema validator not found for ref ${ref}`);
  }
  return validator;
};

export const validators = {
  serverDetail: getSchemaValidator("#/components/schemas/ServerDetail"),
  serverResponse: getSchemaValidator("#/components/schemas/ServerResponse"),
  serverList: getSchemaValidator("#/components/schemas/ServerList"),
};

export type ValidationRef = keyof typeof validators;

export const getValidator = (name: ValidationRef): ValidateFunction<unknown> => validators[name];

export { ajv, openApiDocument, componentSchemas };
