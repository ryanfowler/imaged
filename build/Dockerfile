FROM node:14.5-alpine3.12 AS builder

RUN apk add --update --no-cache build-base pkgconfig vips-dev=8.9.2-r0

WORKDIR /imaged
COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --production

# Use multi-stage build to reduce the size of the final image.
FROM node:14.5-alpine3.12

RUN apk add --update --no-cache \
    libjpeg-turbo-dev=2.0.5-r0 \
    libexif-dev=0.6.22-r0 \
    giflib-dev=5.2.1-r0 \
    librsvg-dev=2.48.8-r0 \
    tiff-dev=4.1.0-r0 \
    libpng-dev=1.6.37-r1 \
    libimagequant-dev=2.12.6-r0 \
    orc-dev=0.4.31-r2 \
    libwebp-dev=1.1.0-r0 \
    libheif-dev=1.6.2-r1 \
    vips-dev=8.9.2-r0

WORKDIR /imaged
COPY --from=builder /imaged/node_modules ./node_modules
COPY --from=builder /imaged/dist ./dist
COPY --from=builder /imaged/package.json .

CMD ["node", "--enable-source-maps", "dist/app.js"]
