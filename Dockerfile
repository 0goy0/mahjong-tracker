FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY client/package*.json ./client/
RUN npm ci --prefix client
COPY client/ ./client/
RUN npm run build --prefix client

COPY server/ ./server/

# Make production explicit in the image so it holds regardless of how the
# container is started (Docker CMD vs Railway startCommand).
ENV NODE_ENV=production

EXPOSE 3333
CMD ["node", "server/index.js"]
