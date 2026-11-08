import { checkFiles } from './check.mjs';

try {
  const [root, encodedFiles] = process.argv.slice(2);
  const files = JSON.parse(encodedFiles);
  if (!root || !Array.isArray(files) || files.some(file => typeof file !== 'string')) {
    throw new Error('UI checker worker requires a root and JSON array of relative files.');
  }
  process.stdout.write(JSON.stringify(await checkFiles(root, files)));
} catch (error) {
  console.error(`UI checker worker failed: ${error.message}`);
  process.exitCode = 1;
}
