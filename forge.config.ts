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
const appBundleId = 'com.soosta.timetable';
const macAppEntitlements = path.resolve(__dirname, 'assets/entitlements.mac.plist');
const macHelperEntitlements = path.resolve(__dirname, 'assets/entitlements.mac.helper.plist');

const optionalEnv = (name: string) => {
  const value = process.env[name]?.trim();

  return value || undefined;
};

const macSignIdentity = optionalEnv('MACOS_SIGN_IDENTITY');
const macSignKeychain = optionalEnv('MACOS_SIGN_KEYCHAIN');
const macNotarizeKeychainProfile = optionalEnv('APPLE_NOTARIZE_KEYCHAIN_PROFILE');
const macNotarizeKeychain = optionalEnv('APPLE_NOTARIZE_KEYCHAIN');
const macNotarizeAppleId = optionalEnv('APPLE_ID');
const macNotarizeAppleIdPassword = optionalEnv('APPLE_APP_SPECIFIC_PASSWORD');
const macNotarizeTeamId = optionalEnv('APPLE_TEAM_ID');
const macNotarizeApiKey = optionalEnv('APPLE_API_KEY');
const macNotarizeApiKeyId = optionalEnv('APPLE_API_KEY_ID');
const macNotarizeApiIssuer = optionalEnv('APPLE_API_ISSUER');

const macOsSign =
  process.platform === 'darwin'
    ? {
        identity: macSignIdentity ?? '-',
        identityValidation: Boolean(macSignIdentity),
        ...(macSignKeychain ? { keychain: macSignKeychain } : {}),
        hardenedRuntime: Boolean(macSignIdentity),
        optionsForFile: (filePath: string) => {
          const isAppBundle = filePath.endsWith('.app');
          const isTopLevelAppBundle = isAppBundle && !filePath.includes('.app/Contents/');

          return {
            ...(isTopLevelAppBundle ? { entitlements: macAppEntitlements } : {}),
            ...(isAppBundle && !isTopLevelAppBundle ? { entitlements: macHelperEntitlements } : {}),
            ...(macSignIdentity ? {} : { hardenedRuntime: false, timestamp: 'none' }),
          };
        },
      }
    : undefined;

const macOsNotarize = (() => {
  if (!macOsSign || !macSignIdentity) {
    return undefined;
  }

  if (macNotarizeKeychainProfile) {
    return {
      keychainProfile: macNotarizeKeychainProfile,
      ...(macNotarizeKeychain ? { keychain: macNotarizeKeychain } : {}),
    };
  }

  if (macNotarizeAppleId && macNotarizeAppleIdPassword && macNotarizeTeamId) {
    return {
      appleId: macNotarizeAppleId,
      appleIdPassword: macNotarizeAppleIdPassword,
      teamId: macNotarizeTeamId,
    };
  }

  if (macNotarizeApiKey && macNotarizeApiKeyId && macNotarizeApiIssuer) {
    return {
      appleApiKey: macNotarizeApiKey,
      appleApiKeyId: macNotarizeApiKeyId,
      appleApiIssuer: macNotarizeApiIssuer,
    };
  }

  return undefined;
})();

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId,
    icon: appIconRoot,
    extraResource: [packagedAppLogo],
    ...(macOsSign ? { osxSign: macOsSign } : {}),
    ...(macOsNotarize ? { osxNotarize: macOsNotarize } : {}),
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
