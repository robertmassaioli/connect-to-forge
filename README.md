## Note

This repository has been replaced with a fork at [https://github.com/atlassian-forks/connect-to-forge](https://github.com/atlassian-forks/connect-to-forge).

## connect-to-forge

This tool is designed to let Connect developers quickly migrate their apps to Forge, starting with the Descriptor to Manifest conversion. To use this tool, simply:

```bash
npx connect-to-forge@latest --type <jira|confluence> --url https://website.com/path/to/descriptor.json
```

If you want to check out this repository and run it locally:

``` bash
yarn install
yarn start --type <jira|confluence> --url https://website.com/path/to/descriptor.json
```

Where the type variable represents the Atlassian product that this app is meant to be installed into and the URL is somewhere on the public internet that the descriptor can be downloaded from.