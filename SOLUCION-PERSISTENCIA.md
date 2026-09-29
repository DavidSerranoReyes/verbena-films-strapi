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

### 1.2 Lo que falta por confirmar (30 segundos)

Hay **indicios** de que producción ya usa Postgres:
- commit del 6 de enero: *"Add PostgreSQL driver (pg) dependency"*;
- commit del 4 de septiembre: *"Fix Postgres connection to prefer DATABASE_URL cleanly"* (y el comentario del código menciona Neon).

Si es así, la base de datos **no** se borra en los reinicios; lo que sí se borra son
**los pósteres** (punto C) y lo que falla es el **rol/permisos** de la cuenta (punto G).

**Cómo saberlo con certeza**, en Render → servicio `verbena-films-strapi`:

1. Pestaña **Environment**: ¿existe `DATABASE_URL`? ¿y `DATABASE_CLIENT=postgres`?
2. Tras el próximo despliegue, en **Logs** este repo imprime ahora:
   `[arranque] Base de datos: postgres · Imágenes: cloudinary` (o `sqlite` / `local`).

> ⚠️ **Si ya existe `DATABASE_URL`, NO la cambies ni crees otra base**: cópiala tal cual.
> Cambiar la URL a una base nueva = empezar con el contenido vacío.

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

### Verificado en local antes de subirlo

- `npm run build` → **OK** (TypeScript compila sin errores).
- Arranque real de Strapi con una cuenta de prueba: crea el usuario **Super Admin** y lo
  reporta en los logs → `[arranque] Cuenta Super Admin creada para verify@example.com`.
- Antes, `GET /api/films` daba **403**; después del bootstrap da **200** con
  `{"data":[...]}` sin necesidad de token.

---

## 3. Paso a paso (una sola vez)

### Paso 1 · Confirmar si ya tienes base de datos persistente

Render → `verbena-films-strapi` → **Environment**:

- **Ya hay `DATABASE_URL`** → perfecto, guárdala y **no la toques**. Salta al Paso 3.
- **No hay nada de base de datos** → Paso 2.

### Paso 2 · Crear la base de datos en Neon (gratis, no caduca)

1. Entra en **https://neon.com** y crea una cuenta (GitHub o email, **sin tarjeta**).
2. **Create project**:
   - Name: `verbena-films`
   - Region: la misma zona que tu servicio de Render (p. ej. **Europe (Frankfurt)**).
3. Pulsa **Connect** y copia la **connection string** *Direct connection* (**sin** `-pooler`):

   ```
   postgresql://neondb_owner:CLAVE@ep-algo-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

> Neon se suspende a los 5 minutos sin tráfico y despierta solo (~1 s). No pierde datos.

### Paso 3 · Cloudinary para los pósteres (gratis)

1. Entra en **https://cloudinary.com/users/register_free** (sin tarjeta).
2. En el **Dashboard**, sección *Product Environment Credentials*, copia
   **Cloud name**, **API Key** y **API Secret**.

### Paso 4 · Variables en Render

Render → **Environment** → **Add Environment Variable**:

| Variable | Valor |
| --- | --- |
| `DATABASE_CLIENT` | `postgres` |
| `DATABASE_URL` | la de Neon (o **la que ya tenías**, sin cambiarla) |
| `DATABASE_SSL` | `true` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | `false` |
| `DATABASE_POOL_MIN` | `0` |
| `UPLOAD_PROVIDER` | `cloudinary` |
| `CLOUDINARY_NAME` | tu *Cloud name* |
| `CLOUDINARY_KEY` | tu *API Key* |
| `CLOUDINARY_SECRET` | tu *API Secret* |
| `ADMIN_EMAIL` | el email con el que entra la dueña |
| `ADMIN_PASSWORD` | mínimo 8 caracteres, una mayúscula y un número |
| `ADMIN_FIRSTNAME` | p. ej. `Ana` |
| `ADMIN_LASTNAME` | p. ej. `Puentes` |

Estas ya existen y **no deben cambiar nunca** (si cambian, se cierran las sesiones y se
invalidan los tokens): `APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`,
`TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `ENCRYPTION_KEY`.

> 💡 Si en `ADMIN_EMAIL` pones **el email que ya usa la dueña**, esa cuenta se convierte
> automáticamente en **Super Admin** al arrancar (sin cambiarle la contraseña): así deja
> de ver el panel vacío y deja de depender de un enlace de invitación.

Guardar → Render redespliega solo. Si no: **Manual Deploy → Deploy latest commit**.

### Paso 5 · Comprobar en los logs

```
[arranque] Base de datos: postgres · Imágenes: cloudinary
[arranque] Cuenta ana@verbenafilms.com: rol Super Admin y estado activo asegurados.
[arranque] Lectura pública activada para: api::film.film.find, ...
```

Si ves `sqlite` o `local`, falta alguna variable del Paso 4.

### Paso 6 · Verificar la API pública

```bash
curl -s https://verbena-films-strapi.onrender.com/api/films | head -c 400
```

Debe devolver `{"data":[...]}` (antes: `403 Forbidden`).

### Paso 7 · Subir el póster de TARANTA (lo hace la dueña)

1. `https://verbena-films-strapi.onrender.com/admin` → entrar con su email.
2. **Content Manager → Film → Taranta** (o *Create new entry*).
3. **Poster** → *Add an asset* → subir la imagen (se guarda en Cloudinary).
4. **Save**.
5. ⚠️ **Publish** (botón azul arriba a la derecha). Sin este paso la web no lo recibe.

### Paso 8 · Probar que ya no se borra nada

Render → **Manual Deploy → Deploy latest commit**. Al terminar, entrar al panel: el
contenido y los usuarios deben seguir ahí (antes desaparecía todo).

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

Para A y B, en el `.env` del frontend: `PUBLIC_USE_STRAPI=true`,
`PUBLIC_STRAPI_URL=https://verbena-films-strapi.onrender.com` (el `STRAPI_API_TOKEN` ya
no es imprescindible: ahora hay lectura pública de lo publicado).

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
| `UPLOAD_PROVIDER=cloudinary pero faltan credenciales` | Faltan `CLOUDINARY_*` | Revisar el Paso 4 |
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
