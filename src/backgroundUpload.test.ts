import { describe, expect, it } from 'vitest';

import { validateBackgroundFile } from './backgroundUpload';
import { MAX_BACKGROUND_IMAGE_BYTES } from './state/types';

describe('background upload validation', () => {
  it('accepts image mime types under the size limit', () => {
    const error = validateBackgroundFile({
      name: 'yard-photo.bin',
      type: 'image/png',
      size: MAX_BACKGROUND_IMAGE_BYTES - 1,
    });

    expect(error).toBeNull();
  });

  it('accepts image file extensions when mime type is missing', () => {
    const error = validateBackgroundFile({
      name: 'yard-photo.jpg',
      type: '',
      size: MAX_BACKGROUND_IMAGE_BYTES - 1,
    });

    expect(error).toBeNull();
  });

  it('rejects non-image files', () => {
    const error = validateBackgroundFile({
      name: 'notes.txt',
      type: 'text/plain',
      size: 1024,
    });

    expect(error).toBe('Please choose an image file.');
  });

  it('rejects files that are 9MB or larger', () => {
    const error = validateBackgroundFile({
      name: 'yard-photo.png',
      type: 'image/png',
      size: MAX_BACKGROUND_IMAGE_BYTES,
    });

    expect(error).toBe('Image must be smaller than 9MB.');
  });
});
