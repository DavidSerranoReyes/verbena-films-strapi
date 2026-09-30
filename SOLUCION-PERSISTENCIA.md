# 🩺 Por qué se borraba el panel y cómo queda arreglado

**Última revisión:** 29 de septiembre de 2026
**Repos afectados:** `verbena-films-strapi` (CMS) y `verbena-films` (web)

---

## 1. Diagnóstico

### 1.1 Lo que está confirmado por el código y por el despliegue

| # | Hecho comprobado | Consecuencia |
| --- | --- | --- |
| A | `config/database.ts` usaba `env('DATABASE_CLIENT', 'sqlite')` → `.tmp/data.db`, y el `.env` local dice `sqlite`. | Si en Render no hay variables de base de datos, **todo se guarda en el disco efímero**. |
| B | Render (plan Free) borra el disco en cada reinicio, redeploy o siesta. | Con SQLite: se pierden cuentas, tokens de registro, noticias, películas y pósteres. |
| C | **No había ningún proveedor de subidas configurado** (`config/plugins.ts` estaba vacío). | **Confirmado: los pósteres van a `public/uploads`, dentro del disco efímero → se pierden siempre**, incluso si la base de datos es Postgres. |
| D | Sondeo a producción: `/api/films` responde **403** al público y el token de API del repo responde **401**. | La web no puede leer el CMS: cae al contenido estático de reserva. |
| E | `/admin/init` responde `hasAdmin: true` y el bundle del panel es idéntico al que compila este repo. | El panel no está roto y el código desplegado es el de `master`; el problema es de contenido/permisos. |
| F | El token de registro de Strapi es de **un solo uso** (`registrationToken: null` al usarse). | El enlace reenviado o partido en dos líneas deja de funcionar. |
| G | Los usuarios invitados heredan el rol elegido en la invitación. | Si es *Author*/*Editor* sin permisos sobre *Film*/*Article*, el panel se ve **vacío** aunque el login funcione. |
| H | *Film* y *Article* tienen `draftAndPublish: true`. | Si se guarda sin pulsar **Publish**, la web no recibe nada. |
| I | `verbenafilms.com` es un build **estático** subido por FTP a CDmon (servidor Apache). | Los cambios del CMS **no** se ven en la web hasta reconstruir y volver a subir el sitio. |
| J | Las bases **Postgres Free de Render caducan a los 30 días** y después las borran. | Si se usa esa base, se romperá sola cada mes. Neon no caduca. |

Documentación de Render que respalda B:
> *"any changes to your web service's filesystem (uploaded images, local SQLite databases,
> etc.) are lost every time the service redeploys, restarts, or spins down"*
> — https://render.com/docs/free

Caducidad de la base Free: https://render.com/changelog/free-postgresql-instances-now-expire-after-30-days-previously-90

### 1.2 Comprobado en producción (29 de septiembre de 2026)

Sondeé el servicio real con peticiones de sólo lectura:

| Prueba | Resultado | Conclusión |
| --- | --- | --- |
| 20 minutos sin tráfico y luego una petición | tardó **34,8 s** en responder (arranque en frío) | el servicio **sí se duerme** (plan Free, sin monitor que lo mantenga despierto) |
| `/admin/init` justo después de ese reinicio | `hasAdmin: true` | **la base de datos es persistente** (Postgres): las cuentas **no** se borran en los reinicios |
| `/admin/init` después del redeploy del 29/09 | `hasAdmin: true` | también sobrevive a los despliegues |
| `/api/films` antes / después de desplegar este código | **403 → 200** | el código nuevo está en producción y la lectura pública ya funciona |
| `/api/films` y `/api/articles` (público) | `{"data":[]}` | la base está **vacía**: 0 películas y 0 noticias publicadas |

