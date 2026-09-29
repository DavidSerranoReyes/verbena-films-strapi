import path from 'path';

/**
 * Configuración de base de datos.
 *
 * ── PRODUCCIÓN (Render + Neon) ─────────────────────────────────────────────
 * En Render hay que definir estas variables:
 *
 *   DATABASE_CLIENT=postgres
 *   DATABASE_URL=postgresql://usuario:clave@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require
 *   DATABASE_SSL=true
 *   DATABASE_SSL_REJECT_UNAUTHORIZED=false
 *
 * ¿Por qué? Render (plan Free) borra el disco en cada reinicio, redeploy o
 * siesta. Si Strapi usa SQLite, se pierden usuarios, contenido y tokens.
 * Neon es Postgres externo y gratuito: los datos viven fuera de Render.
 *
 * ── LOCAL ──────────────────────────────────────────────────────────────────
 * Sin variables de entorno usa SQLite en .tmp/data.db (cómodo para desarrollo).
 */
export default ({ env }) => {
  const databaseUrl = env('DATABASE_URL');

  // Si hay DATABASE_URL asumimos Postgres aunque DATABASE_CLIENT no esté definido.
  const client = env('DATABASE_CLIENT', databaseUrl ? 'postgres' : 'sqlite');

  // Neon y Supabase exigen SSL. Node no siempre tiene su CA, así que en esos
  // hosts NO rechazamos el certificado por defecto (si no, la conexión falla
  // con "self signed certificate in certificate chain"). En cualquier otro
  // host se mantiene el comportamiento estricto de siempre.
  const isManagedExternalPg =
    typeof databaseUrl === 'string' && /neon\.tech|supabase\.co/i.test(databaseUrl);

  const sslEnabled = env.bool('DATABASE_SSL', isManagedExternalPg);

  const sslOptions = sslEnabled && {
    key: env('DATABASE_SSL_KEY', undefined),
    cert: env('DATABASE_SSL_CERT', undefined),
    ca: env('DATABASE_SSL_CA', undefined),
    capath: env('DATABASE_SSL_CAPATH', undefined),
    cipher: env('DATABASE_SSL_CIPHER', undefined),
    rejectUnauthorized: env.bool(
      'DATABASE_SSL_REJECT_UNAUTHORIZED',
      !isManagedExternalPg,
    ),
  };

  const connections = {
    mysql: {
      connection: {
        host: env('DATABASE_HOST', 'localhost'),
        port: env.int('DATABASE_PORT', 3306),
        database: env('DATABASE_NAME', 'strapi'),
        user: env('DATABASE_USERNAME', 'strapi'),
        password: env('DATABASE_PASSWORD', 'strapi'),
        ssl: sslOptions,
      },
      pool: { min: env.int('DATABASE_POOL_MIN', 2), max: env.int('DATABASE_POOL_MAX', 10) },
    },
    postgres: {
      connection: {
        // Si hay DATABASE_URL (Neon, Supabase, Render Postgres...) se usa tal cual
        // y se ignoran host/usuario/clave sueltos, para no pisar la URL.
        ...(databaseUrl
          ? { connectionString: databaseUrl }
          : {
              host: env('DATABASE_HOST', 'localhost'),
              port: env.int('DATABASE_PORT', 5432),
              database: env('DATABASE_NAME', 'strapi'),
              user: env('DATABASE_USERNAME', 'strapi'),
              password: env('DATABASE_PASSWORD', 'strapi'),
            }),
        ssl: sslOptions,
        schema: env('DATABASE_SCHEMA', 'public'),
      },
      // min: 0 → Neon puede suspenderse cuando no hay tráfico (ahorra cuota) y
      // se reconecta solo en la siguiente petición.
      pool: { min: env.int('DATABASE_POOL_MIN', 0), max: env.int('DATABASE_POOL_MAX', 10) },
    },
    sqlite: {
      connection: {
        filename: path.join(__dirname, '..', '..', env('DATABASE_FILENAME', '.tmp/data.db')),
      },
      useNullAsDefault: true,
    },
  };

  return {
    connection: {
      client,
      ...connections[client],
      acquireConnectionTimeout: env.int('DATABASE_CONNECTION_TIMEOUT', 60000),
    },
  };
};
