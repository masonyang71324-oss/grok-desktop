'use strict';
const { parentPort, workerData } = require('node:worker_threads');
require('./office-preview-model.cjs')
  .buildOfficePreview(workerData.bytes, workerData.extension)
  .then(
    (model) => parentPort.postMessage({ model }),
    (error) => parentPort.postMessage({ error: error.message || 'Office preview failed' }),
  );
