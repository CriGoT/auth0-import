#!/usr/bin/env node

const Auth0ImporterCli = require('../dist').default;

new Auth0ImporterCli().run(process.argv);
