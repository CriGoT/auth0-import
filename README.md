# Auth0-Import

Simple command line to send multiple files to the Auth0 Management API.

## Requisites

- You need an Auth0 account
- Create a database connection where you want to import your users
- Create a non-interactive client
- Grant access to your client to the `Auth0 Management API`. Make sure that it has enabled the following scopes:
  - read:connections
  - create:users


## Installation

1. Clone this repo
1. Install all packages using `yarn`
1. Build the client running `npm run build`
1. Verify that the client is ready by running `bin/auth0-import.js -h`

## Usage

```
 Usage: auth0-import [options] <file1 file2 pattern ...>


  Options:

    -V, --version                         output the version number
    -v,--verbose                          Write aditional information into the output
    -c,--configFile <configuration.json>  Specifies a JSON  configuration file with the options.
                                         Command line options will override the config file options
    -o,--out <results.json>               Name of the file where the detailed results will be stored
    --auth0domain <*.auth0.com>           Auth0 domain where the user accounts will be imported
    --connectionName <name>               Name of the connection into where the users will be imported
    --clientId <client ID>                Client ID to be used by auth0-import to connect to Auth0
    --clientSecret <client Secret>        Client Secret to be used by auth0-import to call the Management API.
                                          This can also be set using the AUTH0_CLIENT_SECRET environment variable
    --upsert                              Files will not only create users but also update existing ones based on email
```
