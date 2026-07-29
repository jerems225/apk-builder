'use strict';
const { PrismaClient } = require('@prisma/client');
const config = require('../config');

// Une seule instance pour tout le processus. `--watch` en développement
// recharge le module : sans ce cache global, chaque rechargement ouvrirait une
// connexion SQLite de plus jusqu'à saturation.
const globalRef = globalThis;

const prisma =
  globalRef.__apkbuildPrisma ||
  new PrismaClient({
    log: config.env === 'development' ? ['warn', 'error'] : ['error'],
  });

if (config.env === 'development') globalRef.__apkbuildPrisma = prisma;

module.exports = prisma;
