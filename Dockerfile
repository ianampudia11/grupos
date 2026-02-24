# Etapa 1: Construcción del Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Etapa 2: Construcción del Backend
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
RUN npx prisma generate
RUN npm run build

# Etapa 3: Imagen Final
FROM node:20-alpine
WORKDIR /app

# Instalar dependencias de producción para el backend
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install --omit=dev

# Copiar compilación del backend y prisma
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/prisma ./prisma
# Generar cliente prisma en la imagen final para asegurar compatibilidad de arquitectura
RUN npx prisma generate

# Copiar compilación del frontend
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copiar carpetas de recursos del backend
COPY backend/public ./public
RUN mkdir -p uploads

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=4250

EXPOSE 4250

CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
