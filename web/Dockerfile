FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8090/ >/dev/null || exit 1
