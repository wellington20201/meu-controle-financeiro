# Meu Controle Financeiro V6 — aplicação única
FROM node:22-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
COPY ops/apply-frontend-stability-fixes.mjs /tmp/apply-frontend-stability-fixes.mjs
RUN node /tmp/apply-frontend-stability-fixes.mjs
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:22-alpine AS backend-build
WORKDIR /src/backend
COPY backend/package*.json ./
RUN npm install --no-audit --no-fund
COPY backend/ ./
COPY ops/apply-rls-context-fix.mjs /tmp/apply-rls-context-fix.mjs
COPY ops/apply-backend-balance-account-card-fixes.mjs /tmp/apply-backend-balance-account-card-fixes.mjs
COPY ops/apply-immediate-expense-balance-fix.mjs /tmp/apply-immediate-expense-balance-fix.mjs
RUN node /tmp/apply-rls-context-fix.mjs
RUN node /tmp/apply-backend-balance-account-card-fixes.mjs
RUN node /tmp/apply-immediate-expense-balance-fix.mjs
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
