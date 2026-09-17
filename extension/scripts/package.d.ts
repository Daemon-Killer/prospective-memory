export interface ZipArchiveResult {
  fileCount: number;
  outputFile: string;
  size: number;
  files: string[];
}

export function createZipArchive(sourceDir: string, outputFile: string): ZipArchiveResult;

export function packageAll(): {
  chrome: ZipArchiveResult;
  firefox: ZipArchiveResult;
};
