import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

export type PasswordReason = 'required' | 'incorrect';

export interface PdfMetadata {
  title: string | null;
  author: string | null;
  subject: string | null;
  creator: string | null;
  producer: string | null;
  pdfVersion: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  encrypted: boolean;
  hasForms: boolean;
  hasSignatures: boolean;
}

export interface ImportedPdf {
  id: string;
  file: File;
  fileName: string;
  size: number;
  lastModified: number;
  pageCount: number;
  fingerprint: string | null;
  metadata: PdfMetadata;
  session: PdfDocumentSession;
}

export interface PdfDocumentSession {
  document: PDFDocumentProxy;
  loadingTask: PDFDocumentLoadingTask;
}

export interface PdfImportProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface PdfImportOptions {
  requestPassword: (reason: PasswordReason) => Promise<string | null>;
  confirmFullRead: (fileSize: number) => Promise<boolean>;
  onProgress?: (progress: PdfImportProgress) => void;
}
