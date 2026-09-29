/**
 * Configuración de plugins.
 *
 * ── SUBIDA DE IMÁGENES (pósteres) ──────────────────────────────────────────
 * En Render el disco es EFÍMERO: si las imágenes se guardan en local
 * (public/uploads) desaparecen en cada reinicio, redeploy o siesta del plan
 * Free. Por eso en producción se suben a Cloudinary:
 *
 *   UPLOAD_PROVIDER=cloudinary
 *   CLOUDINARY_NAME=xxxxx          (Cloud name)
 *   CLOUDINARY_KEY=xxxxxxxxxxxx    (API Key)
 *   CLOUDINARY_SECRET=xxxxxxxxxx   (API Secret)
 *
 * En local, sin esas variables, se usa el proveedor local de siempre
 * (las imágenes van a public/uploads) y nada cambia.
 */
export default ({ env }) => {
  const provider = env('UPLOAD_PROVIDER', 'local');

  if (provider === 'cloudinary') {
    const cloudName = env('CLOUDINARY_NAME', env('CLOUDINARY_CLOUD_NAME'));
    const apiKey = env('CLOUDINARY_KEY', env('CLOUDINARY_API_KEY'));
    const apiSecret = env('CLOUDINARY_SECRET', env('CLOUDINARY_API_SECRET'));

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error(
        'UPLOAD_PROVIDER=cloudinary pero faltan credenciales. ' +
          'Define CLOUDINARY_NAME, CLOUDINARY_KEY y CLOUDINARY_SECRET en Render ' +
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