**Conclusión:** el borrado de cuentas y contenido ocurrió **antes** (probablemente al pasar
de SQLite a Postgres en enero: todo lo creado en la etapa SQLite se perdió), no por las
siestas de Render. Lo que **sí** se sigue perdiendo en cada reinicio son **las imágenes**
(punto C de la tabla): el póster que suba la clienta desaparecerá hasta que se configure
Cloudinary.

> ⚠️ Por eso: **si ya tienes `DATABASE_URL` configurada, NO la cambies ni crees otra base
> de datos**. Lo que falta por configurar es **Cloudinary** (imágenes) y **`ADMIN_EMAIL`**
> (cuenta y rol: es lo que hace que el panel deje de verse vacío).

Y el "panel vacío" que ella ve tiene dos causas que se suman:
1. **no hay contenido** en la base (0 entradas publicadas), y
2. si su usuario no tiene rol **Super Admin**, el *Content Manager* no le muestra las
   colecciones aunque existan.

Ambas se resuelven en el Paso 3 y el Paso 6.

---

## 2. Qué se ha cambiado en el repositorio

| Archivo | Cambio |
| --- | --- |
| `config/database.ts` | Usa **Postgres** si existe `DATABASE_URL` (aunque `DATABASE_CLIENT` no esté). Detecta Neon/Supabase y activa SSL automáticamente para evitar el error *self signed certificate*. En local, sin variables, sigue con SQLite. |
| `config/plugins.ts` | Subida de imágenes a **Cloudinary** con `UPLOAD_PROVIDER=cloudinary`. En local sigue guardando en `public/uploads`. También admite S3-compatible (R2/B2/S3). |
| `config/middlewares.ts` | La Content Security Policy autoriza los dominios de Cloudinary para que los pósteres se vean en el panel. |
| `src/index.ts` | Bootstrap idempotente que: **(a)** asegura la cuenta de administración de `ADMIN_EMAIL` con rol **Super Admin** (arregla el "panel vacío"); **(b)** da **lectura pública** de lo publicado en Film/Article (arregla el 403 y la dependencia del token); **(c)** avisa en los logs si sigue en SQLite o guardando imágenes en disco. |
| `package.json` | Añadido `@strapi/provider-upload-cloudinary@5.33.1`. |
| `.env.example` | Todas las variables nuevas documentadas. |
| `render.yaml` | Referencia de configuración (no afecta al servicio actual, Render sólo lo lee si creas un Blueprint nuevo). |

### Verificado antes de subirlo

**En local:**

- `npm run build` → **OK** (TypeScript compila sin errores).
- Arranque real de Strapi con una cuenta de prueba: crea el usuario **Super Admin** y lo
  reporta en los logs → `[arranque] Cuenta Super Admin creada para verify@example.com`.
- `GET /api/films` pasó de **403** a **200** sin token tras el bootstrap.
- Arranque real con `UPLOAD_PROVIDER=cloudinary` y credenciales de prueba: Strapi arranca
  sin errores, el log dice `Imágenes: cloudinary` y la CSP del panel añade
  `res.cloudinary.com`. La configuración está bien cableada: con las credenciales reales
  funcionará sin sorpresas.

**En producción (después del deploy del 29/09, commit `1260721`):**

- `GET /api/films` → **200** (antes 403): el código nuevo está corriendo en Render.
- `hasAdmin: true` se mantuvo tras un reinicio y tras el redeploy: la base de datos es
  persistente.

---

## 3. Paso a paso (una sola vez)

### Paso 1 · Base de datos: **no tocar nada**

Ya está comprobado que producción usa una base de datos persistente (Postgres): las
cuentas sobreviven a reinicios y despliegues.

- **No cambies `DATABASE_URL`.** Si la cambias por otra base, empiezas con todo vacío.
- Sólo necesitas confirmar en **Logs** que aparece
  `[arranque] Base de datos: postgres · Imágenes: ...`.

