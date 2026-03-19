import path from 'node:path';

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const packagedAppLogo = path.resolve(__dirname, 'logo/logo.png');
const appIconRoot = path.resolve(__dirname, 'assets/icons/soosta-icon');
const appIconIco = `${appIconRoot}.ico`;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: appIconRoot,
    extraResource: [packagedAppLogo],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'SoostaTimetable',
      setupIcon: appIconIco,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({
      options: {
        icon: packagedAppLogo,
      },
    }),
    new MakerDeb({
      options: {
        icon: packagedAppLogo,
      },
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      port: 3344,
      loggerPort: 3345,
      devContentSecurityPolicy: [
        "default-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' http://localhost:* ws://localhost:*",
      ].join('; '),
      devServer: {
        client: {
          webSocketURL: {
            hostname: 'localhost',
          },
        },
      },
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.ts',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
