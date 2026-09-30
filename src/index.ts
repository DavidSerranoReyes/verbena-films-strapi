import type { Core } from '@strapi/strapi';

/**
 * Acciones de lectura pública para la web (rol "Public" de users-permissions).
 * Así la web puede leer películas y noticias aunque el token de API se pierda
 * o se rote; sólo se exponen entradas PUBLICADAS.
 */
const PUBLIC_READ_ACTIONS = [
  'api::film.film.find',
  'api::film.film.findOne',
  'api::article.article.find',
  'api::article.article.findOne',
];

/**
 * Deja en los logs de Render un resumen del almacenamiento en uso.
 * Si aparece SQLite en producción, es la señal de alarma: los datos se
 * borrarán en el siguiente reinicio o siesta del plan Free.
 */
function logStorageMode(strapi: Core.Strapi) {
  let dbClient = 'desconocido';
  let uploadProvider = 'desconocido';

  try {
    dbClient = String(strapi.config.get('database.connection.client') ?? 'desconocido');
  } catch {
    /* la config siempre existe, pero nunca bloqueamos el arranque por un log */
  }

  try {
    const uploadConfig = strapi.config.get('plugin::upload') as
      | { provider?: string }
      | undefined;
    uploadProvider = String(uploadConfig?.provider ?? 'local');
  } catch {
    /* ignorado */
  }

  strapi.log.info(`[arranque] Base de datos: ${dbClient} · Imágenes: ${uploadProvider}`);

  if (dbClient === 'sqlite' && process.env.NODE_ENV === 'production') {
    strapi.log.warn(
      '[arranque] ATENCIÓN: Strapi está usando SQLite en producción. En Render el disco ' +
        'es efímero y se borra en cada reinicio, redeploy o siesta: se perderán usuarios, ' +
        'contenido e imágenes. Configura DATABASE_CLIENT=postgres y DATABASE_URL (Neon).',
    );
  }

  if (uploadProvider === 'local' && process.env.NODE_ENV === 'production') {
    strapi.log.warn(
      '[arranque] ATENCIÓN: las imágenes se guardan en el disco local (public/uploads). ' +
        'En Render se perderán en el próximo reinicio. Configura UPLOAD_PROVIDER=cloudinary ' +
        'con CLOUDINARY_NAME, CLOUDINARY_KEY y CLOUDINARY_SECRET.',
    );
  }
}

/**
 * Garantiza que existe la cuenta de administración indicada por variables de
 * entorno y que tiene rol Super Admin.
 *
 * Variables:
 *   ADMIN_EMAIL      (obligatoria para activar esta función)
 *   ADMIN_PASSWORD   (mínimo 8 caracteres)
 *   ADMIN_FIRSTNAME  (opcional, por defecto "Verbena")
 *   ADMIN_LASTNAME   (opcional, por defecto "Films")
 *
 * Es idempotente: si la cuenta ya existe, sólo corrige rol/estado; nunca
 * cambia la contraseña ni borra contenido.
 */
