const { createWorker } = require('tesseract.js');
const fsPromises = require('fs').promises;
const path = require('path');

class OCRProcessor {
  constructor() {
    this.worker = null;
  }

  async init() {
    try {
      this.worker = await createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });
      console.log('OCR worker initialized');
    } catch (error) {
      console.error('Failed to initialize OCR worker:', error);
      throw error;
    }
  }

  async processImage(imagePath) {
    if (!this.worker) {
      await this.init();
    }

    try {
      console.log('Processing image:', imagePath);
      
      const imageBuffer = await fsPromises.readFile(imagePath);
      
      const { data: { text, confidence } } = await this.worker.recognize(imageBuffer);
      
      console.log(`OCR completed with ${confidence}% confidence`);
      console.log('Extracted text:', text);
      
      return {
        text: text.trim(),
        confidence,
        lines: text.split('\n').filter(line => line.trim())
      };
    } catch (error) {
      console.error('OCR processing failed:', error);
      throw error;
    }
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      console.log('OCR worker terminated');
    }
  }

  async ensureDirectories() {
    const dirs = [
      path.join(__dirname, '..', 'downloads'),
      path.join(__dirname, '..', 'temp')
    ];

    for (const dir of dirs) {
      try {
        await fsPromises.mkdir(dir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create directory ${dir}:`, error);
      }
    }
  }
}

module.exports = OCRProcessor;