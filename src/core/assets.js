import { uid } from './ids.js';
import { PH } from './placeholder.js';

export const FOLDERS = ['All files', 'Brand', 'Product', 'Photography', 'Uploads'];

export const seedAssets = () => [
  { id: uid(), name: 'logo-lockup.png', url: PH('logo lockup', 480, 180), folder: 'Brand', w: 480, ht: 180, size: 18400 },
  { id: uid(), name: 'hero-workshop.jpg', url: PH('workshop hero', 600, 340), folder: 'Photography', w: 600, ht: 340, size: 142000 },
  { id: uid(), name: 'jacket-03-front.jpg', url: PH('jacket 03 front', 520, 360), folder: 'Product', w: 520, ht: 360, size: 98000 },
  { id: uid(), name: 'jacket-03-detail.jpg', url: PH('jacket 03 detail', 520, 360), folder: 'Product', w: 520, ht: 360, size: 91000 },
  { id: uid(), name: 'boots-pair.jpg', url: PH('boots pair', 520, 360), folder: 'Product', w: 520, ht: 360, size: 88000 },
  { id: uid(), name: 'texture-waxed.jpg', url: PH('waxed texture', 600, 240), folder: 'Photography', w: 600, ht: 240, size: 64000 },
];

export const KB = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
