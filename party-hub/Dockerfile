FROM nginx:alpine

# Custom Nginx reverse proxy configuration
COPY nginx.conf /etc/nginx/nginx.conf
COPY nginx-locations.conf /etc/nginx/treffen-locations.conf
COPY nginx-proxy.conf /etc/nginx/treffen-proxy.conf
COPY nginx-ssl.conf /etc/nginx/treffen-ssl.conf.template
COPY 40-enable-ssl.sh /docker-entrypoint.d/40-enable-ssl.sh
COPY 15-treffen-resolver.sh /docker-entrypoint.d/15-treffen-resolver.sh
# Vorgabe, falls nginx ohne Entrypoint startet (wird beim Containerstart überschrieben)
RUN chmod +x /docker-entrypoint.d/40-enable-ssl.sh /docker-entrypoint.d/15-treffen-resolver.sh \
    && mkdir -p /etc/nginx/ssl-enabled \
    && echo 'resolver 127.0.0.11 valid=10s ipv6=off;' > /etc/nginx/treffen-resolver.conf

# Copy all static assets into Nginx webroot
COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
