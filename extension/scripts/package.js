import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Creates a standard, specification-compliant ZIP archive from a directory.
 * Pure Node.js standard library, zero external dependencies, 100% cross-platform.
 *
 * @param {string} sourceDir Absolute path to the directory to package
 * @param {string} outputFile Absolute path to the output .zip file
 * @returns {{ fileCount: number, outputFile: string, size: number, files: string[] }}
 */
export function createZipArchive(sourceDir, outputFile) {
  if (!existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const outDir = dirname(outputFile);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const fileEntries = [];
  function walk(dir) {
    const entries = readdirSync(dir).sort();
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const relPath = relative(sourceDir, fullPath).replace(/\\/g, '/');
        fileEntries.push({ fullPath, relPath, mtime: stat.mtime });
      }
    }
  }
  walk(sourceDir);

  const localHeaders = [];
  const cdHeaders = [];
  let currentOffset = 0;

  for (const file of fileEntries) {
    const data = readFileSync(file.fullPath);
    const uncompressedSize = data.length;
    const fileCrc = crc32(data);
    const compressedData = deflateRawSync(data);
    const compressedSize = compressedData.length;

    const mtime = file.mtime instanceof Date ? file.mtime : new Date();
    const dosTime =
      ((mtime.getHours() & 0x1f) << 11) |
      ((mtime.getMinutes() & 0x3f) << 5) |
      ((Math.floor(mtime.getSeconds() / 2)) & 0x1f);
    const year = Math.max(1980, mtime.getFullYear());
    const dosDate =
      (((year - 1980) & 0x7f) << 9) |
      (((mtime.getMonth() + 1) & 0x0f) << 5) |
      (mtime.getDate() & 0x1f);

    const nameBuf = Buffer.from(file.relPath, 'utf8');

    // Local file header (30 bytes + nameBuf.length)
    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0); // signature
    localHdr.writeUInt16LE(20, 4);         // version needed (2.0)
    localHdr.writeUInt16LE(0, 6);          // flags
    localHdr.writeUInt16LE(8, 8);          // compression method: 8 = Deflate
    localHdr.writeUInt16LE(dosTime, 10);   // last mod time
    localHdr.writeUInt16LE(dosDate, 12);   // last mod date
    localHdr.writeUInt32LE(fileCrc, 14);   // crc-32
    localHdr.writeUInt32LE(compressedSize, 18);   // compressed size
    localHdr.writeUInt32LE(uncompressedSize, 22); // uncompressed size
    localHdr.writeUInt16LE(nameBuf.length, 26);   // file name length
    localHdr.writeUInt16LE(0, 28);         // extra field length

    const fileOffset = currentOffset;
    const localRecord = Buffer.concat([localHdr, nameBuf, compressedData]);
    localHeaders.push(localRecord);
    currentOffset += localRecord.length;

    // Central directory file header (46 bytes + nameBuf.length)
    const cdHdr = Buffer.alloc(46);
    cdHdr.writeUInt32LE(0x02014b50, 0);   // signature
    cdHdr.writeUInt16LE(20, 4);           // version made by (2.0)
    cdHdr.writeUInt16LE(20, 6);           // version needed (2.0)
    cdHdr.writeUInt16LE(0, 8);            // flags
    cdHdr.writeUInt16LE(8, 10);           // compression method
    cdHdr.writeUInt16LE(dosTime, 12);     // last mod time
    cdHdr.writeUInt16LE(dosDate, 14);     // last mod date
    cdHdr.writeUInt32LE(fileCrc, 16);     // crc-32
    cdHdr.writeUInt32LE(compressedSize, 20);   // compressed size
    cdHdr.writeUInt32LE(uncompressedSize, 24); // uncompressed size
    cdHdr.writeUInt16LE(nameBuf.length, 28);   // file name length
    cdHdr.writeUInt16LE(0, 30);           // extra field length
    cdHdr.writeUInt16LE(0, 32);           // file comment length
    cdHdr.writeUInt16LE(0, 34);           // disk number start
    cdHdr.writeUInt16LE(0, 36);           // internal file attributes
    cdHdr.writeUInt32LE(0, 38);           // external file attributes
    cdHdr.writeUInt32LE(fileOffset, 42);  // relative offset of local header

    const cdRecord = Buffer.concat([cdHdr, nameBuf]);
    cdHeaders.push(cdRecord);
  }

  const cdBuf = Buffer.concat(cdHeaders);
  const cdOffset = currentOffset;
  const cdSize = cdBuf.length;

  // End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);           // signature
  eocd.writeUInt16LE(0, 4);                    // disk number
  eocd.writeUInt16LE(0, 6);                    // disk with CD
  eocd.writeUInt16LE(fileEntries.length, 8);   // records on this disk
  eocd.writeUInt16LE(fileEntries.length, 10);  // total records
  eocd.writeUInt32LE(cdSize, 12);              // size of central directory
  eocd.writeUInt32LE(cdOffset, 16);            // offset of central directory
  eocd.writeUInt16LE(0, 20);                   // comment length

  const finalZip = Buffer.concat([...localHeaders, cdBuf, eocd]);
  writeFileSync(outputFile, finalZip);

  return {
    fileCount: fileEntries.length,
    outputFile,
    size: finalZip.length,
    files: fileEntries.map((f) => f.relPath),
  };
}

/**
 * Packages all extension targets (Chrome and Firefox) into distributable zip archives.
 */
export function packageAll() {
  const rootDir = resolve(__dirname, '..');
  const chromeDir = resolve(rootDir, 'dist/chrome');
  const firefoxDir = resolve(rootDir, 'dist/firefox');
  const chromeZip = resolve(rootDir, 'dist/remy-chrome.zip');
  const firefoxZip = resolve(rootDir, 'dist/remy-firefox.zip');

  if (!existsSync(chromeDir) || !existsSync(firefoxDir)) {
    throw new Error('Build output missing. Please run "npm run build" before packaging.');
  }

  console.log('Packaging Chrome extension archive...');
  const chromeRes = createZipArchive(chromeDir, chromeZip);
  console.log(`✓ Created ${chromeZip} (${chromeRes.fileCount} files, ${chromeRes.size} bytes)`);

  console.log('Packaging Firefox extension archive...');
  const firefoxRes = createZipArchive(firefoxDir, firefoxZip);
  console.log(`✓ Created ${firefoxZip} (${firefoxRes.fileCount} files, ${firefoxRes.size} bytes)`);

  return { chrome: chromeRes, firefox: firefoxRes };
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);
if (isDirectRun) {
  try {
    packageAll();
  } catch (err) {
    console.error('Packaging failed:', err.message);
    process.exit(1);
  }
}
