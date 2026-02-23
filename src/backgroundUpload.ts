import { MAX_BACKGROUND_IMAGE_BYTES } from './state/types';

const IMAGE_EXTENSION_PATTERN = /\.(avif|bmp|gif|heic|ico|jpe?g|png|svg|tiff?|webp)$/i;

export const BACKGROUND_IMAGE_MAX_MB = 9;

export interface BackgroundFileCandidate {
  name: string;
  type: string;
  size: number;
}

const isImageFile = (file: BackgroundFileCandidate): boolean => {
  const hasImageMimeType = file.type.startsWith('image/');
  const hasImageExtension = IMAGE_EXTENSION_PATTERN.test(file.name);

  return hasImageMimeType || hasImageExtension;
};

export const validateBackgroundFile = (file: BackgroundFileCandidate): string | null => {
  if (!isImageFile(file)) {
    return 'Please choose an image file.';
  }

  if (file.size >= MAX_BACKGROUND_IMAGE_BYTES) {
    return `Image must be smaller than ${BACKGROUND_IMAGE_MAX_MB}MB.`;
  }

  return null;
};

export const readFileAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Unable to read image data.'));
    };

    reader.onerror = () => {
      reject(new Error('Unable to read image data.'));
    };

    reader.readAsDataURL(file);
  });
