import type { ActivityDefinition } from '../../types';

export const documentActivities: ActivityDefinition[] = [
  {
    id: 'read-pdf',
    name: 'Read PDF',
    category: 'documents',
    group: 'PDF',
    icon: '📄',
    description: 'Extracts selectable text from a digital PDF',
    color: '#B91C1C',
    nodeType: 'activity',
    properties: [
      { name: 'path', label: 'PDF File Path', type: 'expression', defaultValue: '', required: true },
      { name: 'output', label: 'Output Variable', type: 'variable', defaultValue: 'pdfText', required: true },
    ],
  },
  {
    id: 'ocr-image',
    name: 'OCR Image',
    category: 'documents',
    group: 'OCR',
    icon: '🔎',
    description: 'Recognizes text in an image using local OCR',
    color: '#B91C1C',
    nodeType: 'activity',
    properties: [
      { name: 'path', label: 'Image File Path', type: 'expression', defaultValue: '', required: true },
      { name: 'language', label: 'OCR Language', type: 'string', defaultValue: 'eng', required: true, description: 'Tesseract language code, for example eng or deu' },
      { name: 'output', label: 'Output Variable', type: 'variable', defaultValue: 'ocrText', required: true },
    ],
  },
  {
    id: 'ocr-pdf',
    name: 'OCR PDF',
    category: 'documents',
    group: 'OCR',
    icon: '🗎',
    description: 'Renders a scanned PDF and recognizes text on each page',
    color: '#B91C1C',
    nodeType: 'activity',
    properties: [
      { name: 'path', label: 'PDF File Path', type: 'expression', defaultValue: '', required: true },
      { name: 'language', label: 'OCR Language', type: 'string', defaultValue: 'eng', required: true, description: 'Tesseract language code, for example eng or deu' },
      { name: 'output', label: 'Output Variable', type: 'variable', defaultValue: 'ocrText', required: true },
    ],
  },
];