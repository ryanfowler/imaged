FROM node:14.15-alpine3.12 AS base

FROM base AS builder
RUN apk add --update --no-cache build-base=0.5-r2
WORKDIR /imaged
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build

FROM builder AS prefinal
RUN npm prune --production

FROM base
WORKDIR /imaged
COPY --from=prefinal /imaged/node_modules ./node_modules
COPY --from=prefinal /imaged/dist ./dist
COPY --from=prefinal /imaged/package.json .
CMD ["node", "--enable-source-maps", "dist/lib/app.js"]
