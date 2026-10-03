# Meu Controle Financeiro V5.3 — aplicação única
FROM node:22-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
COPY ops/apply-reference-ui.mjs /tmp/apply-reference-ui.mjs
COPY ops/apply-fix-transaction-confirmation.mjs /tmp/apply-fix-transaction-confirmation.mjs
COPY frontend/src/reference-ui.css ./src/reference-ui.css
RUN node /tmp/apply-reference-ui.mjs
RUN node /tmp/apply-fix-transaction-confirmation.mjs
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:22-alpine AS backend-build
WORKDIR /src/backend
COPY backend/package*.json ./
RUN npm install --no-audit --no-fund
COPY backend/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=backend-build /src/backend/dist ./dist
COPY --from=frontend-build /src/frontend/dist ./public
COPY database ./database
COPY backend/scripts/apply-migrations.mjs ./scripts/apply-migrations.mjs
EXPOSE 3333
CMD ["sh", "-c", "node scripts/apply-migrations.mjs && node dist/server.js"]
