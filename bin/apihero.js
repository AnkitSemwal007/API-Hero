#!/usr/bin/env node
/**
 * CLI wrapper for the API Hero headless runner.
 * Prefer this bin entry so consumers do not depend on dist layout details.
 */
'use strict';

const { main } = require('../dist/cli/main.js');

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`apihero failed: ${message}\n`);
    process.exitCode = 1;
  });
