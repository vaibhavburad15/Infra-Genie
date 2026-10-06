import { Unzip } from 'fflate';

export const BLOCKED_DEPENDENCY_FOLDER_NAMES = new Set([
  'node_modules',
  'venv',
  '.venv',
  'env',
  '.env',
  'myenv',
  '__pycache__',
  '.tox',
  '.nox',
  '__pypackages__',
]);

const MAX_DISPLAYED_DEPENDENCY_PATHS = 10;
const DEPENDENCY_FOLDER_MESSAGE =
  'Your ZIP contains dependency folders: {paths}. Remove these folders, create a new ZIP, and upload it again.';
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04], // local file header
  [0x50, 0x4b, 0x01, 0x02], // central directory entry
  [0x50, 0x4b, 0x05, 0x06], // empty archive end record
  [0x50, 0x4b, 0x06, 0x06], // ZIP64 end record
  [0x50, 0x4b, 0x07, 0x08], // data descriptor
];

export type ZipValidationResult =
  | { valid: true }
  | { valid: false; message: string };

function normalizeArchivePath(name: string): string {
  return name.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+/, '');
}

function archiveComponents(name: string): string[] {
  return normalizeArchivePath(name).split('/').filter(Boolean);
}

function hasZipSignature(bytes: Uint8Array): boolean {
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    if (ZIP_SIGNATURES.some((signature) =>
      signature.every((value, offset) => bytes[index + offset] === value),
    )) {
      return true;
    }
  }
  return false;
}

function dependencyFolderMessage(paths: Map<string, string>): string {
  const uniquePaths = [...paths.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b),
  );
  const shown = uniquePaths.slice(0, MAX_DISPLAYED_DEPENDENCY_PATHS);
  const remaining = uniquePaths.length - shown.length;
  if (remaining > 0) shown.push(`and ${remaining} more`);
  return DEPENDENCY_FOLDER_MESSAGE.replace('{paths}', shown.join(', '));
}

function dependencyFoldersForEntry(rawName: string): Set<string> {
  const normalized = normalizeArchivePath(rawName);
  const components = archiveComponents(normalized);
  const detected = new Set<string>();
  if (!components.length) return detected;

  const isDirectory = normalized.endsWith('/');
  const folderComponents = isDirectory ? components : components.slice(0, -1);
  folderComponents.forEach((component, index) => {
    if (BLOCKED_DEPENDENCY_FOLDER_NAMES.has(component.toLowerCase())) {
      detected.add(folderComponents.slice(0, index + 1).join('/'));
    }
  });

  if (!isDirectory && components[components.length - 1].toLowerCase() === 'pyvenv.cfg') {
    const containingFolder = components.slice(0, -1).join('/');
    detected.add(containingFolder || '.');
  }
  return detected;
}

/**
 * Inspect ZIP central-directory metadata only. No archive member is started,
 * decompressed, written to disk, or executed.
 */
export async function validateZipContents(file: File): Promise<ZipValidationResult> {
  if (file.size === 0) return { valid: false, message: 'The ZIP archive is empty.' };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { valid: false, message: 'Unable to read the ZIP archive.' };
  }

  return new Promise((resolve) => {
    let entryCount = 0;
    const detected = new Map<string, string>();
    const unzipper = new Unzip();
    unzipper.onfile = (entry) => {
      entryCount += 1;
      dependencyFoldersForEntry(entry.name).forEach((path) => {
        detected.set(path.toLowerCase(), path);
      });
    };

    try {
      // Do not register a decompressor or call entry.start(): metadata is all
      // that is needed for this validation.
      unzipper.push(bytes, true);
    } catch {
      resolve({ valid: false, message: 'Invalid or unsupported archive. Only ZIP files are supported.' });
      return;
    }

    if (!hasZipSignature(bytes)) {
      resolve({ valid: false, message: 'Invalid or unsupported archive. Only ZIP files are supported.' });
      return;
    }

    if (entryCount === 0) {
      resolve({ valid: false, message: 'The ZIP archive is empty.' });
    } else if (detected.size > 0) {
      resolve({ valid: false, message: dependencyFolderMessage(detected) });
    } else {
      resolve({ valid: true });
    }
  });
}
