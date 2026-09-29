from __future__ import annotations

import os
from pathlib import Path

import paramiko


ROOT = Path(__file__).resolve().parents[1]


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def new_client() -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    known_hosts = Path.home() / ".ssh" / "known_hosts"
    if known_hosts.exists():
        client.load_host_keys(str(known_hosts))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    return client


def main() -> None:
    env = read_env(ROOT / ".env.example")
    host = env.get("SSH_HOST", "102.68.84.191")
    username = env.get("SSH_USERNAME", "")
    password = env.get("SSH_PASS", "")
    if not host or not username or not password:
        raise RuntimeError("RELAY_HOST, SSH_USERNAME, and SSH_PASS are required")

    public_key_path = ROOT / ".desktop-data" / "ssh" / "all_in_relay_ed25519.pub"
    private_key_path = ROOT / ".desktop-data" / "ssh" / "all_in_relay_ed25519"
    public_key = public_key_path.read_text(encoding="ascii").strip()

    client = new_client()
    client.connect(host, username=username, password=password, look_for_keys=False, allow_agent=False, timeout=10)
    sftp = client.open_sftp()
    ssh_directory = f"/root/.ssh" if username == "root" else f"/home/{username}/.ssh"
    authorized_keys = f"{ssh_directory}/authorized_keys"
    try:
        sftp.mkdir(ssh_directory, mode=0o700)
    except OSError:
        pass
    try:
        with sftp.open(authorized_keys, "r") as stream:
            existing = stream.read().decode("utf-8")
    except OSError:
        existing = ""
    if public_key not in existing.splitlines():
        with sftp.open(authorized_keys, "a") as stream:
            stream.write(("" if not existing or existing.endswith("\n") else "\n") + public_key + "\n")
    sftp.chmod(ssh_directory, 0o700)
    sftp.chmod(authorized_keys, 0o600)
    sftp.close()
    client.close()

    key = paramiko.Ed25519Key.from_private_key_file(str(private_key_path))
    verification = new_client()
    verification.connect(host, username=username, pkey=key, look_for_keys=False, allow_agent=False, timeout=10)
    _, stdout, _ = verification.exec_command("printf KEY_AUTH_OK")
    result = stdout.read().decode("ascii")
    verification.close()
    if result != "KEY_AUTH_OK":
        raise RuntimeError("Key-only SSH verification failed")
    print("KEY_AUTH_OK")


if __name__ == "__main__":
    main()
