FROM node:14.8-alpine3.12 AS base
ENV VIPS_VERSION 8.10.0
RUN apk add --no-cache --virtual .build-deps \
        build-base=0.5-r2 glib-dev=2.64.4-r0 expat-dev=2.2.9-r1 \
    && apk add --update --no-cache \
        libjpeg-turbo-dev=2.0.5-r0 \
        libexif-dev=0.6.22-r0 \
        giflib-dev=5.2.1-r0 \
        librsvg-dev=2.48.8-r0 \
        tiff-dev=4.1.0-r0 \
        libpng-dev=1.6.37-r1 \
        libimagequant-dev=2.12.6-r0 \
        lcms2-dev=2.9-r1 \
        orc-dev=0.4.31-r2 \
        libwebp-dev=1.1.0-r0 \
        libheif-dev=1.6.2-r1 \
    && mkdir /vips && cd /vips \
    && wget https://github.com/libvips/libvips/releases/download/v$VIPS_VERSION/vips-$VIPS_VERSION.tar.gz \
    && tar -xzf vips-$VIPS_VERSION.tar.gz \
    && cd vips-$VIPS_VERSION \
    && ./configure \
        --enable-debug=no \
        --without-python \
        --disable-static \
        --disable-dependency-tracking \
        --enable-silent-rules \
    && make && make install \
    && cd / && rm -rf /vips \
    && apk del .build-deps

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
CMD ["node", "--enable-source-maps", "dist/app.js"]
