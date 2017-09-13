'use latest';

import program from 'commander';

program
  .version('0.1.0')
  .option('-v,--verbose', 'Write aditional information into the output')
  .option('-i,--input <file or directory>', 'The files to be imported using the management API. Each file in the directory will be considered a file to be posted')
  .option('-c,--config-file','Specifies a JSON  configuration file. Command line options will override the config file options')
  .option('--domain', 'Auth0 domain where the user accounts will be imported ')
  .option('--connection-name', 'Name of the connection into where the users will be imported')
  .option('--client-id','Client ID to be used by auth0-import to connect to Auth0')
  .option('--client-secret', 'Client Secret to be used by auth0-import to call the Management API')
  .parse(process.argv);

if (!program.input || (program.config === undefined && (program.domain === undefined || program['client-id'] === undefined || program['client-secret'] === undefined))) {
  program.outputHelp();
  process.exit(1);
}
