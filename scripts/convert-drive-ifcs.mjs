import { readdir, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IfcImporter } from "@thatopen/fragments";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const args = process.argv.slice(2).filter((arg) => arg !== "--force");
const inputDir = path.resolve(
  args[0] ?? path.join(projectRoot, "source-models", "drive-ifc"),
);
const outputDir = path.resolve(
  args[1] ?? path.join(projectRoot, "protected-models"),
);
const force = process.argv.includes("--force");

function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

async function isOutputFresh(inputPath, outputPath) {
  if (force) return false;

  try {
    const [input, output] = await Promise.all([stat(inputPath), stat(outputPath)]);
    return output.mtimeMs >= input.mtimeMs;
  } catch {
    return false;
  }
}

async function convertIfc(inputPath, outputPath, id) {
  const importer = new IfcImporter();
  importer.wasm = {
    path: `${path.join(projectRoot, "node_modules", "web-ifc")}${path.sep}`,
    absolute: true,
  };

  const ifcBytes = new Uint8Array(await readFile(inputPath));
  const fragmentBytes = await importer.process({
    id,
    bytes: ifcBytes,
    raw: false,
  });

  await writeFile(outputPath, fragmentBytes);
  return {
    inputBytes: ifcBytes.byteLength,
    outputBytes: fragmentBytes.byteLength,
  };
}

await mkdir(outputDir, { recursive: true });

const files = (await readdir(inputDir))
  .filter((file) => file.toLowerCase().endsWith(".ifc"))
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  throw new Error(`No IFC files found in ${inputDir}`);
}

for (const file of files) {
  const baseName = path.basename(file, path.extname(file));
  const id = slugify(baseName);
  const inputPath = path.join(inputDir, file);
  const outputPath = path.join(outputDir, `${id}.frag`);

  if (await isOutputFresh(inputPath, outputPath)) {
    console.log(`skip ${file} -> ${path.basename(outputPath)} (fresh)`);
    continue;
  }

  console.log(`convert ${file} -> ${path.basename(outputPath)}`);
  const { inputBytes, outputBytes } = await convertIfc(inputPath, outputPath, id);
  console.log(`done ${id}: ${inputBytes} bytes IFC -> ${outputBytes} bytes frag`);
}
