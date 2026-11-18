FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./

USER 10001:10001
EXPOSE 3000

CMD ["node", "server.js"]
