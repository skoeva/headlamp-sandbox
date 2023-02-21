#!/usr/bin/env node
// @ts-check
'use strict';

// Aids maintenance syncing packages between frontend/ and headlamp-plugin
// Inside headlamp-plugin: `npm run update-dependencies`.

// Some packages are used by headlamp-plugin that are not used by the frontend.
// These won't be removed from headlamp-plugin/package.json
const dependenciesFrontDoesNotHave = new Set([
  '@babel/cli',
  '@babel/core',
  '@babel/plugin-proposal-class-properties',
  '@babel/plugin-transform-react-jsx',
  '@babel/preset-env',
  '@babel/preset-react',
  '@babel/preset-typescript',
  '@remix-run/router',
  '@svgr/webpack',
  'babel-loader',
  'css-loader',
  'env-paths',
  'eslint-plugin-jsx-a11y',
  'file-loader',
  'filemanager-webpack-plugin',
  'fs-extra',
  'imports-loader',
  'shx',
  'style-loader',
  'url-loader',
  'validate-npm-package-name',
  'webpack-cli',
  'yargs',
  'is-plain-object',
  'tsconfig-paths-webpack-plugin',
  'vm-browserify',
]);

// Dependencies from frontend/package.json that aren't wanted by headlamp-plugin.
// These won't be added to headlamp-plugin/package.json
const dependenciesToNotCopy = [
  'husky',
  'typedoc',
  'typedoc-hugo-theme',
  'typedoc-plugin-markdown',
  'typedoc-plugin-rename-defaults',
];

const yargs = require('yargs/yargs');
const fs = require('fs-extra');
const headlampPluginPkg = require('../package.json');
const frontendPkg = require('../../../frontend/package.json');

/**
 * Update dependencies from frontend/package.json into headlamp-plugin/packages.json
 *
 * Because frontend/ isn't distributed as a package, we can't just depend on it.
 *
 * @param packageJsonPath {string} where the package.json is
 * @param checkOnly {boolean} if true only do a check, do not
 * @rtype {boolean}
 * @returns 1 if something changed, 0 if nothing changed.
 */
function updateDependencies(packageJsonPath, checkOnly) {
  const allFrontendDependencies = {
    ...frontendPkg.dependencies,
    ...frontendPkg.devDependencies,
  };
  const newDependencies = {
    ...allFrontendDependencies,
    ...headlampPluginPkg.dependencies,
  };
  const headlampPluginPkgOriginal = { ...headlampPluginPkg };

  const sortedDependencies = {};
  Object.keys(newDependencies)
    .sort()
    .forEach(function (key) {
      sortedDependencies[key] = newDependencies[key];
    });

  // @ts-ignore because, the keys change in the dependencies.
  headlampPluginPkg.dependencies = sortedDependencies;

  // Some dependencies from frontend/ aren't wanted.
  for (const packageName of dependenciesToNotCopy) {
    delete headlampPluginPkg.dependencies[packageName];
  }

  // We want to find if packages are removed from frontend/package.json too.
  function checkRemovedDependencies(checkOnly) {
    // Are any in the output which aren't in the input anymore?
    function keysFromANotInB(a, b) {
      return Object.keys(a).filter(k => !(k in b));
    }

    const notIn = keysFromANotInB(headlampPluginPkg.dependencies, allFrontendDependencies).filter(
      k => !dependenciesFrontDoesNotHave.has(k)
    );

    for (const packageName of notIn) {
      delete headlampPluginPkg.dependencies[packageName];
    }

    if (notIn.length > 0) {
      if (checkOnly) {
        console.log(
          '\nDependencies REMOVED from frontend/ and should also be removed from headlamp-plugin/',
          notIn
        );
      } else {
        console.warn(
          '\nDependencies REMOVED from frontend/ and now also from headlamp-plugin/',
          notIn
        );
      }
      console.warn(
        'If you want to add these dependencies to headlamp-plugin, ' +
          'please add them to the dependenciesFrontDoesNotHave list inside update-dependencies.js'
      );
    }
  }

  /**
   * The new dependencies which were added from frontend/ to headlamp-plugin/
   */
  function checkAddedDependencies(dependencies, dependenciesOriginal) {
    function keysFromANotInB(a, b) {
      return Object.keys(a).filter(k => !(k in b));
    }

    const notIn = keysFromANotInB(dependencies, dependenciesOriginal);

    if (notIn.length > 0) {
      console.log(
        'Dependencies ADDED to headlamp-plugin/package.json from frontend/package.json',
        notIn
      );
      console.warn(
        'If you want to prevent adding these dependencies to headlamp-plugin, ' +
          'please add them to the dependenciesToNotCopy list inside update-dependencies.js'
      );
    }
  }

  checkRemovedDependencies(checkOnly);
  checkAddedDependencies(headlampPluginPkg.dependencies, headlampPluginPkgOriginal.dependencies);

  const changed = JSON.stringify(headlampPluginPkgOriginal) !== JSON.stringify(headlampPluginPkg);

  if (checkOnly) {
    if (changed) {
      console.log('\nSome frontend/package.json dependencies changed.');
      console.log(
        'Please run "./bin/update-dependencies.js update" to sync dependencies from frontend/.'
      );
      return 1;
    } else {
      return 0;
    }
  }

  if (changed) {
    console.log(
      'Some frontend/package.json dependencies changed. Writing headlamp-plugin/package.json'
    );
    fs.writeFileSync(packageJsonPath, JSON.stringify(headlampPluginPkg, null, '  ') + '\n');
    return 1;
  } else {
    console.warn(
      'No frontend/package.json dependencies changed. Not writing headlamp-plugin/package.json'
    );
    return 0;
  }
}

/**
 * Update dependencies from frontend/package.json in headlamp-plugin/package.json
 *
 * @rtype {number}
 * @returns A return code, 0 if there is no problem, 1 if there is.
 */
function update() {
  updateDependencies('package.json', false);
  return 0;
}

/**
 * Check if dependencies changed
 *
 * @rtype {number}
 * @returns A return code, 1 if some do need updating, 0 if they don't
 */
function check() {
  return updateDependencies('package.json', true);
}

yargs(process.argv.slice(2))
  .command('check', 'Check if dependency updates are needed from frontend/package.json', {}, () => {
    process.exitCode = check();
  })
  .command(
    'update',
    'Update dependencies from frontend/package.json in headlamp-plugin/package.json',
    {},
    () => {
      process.exitCode = update();
    }
  )
  .demandCommand(1, '')
  .strict()
  .help().argv;
