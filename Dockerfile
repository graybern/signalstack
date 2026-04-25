FROM node:20-alpine AS web-build
WORKDIR /app
COPY package*.json ./
COPY packages/web/package*.json ./packages/web/
RUN npm ci --workspace=packages/web
COPY packages/web ./packages/web
RUN npm run build --workspace=packages/web

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
RUN npm ci --workspace=packages/server --omit=dev
COPY packages/server ./packages/server
COPY --from=web-build /app/packages/web/dist ./packages/web/dist
RUN cd packages/server && npx tsc
EXPOSE 3001
VOLUME /app/packages/server/data
ENV NODE_ENV=production
CMD ["node", "packages/server/dist/index.js"]
