FROM nginx:1.27-alpine

COPY index.html /usr/share/nginx/html/index.html
COPY data/news.json /usr/share/nginx/html/data/news.json
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
