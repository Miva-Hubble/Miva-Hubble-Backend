/**
 * In-memory file payload produced by multer memoryStorage for profile picture uploads.
 * Defined locally so build/deploy does not depend on global Express.Multer augmentation.
 */
export interface UploadedImageFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
