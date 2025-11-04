output "resource_group_name" {
  description = "Name of the resource group"
  value       = azurerm_resource_group.main.name
}

output "container_registry_login_server" {
  description = "Login server for the container registry"
  value       = azurerm_container_registry.main.login_server
}

output "container_app_fqdn" {
  description = "FQDN of the container app"
  value       = azurerm_container_app.api.ingress[0].fqdn
}

output "api_url" {
  description = "Full URL of the API"
  value       = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}
