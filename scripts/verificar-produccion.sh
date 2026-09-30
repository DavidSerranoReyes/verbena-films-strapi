#!/usr/bin/env bash
#
# Verifica desde fuera el estado del CMS de Verbena Films.
# Sirve incluso si no puedes entrar al dashboard de Render: no necesita claves.
#
# Uso:
#   bash scripts/verificar-produccion.sh
#   bash scripts/verificar-produccion.sh https://otra-url.com
#
set -u

URL="${1:-https://verbena-films-strapi.onrender.com}"
TIMEOUT=90
ok=0
pend=0

linea_ok()   { printf '  \033[32m✅ %s\033[0m\n' "$1"; ok=$((ok + 1)); }
linea_pend() { printf '  \033[31m❌ %s\033[0m\n     → %s\n' "$1" "$2"; pend=$((pend + 1)); }

echo
echo "Verificando $URL"
echo "(la primera petición puede tardar ~1 min: el plan Free se duerme)"
echo

# 1. El servicio responde y existe un administrador
INIT="$(curl -sS -m "$TIMEOUT" "$URL/admin/init" 2>/dev/null || true)"
if [ -n "$INIT" ]; then
  linea_ok "El servicio responde"
else
  linea_pend "El servicio responde" "no hubo respuesta; si acaba de despertar, espera un minuto y reintenta"
fi
if printf '%s' "$INIT" | grep -q '"hasAdmin":true'; then
  linea_ok "Existe una cuenta de administración"
else
  linea_pend "Existe una cuenta de administración" "define ADMIN_EMAIL y ADMIN_PASSWORD en Render"
fi

# 2. La web puede leer el contenido publicado
CODE="$(curl -sS -m "$TIMEOUT" -o /dev/null -w '%{http_code}' "$URL/api/films" 2>/dev/null || echo 000)"
if [ "$CODE" = "200" ]; then
  linea_ok "Lectura pública de películas (200)"
else
  linea_pend "Lectura pública de películas" "respondió $CODE (se espera 200); revisa ENSURE_PUBLIC_READ"
fi

# 3. Las imágenes ya no viven en el disco efímero de Render
CSP="$(curl -sS -m "$TIMEOUT" -D - -o /dev/null "$URL/admin" 2>/dev/null | grep -i '^content-security-policy' || true)"
if printf '%s' "$CSP" | grep -qi 'cloudinary'; then
  linea_ok "Los pósteres se suben a Cloudinary (no al disco efímero)"
else
  linea_pend "Los pósteres se suben a Cloudinary" "falta la credencial en Render: añade CLOUDINARY_URL=cloudinary://KEY:SECRET@CLOUD"
fi

# 4. Contenido publicado (informativo)
PELIS="$(curl -sS -m "$TIMEOUT" "$URL/api/films" 2>/dev/null | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2 || true)"
NOTIS="$(curl -sS -m "$TIMEOUT" "$URL/api/articles" 2>/dev/null | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2 || true)"
echo "  ℹ️  Publicado ahora mismo: ${PELIS:-?} película(s) y ${NOTIS:-?} noticia(s)"
[ "${PELIS:-0}" = "0" ] && echo "     (si acabas de crear una entrada, recuerda pulsar Publish)"

echo
if [ "$pend" = "0" ]; then
  printf '\033[32mTodo correcto (%s comprobaciones).\033[0m\n\n' "$ok"
  exit 0
fi
printf '\033[33m%s pendiente(s). Pasos en SOLUCION-PERSISTENCIA.md\033[0m\n\n' "$pend"
exit 1