> Sólo si en los logs apareciera `Base de datos: sqlite` habría que crear una base en
> Neon (gratis, no caduca) y poner `DATABASE_CLIENT=postgres` + `DATABASE_URL` +
> `DATABASE_SSL=true` + `DATABASE_SSL_REJECT_UNAUTHORIZED=false`:
> 1. **https://neon.com** → cuenta gratis (sin tarjeta).
> 2. **Create project** → región igual a la de Render (p. ej. Europe/Frankfurt).
> 3. **Connect** → copia la connection string *Direct connection* (**sin** `-pooler`).

### Paso 2 · Cloudinary para los pósteres (gratis) — **esto es lo que falta**

1. Entra en **https://cloudinary.com/users/register_free** (sin tarjeta).
2. En el **Dashboard**, sección *Product Environment Credentials*, copia
   **Cloud name**, **API Key** y **API Secret**.

Sin esto, cada imagen que suba la clienta se borrará en el siguiente reinicio del servicio.

### Paso 3 · Variables en Render

Render → **Environment** → **Add Environment Variable**.

**Cloudinary (imágenes) — la forma rápida, con UNA sola variable:**

| Variable | Valor |
| --- | --- |
| `UPLOAD_PROVIDER` | `cloudinary` |
| `CLOUDINARY_URL` | `cloudinary://API_KEY:API_SECRET@CLOUD_NAME` (Cloudinary lo muestra tal cual en su dashboard) |

*(`UPLOAD_PROVIDER` es opcional: si hay credenciales de Cloudinary, se deduce solo. Ponlo
sólo si quieres forzar `local`.)*

*(Si prefieres, en lugar de `CLOUDINARY_URL` puedes usar las tres sueltas:
`CLOUDINARY_NAME`, `CLOUDINARY_KEY` y `CLOUDINARY_SECRET`.)*

**Cuenta de administración:**

| Variable | Valor |
| --- | --- |
| `ADMIN_EMAIL` | el email con el que entra la dueña |
| `ADMIN_PASSWORD` | mínimo 8 caracteres, una mayúscula y un número |
| `ADMIN_FIRSTNAME` | p. ej. `Ana` |
| `ADMIN_LASTNAME` | p. ej. `Puentes` |

**No toques** `DATABASE_URL` ni `DATABASE_CLIENT`. Tampoco deben cambiar nunca (si
cambian, se cierran las sesiones y se invalidan los tokens): `APP_KEYS`,
`API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `JWT_SECRET`,
`ENCRYPTION_KEY`.

> 💡 Si en `ADMIN_EMAIL` pones **el email que ya usa la dueña**, esa cuenta se convierte
> automáticamente en **Super Admin** al arrancar (sin cambiarle la contraseña): así deja
> de ver el panel vacío y deja de depender de un enlace de invitación.

Guardar → Render redespliega solo. Si no: **Manual Deploy → Deploy latest commit**.

### Paso 4 · Comprobar en los logs

```
[arranque] Base de datos: postgres · Imágenes: cloudinary
[arranque] Cuenta ana@verbenafilms.com: rol Super Admin y estado activo asegurados.
[arranque] Lectura pública activada para: api::film.film.find, ...
```

Si ves `Imágenes: local`, falta `UPLOAD_PROVIDER=cloudinary`. Si ves
`Base de datos: sqlite`, avísame antes de tocar nada.

**Sin ver los logs** (por si el dashboard te vuelve a bloquear), se comprueba desde fuera:

```bash
# Opción cómoda: script incluido en el repo (no necesita ninguna clave)
bash scripts/verificar-produccion.sh
```

```bash
# O a mano:
# ¿Cloudinary ya está activo? Debe aparecer res.cloudinary.com en img-src
curl -s -D - -o /dev/null https://verbena-films-strapi.onrender.com/admin \
  | tr ';' '\n' | grep img-src

