# MCP Registry API

Fastify + SQLite implementation of the [Model Context Protocol](https://github.com/modelcontextprotocol/registry) generic registry API.  
Use it to publish and serve MCP server metadata with responses that conform to the official OpenAPI spec.

## Prerequisites

- Node.js 18.19+ (Node 20.x recommended for Azure App Service)
- npm 9+

## Getting Started

```bash
git clone <this repo>
cd mcp-registry
npm install
cp .env.example .env    # tweak PORT / DATABASE_PATH / REGISTRY_PUBLISH_TOKEN
```

### Run locally

```bash
# optional: load sample data from registry.json
npm run seed

# start the API with live reload
npm run dev

# or build for production and run the compiled server
npm run build
npm start
```

The service listens on `http://0.0.0.0:${PORT}` (default `3000`).  
`/healthz` returns a simple status payload for readiness probes.

## Core API Surface (v0)

| Method & Path | Description |
| --- | --- |
| `GET /v0/servers` | List servers (defaults to latest version). Supports `cursor`, `limit`, `search`, `updated_since`, and `version` filters. |
| `GET /v0/servers/{serverName}/versions` | List every version of a server (`serverName` must be URL-encoded, e.g. `io.modelcontextprotocol%2Ffilesystem`). |
| `GET /v0/servers/{serverName}/versions/{version}` | Fetch a specific version (`version=latest` for the newest release). |
| `POST /v0/publish` | Publish or update a server version. Requires a bearer token when `REGISTRY_PUBLISH_TOKEN` is configured. |

Requests and responses are validated at runtime against the upstream OpenAPI schemas (see `docs/reference/api/openapi.yaml`).

### Example: publish a server

```bash
curl -X POST http://localhost:3000/v0/publish \
  -H "Authorization: Bearer $REGISTRY_PUBLISH_TOKEN" \
  -H "Content-Type: application/json" \
  --data @samples/filesystem.json
```

Use `registry.json` when you want to seed multiple entries at once (see `npm run seed`).

### Example: page through servers

```bash
curl "http://localhost:3000/v0/servers?limit=20"
# use the metadata.nextCursor value on the next request:
curl "http://localhost:3000/v0/servers?cursor=<nextCursor>"
```

## Configuration

- `PORT` – HTTP port (defaults to `3000`)
- `DATABASE_PATH` – location for the SQLite database file (`./data/registry.sqlite` by default)
- `REGISTRY_PUBLISH_TOKEN` – bearer token required for `POST /v0/publish`. Leave unset to make the registry read-only.
- `OPENAPI_SPEC_PATH` – optional override if you relocate the OpenAPI document.

All configuration is read at start-up (`.env` is supported via `dotenv`).

## Deploying to Azure App Service

1. Login to Azure

```bash
az login
```

2. Configure variables

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
Edit terraform.tfvars with your values
```

3. Deploy infrastructure

```bash
terraform init
terraform apply
```

4. Get your API URL

```bash
terraform -chdir=terraform output api_url
```

## Tooling

- `npm run dev` – Fastify with hot reload (tsx)
- `npm run typecheck` / `npm test` – TypeScript compilation checks
- `npm run clean` – remove the `dist` directory
- `npm run seed [file]` – load server definitions from a JSON array

## Helpful Links

- OpenAPI specification: `docs/reference/api/openapi.yaml`
- MCP registry API reference: https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/generic-registry-api.md

Feel free to layer additional CI/CD and infrastructure automation on top of this baseline.
