const { execSync } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const log = (msg) => console.log(`\x1b[36m[Release]\x1b[0m ${msg}`);
const success = (msg) => console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
const error = (msg) => { console.error(`\x1b[31m✖ ${msg}\x1b[0m`); process.exit(1); };

function run(command, ignoreErrors = false) {
  try {
    return execSync(command, { stdio: 'inherit', encoding: 'utf-8' });
  } catch (err) {
    if (!ignoreErrors) {
      error(`Command failed: ${command}`);
    }
    return null;
  }
}

async function prompt(question) {
  return new Promise((resolve) => {
    rl.question(`\x1b[33m? ${question}\x1b[0m`, resolve);
  });
}

async function release() {
  console.log('\n\x1b[1m🚀 Codesession CLI Release Automation\x1b[0m\n');

  // 1. Check Git Status
  log('Checking git status...');
  const status = execSync('git status --porcelain', { encoding: 'utf-8' });
  if (status.trim() !== '') {
    log('You have uncommitted changes. Committing them as "chore: prep release"...');
    run('git add .');
    run('git commit -m "chore: prep release"');
  }

  // 2. Select version bump
  const currentVersion = require('../package.json').version;
  log(`Current version is ${currentVersion}`);
  
  const bumpType = await prompt('What type of release? (patch, minor, major) [patch]: ');
  const type = bumpType.trim() || 'patch';
  
  if (!['patch', 'minor', 'major'].includes(type)) {
    error('Invalid release type. Must be patch, minor, or major.');
  }

  // 3. Run Build & Tests
  log('Running tests...');
  run('npm run test');
  success('Tests passed!');

  log('Building project...');
  run('npm run build');
  success('Build successful!');

  // 4. Bump version
  log(`Bumping version (${type})...`);
  run(`npm version ${type} -m "chore: release v%s"`);
  const newVersion = require('../package.json').version;
  success(`Bumped to v${newVersion}`);

  // 5. Push to GitHub
  log('Pushing to GitHub (commits and tags)...');
  run('git push origin main');
  run('git push origin --tags');
  success('Pushed to GitHub!');

  // 6. Publish to NPM
  const npmPublish = await prompt('Publish to NPM now? (y/N): ');
  if (npmPublish.trim().toLowerCase() === 'y') {
    log('Publishing to NPM...');
    run('npm publish');
    success('Published to NPM!');
  } else {
    log('Skipped NPM publish.');
  }

  rl.close();

  console.log('\n\x1b[32m🎉 Release Process Complete!\x1b[0m\n');
  console.log('Next manual steps for the marketplaces:');
  console.log(`1. \x1b[1mGitHub Releases\x1b[0m: Navigate to your repository's Releases tab and draft a release for \x1b[36mv${newVersion}\x1b[0m.`);
  console.log(`2. \x1b[1mGitHub Action Marketplace\x1b[0m: When drafting the GitHub Release, check the box \x1b[36m"Publish this Action to the GitHub Marketplace"\x1b[0m.`);
  console.log(`3. \x1b[1mNPM Package\x1b[0m: Ensure it shows up correctly at \x1b[36mhttps://www.npmjs.com/package/codesession-cli\x1b[0m\n`);
}

release().catch(err => {
  console.error(err);
  process.exit(1);
});