# ¿La lectura pública funciona? Debe devolver 200
curl -s -o /dev/null -w "%{http_code}\n" https://verbena-films-strapi.onrender.com/api/films
```

### Paso 5 · Verificar la API pública

```bash
curl -s https://verbena-films-strapi.onrender.com/api/films | head -c 400
```

Debe devolver `{"data":[...]}` (antes: `403 Forbidden`).

### Paso 6 · Crear/revisar el póster de TARANTA (lo hace la dueña)

1. `https://verbena-films-strapi.onrender.com/admin` → entrar con su email.
2. **Content Manager → Film → Create new entry**.
3. Rellenar título, director, año, país y sinopsis (son obligatorios).
4. **Poster** → *Add an asset* → subir la imagen (se guarda en Cloudinary).
5. **Save**.
6. ⚠️ **Publish** (botón azul arriba a la derecha). Sin este paso la web no lo recibe.

### Paso 7 · Probar que ya no se borra nada

Subir una imagen, luego Render → **Manual Deploy → Deploy latest commit**. Al terminar,
la imagen y el contenido deben seguir ahí (antes desaparecían).

---

## 4. Lo que queda pendiente

### 4.1 Los cambios del CMS no se ven en la web hasta reconstruirla

`verbenafilms.com` es un **build estático** subido por FTP a CDmon: el CMS guarda el
contenido, pero la web no lo lee en vivo.

| Opción | Esfuerzo | Resultado |
| --- | --- | --- |
| **A. Reconstruir cuando ella avise** (actual) | cero | `npm run build` + subir `dist/` por FTP cada vez. |
| **B. Rebuild automático** | medio | *Deploy Hook* + webhook de Strapi: al publicar, la web se reconstruye sola. |
| **C. Web en Vercel con SSR** | alto | Los cambios se ven al instante, sin reconstruir. |

Para A y B, en el `.env` del frontend: `PUBLIC_USE_STRAPI=true` y
`PUBLIC_STRAPI_URL=https://verbena-films-strapi.onrender.com`.

**Sobre `STRAPI_API_TOKEN` (comprobado a mano):**

| Petición a `/api/films` | Respuesta |
| --- | --- |
| Sin cabecera `Authorization` | **200** (rol público, ya activado) |
| Con `Authorization: Bearer ` (vacío) | **200** |
| Con un token **inválido o caducado** | **401** ← ojo |

Es decir: si la web envía un token viejo, **no** cae al rol público, falla. Como el
token del `.env` actual (enero) ya no existe en la base de datos, lo más robusto es
**dejarlo vacío** (`STRAPI_API_TOKEN=`) y apoyarse en la lectura pública, o generar un
token nuevo en *Settings → API Tokens* y usarlo. Lo más importante: **la web guarda el
contenido en el momento del build**, así que hasta que no se reconstruya y se suba el
`dist/` a CDmon, no se verá nada nuevo.

### 4.2 Que el panel no tarde 1 minuto en abrir

Solo ocurre en el plan Free (se duerme a los 15 min):

- **Gratis:** monitor en **https://cron-job.org** pidiendo
  `https://verbena-films-strapi.onrender.com/_health` cada 10 minutos.
- **7 $/mes:** plan **Starter** en Render (no duerme nunca).

### 4.3 Si el contenido actual importa

Si la base actual **no** fuera Postgres y hubiera contenido que conservar, hay que
exportarlo con `strapi export` / `strapi import` **antes** de cambiar `DATABASE_URL`.
Avísame y lo hacemos; si ya era Postgres, no se pierde nada.

---

## 5. Problemas típicos y solución

