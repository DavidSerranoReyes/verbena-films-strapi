/**
 * Configuración de plugins.
 *
 * ── SUBIDA DE IMÁGENES (pósteres) ──────────────────────────────────────────
 * En Render el disco es EFÍMERO: si las imágenes se guardan en local
 * (public/uploads) desaparecen en cada reinicio, redeploy o siesta del plan
 * Free. Por eso en producción se suben a Cloudinary. Dos formas de configurarlo:
 *
 *   A) Una sola variable (la que Cloudinary te da para copiar):
 *      UPLOAD_PROVIDER=cloudinary
 *      CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
 *
 *   B) Tres variables sueltas:
 *      UPLOAD_PROVIDER=cloudinary
 *      CLOUDINARY_NAME=xxxxx          (Cloud name)
 *      CLOUDINARY_KEY=xxxxxxxxxxxx    (API Key)
 *      CLOUDINARY_SECRET=xxxxxxxxxx   (API Secret)
 *
 * En local, sin esas variables, se usa el proveedor local de siempre
 * (las imágenes van a public/uploads) y nada cambia.
 */
export default ({ env }) => {
  // Si hay credenciales de Cloudinary pero no se indicó el proveedor, se asume
  // Cloudinary: es lo que se quiere en producción y evita que las imágenes
  // acaben (y se pierdan) en el disco efímero por olvidar UPLOAD_PROVIDER.
  const hasCloudinaryCreds = Boolean(
    env('CLOUDINARY_URL') ||
      env('CLOUDINARY_NAME', env('CLOUDINARY_CLOUD_NAME')) ||
      env('CLOUDINARY_KEY', env('CLOUDINARY_API_KEY')),
  );

  const provider = env('UPLOAD_PROVIDER', hasCloudinaryCreds ? 'cloudinary' : 'local');

  if (provider === 'cloudinary') {
    let cloudName = env('CLOUDINARY_NAME', env('CLOUDINARY_CLOUD_NAME'));
    let apiKey = env('CLOUDINARY_KEY', env('CLOUDINARY_API_KEY'));
    let apiSecret = env('CLOUDINARY_SECRET', env('CLOUDINARY_API_SECRET'));

    // Si no hay variables sueltas, aceptamos la URL única de Cloudinary:
    // cloudinary://<api_key>:<api_secret>@<cloud_name>
    // Se tolera que se pegue la línea completa del dashboard
    // ("CLOUDINARY_URL=cloudinary://...") o entre comillas.
    const rawCloudinaryUrl = env('CLOUDINARY_URL');
    const cloudinaryUrl = rawCloudinaryUrl
      ? String(rawCloudinaryUrl)
          .trim()
          .replace(/^cloudinary_url\s*=\s*/i, '')
          .replace(/^["']|["']$/g, '')
      : undefined;

    if ((!cloudName || !apiKey || !apiSecret) && cloudinaryUrl) {
      try {
        const parsed = new URL(cloudinaryUrl);
        cloudName = cloudName || decodeURIComponent(parsed.hostname);
        apiKey = apiKey || decodeURIComponent(parsed.username);
        apiSecret = apiSecret || decodeURIComponent(parsed.password);
      } catch {
        throw new Error(
          'CLOUDINARY_URL no tiene el formato esperado. Debe ser: ' +
            'cloudinary://API_KEY:API_SECRET@CLOUD_NAME',
        );
      }
    }

    // El SDK de Cloudinary lee `process.env.CLOUDINARY_URL` por su cuenta al
    // cargarse y aborta si no empieza por "cloudinary://". Le dejamos el valor
    // ya limpio para tolerar que se pegue la línea entera del dashboard.
    if (cloudinaryUrl) {
      process.env.CLOUDINARY_URL = cloudinaryUrl;
    }

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error(
        'UPLOAD_PROVIDER=cloudinary pero faltan credenciales. ' +
          'Define CLOUDINARY_URL (una sola variable) o bien CLOUDINARY_NAME, ' +
          'CLOUDINARY_KEY y CLOUDINARY_SECRET en Render ' +
          '(o borra UPLOAD_PROVIDER para usar el almacenamiento local).',
      );
    }

    return {
      upload: {
        config: {
          provider: 'cloudinary',
          providerOptions: {
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret,
          },
          actionOptions: {
            upload: {},
            uploadStream: {},
            delete: {},
          },
        },
      },
    };
  }

  // Alternativa S3-compatible (Cloudflare R2, Backblaze B2, Supabase, AWS S3).
  // Requiere instalar: npm i @strapi/provider-upload-aws-s3@5.33.1
  if (provider === 'aws-s3') {
    return {
      upload: {
        config: {
          provider: 'aws-s3',
          providerOptions: {
            baseUrl: env('AWS_BASE_URL', undefined),
            rootPath: env('AWS_ROOT_PATH', undefined),
            s3Options: {
              credentials: {
                accessKeyId: env('AWS_ACCESS_KEY_ID'),
                secretAccessKey: env('AWS_ACCESS_SECRET'),
              },
              region: env('AWS_REGION', 'auto'),
              endpoint: env('AWS_ENDPOINT', undefined),
              params: {
                Bucket: env('AWS_BUCKET'),
              },
            },
          },
          actionOptions: {
            upload: {},
            uploadStream: {},
            delete: {},
          },
        },
      },
    };
  }

  return {};
};
