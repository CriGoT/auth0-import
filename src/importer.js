import rp from 'request-promise-native';
import { AuthenticationClient } from 'auth0';
import glob from 'glob';
import fs from 'fs';

/* Symbols created to use in private methods */
const getManagementToken = Symbol('getManagementToken');
const callApi = Symbol('callApi');
const getConnection = Symbol('getConnection');
const postUserImport = Symbol('postUserImport');
const waitAndCheck = Symbol('waitAndCheck');
const resetTokenTimeout = Symbol('resetTokenTimeout');
const privateState = Symbol('privateState');

/* Constants */
const MS_IN_SEC = 1000;
const RENEW_INTERVAL = 60;
const WAIT_INTERVAL = 5 * 1000;
const AUTH0_JOB_STATUS_PENDING = 'pending';
const MAX_FILE_SIZE = 500000;
const NOOP = () => {};


const readFiles = logger => filePattern => new Promise((resolve, reject) => {
  glob(filePattern, (err, files) => {
    if (err) {
      reject(err);
    } else {
      logger.debug(files, `Pattern ${filePattern} matches the following files`);
      resolve(files);
    }
  });
});

const checkFileSize = logger => (fileName) => {
  const size = fs.statSync(fileName).size;
  logger.debug(`File ${fileName} size ${size} bytes`);
  if (size > MAX_FILE_SIZE) {
    logger.warn(`File ${fileName} exceeds the limit of 500K so it won't be processed`);
    return false;
  }

  return true;
};

/**
 * Provides a class that imports files into an Auth0 connection
 *
 * @export
 * @class Auth0Importer
 */
export default class Auth0Importer {
  /**
   * Creates an instance of Auth0Importer.
   * @param {Object} options
   * @param {string} options.domain - Auth0 Domain of the account where the users will be imported
   * @param {string} options.clientID - The client ID that will be used to get a token
   * @param {string} options.clientSecret - The client Secret that will be used to obtain a token
   * @param {Object} options.logger - Object that provides methods to report progress and errors
   * @memberof Auth0Importer
   */
  constructor({ clientId, clientSecret, domain, logger }) {
    this.logger = logger || { info: NOOP, error: NOOP, debug: NOOP, warn: NOOP };
    this[privateState] = {};
    this[privateState].clientId = clientId;
    this[privateState].apiUrl = `https://${domain}/api/v2/`;
    this[privateState].authClient = new AuthenticationClient({
      domain,
      clientId,
      clientSecret
    });
  }

  [resetTokenTimeout]() {
    clearTimeout(this[privateState].tokenTimeout);
  }

  [getManagementToken]() {
    this[privateState].tokenPromise = this[privateState].authClient
      .clientCredentialsGrant({
        audience: this[privateState].apiUrl,
        scope: 'create:users read:connections'
      })
      .then((response) => {
        this.logger.debug(`API ==> Management API access token retrieved. Access token valid for ${response.expires_in} seconds`);
        this[privateState].tokenTimeout = setTimeout(
          () => this[getManagementToken](),
          Math.min((response.expires_in - RENEW_INTERVAL) * MS_IN_SEC, 2147483647));
        return response.access_token;
      });
  }

  [callApi](options) {
    this.logger.debug(`API ==> Invoking Management Api endpoint ${options.method || 'GET'} - ${options.uri}`);
    return this[privateState].tokenPromise
      .then(token => rp(Object.assign({},
        options,
        {
          uri: `${this[privateState].apiUrl}${options.uri}`,
          headers: Object.assign({
            Authorization: `Bearer ${token}`
          }, options.headers)
        }
      )));
  }

  [getConnection](name, upsert, email) {
    this.logger.info('Connection ==> Retrieving connection');
    return this[callApi]({
      method: 'GET',
      json: true,
      uri: 'connections',
      qs: {
        name
      } })
      .then((connections) => {
        if (!connections || connections.length === 0) throw new Error(`Connection ${name} was not found`);
        if (connections[0].strategy !== 'auth0') throw new Error(`Connection ${name} is not a database connection`);
        if (connections[0].enabled_clients.indexOf(this[privateState].clientId) < 0) {
          throw new Error(`Connection ${name} is not enabled for client ${this[privateState].clientId}`);
        }

        this.logger.info('Connection ==> successfully retrieved and validated');
        this.logger.debug(connections);

        return {
          startTime: new Date(),
          connection: {
            id: connections[0].id,
            name: connections[0].name
          },
          upsert: !!upsert,
          email: !!email,
          files: []
        };
      });
  }
  [waitAndCheck](name, stats) {
    return (resultString) => {
      this.logger.debug(`File: ${name} ==> Job status response ${resultString}`);
      const result = JSON.parse(resultString);
      if (result.status !== AUTH0_JOB_STATUS_PENDING) {
        return this[callApi]({ uri: `jobs/${result.id}/errors` })
          .then((errorsString) => {
            this.logger.debug(`File: ${name} ==> Job error details response ${errorsString}`);
            const errors = JSON.parse(errorsString);
            if (errors && errors.length > 0) {
              this.logger.warn(`File: ${name} ==> Import job finished with errors`);
            } else {
              this.logger.info(`File: ${name} ==> Import job finished`);
            }
            stats.files.push(Object.assign({ name, result }, { errors }));
            return stats;
          });
      }
      this.logger.debug(`File: ${name} ==> Still processing. Will check again in ${WAIT_INTERVAL / 1000} seconds`);

      return new Promise(resolve => setTimeout(resolve, WAIT_INTERVAL))
        .then(() => this[callApi]({ uri: `jobs/${result.id}` }))
        .then(this[waitAndCheck](name, stats));
    };
  }

  [postUserImport](promise, file) {
    return promise
      .then((stats) => {
        this.logger.info(`File: ${file} ==> Sending file to Auth0`);
        return this[callApi]({
          method: 'POST',
          uri: 'jobs/users-imports',
          formData: {
            users: {
              value: fs.createReadStream(file),
              options: {
                filename: file,
                contentType: 'application/json'
              }
            },
            connection_id: stats.connection.id,
            upsert: stats.upsert.toString(),
            send_completion_email: stats.email.toString()
          }
        }).then(this[waitAndCheck](file, stats));
      });
  }

  /**
   *
   *
   * @param {Object} options
   * @param {string} [options.connection] - The name of the connection where the users imported
   * @param {bool} [options.upsert] - The import Job will update existing users
   * @param {bool} [options.email] - Defines whether admins should receive an email after import
   * @param {Array} files - The files or patterns to be imported
   * @memberof Auth0Importer
   */
  import(options, files) {
    const { connection, upsert, email } = Object.assign({ upsert: false, email: false }, options);
    if (!connection || connection.length === 0) return Promise.reject(Error('You must specificy a connection name in options.connection'));

    this.logger.info('Starting import');
    this.logger.debug(options, 'Parameters');
    // we initialize the token
    this[getManagementToken]();
    this.logger.info('Enumerating all files');

    return Promise.all((files || []).map(readFiles(this.logger)))
      .then(allFiles => allFiles
        .reduce((f, current) => f.concat(current), [])
        .filter(checkFileSize(this.logger))
        .reduce(this[postUserImport].bind(this), this[getConnection](connection, upsert, email))
        .then((results) => {
          this[resetTokenTimeout]();
          if (results.files.some(f => f.errors.length > 0)) {
            this.logger.warn(`Finished importing ${results.files.length} files. Some files had errors`);
          } else {
            this.logger.info(`Finished importing ${results.files.length} files`);
          }
          return Object.assign(results, {
            endTime: new Date()
          });
        }));
  }
}
