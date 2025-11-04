terraform {
  required_version = ">= 1.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "=4.1.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

# Resource Group
resource "azurerm_resource_group" "main" {
  name     = "${var.project_name}-${var.environment}-rg"
  location = var.location

  tags = var.tags
}

# Log Analytics Workspace for Container Apps
resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.project_name}-${var.environment}-logs"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30

  tags = var.tags
}

# Container Apps Environment
resource "azurerm_container_app_environment" "main" {
  name                       = "${var.project_name}-${var.environment}-env"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  tags = var.tags
}

# Container Registry
resource "azurerm_container_registry" "main" {
  name                          = "${replace(var.project_name, "-", "")}${var.environment}acr"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  sku                           = "Premium"
  admin_enabled                 = false
  public_network_access_enabled = false
  
  network_rule_set {
    default_action = "Deny"
  }
  tags = var.tags
}

# Build and push Docker image
resource "null_resource" "docker_build_push" {
  # Trigger rebuild when image tag changes or ACR is recreated
  triggers = {
    acr_id    = azurerm_container_registry.main.id
    image_tag = var.image_tag
  }

  provisioner "local-exec" {
    command     = <<-EOT
      echo "Logging into Azure Container Registry..."
      az acr login --name ${azurerm_container_registry.main.name}
      
      echo "Building and pushing Docker image..."
      docker buildx build --platform linux/amd64 \
        -t ${azurerm_container_registry.main.login_server}/mcp-registry:${var.image_tag} \
        --push \
        ${path.module}/..
      
      echo "Docker image pushed successfully!"
    EOT
    working_dir = path.module
  }

  depends_on = [azurerm_container_registry.main]
}

# Container App with Managed Identity
resource "azurerm_container_app" "api" {
  name                         = "${var.project_name}-${var.environment}-api"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  template {
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas

    container {
      name   = "mcp-registry-api"
      image  = "${azurerm_container_registry.main.login_server}/mcp-registry:${var.image_tag}"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "PORT"
        value = "3000"
      }

      env {
        name  = "DATABASE_PATH"
        value = "/app/data/registry.sqlite"
      }

      env {
        name        = "REGISTRY_PUBLISH_TOKEN"
        secret_name = "registry-publish-token"
      }
    }
  }

  registry {
    server               = azurerm_container_registry.main.login_server
    username             = azurerm_container_registry.main.admin_username
    password_secret_name = "acr-password"
  }

  secret {
    name  = "acr-password"
    value = azurerm_container_registry.main.admin_password
  }

  secret {
    name  = "registry-publish-token"
    value = var.registry_publish_token
  }

  ingress {
    external_enabled = true
    target_port      = 3000

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  tags = var.tags

  depends_on = [null_resource.docker_build_push]
}

# Note: Using ephemeral storage for SQLite database
# Data will be lost on container restarts. For production, consider:
# - Azure SQL Database / PostgreSQL
# - Read-only data with initialization script
# - External API-based storage
