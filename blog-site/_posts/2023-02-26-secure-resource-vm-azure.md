---
title:  "Access to secure Azure resources from a Azure VM deployed using Terraform using a User Managed Identity"
date:   2023-02-22 11:49:06 +0000
categories: [azure, virtual machie, terraform, managed identity]
---

This article shows the creation of a Terraform configuration that deploys a VM to the Azure cloud, installs some tooling in it (including docker), and gets secrets from an Azure Key Vault. The secrets are later used as parameters for containers based on images from an Azure Container Registry.
<!--more-->
## TL;DR

You want to access Azure secure resources from an Azure VM which is deployed using Terraform. In addition, the resources and the secrets (stored in a vault) used to access those resources, are under a subscription distinct from the VM one.

A solution lies in creating a Managed Identity, which is given access to the required resources, and which is assigned to the VM as a User Assigned managed identity. With the `az` tool included in the VM tooling, you can access the desired secrets and resources.

## The full story

If you are reading this, you are probably familiar with the Azure infrastructure and Terraform. Otherwise, this [page](https://learn.microsoft.com/en-us/azure/developer/terraform/overview) contains some usefull links.

The reason why we dig into this problem was that we wanted to automate the deployment of a VM in which docker is running a few containers, some of which require secrets as arguments. Furthermore, the images for those containers are stored in an Azure container registry.

To get started with creating a Linux Azure VM using Terraform, you may refer to this [Azure article](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/quick-create-terraform). For simplicity, only a fragment of a Terraform configuration to create an Azure VM is shown here:

```terraform
resource "azurerm_network_interface" "nic" {
  name                = "${var.vm_name}-nic"
  location            = var.location
  resource_group_name = var.rg_name
  tags                = var.tags
  ip_configuration {
    name                          = "${var.vm_name}-nic-ipconfig"
    private_ip_address_allocation = "Dynamic"
    subnet_id                     = var.snet_id
  }
}

resource "azurerm_storage_account" "sa" {
  name                     = "${var.vm_name}sadiag"
  location                 = var.location
  resource_group_name      = var.rg_name
  account_tier             = "Standard"
  account_replication_type = "LRS"
  tags                     = var.tags
}

resource "azurerm_linux_virtual_machine" "vm" {
  location            = var.location
  name                = var.vm_name
  tags                = var.tags
  resource_group_name = var.rg_name
  size                = "Standard_B2s"
  computer_name                   = var.vm_name
  admin_username                  = "my_user"
  admin_password                  = var.password
  disable_password_authentication = false
  network_interface_ids           = [azurerm_network_interface.nic.id]
  boot_diagnostics {
    storage_account_uri = azurerm_storage_account.sa.primary_blob_endpoint
  }
  os_disk {
    name                 = "${var.vm_name}-disk"
    storage_account_type = "Standard_LRS"
    caching              = "ReadWrite"
  }
  source_image_reference {
    publisher = "Canonical"
    offer     = "UbuntuServer"
    sku       = "18.04-LTS"
    version   = "latest"
  }
  custom_data = base64encode(file("./cloud-init.yaml"))
}
```

This example uses the Ubuntu Server 18.04-LTS image, but you might choose many other images that you can list using the command [`az vm image list`](https://learn.microsoft.com/en-us/cli/azure/vm/image?view=azure-cli-latest#az-vm-image-list).

Before caring about the sensitive information, we need the appropriate tooling to be available in the VM upon deployment. To accomplish that, you have at least three alternatives:

1. An existing VM image that suits you with the tooling already installed.
1. Create a new image from a deployed VM in which you have the tooling installed.
1. Start from one of the basic images and automate the tools installation once the VM is deployed.

The third option is the most flexible one, and the one described here. In the previous terrafrom configuration, the VM creation is supplied with the (base64 encoded) content of a file in the `custom_data` attribute. That file contains the instructions to install docker and other tooling, following the conventions for cloud-init config, although it can be written as a bash script.

The cloud-init mechanism in an Azure Linux VM reads the `custom_data` that is provided to the VM during its creation process as described in this [article](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/using-cloud-init).

```yaml
#cloud-config
package_upgrade: true
packages:
  - ca-certificates
  - curl
  - gnupg
  - lsb-release
  - apt-transport-https
runcmd:
  - sudo apt-get -y update
  - sudo mkdir -m 0755 -p /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  - sudo apt-get -y update
  - sudo apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  - sudo groupadd docker
  - sudo usermod -aG docker my_user
  - newgrp docker
```

With the previous instructions, we can get to the point of having docker running in the VM. If one is already using the `custom_data` attribute, the temptation to include the secrets in that data is likely to appear. You should avoid this, as stated by the Azure [documentation](https://learn.microsoft.com/en-us/azure/virtual-machines/custom-data). If you have secrets, it is better to have them stored in a Key Vault and access them in a secure way.

Be aware that after the Terraform configuration is applied, it may take a while until cloud-init completes your instructions in the VM. You may check its progress by inspecting its output using `tail -f /var/log/cloud-init-output.log`.
{: .notice--info}

A possible solution to passing secrets stored in a Key Vault to a VM may be using the `secret` attribute that copies secrets (like certificates) to the VM at a predefined folder (more details in this [article](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/tutorial-automate-vm-deployment)). This would work great if the subscription used for creating the VM resource is the same as the one used for accessing the secrets. It was not our case, so no further details into this alternative are shown here.

The adopted solution was to create an Azure Managed Identity which is assigned to the VM as a User Assigned managed identity. Once the identity is created, like explained in this [article](https://learn.microsoft.com/en-us/azure/active-directory/managed-identities-azure-resources/how-manage-user-assigned-managed-identities?pivots=identity-mi-methods-azp#create-a-user-assigned-managed-identity), we can tell Terraform to assign it to the VM. The new configuration is:

```terraform
resource "azurerm_network_interface" "nic" {
  name                = "${var.vm_name}-nic"
  location            = var.location
  resource_group_name = var.rg_name
  tags                = var.tags
  ip_configuration {
    name                          = "${var.vm_name}-nic-ipconfig"
    private_ip_address_allocation = "Dynamic"
    subnet_id                     = var.snet_id
  }
}

resource "azurerm_storage_account" "sa" {
  name                     = "${var.vm_name}sadiag"
  location                 = var.location
  resource_group_name      = var.rg_name
  account_tier             = "Standard"
  account_replication_type = "LRS"
  tags                     = var.tags
}

data "azurerm_user_assigned_identity" "identity" {
  name                = "var.identity_name"
  resource_group_name = "var.identity_rg"
}

resource "azurerm_linux_virtual_machine" "vm" {
  location            = var.location
  name                = var.vm_name
  tags                = var.tags
  resource_group_name = var.rg_name
  size                = "Standard_B2s"
  computer_name                   = var.vm_name
  admin_username                  = "my_user"
  admin_password                  = var.password
  disable_password_authentication = false
  network_interface_ids           = [azurerm_network_interface.nic.id]
  boot_diagnostics {
    storage_account_uri = azurerm_storage_account.sa.primary_blob_endpoint
  }
  os_disk {
    name                 = "${var.vm_name}-disk"
    storage_account_type = "Standard_LRS"
    caching              = "ReadWrite"
  }
  source_image_reference {
    publisher = "Canonical"
    offer     = "UbuntuServer"
    sku       = "18.04-LTS"
    version   = "latest"
  }
  custom_data = base64encode(file("./cloud-init.yaml"))
  identity {
    type         = "UserAssigned"
    identity_ids = [data.azurerm_user_assigned_identity.identity.id]
  }
}
```

Now that the VM can act as the created identity, we need to provide it with access to the Azure Key Vault and the Azure Container Registry. To grant the identity with access to the Key Vault is necessary to create an Access Policy that includes the required permissions (e.g., `Get` and `List` permission for Secrets), as described [here](https://learn.microsoft.com/en-us/azure/key-vault/general/assign-access-policy?tabs=azure-portal). In the case of the Container Registry, the access is granted by adding a (Reader) role assignment to the registry resource, as described in this [article](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal). Now the cloud-init instructions can include the actions to access the required resources and secrets. 

```yaml
#cloud-config
package_upgrade: true
packages:
  - ca-certificates
  - curl
  - gnupg
  - lsb-release
  - apt-transport-https
runcmd:
  - sudo apt-get -y update
  - sudo mkdir -m 0755 -p /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  - sudo apt-get -y update
  - sudo apt-get -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  - sudo groupadd docker
  - sudo usermod -aG docker my_user
  - newgrp docker
  - curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
  - az login --identity
  - az acr login --name <registry>
  - secret=$(az keyvault secret show --name <SECRET-NAME> --vault-name <vault-name> --query "value" -o tsv)
  - docker run -d -e SECRET=$secret <registry.azurecr.io/container-image>
```
The new four instructuion at the end of the file do the following:

1. Deal with [`az cli installation`](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux?pivots=apt).
1. Do an `az login` based on the assigned identity.
1. Do an `az acr login` targeting the container registry named `registry`.
1. Get a secret named `SECRET-NAME` from a Vault named `vault-name`.
1. Execute `docker run` passing to it the previous secret value as a variable. The command will trigger the pull of the image `registry.azurecr.io/container-image` from the registry to which access was already granted.

