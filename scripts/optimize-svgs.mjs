import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { optimize } from 'svgo';

const resolveResourcesDir = () => {
  const input = process.argv[2];
  if (!input) {
    return path.join(process.cwd(), 'src', 'resources');
  }

  return path.isAbsolute(input) ? input : path.join(process.cwd(), input);
};

const resourcesDir = resolveResourcesDir();

const svgoConfig = {
  multipass: true,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          removeViewBox: false,
          cleanupIds: false,
        },
      },
    },
  ],
};

const formatSize = (size) => {
  if (size > 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (size > 1024) {
    return `${(size / 1024).toFixed(2)} KB`;
  }
  return `${size} B`;
};

const run = async () => {
  const dirEntries = await fs.readdir(resourcesDir, { withFileTypes: true });
  const svgFiles = dirEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.svg'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (svgFiles.length === 0) {
    console.log(`No SVG files found in ${resourcesDir}`);
    return;
  }

  let totalBefore = 0;
  let totalAfter = 0;
  let changedCount = 0;

  for (const fileName of svgFiles) {
    const filePath = path.join(resourcesDir, fileName);
    const original = await fs.readFile(filePath, 'utf8');
    const beforeSize = Buffer.byteLength(original, 'utf8');
    totalBefore += beforeSize;

    const optimized = optimize(original, { ...svgoConfig, path: filePath });

    if ('error' in optimized) {
      console.warn(`Skipping ${fileName}: ${optimized.error}`);
      continue;
    }

    const optimizedMarkup = optimized.data;
    const afterSize = Buffer.byteLength(optimizedMarkup, 'utf8');
    totalAfter += afterSize;

    if (optimizedMarkup !== original) {
      await fs.writeFile(filePath, optimizedMarkup, 'utf8');
      changedCount += 1;
    }

    console.log(
      `${fileName}: ${formatSize(beforeSize)} -> ${formatSize(afterSize)}`,
    );
  }

  const diff = totalBefore - totalAfter;
  console.log('');
  console.log(`Optimized ${changedCount}/${svgFiles.length} files.`);
  console.log(`Total: ${formatSize(totalBefore)} -> ${formatSize(totalAfter)} (${diff >= 0 ? '-' : '+'}${formatSize(Math.abs(diff))})`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
