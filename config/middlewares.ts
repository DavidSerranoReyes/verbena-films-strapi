/**
 * Middlewares de la aplicación.
 *
 * El middleware de seguridad lleva una Content Security Policy que, por
 * defecto, sólo permite mostrar imágenes servidas por Strapi. Al subir los
 * pósteres a Cloudinary hay que autorizar sus dominios (res.cloudinary.com)
 * o el panel de administración los mostrará rotos.
 */
export default ({ env }) => {
  const cloudName = env('CLOUDINARY_NAME', env('CLOUDINARY_CLOUD_NAME'));

  // Dominios extra separados por comas, por si algún día se usa R2/S3 propio.
  const extraHosts = String(env('UPLOAD_EXTRA_CSP_HOSTS', ''))
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);

  const mediaHosts = [
    "'self'",
    'data:',
    'blob:',
    'market-assets.strapi.io',
    ...(cloudName
      ? [
          'https://res.cloudinary.com',
          `https://${cloudName}.cloudinary.com`,
          'https://*.cloudinary.com',
        ]
      : []),
    ...extraHosts,
  ];

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': ["'self'", 'https:'],
            'img-src': mediaHosts,
            'media-src': mediaHosts,
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    'strapi::cors',
    'strapi::poweredBy',
    'strapi::query',
    'strapi::body',
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};
