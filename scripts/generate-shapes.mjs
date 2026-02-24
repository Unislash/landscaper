import { promises as fs } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const resourcesDir = path.join(cwd, 'src', 'resources');
const typesPath = path.join(cwd, 'src', 'state', 'types.ts');
const shapeAssetsPath = path.join(resourcesDir, 'shapeAssets.ts');

const toIdentifier = (value, used) => {
  const base = value
    .replace(/\.svg$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('');

  const prefixed = /^[a-zA-Z_]/.test(base) ? base : `shape${base}`;
  let candidate = prefixed || 'shape';
  let counter = 1;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${prefixed || 'shape'}${counter}`;
  }
  used.add(candidate);
  return candidate;
};

const readShapeOrder = async () => {
  const contents = await fs.readFile(typesPath, 'utf8');
  const match = contents.match(/export const SHAPE_OPTIONS = \\[([\\s\\S]*?)\\] as const;/);
  if (!match) {
    return [];
  }
  const matches = [...match[1].matchAll(/'([^']+)'/g)];
  return matches.map((entry) => entry[1]);
};

const writeShapeOptions = async (shapeIds) => {
  const contents = await fs.readFile(typesPath, 'utf8');
  const block = `export const SHAPE_OPTIONS = [\n${shapeIds
    .map((id) => `  '${id}',`)
    .join('\n')}\n] as const;`;

  const next = contents.replace(/export const SHAPE_OPTIONS = \\[[\\s\\S]*?\\] as const;/, block);
  await fs.writeFile(typesPath, next, 'utf8');
};

const writeShapeAssets = async (shapeIds, fileNames) => {
  const used = new Set();
  const importLines = [];
  const mappingLines = [];

  shapeIds.forEach((id) => {
    const fileName = fileNames.get(id);
    if (!fileName) {
      return;
    }
    const identifier = toIdentifier(id, used);
    importLines.push(`import ${identifier} from './${fileName}?raw';`);
    mappingLines.push(`  '${id}': ${identifier},`);
  });

  const contents = `import type { ShapeId } from '../state/types';\n\n${importLines.join(
    '\n',
  )}\n\nexport const SHAPE_SVGS = {\n${mappingLines.join('\n')}\n} satisfies Record<ShapeId, string>;\n`;

  await fs.writeFile(shapeAssetsPath, contents, 'utf8');
};

const run = async () => {
  const entries = await fs.readdir(resourcesDir, { withFileTypes: true });
  const svgFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'))
    .map((entry) => entry.name)
    .filter((name) => name !== 'shapeAssets.ts');

  const fileNames = new Map(svgFiles.map((name) => [name.replace(/\.svg$/i, ''), name]));

  const existingOrder = await readShapeOrder();
  const existingSet = new Set(existingOrder);

  const sortedNew = [...fileNames.keys()]
    .filter((id) => !existingSet.has(id))
    .sort((a, b) => a.localeCompare(b));

  const ordered = [
    ...existingOrder.filter((id) => fileNames.has(id)),
    ...sortedNew,
  ];

  if (ordered.length === 0) {
    console.log('No SVGs found in src/resources.');
    return;
  }

  await writeShapeOptions(ordered);
  await writeShapeAssets(ordered, fileNames);
  console.log(`Updated ${ordered.length} shapes.`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
