const { build } = require('esbuild');

/**
 * @type {import('esbuild').BuildOptions}
 */
const commonServer = {
  entryPoints: ['src/server.tsx'],
  platform: 'node',
};

/**
 * @type {import('esbuild').BuildOptions}
 */
const commonClient = {
  entryPoints: ['src/client.tsx'],
  platform: 'node',
  sourcemap: 'external',
  minify: true,
};

/**
 * @type {Record<string, import('esbuild').BuildOptions>}
 */
const configs = {
  serverCjs: {
    ...commonServer,
    outfile: 'dist/server.cjs',
    format: 'cjs',
    target: 'node12',
  },
  serverEsm: {
    ...commonServer,
    outfile: 'dist/server.js',
    format: 'esm',
    target: 'node18',
  },
  clientCjs: {
    ...commonClient,
    outfile: 'dist/client.cjs',
    format: 'cjs',
    target: 'es2015',
  },
  clientEsm: {
    ...commonClient,
    outfile: 'dist/client.js',
    format: 'esm',
    target: 'es2018',
  },
};

const watch = Boolean(process.env.WATCH);
const config = configs[process.env.CONFIG];

if (!config) {
  throw new Error(
    `Don't know how to build ${process.env.CONFIG}. Please set CONFIG env var`,
  );
}

build({
  ...config,
  watch: watch
    ? {
        onRebuild(err) {
          if (err) {
            console.error('ERROR', process.env.CONFIG, err);
          }
        },
      }
    : false,
  plugins: [
    {
      name: 'external',
      setup(build) {
        if (config.format === 'esm') {
          build.onResolve({ filter: /@remix-run\/react\/components/ }, () => ({
            path: '@remix-run/react/esm/components',
            external: true,
          }));
        }
        build.onResolve({ filter: /^[^./]|^\.[^./]|^\.\.[^/]/ }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
  bundle: true,
})
  .catch((err) => {
    console.error('ERROR', process.env.CONFIG, err);
    process.exit(1);
  })
  .then(() => {
    if (watch) {
      console.log('watching...');
    }
  });
