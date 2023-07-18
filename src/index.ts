import fs from 'fs';
import axios from 'axios';
import yaml from 'js-yaml';
import { program } from 'commander';
import inquirer from 'inquirer';
import { error } from 'console';
import { isPresent } from 'ts-is-present';

// Typings for Atlassian Connect Descriptor
interface ConnectDescriptor {
  name: string;
  key: string;
  baseUrl: string;
  scopes: string[];
  lifecycle?: Record<string, string>;
  modules: Record<string, any>;
}

// Typings for Forge Manifest
interface ForgeManifest {
  app: {
    connect: {
      key: string;
      authentication?: string;
      remote: string;
    };
  };
  remotes: { key: string; baseUrl: string }[];
  connectModules: Record<string, any>;
  permissions: {
    scopes: string[];
  };
}

// Commander setup
program
  .requiredOption('-u, --url <url>', 'Atlassian Connect descriptor URL')
  .option('-t, --type <type>', 'App type (jira or confluence)')
  .option('-o, --output <path>', 'Output file path', 'manifest.yml')
  .name('connect-to-forge')
  .usage('--type <jira|confluence> --url https://website.com/path/to/descriptor.json')
  .parse(process.argv);

const { url, type, output } = program.opts();

// Helper function to download Atlassian Connect descriptor
async function downloadConnectDescriptor(url: string): Promise<ConnectDescriptor> {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    console.error(`Error downloading Atlassian Connect descriptor at ${url}: ${error}`);
    process.exit(1);
  }
}

// Helper function to convert Atlassian Connect descriptor to Forge Manifest
function convertToForgeManifest(connect: ConnectDescriptor, type: 'jira' | 'confluence'): [ForgeManifest, string[]] {
  let manifest: ForgeManifest = {
    app: {
      connect: {
        key: connect.key,
        remote: 'connect'
      }
    },
    remotes: [
      {
        key: 'connect',
        baseUrl: connect.baseUrl
      }
    ],
    connectModules: {},
    permissions: {
      scopes: []
    }
  };

  let warnings: string[] = [];

  console.log(`Conversion begun for '${connect.name}':`);
  console.log('');

  // Add lifecycle events
  if (connect.lifecycle) {
    const moduleName = `${type}:lifecycle`;
    manifest.connectModules[moduleName] = [{ key: 'lifecycle-events', ...connect.lifecycle }];
    console.log(` - Moved all lifecycle events into connectModules.${moduleName}.`);
    manifest.app.connect.authentication = 'jwt';
  }

  // Add modules
  if (connect.modules) {
    for (const [moduleType, moduleContent] of Object.entries(connect.modules)) {
      manifest.connectModules[`${type}:${moduleType}`] = moduleContent;
    }
    console.log(` - Moved ${Object.keys(connect.modules).length} modules into connectModules in the Manifest`);
  }

  // Add webhooks with keys
  const webhooks = connect.modules.webhooks;
  if (webhooks && Array.isArray(webhooks)) {
    webhooks.forEach((webhook, index) => {
      manifest.connectModules[`${type}:webhooks`][index].key = `webhook-${index + 1}`;
    });
    console.log(` - Ensured all webhooks have automatically generated keys.`)
  }

  // Add scopes
  if(isPresent(connect.scopes) && connect.scopes.length > 0) {
    connect.scopes.forEach(scope => {
      if (scope.toLocaleLowerCase() === 'act_as_user') {
        warnings.push('ACT_AS_USER scope is not supported in Forge manifest.');
      } else {
        let forgeScope = scope.toLowerCase().replace('_', '-');
        manifest.permissions.scopes.push(`${forgeScope}:connect-${type}`);
      }
    });
    console.log(` - Converted ${connect.scopes.length} connect scopes into correct format in manifest.`);
  }

  console.log('');

  return [manifest, warnings];
}

async function main() {
  const connectDescriptor = await downloadConnectDescriptor(url);
  const [forgeManifest, warnings] = convertToForgeManifest(connectDescriptor, type as 'jira' | 'confluence');

  if (warnings.length > 0) {
    console.warn('Warnings detected:');
    warnings.forEach(warning => console.warn(`- ${warning}`));

    const { proceed } = await inquirer.prompt([
      {
        name: 'proceed',
        type: 'confirm',
        message: 'Do you wish to proceed with manifest generation despite the warnings?',
        default: false
      }
    ]);

    if (!proceed) {
      process.exit(0);
    }
  }

  const manifestYaml = yaml.dump(forgeManifest);
  fs.writeFileSync(output, manifestYaml);
  console.log(`Forge manifest generated and saved to ${output}`);
}

main().catch(e => {
  console.error(`Program failed to catche error: ${error}`);
});