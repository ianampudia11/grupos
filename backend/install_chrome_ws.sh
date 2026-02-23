#!/usr/bin/env bash
set -e

BACKEND_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$BACKEND_DIR/.." && pwd)"
ENV_FILE="$BACKEND_DIR/.env"

echo "=== Wagrupos: instalacao Chrome WS (browserless) + config .env ==="
echo ""

PORTS_BACKEND=4250
PORTS_FRONTEND=5173
PORTS_REDIS=6379
PORTS_BROWSERLESS=3999

echo "Portas usadas pelo projeto (evitar conflito):"
echo "  Backend (API):     $PORTS_BACKEND"
echo "  Frontend (Vite):   $PORTS_FRONTEND"
echo "  Redis:            $PORTS_REDIS  (use o que ja esta rodando no servidor)"
echo "  Browserless (WS): $PORTS_BROWSERLESS  <- usada pelo Docker"
echo ""

check_port() {
  if command -v ss &>/dev/null; then
    ss -tlnp 2>/dev/null | grep -q ":$1 " && echo "EM USO" || echo "livre"
  elif command -v netstat &>/dev/null; then
    netstat -tln 2>/dev/null | grep -q ":$1 " && echo "EM USO" || echo "livre"
  else
    echo "?"
  fi
}

echo "Verificando portas no sistema:"
for p in $PORTS_BACKEND $PORTS_FRONTEND $PORTS_REDIS $PORTS_BROWSERLESS; do
  st=$(check_port "$p")
  printf "  %s -> %s\n" "$p" "$st"
done
echo ""

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$BACKEND_DIR/.env.example" ]; then
    cp "$BACKEND_DIR/.env.example" "$ENV_FILE"
    echo "Criado .env a partir de .env.example"
  else
    echo "Erro: .env nao existe. Crie um .env na pasta backend."
    exit 1
  fi
fi

if ! command -v docker &>/dev/null; then
  echo "Erro: Docker nao encontrado. Instale o Docker para usar browserless."
  exit 1
fi

TOKEN="wagrupos-$(openssl rand -hex 16 2>/dev/null || echo "token-$(date +%s)")"
export BROWSERLESS_TOKEN="$TOKEN"

COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Erro: $COMPOSE_FILE nao encontrado."
  exit 1
fi

echo "Subindo apenas Browserless (porta $PORTS_BROWSERLESS). Redis nao e alterado (use o que ja esta rodando)."
cd "$BACKEND_DIR"
if docker compose version &>/dev/null; then
  docker compose -f docker-compose.yml up -d
else
  docker-compose -f docker-compose.yml up -d
fi

CHROME_WS_VALUE="ws://localhost:${PORTS_BROWSERLESS}?token=${TOKEN}"

update_env_var() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    local tmp="$ENV_FILE.tmp"
    grep -v "^${key}=" "$ENV_FILE" > "$tmp"
    echo "${key}=${val}" >> "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

update_env_var "CHROME_WS" "$CHROME_WS_VALUE"

echo ""
echo "=== Pronto ==="
echo ""
echo "No backend/.env foi configurado:"
echo "  CHROME_WS=$CHROME_WS_VALUE"
echo ""
echo "Comandos uteis:"
echo "  Subir:   cd $BACKEND_DIR && docker compose -f docker-compose.yml up -d"
echo "  Parar:   cd $BACKEND_DIR && docker compose -f docker-compose.yml down"
echo "  Logs:    cd $BACKEND_DIR && docker compose -f docker-compose.yml logs -f"
echo ""
echo "Portas: Browserless $PORTS_BROWSERLESS. Redis continua o seu (REDIS_URI no .env)."
echo ""
