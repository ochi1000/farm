param(
    [string]$HostName = "102.68.84.191",
    [string]$SshUser = "root",
    [string]$PublicKeyPath = ".desktop-data\ssh\all_in_relay_ed25519.pub"
)

$ErrorActionPreference = "Stop"
if ($HostName -notmatch '^[A-Za-z0-9.-]+$' -or $SshUser -notmatch '^[A-Za-z0-9._-]+$') {
    throw "Invalid SSH host or username."
}

$publicKey = (Get-Content $PublicKeyPath -Raw).Trim()
if ($publicKey -notmatch '^ssh-ed25519\s+[A-Za-z0-9+/=]+(?:\s+.*)?$') {
    throw "The public key is not a valid Ed25519 key."
}

Write-Host "Enter the password for $SshUser@$HostName when SSH prompts for it."
Write-Host "Only the public key will be installed; the private key stays on this PC."

$remoteCommand = "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF '$publicKey' ~/.ssh/authorized_keys || printf '%s\n' '$publicKey' >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys"
& ssh -o StrictHostKeyChecking=accept-new "$SshUser@$HostName" $remoteCommand
if ($LASTEXITCODE -ne 0) { throw "SSH key authorization failed." }

Write-Host "SSH_KEY_AUTHORIZED"
