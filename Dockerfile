FROM node:18 AS builder
WORKDIR /imaged
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM builder AS prefinal
RUN npm prune --omit=dev

FROM gcr.io/distroless/nodejs:18
WORKDIR /imaged
COPY --from=prefinal /imaged/node_modules ./node_modules
COPY --from=prefinal /imaged/dist ./dist
COPY --from=prefinal /imaged/package.json .
CMD ["dist/lib/app.js"]
