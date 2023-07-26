## connect-to-forge

This tool is designed to let Connect developers quickly migrate their apps to Forge, starting with the Descriptor to Manifest conversion. To use this tool, simply:

```bash
npx connect-to-forge --type <jira|confluence> --url https://website.com/path/to/descriptor.json
```

If you want to check out this repository and run it locally:

``` bash
yarn install
yarn start --type <jira|confluence> --url https://website.com/path/to/descriptor.json
```

Where the type variable represents the Atlassian product that this app is meant to be installed into and the URL is somewhere on the public internet that the descriptor can be downloaded from.