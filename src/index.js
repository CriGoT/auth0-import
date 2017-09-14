'use strict';

import util from 'util';
import program from 'commander';
import fs from 'fs';
import Auth0Importer from './importer';


program
  .version('0.1.0')
  .usage('[options] <file1 file2 pattern ...>')
  .option('-v,--verbose', 'Write aditional information into the output')
  .option('-c,--configFile <configuration.json>','Specifies a JSON  configuration file. Command line options will override the config file options')
  .option('-o,--out <results.json>','Name of the file where the detailed results will be stored')
  .option('--auth0domain <*.auth0.com>', 'Auth0 domain where the user accounts will be imported ')
  .option('--connectionName <name>', 'Name of the connection into where the users will be imported')
  .option('--clientId <client ID>','Client ID to be used by auth0-import to connect to Auth0')
  .option('--clientSecret <client Secret>', 'Client Secret to be used by auth0-import to call the Management API')
  .option('--upsert', 'Files will not only create users but also update existing ones based on email');

/**
 * Prints the help in the standard output and finishes the execution
 *
 * @param {number} exitCode - sets the code to be emitted while finishing the program
 * @param {string} [message] - A message to be displayed before the help is printed
 * @memberof Auth0ImporterCli
 */
const printHelpAndExit = (exitCode, message = null) => {
  if (message) process.stderr.write(`${message}\n`);
  program.outputHelp();
  process.exit(exitCode || 0);
};

const addTime = display => (...params) => {
  display(`[${new Date().toISOString()}]`, ...params);
};

const displayResults = (results) => {
  const failedFiles = results.files.filter(f => f.result.summary.failed > 0);

  console.log(`\n\nTime taken: \t\t\t\t ${(results.endTime - results.startTime) / 1000} seconds`);
  console.log('\n\nUsers Imported\n');
  console.log(`\tUsers inserted: \t\t ${results.files.reduce((sum, f) => f.result.summary.inserted + sum, 0)}`);
  console.log(`\tUsers updated: \t\t\t ${results.files.reduce((sum, f) => f.result.summary.updated + sum, 0)}`);
  console.log(`\tUsers failed: \t\t\t ${results.files.reduce((sum, f) => f.result.summary.failed + sum, 0)}`);
  console.log(`\n\tTotal Users: \t\t\t ${results.files.reduce((sum, f) => f.result.summary.inserted + f.result.summary.updated + f.result.summary.failed + sum, 0)}`);
  console.log('\n\nFiles Processed\n');
  console.log(`\tFiles processed without errors:  ${results.files.length - failedFiles.length}`);
  console.log(`\tFiles processed with errors: \t ${failedFiles.length}`);
  console.log(`\n\tTotal Number of Files: \t\t ${results.files.length}`);

  if (failedFiles.length > 0) {
    console.log('\n\Files with errors:');
    failedFiles.forEach(f => console.log(`\t${f.name} [${f.errors.length} errors]`));
  }
  console.log('\n');
  return results;
};


const displayError = (err) => {
  console.error(`An error occured while trying to import the files: ${err}`);
  process.exit(-1);
};

const saveResults = (fileName) => {
  if (!fileName) return Promise.resolve();

  return results => new Promise((resolve, reject) => {
    try {
      fs.writeFileSync(fileName, JSON.stringify(results));
      console.log(`Detailed results saved to ${fileName}\n`)
      resolve(results);
    } catch (e) {
      process.stderr.write(`Unable to write results file: ${e}`);
      reject(e);
    }
  });
};

/**
 * Parses a JSON configuration file
 *
 * @param {string} path
 */
const readConfigFile = (path) => {
  return new Promise((resolve, reject) => {
    const config = {};

    if (path) {
      try {
        const configString = fs.readFileSync(path);
        Object.assign(config, JSON.parse(configString));
      } catch (e) {
        process.stderr.write(`Unable to read configuration file: ${e}`);
        reject(e);
      }
    }
    resolve(config);
  });
};

/**
 * Validates that all required information is available
 *
 * @param {Object} config
 */
const validateConfig = (config) => {
  if (!program.args || program.args.length === 0) printHelpAndExit(2, 'You must specify a file to import');

  if (!config.auth0domain) printHelpAndExit(3, 'You must specify the Auth0 domain where you want to import the users');
  if (!config.clientId) printHelpAndExit(4, 'You must specify a client Id in either the configuration file or the command line');
  if (!config.clientSecret) printHelpAndExit(5, 'You must specify a client  secret in either the configuration file, the command line or the AUTH0_CLIENT_SECRET environment variable');
  if (!config.connectionName) printHelpAndExit(6, 'You must specify a connection name in either the configuration file or the command line');
};

/**
 * Implementes a CLI to import users into an Auth0 Connection
 *
 * @class Auth0ImporterCli
 */
export default class Auth0ImporterCli {
  constructor(options) {
    this.options = options;
  }

  /**
   *
   *
   * @param {Array} args
   * @returns
   * @memberof Auth0ImporterCli
   */
  run(args) {
    program.parse(args);

    return readConfigFile(program.configFile)
      .then((config) => {
        // Override configuration with values passed in command line
        this.config = Object.assign(config, program);

        // We allow to override the client secret with environment variables
        this.config.clientSecret = process.env.AUTH0_CLIENT_SECRET || this.config.clientSecret;

        validateConfig(this.config);

        return new Auth0Importer({
          domain: this.config.auth0domain,
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          logger: {
            log: addTime(console.log),
            error: addTime(console.log),
            debug: addTime(this.config.verbose ? console.log : () => {})
          }
        }).import({
          connection: this.config.connectionName,
          upsert: this.config.upsert,
          email: this.config.email
        }, this.config.args)
          .then(displayResults)
          .then(saveResults(this.config.out))
          .catch(displayError);
      })
      .catch(e => printHelpAndExit(-1, e.toString()));
  }
}
