# MCP Registry - Azure Terraform Deployment

This directory contains Terraform configuration to deploy the MCP Registry API to Azure using Container Apps.

## Architecture

The deployment includes:

- **Azure Container Registry (ACR)**: Stores Docker images
- **Azure Container Apps**: Runs the application with auto-scaling
- **Azure Storage Account**: Provides persistent storage for SQLite database via Azure Files
- **Log Analytics Workspace**: Collects logs and metrics
- **Container Apps Environment**: Managed environment for the container app

## Prerequisites

1. **Azure CLI**: [Install Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)
2. **Terraform**: [Install Terraform](https://www.terraform.io/downloads)
3. **Docker**: [Install Docker](https://docs.docker.com/get-docker/)
4. **Azure Subscription**: Active Azure subscription with appropriate permissions

## Setup

### 1. Login to Azure

```bash
az login
```

### 2. Set your subscription (if you have multiple)

```bash
az account set --subscription "YOUR_SUBSCRIPTION_ID"
```

### 3. Configure Terraform Variables

Copy the example variables file:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and set your values:

```hcl
project_name = "mcp-registry"
environment  = "dev"
location     = "eastus"
registry_publish_token = "your-secret-token-here"
```

## Deployment

### 1. Initialize Terraform

```bash
cd terraform
terraform init
```

### 2. Review the deployment plan

```bash
terraform plan
```

### 3. Apply the configuration

```bash
terraform apply
```

Type `yes` when prompted to confirm.

### 4. Build and push Docker image

After Terraform creates the infrastructure, get the ACR details:

```bash
# Get ACR login server
ACR_LOGIN_SERVER=$(terraform output -raw container_registry_login_server)

# Login to ACR
az acr login --name $(terraform output -raw container_registry_login_server | sed 's/.azurecr.io//')

# Build and tag the image (from project root)
cd ..
docker build -t $ACR_LOGIN_SERVER/mcp-registry:latest .

# Push to ACR
docker push $ACR_LOGIN_SERVER/mcp-registry:latest
```

### 5. Update Container App with new image

```bash
# Trigger a new revision to pull the image
az containerapp update \
  --name $(terraform output -raw resource_group_name | sed 's/-rg$//')-api \
  --resource-group $(terraform output -raw resource_group_name)
```

### 6. Get the API URL

```bash
terraform output api_url
```

## Testing the Deployment

Test the health endpoint:

```bash
API_URL=$(terraform output -raw api_url)
curl $API_URL/healthz
```

## Environment Variables

The application is configured with these environment variables:

- `NODE_ENV`: Set to "production"
- `PORT`: Container port (3000)
- `DATABASE_PATH`: Path to SQLite database in Azure Files mount
- `REGISTRY_PUBLISH_TOKEN`: Secret token for publishing (from Terraform variables)

## Scaling

The Container App is configured with auto-scaling:

- **Min replicas**: 1 (configurable via `min_replicas`)
- **Max replicas**: 3 (configurable via `max_replicas`)
- **CPU**: 0.25 cores per instance
- **Memory**: 0.5 GB per instance

To adjust scaling, update the variables in `terraform.tfvars` and re-apply:

```bash
terraform apply
```

## Monitoring

Access logs through Azure Portal:

1. Go to your Container App resource
2. Navigate to "Log stream" or "Logs" in the left menu
3. Use Log Analytics queries to analyze application behavior

## Updating the Application

To deploy a new version:

```bash
# Build new image with a version tag
docker build -t $ACR_LOGIN_SERVER/mcp-registry:v1.0.1 .
docker push $ACR_LOGIN_SERVER/mcp-registry:v1.0.1

# Update terraform.tfvars with new image_tag
# image_tag = "v1.0.1"

# Apply the changes
terraform apply
```

## Cost Considerations

Azure Container Apps pricing is based on:

- vCPU and memory allocation
- Request count
- Data egress

With the default configuration (0.25 vCPU, 0.5 GB RAM, 1 replica), costs are minimal for low-traffic applications. Azure offers a monthly free grant for Container Apps.

## Cleanup

To destroy all resources:

```bash
terraform destroy
```

Type `yes` when prompted to confirm.

## Troubleshooting

### Container fails to start

Check logs:

```bash
az containerapp logs show \
  --name <container-app-name> \
  --resource-group <resource-group-name> \
  --follow
```

### Database connectivity issues

Verify the Azure Files mount:

```bash
az containerapp exec \
  --name <container-app-name> \
  --resource-group <resource-group-name> \
  --command "ls -la /mnt/data"
```

### Image pull errors

Ensure ACR credentials are correct:

```bash
az acr credential show --name <acr-name>
```

## Security Considerations

1. **Secrets Management**: Consider using Azure Key Vault for sensitive values
2. **Network Security**: Add VNet integration for private networking
3. **Authentication**: Implement Azure AD authentication for the API
4. **HTTPS**: Container Apps provides automatic HTTPS (enabled by default)

## Further Customization

- Add Azure Application Insights for advanced monitoring
- Configure custom domains
- Set up Azure Front Door for CDN and WAF
- Implement backup strategy for the database
- Add staging environments by duplicating with different `environment` variable
