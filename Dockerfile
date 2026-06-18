# Build Stage
FROM node:18-alpine AS builder
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --only=production

# Production Stage
FROM node:18-alpine
WORKDIR /usr/src/app

# Copy production node_modules and code
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY test.js ./
COPY public/ ./public/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Non-root user execution for security compliance
USER node

CMD ["node", "server.js"]
