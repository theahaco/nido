/// <reference types="astro/client" />

declare module "qrcode" {
  interface QrRenderOptions {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: {
      dark?: string;
      light?: string;
    };
  }

  const QRCode: {
    toCanvas(canvas: HTMLCanvasElement, text: string, options?: QrRenderOptions): Promise<void>;
  };

  export default QRCode;
}

interface Window {
  renderNidoQr?: (target: string | HTMLCanvasElement, value: string) => void;
  BarcodeDetector?: BarcodeDetectorConstructor;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}

interface DetectedBarcode {
  format: string;
  rawValue: string;
}

interface BarcodeDetector {
  detect(image: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: BarcodeDetectorOptions): BarcodeDetector;
  getSupportedFormats?(): Promise<string[]>;
}
