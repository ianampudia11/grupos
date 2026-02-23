#!/usr/bin/env bash
# Instala Docker no Linux (Ubuntu/Debian). Execute como root: sudo bash install-docker.sh

set -e

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root: sudo bash install-docker.sh"
  exit 1
fi

echo "Instalando Docker (script oficial get.docker.com)..."
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
rm -f /tmp/get-docker.sh
systemctl enable --now docker 2>/dev/null || true
docker --version
echo ""
echo "Docker instalado. Para rodar o Chrome WS: cd $(dirname "$0") && ./install_chrome_ws.sh"