| Error en logs | Causa | Solución |
| --- | --- | --- |
| `self signed certificate in certificate chain` | SSL estricto contra Neon | `DATABASE_SSL=true` y `DATABASE_SSL_REJECT_UNAUTHORIZED=false` |
| `password authentication failed for user` | URL mal copiada | Volver a copiar la connection string (codificar caracteres especiales: `@`→`%40`) |
| `Could not load upload provider "cloudinary"` | Falta el paquete | Redesplegar (el build hace `npm install`) |
| `UPLOAD_PROVIDER=cloudinary pero faltan credenciales` | No hay `CLOUDINARY_URL` ni las tres variables sueltas (o alguna tiene un espacio de más) | Revisar el Paso 3. Strapi **no arranca a propósito** hasta que esté la credencial: así no se pierden pósteres en silencio |
| `CLOUDINARY_URL no tiene el formato esperado` | La URL está mal copiada | Debe ser exactamente `cloudinary://API_KEY:API_SECRET@CLOUD_NAME` |
| La dueña entra y ve el panel vacío | Su rol no es Super Admin | Poner su email en `ADMIN_EMAIL` y redesplegar |
| Sube una película y no aparece en la web | Está en borrador | Pulsar **Publish** |
| `Invalid registrationToken` | Token de un solo uso o caducado | Ya no hace falta: la cuenta se crea con `ADMIN_EMAIL` |

### Cambiar la contraseña de la dueña

El bootstrap **no** cambia contraseñas de cuentas existentes. Para cambiarla:

- ella misma en **Perfil → Change password**, o
- borrar su usuario en *Settings → Users* y redesplegar con el nuevo `ADMIN_PASSWORD`.

---

## 6. Mensaje listo para enviarle a la dueña

> ¡Hola! Ya encontré la causa de que desapareciera lo que subías: el servidor donde está
> el panel guardaba las cosas en su propio disco, y ese disco se borra cada vez que el
> servidor se reinicia o se duerme. Ahí dentro estaban las cuentas, las noticias y los
> pósteres. No era nada que hicieras mal.
>
> Ya lo he cambiado a un almacenamiento permanente, así que esto no debería volver a
> pasar. Entra en https://verbena-films-strapi.onrender.com/admin con tu email y tu
> contraseña. Si no te acuerdas, avísame y te la restablezco.
>
> Dos cosas al subir contenido:
> 1. Después de guardar, pulsa **Publish** (si no, no se publica).
> 2. El servidor gratuito puede tardar hasta un minuto en abrir si lleva un rato sin uso;
>    es normal, espera un poco.
>
> Cualquier cosa que veas rara, me avisas y lo miro. 💛

---

## Anexo · Si Render te vuelve a bloquear el dashboard

Síntoma: al entrar en `dashboard.render.com` aparece *"El acceso está restringido
temporalmente… Varias posibilidades… un robot se encuentra en la misma red (IP …)"*.

Causa comprobada el 29/09/2026, eran **dos cosas a la vez**:

1. **Cloudflare WARP (1.1.1.1) conectado.** La IP de salida era `104.28.251.216`, del
   rango de Cloudflare (AS13335): una salida compartida con mala reputación, así que
   Cloudflare lanzaba el reto antirrobots.
2. **Extensión AdBlock en Chrome** (perfil *Default*): bloquea/reescribe el script del
   reto (`challenges.cloudflare.com`), por lo que el reto nunca se completaba y salía el
   bloqueo definitivo.

Solución y comprobación:

```bash
warp-cli status          # Connected / Disconnected
warp-cli disconnect      # desconectar WARP (reversible con: warp-cli connect)
curl -4 https://api.ipify.org   # ver la IP de salida real
```

Con WARP desconectado y un Chrome sin extensiones ni cookies, el dashboard carga el
login (`Render Dashboard`). Si aun así bloqueara: excluir `dashboard.render.com` en
AdBlock (*Detalles → Acceso al sitio → En sitios específicos*), probar en incógnito o en
otra red (datos móviles), y no reintentar en bucle (cada intento puede alargar el bloqueo).

Nota: `api.render.com` **no** pasa por ese reto (responde 401 sin API key), así que la
API de Render sirve como vía alternativa con una API key
(*Account Settings → API Keys*).
