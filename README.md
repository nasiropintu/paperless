# Paperless — Local Scan Desk

Paperless is a PWA-first document scanner. Its core scan flow runs in the browser: camera capture and image import, multipage page management, perspective correction, image enhancement, searchable English OCR, local library organization, and PDF/image export. It does not need a Manus login, application server, database, paid OCR API, or cloud document storage.

## Run it

```bash
pnpm install --frozen-lockfile
pnpm dev:static
```

Useful checks and production build:

```bash
pnpm check
pnpm build:static
```

## Where documents live

Scans are kept in IndexedDB in the current browser profile. The service worker caches the app shell and static resources; OCR worker/core/model files are cached after the first OCR load, so previously loaded OCR can continue offline. The browser may remove local site data, and there is no cross-device sync or account recovery. Export important documents regularly.

Camera access requires a secure browser context and permission. If camera access is denied or unavailable, use **Import images**. OCR currently bundles the English Tesseract model and runs on-device. The initial OCR language file adds about 11 MB to the site package; scan images and recognized text are not sent to an OCR service. The trained data is sourced from https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz.

## Export and redaction notes

PDFs and page images are rendered locally. Markup and redaction marks are flattened into exported copies; the original scan remains in the local library. **Encrypt copy** creates an AES-GCM protected `.paperless` file, not a standard password-encrypted PDF; it can be unlocked in Paperless with the password. The password cannot be recovered.

## PWA and native migration

The install manifest, raster icons, static route declaration, and service worker live under `client/public/`. The IndexedDB adapter is in `client/src/lib/documentStore.ts`, scan/image transformations in `client/src/lib/scanProcessing.ts`, and PDF/sharing helpers in `client/src/lib/documentExport.ts`. Keeping those browser-specific adapters separate makes it easier to replace storage, camera capture, and canvas processing when building a native client later. The current project is configured as a static PWA with the managed server and database disabled.

The custom name selected on first launch changes the workspace label and page title. The browser's installed-app label remains **Paperless** because the install manifest is static.

The bundled Tesseract OCR worker/core and English model include their Apache 2.0 license texts under `client/public/vendor/tesseract/` and `client/public/tessdata/`.

## Open-source credits

Paperless is built with React, Vite, Tesseract.js, and pdf-lib, alongside the packages listed in `package.json`. Their respective license and notice files are retained with the project, including the bundled Tesseract assets.

## Creator

**NasirPintu** (Mohammad Nasiruddin Pintu) · Creator, Product Architect & Open-Source Builder

* GitHub: [@nasiropintu](https://github.com/nasiropintu)
* X: [@nasiropintu](https://x.com/nasiropintu)
* Instagram: [@the_np2](https://www.instagram.com/the_np2/)
* Facebook: [mohammadnasiruddin.pintu](https://www.facebook.com/mohammadnasiruddin.pintu/)

The app includes an About panel with creator links and a project-level AI assistance disclosure. Specific model or assistant credits should reflect documented contributions; they are not inferred from this branding kit.

## License

Paperless is released under the MIT License. Third-party components and bundled assets remain subject to their own licenses and notices.
