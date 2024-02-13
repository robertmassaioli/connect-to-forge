import fs from 'fs';
import axios from 'axios';
import yaml from 'js-yaml';
import { program } from 'commander';
import inquirer from 'inquirer';
import { error } from 'console';
import { isPresent } from 'ts-is-present';
import merge from 'deepmerge';

// Typings for Atlassian Connect Descriptor
interface ConnectDescriptor {
  name: string;
  key: string;
  baseUrl: string;
  scopes: string[];
  lifecycle?: Record<string, string>;
  modules: Record<string, any>;
  translations?: object;
  regionBaseUrls?: object;
  cloudAppMigration?: object;
}

// Typings for Forge manifest
interface ForgeManifest {
  app: {
    id: string;
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

const UNSUPPORTED_MODULES = new Set([]);

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

function loadExistingManifest(outputFilename: string): ForgeManifest | null {
  try {
    const result = yaml.load(fs.readFileSync(outputFilename).toString('utf8'));
    console.log(`Existing ${outputFilename} file detected, will merge your Connect Modules in.`);
    console.log('');
    return result as ForgeManifest;
  } catch (e) {
    console.log(`No existing ${outputFilename} file detected, will create one.`);
    console.log('');
  }

  return null;
}

function genDefaultManifest(connect: ConnectDescriptor): ForgeManifest {
  return {
    app: {
      id: 'ari:cloud:ecosystem::app/invalid-run-forge-register', // A dummy id is required for the 'forge register' command to work.
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
}

// Helper function to convert Atlassian Connect descriptor to Forge manifest
function convertToForgemanifest(manifest: ForgeManifest, connect: ConnectDescriptor, type: 'jira' | 'confluence'): [ForgeManifest, string[]] {
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
      if (isPresent(moduleContent)) {
        // There are no singleton modules in a Forge manifest, so anything that is not an array needs to be turned into one.
        manifest.connectModules[`${type}:${moduleType}`] = Array.isArray(moduleContent) ? moduleContent : [moduleContent];
      }
    }
    console.log(` - Moved ${Object.keys(connect.modules).length} modules into connectModules in the manifest`);
  }

  // Check for unsupported modules


  const foundUnsupportedModules = Object.keys(connect.modules).filter(module => UNSUPPORTED_MODULES.has(module));
  warnings.push(...foundUnsupportedModules.map(unsupportedModule => `${unsupportedModule} is not currently supported in a Forge manifest.`))


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
      const forgeScope = scope.toLowerCase().replace(/_/g, '-');
      manifest.permissions.scopes.push(`${forgeScope}:connect-${type}`);
    });
    console.log(` - Converted ${connect.scopes.length} connect scopes into correct format in manifest.`);
  }

  // Check for translations
  if(isPresent(connect.translations)) {
    warnings.push(`Found 'translations' in Connect Descriptor. Translations for 'connectModules' not currently supported in Forge manifest and will not be copied over.`);
  }

  if(isPresent(connect.regionBaseUrls)) {
    warnings.push(`Found 'regionBaseUrls' in Connect Descriptor. Data Residency not Connect not currently supported in a Forge manifest.`);
  }

  if(isPresent(connect.cloudAppMigration)) {
    warnings.push(`Found 'cloudAppMigration' in Connect Descriptor. App Migration Platform not currently supported in a Forge manifest.`);
  }

  console.log('');

  return [manifest, warnings];
}

type ExpectedAction = 'Override' | 'Abort';

async function main() {
  const connectDescriptor = await downloadConnectDescriptor(url);
  let [forgeManifest, warnings] = convertToForgemanifest(genDefaultManifest(connectDescriptor), connectDescriptor, type as 'jira' | 'confluence');

  const existingManifest = loadExistingManifest(output);
  if (isPresent(existingManifest)) {
    if (isPresent(existingManifest?.app?.connect)) {
      const answers = await inquirer.prompt<{ action: ExpectedAction }>([
        {
          type: 'list',
          name: 'action',
          message: 'We have detected that you already have a app.connect section in your manifest.yml. How do you want your manifest.yml to be modified?',
          choices: ['Override', 'Abort'],
        }
      ]);

      if (answers.action === 'Abort') {
        console.error('Aborting as requested!');
        process.exit(0);
      } else if (answers.action === 'Override') {
        console.log('Overriding your existing manifest with a freshly generated one based on the Connect Descriptor.');
      }

      console.log('');
    } else {
      forgeManifest = merge(forgeManifest, existingManifest);
    }
  }

  if (warnings.length > 0) {
    console.warn('Warnings detected:');
    warnings.forEach(warning => console.warn(`- ${warning}`));
    console.warn('');
    console.warn(`For more information about these limitations: https://developer.atlassian.com/platform/adopting-forge-from-connect/limitations-and-differences/#incompatibilities`);
    console.warn('');

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

  // console.log('result', JSON.stringify(forgeManifest, null ,2));
  const manifestYaml = yaml.dump(forgeManifest);
  fs.writeFileSync(output, manifestYaml);
  console.log(`Forge manifest generated and saved to ${output}`);
  console.log('');
  console.log('To continue your journey by registering and deploying this app, please go to:');
  console.log('https://developer.atlassian.com/platform/adopting-forge-from-connect/how-to-adopt/#part-3--register-and-deploy-your-app-to-forge');
}

main().catch(e => {
  console.error(`Program failed to catche error: ${error}`);
});