#!/usr/bin/env bash
# One-time VPS preparation for Ubuntu 22.04 / 24.04 LTS.
# Run as root:  bash bootstrap-vps.sh
set -euo pipefail

APP_DIR=/opt/sport-spin
DEPLOY_USER=${DEPLOY_USER:-ubuntu}

echo "==> apt update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg rsync ufw

echo "==> Docker Engine + compose plugin (official convenience script)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker --version
docker compose version

echo "==> allow the deploy user to run docker without sudo"
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  usermod -aG docker "$DEPLOY_USER"
fi

echo "==> firewall: 22, 80, 443 only"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> app directory"
mkdir -p "$APP_DIR"
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$APP_DIR"
fi

echo
echo "Done. Next:"
echo "  1) rsync the project to $APP_DIR (see deploy/vps/push.sh on your workstation)"
echo "  2) cd $APP_DIR && cp .env.example .env   # set DOMAIN + ACME_EMAIL"
echo "  3) docker compose up -d --build"
echo "  4) docker compose --profile edge up -d   # enables HTTPS via Traefik"