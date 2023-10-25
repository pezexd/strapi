import type { CLIContext } from '@strapi/strapi';
import * as tsUtils from '@strapi/typescript-utils';
import { joinBy } from '@strapi/utils';
import chokidar from 'chokidar';

import { getTimer } from './core/timer';
import { checkRequiredDependencies } from './core/dependencies';
import { createBuildContext } from './createBuildContext';
import { watch as watchWebpack } from './webpack/watch';

import EE from '@strapi/strapi/dist/utils/ee';
import { writeStaticClientFiles } from './staticFiles';

interface DevelopOptions extends CLIContext {
  polling?: boolean;
  open?: boolean;
}

const develop = async ({ cwd, polling, logger, tsconfig, strapi, ...options }: DevelopOptions) => {
  const timer = getTimer();

  const { didInstall } = await checkRequiredDependencies({ cwd, logger }).catch((err) => {
    logger.error(err.message);
    process.exit(1);
  });

  if (didInstall) {
    return;
  }

  timer.start('createBuildContext');
  const contextSpinner = logger.spinner(`Building build context`).start();
  console.log('');

  const ctx = await createBuildContext({
    cwd,
    logger,
    options,
    strapi,
  });
  const contextDuration = timer.end('createBuildContext');
  contextSpinner.text = `Building build context (${contextDuration}ms)`;
  contextSpinner.succeed();

  timer.start('creatingAdmin');
  const adminSpinner = logger.spinner(`Creating admin`).start();

  EE.init(cwd);
  await writeStaticClientFiles(ctx);
  await watchWebpack(ctx);

  const adminDuration = timer.end('creatingAdmin');
  adminSpinner.text = `Creating admin (${adminDuration}ms)`;
  adminSpinner.succeed();

  const strapiInstance = await strapi.load();

  timer.start('generatingTS');
  const generatingTsSpinner = logger.spinner(`Generating types`).start();

  await tsUtils.generators.generate({
    strapi: strapiInstance,
    pwd: cwd,
    rootDir: undefined,
    logger: { silent: true, debug: false },
    artifacts: { contentTypes: true, components: true },
  });

  const generatingDuration = timer.end('generatingTS');
  generatingTsSpinner.text = `Generating types (${generatingDuration}ms)`;
  generatingTsSpinner.succeed();

  if (tsconfig?.config) {
    timer.start('compilingTS');
    const compilingTsSpinner = logger.spinner(`Compiling TS`).start();

    tsUtils.compile(cwd, { configOptions: { ignoreDiagnostics: false } });

    const compilingDuration = timer.end('compilingTS');
    compilingTsSpinner.text = `Compiling TS (${compilingDuration}ms)`;
    compilingTsSpinner.succeed();
  }

  const restart = async () => {
    if (strapiInstance.reload.isWatching && !strapiInstance.reload.isReloading) {
      strapiInstance.reload.isReloading = true;
      strapiInstance.reload();
    }
  };

  const watcher = chokidar
    .watch(cwd, {
      ignoreInitial: true,
      usePolling: polling,
      ignored: [
        /(^|[/\\])\../, // dot files
        /tmp/,
        '**/src/admin/**',
        '**/src/plugins/**/admin/**',
        '**/dist/src/plugins/test/admin/**',
        '**/documentation',
        '**/documentation/**',
        '**/node_modules',
        '**/node_modules/**',
        '**/plugins.json',
        '**/build',
        '**/build/**',
        '**/index.html',
        '**/public',
        '**/public/**',
        strapiInstance.dirs.static.public,
        joinBy('/', strapiInstance.dirs.static.public, '**'),
        '**/*.db*',
        '**/exports/**',
        '**/dist/**',
        '**/*.d.ts',
        ...strapiInstance.config.get('admin.watchIgnoreFiles', []),
      ],
    })
    .on('add', (path) => {
      strapiInstance.log.info(`File created: ${path}`);
      restart();
    })
    .on('change', (path) => {
      strapiInstance.log.info(`File changed: ${path}`);
      restart();
    })
    .on('unlink', (path) => {
      strapiInstance.log.info(`File deleted: ${path}`);
      restart();
    });

  process.on('message', async (message) => {
    switch (message) {
      case 'kill': {
        await watcher.close();
        await strapiInstance.destroy();
        process.send?.('killed');
        process.exit();
        break;
      }
      default:
        break;
    }
  });

  strapiInstance.start();
};

export { develop };
export type { DevelopOptions };
