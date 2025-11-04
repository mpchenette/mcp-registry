import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ServerDetail, ServerList, ServerResponse } from "../types/registry";
import type { RegistryService, ListServersOptions } from "../services/registry-service";
import { dereferencedSchemas, getValidator } from "../schemas/openapi";
import { validateWithSchema } from "../utils/validation";
import { HttpError, UnauthorizedError } from "../utils/errors";

interface RegistryRoutesOptions {
  registry: RegistryService;
  publishToken: string | null;
}

interface ListServersQuerystring {
  cursor?: string;
  limit?: number;
  search?: string;
  updated_since?: string;
  version?: string;
}

interface ServerNameParams {
  serverName: string;
}

interface ServerVersionParams extends ServerNameParams {
  version: string;
}

const listServersQuerySchema = {
  type: "object",
  properties: {
    cursor: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    search: { type: "string" },
    updated_since: { type: "string", format: "date-time" },
    version: { type: "string" },
  },
  additionalProperties: false,
};

const serverNameParamsSchema = {
  type: "object",
  required: ["serverName"],
  properties: {
    serverName: {
      type: "string",
      minLength: 1,
    },
  },
};

const serverVersionParamsSchema = {
  type: "object",
  required: ["serverName", "version"],
  properties: {
    serverName: {
      type: "string",
      minLength: 1,
    },
    version: {
      type: "string",
      minLength: 1,
    },
  },
};

const serverDetailSchema = dereferencedSchemas.ServerDetail;
const serverResponseSchema = dereferencedSchemas.ServerResponse;
const serverListSchema = dereferencedSchemas.ServerList;

export const registryRoutes: FastifyPluginAsync<RegistryRoutesOptions> = async (fastify, options) => {
  const { registry, publishToken } = options;

  fastify.get(
    "/v0/servers",
    {
      schema: {
        tags: ["servers"],
        querystring: listServersQuerySchema,
        response: {
          200: serverListSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: ListServersQuerystring }>): Promise<ServerList> => {
      const query = request.query ?? {};
      const listOptions: ListServersOptions = {
        limit: query.limit !== undefined ? Number(query.limit) : undefined,
        cursor: query.cursor,
        search: query.search?.trim(),
        updatedSince: query.updated_since,
        version: query.version?.trim(),
      };

      const result = registry.listServers(listOptions);
      return validateWithSchema<ServerList>(
        getValidator("serverList"),
        result,
        "Server list response failed schema validation",
      );
    },
  );

  fastify.get(
    "/v0/servers/:serverName/versions",
    {
      schema: {
        tags: ["servers"],
        params: serverNameParamsSchema,
        response: {
          200: serverListSchema,
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: ServerNameParams }>, reply: FastifyReply) => {
      try {
        const { serverName } = request.params;
        const result = registry.listServerVersions(serverName);
        const validated = validateWithSchema<ServerList>(
          getValidator("serverList"),
          result,
          "Server versions response failed schema validation",
        );
        return validated;
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404) {
          return reply.code(404).send({ error: "Server not found" });
        }
        throw error;
      }
    },
  );

  fastify.get(
    "/v0/servers/:serverName/versions/:version",
    {
      schema: {
        tags: ["servers"],
        params: serverVersionParamsSchema,
        response: {
          200: serverResponseSchema,
          404: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: ServerVersionParams }>, reply: FastifyReply) => {
      try {
        const { serverName, version } = request.params;
        const result = registry.getServerVersion(serverName, version);
        const validated = validateWithSchema<ServerResponse>(
          getValidator("serverResponse"),
          result,
          "Server version response failed schema validation",
        );
        return validated;
      } catch (error) {
        if (error instanceof HttpError && error.statusCode === 404) {
          return reply.code(404).send({ error: "Server version not found" });
        }
        throw error;
      }
    },
  );

  fastify.post(
    "/v0/publish",
    {
      schema: {
        tags: ["publish"],
        body: serverDetailSchema,
        response: {
          200: serverResponseSchema,
          401: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
          403: {
            type: "object",
            properties: {
              error: { type: "string" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: ServerDetail }>, reply: FastifyReply) => {
      if (!publishToken) {
        throw new HttpError(403, "Publishing is disabled on this registry instance");
      }

      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) {
        throw new UnauthorizedError("Missing bearer token");
      }

      const token = authorization.slice("Bearer ".length).trim();
      if (token !== publishToken) {
        throw new UnauthorizedError("Invalid bearer token");
      }

      const payload = validateWithSchema<ServerDetail>(
        getValidator("serverDetail"),
        request.body,
        "Server payload failed schema validation",
      );

      const result = registry.publish(payload);
      const validated = validateWithSchema<ServerResponse>(
        getValidator("serverResponse"),
        result.response,
        "Publish response failed schema validation",
      );
      return reply.code(200).send(validated);
    },
  );
};
