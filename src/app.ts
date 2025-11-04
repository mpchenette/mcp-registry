import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env";
import { createDatabase } from "./db";
import { registryRoutes } from "./routes/registry-routes";
import { RegistryService } from "./services/registry-service";
import { HttpError, ValidationError } from "./utils/errors";
import { formatAjvErrors } from "./utils/validation";

export const buildApp = () => {
  const app = Fastify({
    logger: {
      level: env.nodeEnv === "production" ? "info" : "debug",
    },
  });

  // Enable CORS for all origins
  app.register(cors, {
    origin: true, // Allow all origins
    credentials: true,
  });

  const database = createDatabase(env.databasePath);
  const registryService = new RegistryService(database);

  app.addHook("onClose", (instance, done) => {
    try {
      database.close();
      done();
    } catch (error) {
      done(error as Error);
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      const payload =
        error instanceof ValidationError
          ? { error: error.message, details: formatAjvErrors(error.errors) }
          : { error: error.message, ...(error.payload as Record<string, unknown> | undefined) };
      reply.status(error.statusCode).send(payload);
      return;
    }

    if (error.validation) {
      reply.status(400).send({
        error: "Invalid request",
        details: error.validation,
      });
      return;
    }

    request.log.error({ err: error }, "Unhandled error");
    reply.status(500).send({ error: "Internal server error" });
  });

  app.register(registryRoutes, {
    registry: registryService,
    publishToken: env.publishToken,
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  return app;
};