async function ensureAdminUser(strapi: Core.Strapi) {
  const email = String(process.env.ADMIN_EMAIL ?? '').trim();
  const password = String(process.env.ADMIN_PASSWORD ?? '');
  const firstname = String(process.env.ADMIN_FIRSTNAME ?? 'Verbena').trim();
  const lastname = String(process.env.ADMIN_LASTNAME ?? 'Films').trim();

  if (!email || !password) {
    strapi.log.info(
      '[arranque] ADMIN_EMAIL / ADMIN_PASSWORD no definidos: no se crea ninguna cuenta automáticamente.',
    );
    return;
  }

  if (password.length < 8) {
    strapi.log.warn(
      `[arranque] ADMIN_PASSWORD debe tener al menos 8 caracteres. Se omite la cuenta ${email}.`,
    );
    return;
  }

  try {
    const roleService = strapi.service('admin::role');
    const userService = strapi.service('admin::user');

    const superAdminRole = await roleService.getSuperAdmin();
    if (!superAdminRole) {
      strapi.log.warn(
        '[arranque] No existe el rol Super Admin todavía; se omite la creación de la cuenta.',
      );
      return;
    }

    // Ojo: hay que pedir el populate de roles, si no `existing.roles` viene
    // vacío y el bootstrap volvería a escribir el rol en cada arranque.
    const existing = await userService.findOneByEmail(email, ['roles']);

    if (existing) {
      const roleIds = (existing.roles ?? []).map((role: { id: number }) => role.id);
      const needsFix = !roleIds.includes(superAdminRole.id) || !existing.isActive;

      if (needsFix) {
        await userService.updateById(existing.id, {
          roles: [superAdminRole.id],
          isActive: true,
        });
        strapi.log.info(
          `[arranque] Cuenta ${email}: rol Super Admin y estado activo asegurados.`,
        );
      } else {
        strapi.log.info(`[arranque] Cuenta ${email} ya existe como Super Admin.`);
      }
      return;
    }

    await userService.create({
      email,
      firstname,
      lastname,
      password,
      isActive: true,
      roles: [superAdminRole.id],
      registrationToken: null,
    });

    strapi.log.info(`[arranque] Cuenta Super Admin creada para ${email}.`);
  } catch (error) {
    strapi.log.error(
      `[arranque] No se pudo preparar la cuenta ${email}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Da permiso de lectura pública (sólo entradas publicadas) a Film y Article.
 * Se puede desactivar con ENSURE_PUBLIC_READ=false.
 */
async function ensurePublicReadPermissions(strapi: Core.Strapi) {
  if (String(process.env.ENSURE_PUBLIC_READ ?? 'true').toLowerCase() === 'false') {
    return;
  }

  try {
    const publicRole = await strapi.db
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });

    if (!publicRole) {
      strapi.log.warn('[arranque] No se encontró el rol público; se omiten los permisos de lectura.');
      return;
    }

    const permissionQuery = strapi.db.query('plugin::users-permissions.permission');
    const added: string[] = [];

    for (const action of PUBLIC_READ_ACTIONS) {
      const existing = await permissionQuery.findOne({
        where: { action, role: publicRole.id },
      });

      if (!existing) {
        await permissionQuery.create({ data: { action, role: publicRole.id } });
        added.push(action);
      }
    }

    if (added.length > 0) {
      strapi.log.info(`[arranque] Lectura pública activada para: ${added.join(', ')}`);
    }
  } catch (error) {
    strapi.log.error(
      `[arranque] No se pudieron asegurar los permisos públicos: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Avisa a GitHub para que reconstruya y publique la web.
 *
 * ¿Por qué? La web es estática y GitHub reconstruye cada 20 minutos, pero su
 * planificador es poco fiable (puede tardar horas en ejecutar). Con esto, al
 * publicar en el panel se lanza la publicación en segundos.
 *
 * Necesita la variable GITHUB_DISPATCH_TOKEN en Render: un token de GitHub
 * (fine-grained, solo el repo verbena-films, permiso Contents: Read and write).
 * Si no está definida, no pasa nada: se avisa por log y la web se actualizará
 * en el siguiente turno del robot.
 */
const EVENTO_DESPLEGUE = 'strapi-publish';

async function avisarAGitHub(strapi: Core.Strapi, motivo: string) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO ?? 'DavidSerranoReyes/verbena-films';

  if (!token) {
    strapi.log.info(
      '[deploy] GITHUB_DISPATCH_TOKEN no definido: la web se actualizará en el siguiente turno del robot (hasta 20 min).',
    );
    return;
  }

  try {
    const respuesta = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'verbena-films-strapi',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ event_type: EVENTO_DESPLEGUE, client_payload: { motivo } }),
      signal: AbortSignal.timeout(15000),
    });

    if (respuesta.ok) {
      strapi.log.info(`[deploy] Aviso enviado a GitHub para publicar la web (${motivo}).`);
    } else {
      const texto = await respuesta.text();
      strapi.log.warn(
        `[deploy] GitHub respondió ${respuesta.status} al avisar: ${texto.slice(0, 200)}`,
      );
    }
  } catch (error) {
    strapi.log.error(
      `[deploy] No se pudo avisar a GitHub: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// Un solo aviso aunque Strapi emita varios eventos seguidos (crear + publicar)
let avisoPendiente: ReturnType<typeof setTimeout> | null = null;

function programarAviso(strapi: Core.Strapi, motivo: string) {
  if (avisoPendiente) clearTimeout(avisoPendiente);
  avisoPendiente = setTimeout(() => {
    avisoPendiente = null;
    void avisarAGitHub(strapi, motivo);
  }, 3000);
}

/**
 * Escucha los cambios de Film y Article y avisa a GitHub.
 * Se avisa de cualquier cambio (publicar, guardar borrador o borrar): el robot
 * compara la huella del contenido publicado y decide si hay algo que subir, así
 * que los borradores no provocan publicaciones innecesarias.
 */
function avisarAlCambiarContenido(strapi: Core.Strapi) {
  try {
    strapi.db.lifecycles.subscribe({
      models: ['api::film.film', 'api::article.article'],
      afterCreate: (event: any) => programarAviso(strapi, `${event.model.uid} creado`),
      afterUpdate: (event: any) => programarAviso(strapi, `${event.model.uid} actualizado`),
      afterDelete: (event: any) => programarAviso(strapi, `${event.model.uid} borrado`),
    });

    strapi.log.info(
      '[deploy] Aviso automático a GitHub activado: al tocar Film o Article se reconstruye la web.',
    );
  } catch (error) {
    strapi.log.error(
      `[deploy] No se pudo activar el aviso a GitHub: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export default {
  /**
   * Se ejecuta antes de inicializar la aplicación.
   */
  register() {},

  /**
   * Se ejecuta al arrancar: prepara la cuenta de administración y los permisos.
   * Todo es idempotente y nunca interrumpe el arranque.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    logStorageMode(strapi);
    await ensureAdminUser(strapi);
    await ensurePublicReadPermissions(strapi);
    avisarAlCambiarContenido(strapi);
  },
};
